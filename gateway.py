import json
import math
import os
import re
import statistics
import sqlite3
import threading
import time
import uuid
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timezone


FIREBASE_DATABASE_URL = os.getenv(
    "FIREBASE_DATABASE_URL",
    "https://yuta-db-default-rtdb.asia-southeast1.firebasedatabase.app",
).rstrip("/")
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyACM0")
BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))
QUEUE_PATH = os.getenv(
    "GATEWAY_QUEUE_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "gateway-outbox.sqlite3"),
)
SYNC_RETRY_SECONDS = 2
OCR_TEST_SECONDS = 60
OCR_SAMPLE_INTERVAL = 0.5
OCR_STABLE_SAMPLES = 4
OCR_NUMBER_PATTERN = re.compile(r"(?<![\d.])(?:\d+(?:\.\d*)?|\.\d+)(?![\d.])")

NUMERIC_FIELDS = (
    "rawIR",
    "temperatureC",
    "testVoltage",
    "motorVoltage",
    "minutes",
    "raw_ab",
    "raw_bc",
    "raw_ca",
    "raw_ag",
    "raw_bg",
    "raw_cg",
)
REQUIRED_FIELDS = (
    "motorId",
    "motorVoltage",
    "ncAuxSafe",
    "zeroVoltageSafe",
)


def build_log_record(data, timestamp=None):
    if not isinstance(data, dict):
        raise ValueError("Arduino message must be a JSON object")

    missing = [field for field in REQUIRED_FIELDS if field not in data]
    if missing:
        raise ValueError(f"Missing required field(s): {', '.join(missing)}")

    motor_id = data["motorId"]
    if not isinstance(motor_id, str) or not motor_id.strip():
        raise ValueError("motorId must be a non-empty string")

    for field in ("ncAuxSafe", "zeroVoltageSafe"):
        if not isinstance(data[field], bool):
            raise ValueError(f"{field} must be a JSON boolean")

    values = {}
    for field in NUMERIC_FIELDS:
        if field not in data:
            continue
        value = data[field]
        if isinstance(value, bool):
            raise ValueError(f"{field} must be a finite number")
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field} must be a finite number") from None
        if not math.isfinite(value):
            raise ValueError(f"{field} must be a finite number")
        values[field] = value

    safety_ok = data["ncAuxSafe"] and data["zeroVoltageSafe"]
    if values["motorVoltage"] <= 0:
        raise ValueError("motorVoltage must be greater than zero")

    record = {
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "motorId": motor_id.strip(),
        "motorVoltage": values["motorVoltage"],
        "ratedVoltage": values["motorVoltage"],
        "ncAuxSafe": data["ncAuxSafe"],
        "zeroVoltageSafe": data["zeroVoltageSafe"],
        "safetyOK": safety_ok,
        "source": "arduino",
        "employeeId": str(data.get("employeeId", "N/A")),
        "operatorName": str(data.get("operatorName", "Arduino Operator")),
    }

    if "motorName" in data:
        record["motorName"] = str(data["motorName"])

    if not safety_ok:
        record["measurementAvailable"] = False
        record["status"] = "SAFETY INTERLOCK FAILED"
        return record

    if "testVoltage" not in values or values["testVoltage"] <= 0:
        raise ValueError("testVoltage must be greater than zero")

    line_fields = ("raw_ab", "raw_bc", "raw_ca", "raw_ag", "raw_bg", "raw_cg")
    available_lines = [values[field] for field in line_fields if field in values]
    if any(value < 0 for value in available_lines):
        raise ValueError("IR measurements must be non-negative")
    raw_ir = values.get("rawIR")
    if raw_ir is None:
        if not available_lines:
            raise ValueError("At least one IR measurement is required")
        raw_ir = min(available_lines)
    if raw_ir < 0:
        raise ValueError("rawIR must be physically valid")

    temperature = values.get("temperatureC")
    if temperature is not None and temperature < -273.15:
        raise ValueError("temperatureC must be physically valid")
    correction = 1.0
    if temperature is not None:
        correction = (
            0.5 ** ((temperature - 40.0) / 10.0)
            if temperature >= 40.0
            else 2.0 ** ((40.0 - temperature) / 10.0)
        )
    corrected_ir = round(raw_ir * correction, 3)
    threshold_ir = round(values["motorVoltage"] / 1000.0 + 1.0, 3)
    if not math.isfinite(corrected_ir) or not math.isfinite(threshold_ir):
        raise ValueError("calculated IR values must be finite")

    record.update({
        "measurementAvailable": True,
        "rawIR": raw_ir,
        "testVoltage": values["testVoltage"],
        "correctedIR": corrected_ir,
        "thresholdIR": threshold_ir,
        "status": "NORMAL" if corrected_ir >= threshold_ir else "MAINTENANCE ALERT",
    })
    if temperature is not None:
        record["temperatureC"] = temperature
    if "minutes" in values:
        record["minutes"] = values["minutes"]
    for field in line_fields:
        if field in values:
            record[field] = values[field]

    return record


