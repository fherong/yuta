import json
import math
import os
import re
import sqlite3
import statistics
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import gatewayy


SERIAL_PORT = gatewayy.SERIAL_PORT
BAUD_RATE = gatewayy.BAUD_RATE
OCR_TEST_SECONDS = 60
OCR_SAMPLE_INTERVAL = 0.5
OCR_STABLE_SAMPLES = 4
OCR_FIELDS = (
    "raw_ab",
    "raw_bc",
    "raw_ca",
    "raw_ag",
    "raw_bg",
    "raw_cg",
)
OCR_NUMBER_PATTERN = re.compile(r"(?<![\d.])(?:\d+(?:\.\d*)?|\.\d+)(?![\d.])")
OCR_UNIT_PATTERN = re.compile(r"[MG]", re.IGNORECASE)


def open_usb_camera(cv2_module, device=None):
    configured_device = str(
        device if device is not None else os.getenv("CAMERA_DEVICE", "0")
    ).strip()
    if not configured_device:
        raise ValueError("CAMERA_DEVICE must be a camera index or device path")

    camera_source = int(configured_device) if configured_device.isdecimal() else configured_device
    camera = cv2_module.VideoCapture(camera_source)
    if not camera.isOpened():
        camera.release()
        raise RuntimeError(
            f"Could not open USB camera {configured_device}; "
            "set CAMERA_DEVICE to its index or device path"
        )
    return camera


def parse_ut501a_reading(text):
    if not isinstance(text, str):
        raise ValueError("OCR output must be text")

    matches = OCR_NUMBER_PATTERN.findall(text.replace(",", "."))
    if len(matches) != 1:
        raise ValueError("OCR did not identify exactly one resistance value")
    units = OCR_UNIT_PATTERN.findall(text)
    if len(units) != 1:
        raise ValueError("OCR did not identify an MΩ or GΩ unit")

    value = float(matches[0])
    if not math.isfinite(value) or value < 0:
        raise ValueError("OCR resistance must be a finite non-negative number")
    return value / 1000 if units[0].upper() == "M" else value


def read_ut501a_frame(frame, pytesseract_module):
    if frame is None or not hasattr(frame, "shape") or len(frame.shape) < 2:
        raise ValueError("Camera returned an invalid frame")

    from PIL import Image, ImageFilter, ImageOps

    height, width = frame.shape[:2]
    top, bottom = int(height * 0.2), int(height * 0.8)
    left, right = int(width * 0.08), int(width * 0.92)
    if bottom <= top or right <= left:
        raise ValueError("Camera frame is too small for OCR")

    if len(frame.shape) == 3 and frame.shape[2] == 3:
        frame = frame[:, :, ::-1].copy()
    image = Image.fromarray(frame).crop((left, top, right, bottom)).convert("L")
    image = ImageOps.autocontrast(image)
    image = image.resize(
        (image.width * 3, image.height * 3),
        Image.Resampling.LANCZOS,
    )
    sharpened = image.filter(
        ImageFilter.UnsharpMask(radius=1.5, percent=150, threshold=3)
    )
    variants = (
        sharpened,
        image.point(lambda pixel: 255 if pixel > 120 else 0),
        image.point(lambda pixel: 255 if pixel > 170 else 0),
    )

    last_result = ""
    for processed in variants:
        number_text = pytesseract_module.image_to_string(
            processed,
            config="--psm 7 -c tessedit_char_whitelist=0123456789.,",
        )
        unit_region = processed.crop(
            (
                int(processed.width * 0.80),
                int(processed.height * 0.2),
                int(processed.width * 0.92),
                int(processed.height * 0.8),
            )
        )
        unit_text = pytesseract_module.image_to_string(
            unit_region,
            config="--psm 10 -c tessedit_char_whitelist=MG",
        )
        last_result = f"{number_text} {unit_text}"
        try:
            parse_ut501a_reading(last_result)
        except ValueError:
            continue
        return last_result
    return last_result


def capture_last_stable_reading(
    camera,
    image_to_text,
    duration=OCR_TEST_SECONDS,
    sample_interval=OCR_SAMPLE_INTERVAL,
    monotonic=time.monotonic,
    sleep=time.sleep,
    preview_frame=None,
    ocr_executor=None,
):
    deadline = monotonic() + duration
    samples = deque(maxlen=OCR_STABLE_SAMPLES)
    latest_stable = None
    owns_executor = ocr_executor is None
    executor = ocr_executor or ThreadPoolExecutor(max_workers=1)
    ocr_future = None
    next_sample = monotonic()

    def consume_ocr_result(future):
        nonlocal latest_stable
        try:
            samples.append(parse_ut501a_reading(future.result()))
        except ValueError:
            samples.clear()
        else:
            if len(samples) == OCR_STABLE_SAMPLES:
                low, high = min(samples), max(samples)
                tolerance = max(0.0001, statistics.median(samples) * 0.005)
                if high - low <= tolerance:
                    latest_stable = samples[-1]

    try:
        while monotonic() < deadline:
            if hasattr(camera, "capture_array"):
                frame = camera.capture_array()
            else:
                success, frame = camera.read()
                if not success:
                    raise RuntimeError("Unable to read a frame from the USB camera")

            if preview_frame is not None:
                preview_frame(frame)

            now = monotonic()
            if ocr_future is not None and ocr_future.done():
                consume_ocr_result(ocr_future)
                ocr_future = None
                next_sample = now + sample_interval

            if ocr_future is None and now >= next_sample:
                ocr_future = executor.submit(image_to_text, frame)

            poll_interval = 0.01 if preview_frame is not None else sample_interval
            sleep(min(poll_interval, max(0, deadline - monotonic())))

        while (
            preview_frame is not None
            and ocr_future is not None
            and not ocr_future.done()
        ):
            success, frame = camera.read()
            if success:
                preview_frame(frame)
            sleep(0.01)

        if ocr_future is not None:
            consume_ocr_result(ocr_future)
    finally:
        if owns_executor:
            executor.shutdown(wait=True)

    if latest_stable is None:
        raise ValueError("No stable UT501A resistance reading was detected during the test")
    return latest_stable


def build_ocr_test_record(data, captured_values, timestamp=None):
    if not isinstance(data, dict):
        raise ValueError("Arduino message must be a JSON object")

    required = ("motorId", "motorVoltage", "ncAuxSafe", "zeroVoltageSafe")
    missing = [field for field in required if field not in data]
    if missing:
        raise ValueError(f"Missing required field(s): {', '.join(missing)}")

    motor_id = data["motorId"]
    if not isinstance(motor_id, str) or not motor_id.strip():
        raise ValueError("motorId must be a non-empty string")
    for field in ("ncAuxSafe", "zeroVoltageSafe"):
        if not isinstance(data[field], bool):
            raise ValueError(f"{field} must be a JSON boolean")

    record_data = dict(data)
    record_data["source"] = "ocr"
    record_data["measurementType"] = "insulationResistance"
    record_data["measurementUnit"] = "GΩ"
    record = gatewayy.build_log_record(record_data)
    if timestamp is not None:
        record["timestamp"] = timestamp

    if not data["ncAuxSafe"] or not data["zeroVoltageSafe"]:
        return record

    if "testVoltage" not in data:
        raise ValueError("Missing required field(s): testVoltage")
    try:
        test_voltage = float(data["testVoltage"])
        motor_voltage = float(data["motorVoltage"])
    except (TypeError, ValueError):
        raise ValueError("testVoltage and motorVoltage must be finite numbers") from None
    if (
        not math.isfinite(test_voltage)
        or test_voltage <= 0
        or not math.isfinite(motor_voltage)
        or motor_voltage <= 0
    ):
        raise ValueError("testVoltage and motorVoltage must be greater than zero")

    if not isinstance(captured_values, dict) or set(captured_values) != set(OCR_FIELDS):
        raise ValueError("All six stable OCR readings are required")

    for field in OCR_FIELDS:
        value_gohm = captured_values[field]
        if isinstance(value_gohm, bool):
            raise ValueError(f"{field} OCR reading must be a finite number")
        try:
            value_gohm = float(value_gohm)
        except (TypeError, ValueError):
            raise ValueError(f"{field} OCR reading must be a finite number") from None
        value_mohm = value_gohm * 1000
        if not math.isfinite(value_gohm) or value_gohm < 0 or not math.isfinite(value_mohm):
            raise ValueError(f"{field} OCR reading must be finite and non-negative")
        record[f"{field}_GOhm"] = value_gohm
        record[field] = value_mohm

    return record


def _write_capture_result(arduino, index, value=None):
    if value is None:
        line = f"OCR_ERROR|{index}\n"
    else:
        line = f"OCR_RESULT|{index}|{value:.6f}\n"
    arduino.write(line.encode("ascii"))
    arduino.flush()


def _save_record(arduino, record, queue, session):
    record_id = queue.enqueue(record)
    gatewayy.send_ack(arduino, "QUEUED")
    gatewayy.retry_pending_records(queue, session)
    return record_id