def sync_to_firebase(record, session, auth_token=None):
    sync_to_firebase_with_id(record, session, auth_token)


def sync_to_firebase_with_id(record, session, auth_token=None, record_id=None):
    auth = {"auth": auth_token} if auth_token else None
    live_response = session.put(
        f"{FIREBASE_DATABASE_URL}/live.json",
        params=auth,
        json=record,
        timeout=10,
    )
    live_response.raise_for_status()

    if record_id is None:
        history_response = session.post(
            f"{FIREBASE_DATABASE_URL}/history.json",
            params=auth,
            json=record,
            timeout=10,
        )
    else:
        history_response = session.put(
            f"{FIREBASE_DATABASE_URL}/history/{record_id}.json",
            params=auth,
            json=record,
            timeout=10,
        )
    history_response.raise_for_status()


class DurableOutbox:
    """Persist accepted readings locally until Firebase confirms both writes."""

    def __init__(self, path=QUEUE_PATH):
        self.path = path
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS outbox (
                    record_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS gateway_cache (
                    cache_key TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.execute("PRAGMA synchronous=FULL")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def enqueue(self, record):
        record_id = f"{int(time.time() * 1000):013d}-{uuid.uuid4().hex}"
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO outbox (record_id, payload) VALUES (?, ?)",
                (record_id, json.dumps(record, allow_nan=False)),
            )
        return record_id

    def oldest(self):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT record_id, payload FROM outbox ORDER BY rowid LIMIT 1"
            ).fetchone()
        return (row[0], json.loads(row[1])) if row else None

    def remove(self, record_id):
        with self._connect() as connection:
            connection.execute("DELETE FROM outbox WHERE record_id = ?", (record_id,))

    def cache_motors(self, motors):
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO gateway_cache (cache_key, payload) VALUES ('motors', ?)
                ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload
                """,
                (json.dumps(motors, allow_nan=False),),
            )

    def cached_motors(self):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM gateway_cache WHERE cache_key = 'motors'"
            ).fetchone()
        return json.loads(row[0]) if row else []


def _serial_write_line(arduino, line):
    arduino.write((line + "\n").encode("utf-8"))


def _normalize_motor_list(payload):
    if payload is None:
        return []
    if not isinstance(payload, dict):
        raise ValueError("Firebase motors value must be an object")

    motors = []
    for motor_id, item in payload.items():
        if not isinstance(item, dict):
            print(f"Ignoring malformed Firebase motor: {motor_id}")
            continue
        name = str(item.get("motor_name", "")).replace("|", " ").replace("\n", " ").strip()
        motor_id = str(motor_id).replace("|", " ").replace("\n", " ").strip()
        try:
            voltage = float(item["rated_voltage"])
        except (KeyError, TypeError, ValueError):
            print(f"Ignoring Firebase motor without a valid rated voltage: {motor_id}")
            continue
        if not motor_id or not name or not math.isfinite(voltage) or voltage <= 0:
            print(f"Ignoring malformed Firebase motor: {motor_id}")
            continue
        motors.append({"id": motor_id, "name": name, "ratedVoltage": voltage})
    return motors


def load_motor_list(session, auth_token, outbox, request_exception):
    auth = {"auth": auth_token} if auth_token else None
    try:
        response = session.get(
            f"{FIREBASE_DATABASE_URL}/motors.json",
            params=auth,
            timeout=10,
        )
        response.raise_for_status()
        motors = _normalize_motor_list(response.json())
    except request_exception as error:
        print(f"Firebase motor list unavailable: {error}")
        motors = outbox.cached_motors() if outbox is not None else []
        if motors:
            print(f"Serving {len(motors)} cached motor(s) to Arduino")
        else:
            print("No cached motors are available")
        return motors

    if outbox is not None:
        outbox.cache_motors(motors)
    return motors


def send_motor_list(arduino, session, auth_token, outbox, request_exception):
    motors = load_motor_list(session, auth_token, outbox, request_exception)
    for motor in motors:
        name = motor["name"].replace("\r", " ").replace("\n", " ").replace("|", " ")
        motor_id = motor["id"].replace("\r", " ").replace("\n", " ").replace("|", " ")
        _serial_write_line(
            arduino,
            f"MOTOR|{motor_id}|{name}|{motor['ratedVoltage']:.2f}",
        )
    _serial_write_line(arduino, "END")


def acknowledge(arduino, saved):
    _serial_write_line(arduino, "ACK|SAVED" if saved else "ACK|ERROR")


def sync_outbox_once(outbox, session, auth_token, request_exception):
    item = outbox.oldest()
    if item is None:
        return True

    record_id, record = item
    try:
        sync_to_firebase_with_id(record, session, auth_token, record_id)
    except request_exception as error:
        print(f"Firebase sync failed; record remains queued: {error}")
        return False

    outbox.remove(record_id)
    print(f"Synced queued motor {record['motorId']} | {record['timestamp']}")
    return True


def _sync_worker(outbox, session, auth_token, request_exception, wake, stop):
    while not stop.is_set():
        if sync_outbox_once(outbox, session, auth_token, request_exception):
            wake.clear()
            if outbox.oldest() is None:
                wake.wait(SYNC_RETRY_SECONDS)
        else:
            wake.wait(SYNC_RETRY_SECONDS)
            wake.clear()


def _start_sync_worker(outbox, session, auth_token, request_exception):
    wake = threading.Event()
    stop = threading.Event()
    worker = threading.Thread(
        target=_sync_worker,
        args=(outbox, session, auth_token, request_exception, wake, stop),
        name="firebase-outbox-sync",
        daemon=True,
    )
    worker.start()
    return wake, stop, worker


def _stop_sync_worker(wake, stop, worker):
    stop.set()
    wake.set()
    worker.join(timeout=2)


def run_gateway(
    serial_module,
    request_exception,
    session,
    auth_token,
    outbox=None,
    motor_session=None,
):
    sync_worker = (
        _start_sync_worker(outbox, session, auth_token, request_exception)
        if outbox is not None
        else None
    )

    try:
        while True:
            try:
                with serial_module.Serial(SERIAL_PORT, BAUD_RATE, timeout=1) as arduino:
                    time.sleep(2)
                    print(f"Connected to Arduino on {SERIAL_PORT} at {BAUD_RATE} baud")
                    print("Waiting for one JSON log record per serial line...")

                    while True:
                        line = arduino.readline().decode("utf-8", errors="replace").strip()
                        if not line:
                            continue
                        if line == "LIST?":
                            send_motor_list(
                                arduino,
                                motor_session or session,
                                auth_token,
                                outbox,
                                request_exception,
                            )
                            continue
                        if not line.startswith("{"):
                            print(f"Ignoring Arduino output: {line}")
                            continue

                        try:
                            data = json.loads(line)
                            if isinstance(data, dict) and "event" in data:
                                continue
                            record = build_log_record(data)
                            if outbox is None:
                                sync_to_firebase(record, session, auth_token)
                                print(
                                    f"Logged motor {record['motorId']} | "
                                    f"{record['status']} | {record['timestamp']}"
                                )
                            else:
                                outbox.enqueue(record)
                                sync_worker[0].set()
                                print(
                                    f"Saved motor {record['motorId']} to local outbox | "
                                    f"{record['status']} | {record['timestamp']}"
                                )
                            acknowledge(arduino, saved=True)
                        except (json.JSONDecodeError, ValueError) as error:
                            print(f"Invalid Arduino record: {error}")
                            acknowledge(arduino, saved=False)
                        except request_exception as error:
                            print(f"Firebase sync failed; record was not confirmed: {error}")
                            acknowledge(arduino, saved=False)
            except serial_module.SerialException as error:
                print(
                    f"Arduino serial port {SERIAL_PORT} unavailable: {error}. "
                    "Retrying in 5 seconds..."
                )
                time.sleep(5)
    except KeyboardInterrupt:
        print("\nGateway stopped.")
    finally:
        if sync_worker is not None:
            _stop_sync_worker(*sync_worker)


def build_ocr_record(value_gohm, motor_id, timestamp=None):
    if isinstance(value_gohm, bool):
        raise ValueError("OCR resistance must be a finite number in GΩ")
    try:
        value_gohm = float(value_gohm)
    except (TypeError, ValueError):
        raise ValueError("OCR resistance must be a finite number in GΩ") from None
    if not math.isfinite(value_gohm) or value_gohm < 0:
        raise ValueError("OCR resistance must be a finite non-negative number in GΩ")
    if not isinstance(motor_id, str) or not motor_id.strip():
        raise ValueError("motorId must be a non-empty string")
    resistance_mohm = value_gohm * 1000.0
    if not math.isfinite(resistance_mohm):
        raise ValueError("converted OCR resistance must be finite")

    return {
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "motorId": motor_id.strip(),
        "source": "ocr",
        "measurementType": "insulationResistance",
        "rawIR_GOhm": value_gohm,
        "rawIR": resistance_mohm,
        "measurementUnit": "GΩ",
        "status": "OCR READING",
        "operatorName": "UT501A OCR",
    }


def parse_ut501a_reading(text):
    if not isinstance(text, str):
        raise ValueError("OCR output must be text")
    normalized = text.replace(",", ".")
    matches = OCR_NUMBER_PATTERN.findall(normalized)
    if len(matches) != 1:
        raise ValueError("OCR did not identify exactly one resistance value")
    value = float(matches[0])
    if not math.isfinite(value) or value < 0:
        raise ValueError("OCR resistance must be a finite non-negative number")
    return value


def read_ut501a_frame(frame, cv2_module, pytesseract_module):
    if frame is None or not hasattr(frame, "shape"):
        raise ValueError("Camera returned an invalid frame")
    height, width = frame.shape[:2]
    top, bottom = int(height * 0.2), int(height * 0.8)
    left, right = int(width * 0.08), int(width * 0.92)
    if bottom <= top or right <= left:
        raise ValueError("Camera frame is too small for OCR")

    roi = frame[top:bottom, left:right]
    gray = cv2_module.cvtColor(roi, cv2_module.COLOR_BGR2GRAY)
    enlarged = cv2_module.resize(
        gray,
        None,
        fx=3,
        fy=3,
        interpolation=cv2_module.INTER_CUBIC,
    )
    _, processed = cv2_module.threshold(
        enlarged, 0, 255, cv2_module.THRESH_BINARY + cv2_module.THRESH_OTSU
    )
    return pytesseract_module.image_to_string(
        processed,
        config="--psm 7 -c tessedit_char_whitelist=0123456789.,",
    )


def capture_last_stable_reading(
    camera,
    image_to_text,
    duration=OCR_TEST_SECONDS,
    sample_interval=OCR_SAMPLE_INTERVAL,
    monotonic=time.monotonic,
    sleep=time.sleep,
):
    deadline = monotonic() + duration
    samples = deque(maxlen=OCR_STABLE_SAMPLES)
    latest_stable = None

    while monotonic() < deadline:
        success, frame = camera.read()
        if not success:
            raise RuntimeError("Unable to read a frame from the USB camera")
        try:
            samples.append(parse_ut501a_reading(image_to_text(frame)))
        except ValueError:
            samples.clear()
        else:
            if len(samples) == OCR_STABLE_SAMPLES:
                low, high = min(samples), max(samples)
                tolerance = max(0.0001, statistics.median(samples) * 0.005)
                if high - low <= tolerance:
                    latest_stable = statistics.median(samples)

        sleep(min(sample_interval, max(0, deadline - monotonic())))

    if latest_stable is None:
        raise ValueError("No stable UT501A resistance reading was detected during the test")
    return latest_stable


def run_ocr_gateway(
    serial_module,
    request_exception,
    session,
    auth_token,
    outbox,
    camera,
    image_to_text,
    motor_id=None,
    motor_session=None,
):
    sync_worker = _start_sync_worker(outbox, session, auth_token, request_exception)
    configured_motor_id = motor_id or os.getenv("MOTOR_ID")
    pending_capture = None
    try:
        while True:
            try:
                with serial_module.Serial(SERIAL_PORT, BAUD_RATE, timeout=1) as arduino:
                    time.sleep(2)
                    print(f"Connected to Arduino on {SERIAL_PORT} at {BAUD_RATE} baud")
                    print('Waiting for {"event":"test_started"} from the Arduino...')

                    while True:
                        line = arduino.readline().decode("utf-8", errors="replace").strip()
                        if not line:
                            continue
                        if line == "LIST?":
                            send_motor_list(
                                arduino,
                                motor_session or session,
                                auth_token,
                                outbox,
                                request_exception,
                            )
                            continue
                        try:
                            message = json.loads(line)
                        except json.JSONDecodeError:
                            print(f"Ignoring Arduino output: {line}")
                            continue
                        if not isinstance(message, dict):
                            continue

                        if message.get("event") == "test_cancelled":
                            pending_capture = None
                            print("OCR test cancelled by Arduino")
                            continue

                        if message.get("event") == "test_started":
                            if pending_capture is not None:
                                print("Ignoring test-start event while another test is awaiting completion.")
                                continue

                            event_motor_id = message.get("motorId") or configured_motor_id
                            if not isinstance(event_motor_id, str) or not event_motor_id.strip():
                                print("Cannot start OCR capture: set MOTOR_ID or include motorId in the start event.")
                                pending_capture = {"error": "missing motorId"}
                                continue

                            print(f"Test started for motor {event_motor_id}; capturing for {OCR_TEST_SECONDS} seconds...")
                            try:
                                value_gohm = capture_last_stable_reading(camera, image_to_text)
                                pending_capture = {
                                    "motorId": event_motor_id.strip(),
                                    "record": build_ocr_record(value_gohm, event_motor_id),
                                }
                                print(
                                    f"Captured final stable UT501A reading: {value_gohm:g} GΩ; "
                                    "waiting for Arduino test result."
                                )
                            except (RuntimeError, ValueError) as error:
                                pending_capture = {
                                    "motorId": event_motor_id.strip(),
                                    "error": str(error),
                                }
                                print(f"OCR test capture failed: {error}")
                            continue

                        try:
                            if message.get("ncAuxSafe") is False or message.get("zeroVoltageSafe") is False:
                                record = build_log_record(message)
                                outbox.enqueue(record)
                                pending_capture = None
                                sync_worker[0].set()
                                acknowledge(arduino, saved=True)
                                print(f"Saved safety failure for motor {record['motorId']} to local outbox")
                                continue

                            if pending_capture is None:
                                raise ValueError("Arduino result arrived without a test-start OCR event")
                            if "error" in pending_capture:
                                raise ValueError(f"OCR capture unavailable: {pending_capture['error']}")
                            if message.get("motorId") != pending_capture["motorId"]:
                                raise ValueError("Arduino result motorId does not match the OCR test-start event")

                            build_log_record(message)
                            record = pending_capture["record"]
                            outbox.enqueue(record)
                            pending_capture = None
                            sync_worker[0].set()
                            acknowledge(arduino, saved=True)
                            print(
                                f"Saved UT501A reading for motor {record['motorId']} "
                                f"to local outbox | {record['rawIR_GOhm']:g} GΩ"
                            )
                        except (json.JSONDecodeError, ValueError) as error:
                            pending_capture = None
                            print(f"Arduino test result rejected: {error}")
                            acknowledge(arduino, saved=False)
            except serial_module.SerialException as error:
                print(
                    f"Arduino serial port {SERIAL_PORT} unavailable: {error}. "
                    "Retrying in 5 seconds..."
                )
                time.sleep(5)
    except KeyboardInterrupt:
        print("\nOCR gateway stopped.")
    finally:
        _stop_sync_worker(*sync_worker)


def main_arduino():
    import serial
    import requests

    auth_token = os.getenv("FIREBASE_AUTH_TOKEN")
    session = requests.Session()
    motor_session = requests.Session()
    outbox = DurableOutbox(QUEUE_PATH)
    run_gateway(
        serial,
        requests.RequestException,
        session,
        auth_token,
        outbox,
        motor_session,
    )


def main():
    import cv2
    import pytesseract
    import requests
    import serial

    pytesseract.get_tesseract_version()
    camera = cv2.VideoCapture(int(os.getenv("CAMERA_DEVICE", "0")))
    if not camera.isOpened():
        camera.release()
        raise RuntimeError("Could not open the USB camera; check CAMERA_DEVICE and camera permissions")

    try:
        session = requests.Session()
        motor_session = requests.Session()
        outbox = DurableOutbox(QUEUE_PATH)

        def image_to_text(frame):
            return read_ut501a_frame(frame, cv2, pytesseract)

        run_ocr_gateway(
            serial,
            requests.RequestException,
            session,
            os.getenv("FIREBASE_AUTH_TOKEN"),
            outbox,
            camera,
            image_to_text,
            motor_session=motor_session,
        )
    finally:
        camera.release()


if __name__ == "__main__":
    main()