def _handle_capture_event(
    arduino,
    message,
    pending_test,
    camera,
    image_to_text,
    preview_frame=None,
):
    index = message.get("index")
    motor_id = message.get("motorId")
    if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(OCR_FIELDS):
        if pending_test is None:
            expected_index = 0
        else:
            expected_index = len(pending_test["captured"])
            if expected_index >= len(OCR_FIELDS):
                print("Ignoring OCR capture event after all six positions were captured")
                return pending_test
        _write_capture_result(arduino, expected_index)
        print(f"Ignoring OCR start event with unsupported index: {index}")
        return pending_test
    field = OCR_FIELDS[index]
    if not isinstance(motor_id, str) or not motor_id.strip():
        _write_capture_result(arduino, index)
        print("Ignoring OCR start event without a valid motorId")
        return pending_test

    if pending_test is None:
        if index != 0:
            _write_capture_result(arduino, index)
            print("OCR capture sequence must start with raw_ab")
            return None
        pending_test = {"motorId": motor_id.strip(), "captured": {}}

    if pending_test["motorId"] != motor_id.strip():
        _write_capture_result(arduino, index)
        print("OCR capture motorId changed before the test completed")
        return pending_test

    next_index = len(pending_test["captured"])
    if next_index >= len(OCR_FIELDS) or field != OCR_FIELDS[next_index]:
        _write_capture_result(arduino, index)
        print(f"OCR capture out of order: expected {OCR_FIELDS[next_index] if next_index < len(OCR_FIELDS) else 'test result'}")
        return pending_test

    print(
        f"Capturing {field} for motor {motor_id}; "
        f"camera window is {OCR_TEST_SECONDS} seconds..."
    )
    try:
        value_gohm = capture_last_stable_reading(
            camera,
            image_to_text,
            preview_frame=preview_frame,
        )
    except (OSError, RuntimeError, ValueError) as error:
        _write_capture_result(arduino, index)
        print(f"OCR capture failed for {field}: {error}")
        return pending_test

    pending_test["captured"][field] = value_gohm
    _write_capture_result(arduino, index, value_gohm)
    print(f"Captured final stable {field}: {value_gohm:g} GΩ")
    return pending_test


def _wait_with_camera_preview(camera, preview_frame, duration):
    if preview_frame is None:
        time.sleep(duration)
        return

    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        success, frame = camera.read()
        if success:
            preview_frame(frame)
        time.sleep(min(0.01, max(0, deadline - time.monotonic())))


def run_ocr_gateway(
    serial_module,
    request_exception,
    session,
    queue,
    camera,
    image_to_text,
    motor_session=None,
    preview_frame=None,
):
    pending_test = None
    next_retry = 0

    try:
        while True:
            if preview_frame is not None:
                success, frame = camera.read()
                if success:
                    preview_frame(frame)
            if time.monotonic() >= next_retry:
                gatewayy.retry_pending_records(queue, session)
                next_retry = time.monotonic() + gatewayy.QUEUE_RETRY_INTERVAL

            try:
                serial_timeout = 0.03 if preview_frame is not None else gatewayy.SERIAL_TIMEOUT
                with serial_module.Serial(
                    SERIAL_PORT,
                    BAUD_RATE,
                    timeout=serial_timeout,
                ) as arduino:
                    _wait_with_camera_preview(camera, preview_frame, 2)
                    print(f"Connected to Arduino on {SERIAL_PORT} at {BAUD_RATE} baud")
                    print("Waiting for OCR capture events from the Arduino...")
                    serial_buffer = bytearray()

                    while True:
                        if b"\n" not in serial_buffer:
                            serial_buffer.extend(arduino.readline())
                            if (
                                b"\n" not in serial_buffer
                                and len(serial_buffer) > 4096
                            ):
                                print("Discarding oversized incomplete Arduino message")
                                serial_buffer.clear()
                            if b"\n" not in serial_buffer:
                                if preview_frame is not None:
                                    success, frame = camera.read()
                                    if success:
                                        preview_frame(frame)
                                if time.monotonic() >= next_retry:
                                    gatewayy.retry_pending_records(queue, session)
                                    next_retry = time.monotonic() + gatewayy.QUEUE_RETRY_INTERVAL
                                continue

                        raw_line, _, remainder = serial_buffer.partition(b"\n")
                        serial_buffer = bytearray(remainder)
                        if preview_frame is not None:
                            success, frame = camera.read()
                            if success:
                                preview_frame(frame)
                        if time.monotonic() >= next_retry:
                            gatewayy.retry_pending_records(queue, session)
                            next_retry = time.monotonic() + gatewayy.QUEUE_RETRY_INTERVAL

                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line:
                            continue

                        if line == "LIST?":
                            try:
                                gatewayy.send_motor_list(arduino, motor_session or session)
                            except request_exception as error:
                                print(f"Firebase motor retrieval failed: {error}")
                                arduino.write(b"END\n")
                                arduino.flush()
                            continue

                        if line == "EMPLOYEES?":
                            try:
                                gatewayy.send_employee_list(arduino, session)
                            except request_exception as error:
                                print(f"Firebase employee retrieval failed: {error}")
                                arduino.write(b"EMPLOYEE_ERROR|UNAVAILABLE\nEND\n")
                                arduino.flush()
                            continue

                        if line.startswith("LOGIN|"):
                            parts = line.split("|", 2)
                            authenticated = False
                            if len(parts) == 3:
                                try:
                                    authenticated = gatewayy.authenticate_employee(
                                        parts[1],
                                        parts[2],
                                        session,
                                    )
                                except request_exception as error:
                                    print(f"Employee authentication failed: {error}")
                            arduino.write(
                                b"LOGIN|OK\n" if authenticated else b"LOGIN|ERROR\n"
                            )
                            arduino.flush()
                            continue

                        try:
                            message = json.loads(line)
                        except json.JSONDecodeError:
                            print(f"Ignoring Arduino output: {line}")
                            continue
                        if not isinstance(message, dict):
                            continue

                        event = message.get("event")
                        if event == "test_cancelled":
                            pending_test = None
                            print("OCR test cancelled by Arduino")
                            continue
                        if event == "ocr_capture_started":
                            pending_test = _handle_capture_event(
                                arduino,
                                message,
                                pending_test,
                                camera,
                                image_to_text,
                                preview_frame,
                            )
                            continue
                        if event is not None:
                            print(f"Ignoring unsupported Arduino event: {event}")
                            continue

                        try:
                            if message.get("ncAuxSafe") is False or message.get("zeroVoltageSafe") is False:
                                record = build_ocr_test_record(message, {})
                                _save_record(arduino, record, queue, session)
                                pending_test = None
                                print(f"Saved safety failure for motor {record['motorId']}")
                                continue

                            if pending_test is None:
                                raise ValueError("Arduino result arrived without OCR captures")
                            if message.get("motorId") != pending_test["motorId"]:
                                raise ValueError("Arduino result motorId does not match OCR captures")

                            record = build_ocr_test_record(
                                message,
                                pending_test["captured"],
                            )
                            _save_record(arduino, record, queue, session)
                            pending_test = None
                            print(
                                f"Saved six OCR readings for motor {record['motorId']} "
                                "to the local queue"
                            )
                        except (ValueError, sqlite3.Error) as error:
                            pending_test = None
                            print(f"Arduino OCR result rejected: {error}")
                            gatewayy.send_ack(arduino, "ERROR", str(error))
            except serial_module.SerialException as error:
                pending_test = None
                print(
                    f"Arduino serial port {SERIAL_PORT} unavailable: {error}. "
                    "Retrying in 5 seconds..."
                )
                _wait_with_camera_preview(
                    camera,
                    preview_frame,
                    gatewayy.RECONNECT_DELAY,
                )
    except KeyboardInterrupt:
        print("\nOCR gateway stopped.")


def main():
    import cv2
    import pytesseract
    import requests
    import serial

    pytesseract.get_tesseract_version()
    preview_setting = os.getenv("CAMERA_PREVIEW")
    if preview_setting is None:
        preview_enabled = bool(os.getenv("DISPLAY") or os.getenv("WAYLAND_DISPLAY"))
    elif preview_setting.strip().lower() in ("1", "true", "yes", "on"):
        preview_enabled = True
    elif preview_setting.strip().lower() in ("0", "false", "no", "off"):
        preview_enabled = False
    else:
        raise ValueError("CAMERA_PREVIEW must be 1 or 0")

    if preview_enabled and not (os.getenv("DISPLAY") or os.getenv("WAYLAND_DISPLAY")):
        raise RuntimeError("CAMERA_PREVIEW requires a desktop display session")

    camera = open_usb_camera(cv2)

    def show_camera_frame(frame):
        cv2.imshow("YUTA USB camera preview", frame)
        cv2.waitKey(1)

    try:
        session = requests.Session()
        queue = gatewayy.TelemetryQueue(gatewayy.QUEUE_DB_PATH)
        run_ocr_gateway(
            serial,
            requests.RequestException,
            session,
            queue,
            camera,
            lambda frame: read_ut501a_frame(frame, pytesseract),
            preview_frame=show_camera_frame if preview_enabled else None,
        )
    finally:
        if preview_enabled:
            cv2.destroyAllWindows()
        camera.release()


if __name__ == "__main__":
    main()
