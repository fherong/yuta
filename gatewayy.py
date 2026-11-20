import hmac
import json
import os
import re
import sqlite3
import time
import uuid

from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests
import serial

from serial import SerialException


# =====================================================
# Y.U.T.A. RASPBERRY PI GATEWAY
# =====================================================

FIREBASE_DATABASE_URL = os.getenv(
    "FIREBASE_DATABASE_URL",
    "https://yuta-db-default-rtdb.asia-southeast1.firebasedatabase.app"
).rstrip("/")

SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyACM0")
BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))

AUTH_TOKEN = os.getenv("FIREBASE_AUTH_TOKEN")

SERIAL_TIMEOUT = 1
RECONNECT_DELAY = 5
QUEUE_RETRY_INTERVAL = 5
QUEUE_DB_PATH = Path(
    os.getenv(
        "YUTA_QUEUE_DB_PATH",
        str(Path.home() / ".local" / "share" / "yuta-gateway" / "telemetry.sqlite3"),
    )
).expanduser()


# =====================================================
# FIREBASE
# =====================================================

def firebase_params():
    if AUTH_TOKEN:
        return {"auth": AUTH_TOKEN}

    return None


def get_motor_voltage(motor_data):
    """
    Dashboard uses rated_voltage.
    Older records may use voltage.
    """

    voltage = motor_data.get(
        "rated_voltage",
        motor_data.get("voltage", 0)
    )

    if isinstance(voltage, bool):
        return 0.0

    if isinstance(voltage, (int, float)):
        return float(voltage)

    match = re.search(
        r"\d+(?:\.\d+)?",
        str(voltage)
    )

    if match:
        return float(match.group())

    return 0.0


def fetch_motors(session):
    response = session.get(
        f"{FIREBASE_DATABASE_URL}/motors.json",
        params=firebase_params(),
        timeout=10
    )

    response.raise_for_status()

    motors = response.json()

    if not isinstance(motors, dict):
        return {}

    return motors


def send_motor_list(arduino, session):
    print("Arduino requested motor list.")

    motors = fetch_motors(session)

    sent_count = 0

    for motor_id, motor_data in motors.items():

        if not isinstance(motor_data, dict):
            continue

        motor_name = str(
            motor_data.get(
                "motor_name",
                motor_data.get("name", motor_id)
            )
        )

        # Prevent serial protocol delimiter conflicts.
        motor_name = (
            motor_name
            .replace("|", " ")
            .replace("\n", " ")
            .replace("\r", " ")
        )

        motor_id = str(motor_id).replace("|", "_")

        rated_voltage = get_motor_voltage(motor_data)

        message = (
            f"MOTOR|{motor_id}|{motor_name}|"
            f"{rated_voltage:g}\n"
        )

        arduino.write(message.encode("utf-8"))
        arduino.flush()

        print(
            f"Sent motor: {motor_name} "
            f"({rated_voltage:g} V)"
        )

        sent_count += 1

    arduino.write(b"END\n")
    arduino.flush()

    print(
        f"Motor list transmission completed: "
        f"{sent_count} motor(s)."
    )


def eligible_employees(users):
    if not isinstance(users, dict):
        return []

    employees = []
    for employee_id, account in users.items():
        if not isinstance(account, dict):
            continue
        if str(account.get("role", "")).strip().lower() != "employee":
            continue

        raw_name = account.get("fullname")
        name = str(raw_name).strip() if raw_name is not None else ""
        pin = account.get("pin")
        if (
            not employee_id
            or not name
            or isinstance(pin, bool)
            or pin is None
            or not re.fullmatch(r"[0-9]{8,12}", str(pin).strip())
            or "|" in str(employee_id)
        ):
            continue

        employees.append({
            "employeeId": str(employee_id),
            "fullname": name.replace("|", " ").replace("\n", " ").replace("\r", " "),
        })

    return sorted(employees, key=lambda employee: employee["fullname"].casefold())


def employee_id_suffix(employee_id):
    digits = re.sub(r"[^0-9]", "", str(employee_id))
    return digits[-3:] if digits else "---"


def fetch_eligible_employees(session):
    response = session.get(
        f"{FIREBASE_DATABASE_URL}/users.json",
        params=firebase_params(),
        timeout=10,
    )
    response.raise_for_status()
    return eligible_employees(response.json())


def send_employee_list(arduino, session):
    print("Arduino requested eligible employee list.")
    employees = fetch_eligible_employees(session)

    for employee in employees:
        employee_id = employee["employeeId"]
        name = employee["fullname"]
        suffix = employee_id_suffix(employee_id)
        message = f"EMPLOYEE|{employee_id}|{name}|{suffix}\n"
        arduino.write(message.encode("utf-8"))
        arduino.flush()

    arduino.write(b"END\n")
    arduino.flush()
    print(f"Employee list transmission completed: {len(employees)} employee(s).")
    return len(employees)


def authenticate_employee(employee_id, pin, session):
    if not employee_id or not re.fullmatch(r"[0-9]{8,12}", str(pin)):
        return False

    response = session.get(
        f"{FIREBASE_DATABASE_URL}/users/{quote(str(employee_id), safe='')}.json",
        params=firebase_params(),
        timeout=10,
    )
    response.raise_for_status()
    account = response.json()

    if not isinstance(account, dict):
        return False
    if str(account.get("role", "")).strip().lower() != "employee":
        return False

    stored_pin = account.get("pin")
    if isinstance(stored_pin, bool) or stored_pin is None:
        return False

    clean_pin = str(stored_pin).strip()
    if not re.fullmatch(r"[0-9]{8,12}", clean_pin):
        return False

    return hmac.compare_digest(clean_pin, str(pin))


def build_log_record(data):
    if not isinstance(data, dict):
        raise ValueError(
            "Arduino message must be a JSON object."
        )

    record = dict(data)
    if "timestamp" not in record:
        record["timestamp"] = datetime.now(
            timezone.utc
        ).isoformat().replace("+00:00", "Z")
    return record


class TelemetryQueue:
    def __init__(self, path):
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)

        with closing(sqlite3.connect(self.path, timeout=30)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS pending_telemetry (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.commit()

    def enqueue(self, record):
        record_id = f"{time.time_ns():016x}{uuid.uuid4().hex}"
        payload = json.dumps(record, separators=(",", ":"), allow_nan=False)

        with closing(sqlite3.connect(self.path, timeout=30)) as connection:
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute(
                "INSERT INTO pending_telemetry (id, payload) VALUES (?, ?)",
                (record_id, payload),
            )
            connection.commit()

        return record_id

    def pending_records(self):
        with closing(sqlite3.connect(self.path, timeout=30)) as connection:
            rows = connection.execute(
                "SELECT id, payload FROM pending_telemetry ORDER BY rowid"
            ).fetchall()

        return [(record_id, json.loads(payload)) for record_id, payload in rows]

    def remove(self, record_id):
        with closing(sqlite3.connect(self.path, timeout=30)) as connection:
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute(
                "DELETE FROM pending_telemetry WHERE id = ?",
                (record_id,),
            )
            connection.commit()

    def contains(self, record_id):
        with closing(sqlite3.connect(self.path, timeout=30)) as connection:
            row = connection.execute(
                "SELECT 1 FROM pending_telemetry WHERE id = ?",
                (record_id,),
            ).fetchone()

        return row is not None


# =====================================================
# FIREBASE SYNCHRONIZATION
# =====================================================

def sync_to_firebase(record_id, record, session):

    params = firebase_params()

    # Update latest telemetry.
    live_response = session.put(
        f"{FIREBASE_DATABASE_URL}/live.json",
        params=params,
        json=record,
        timeout=10
    )

    live_response.raise_for_status()

    # Use the local queue ID so retries cannot duplicate a history entry.
    history_response = session.put(
        f"{FIREBASE_DATABASE_URL}/history/{record_id}.json",
        params=params,
        json=record,
        timeout=10
    )

    history_response.raise_for_status()

    return True


def flush_pending_records(queue, session):
    synced_count = 0

    for record_id, record in queue.pending_records():
        sync_to_firebase(record_id, record, session)
        queue.remove(record_id)
        synced_count += 1

    return synced_count


def retry_pending_records(queue, session):
    try:
        synced_count = flush_pending_records(queue, session)
    except requests.RequestException as error:
        print("Cloud sync deferred; queued records remain on the Pi:", error)
        return
    except sqlite3.Error as error:
        print("Local telemetry queue error:", error)
        return

    if synced_count:
        print(f"Synced {synced_count} queued test record(s) to Firebase.")


# =====================================================
# SERIAL ACKNOWLEDGEMENT
# =====================================================

def send_ack(arduino, status, message=""):
    if status in ("SAVED", "QUEUED"):
        arduino.write(f"ACK|{status}\n".encode("ascii"))

    else:
        safe_message = str(message).replace("|", " ").replace("\n", " ").replace("\r", " ")
        arduino.write(f"ACK|ERROR|{safe_message}\n".encode("utf-8"))

    arduino.flush()


# =====================================================
# SERIAL GATEWAY
# =====================================================

def run_gateway():

    queue = TelemetryQueue(QUEUE_DB_PATH)
    session = requests.Session()
    next_queue_retry = 0

    print("======================================")
    print("       Y.U.T.A. RASPBERRY PI")
    print("          SERIAL GATEWAY")
    print("======================================")

    print(f"Firebase: {FIREBASE_DATABASE_URL}")
    print(f"Serial port: {SERIAL_PORT}")
    print(f"Baud rate: {BAUD_RATE}")
    print(f"Local queue: {queue.path}")
    print("Waiting for Arduino...")
    print()

    try:

        while True:
            if time.monotonic() >= next_queue_retry:
                retry_pending_records(queue, session)
                next_queue_retry = time.monotonic() + QUEUE_RETRY_INTERVAL

            try:

                with serial.Serial(
                    SERIAL_PORT,
                    BAUD_RATE,
                    timeout=SERIAL_TIMEOUT
                ) as arduino:

                    # Allow Arduino to reset after serial connection.
                    time.sleep(2)

                    print(
                        f"Connected to Arduino: "
                        f"{SERIAL_PORT}"
                    )

                    print("Waiting for commands...")
                    print()

                    while True:

                        raw_line = arduino.readline()

                        if time.monotonic() >= next_queue_retry:
                            retry_pending_records(queue, session)
                            next_queue_retry = time.monotonic() + QUEUE_RETRY_INTERVAL

                        if not raw_line:
                            continue

                        line = raw_line.decode(
                            "utf-8",
                            errors="replace"
                        ).strip()

                        if not line:
                            continue

                        # ---------------------------------
                        # MOTOR LIST REQUEST
                        # ---------------------------------

                        if line == "LIST?":

                            try:

                                send_motor_list(
                                    arduino,
                                    session
                                )

                            except requests.RequestException as error:

                                print(
                                    "Firebase motor retrieval failed:",
                                    error
                                )

                                arduino.write(b"END\n")
                                arduino.flush()

                            continue

                        # ---------------------------------
                        # EMPLOYEE LOGIN
                        # ---------------------------------

                        if line == "EMPLOYEES?":

                            try:
                                send_employee_list(arduino, session)

                            except requests.RequestException as error:
                                print("Firebase employee retrieval failed:", error)
                                arduino.write(b"EMPLOYEE_ERROR|UNAVAILABLE\nEND\n")
                                arduino.flush()

                            continue

                        if line.startswith("LOGIN|"):
                            parts = line.split("|", 2)
                            authenticated = False

                            if len(parts) == 3:
                                try:
                                    authenticated = authenticate_employee(
                                        parts[1],
                                        parts[2],
                                        session,
                                    )
                                except requests.RequestException as error:
                                    print("Employee authentication failed: Firebase unavailable.", error)

                            arduino.write(b"LOGIN|OK\n" if authenticated else b"LOGIN|ERROR\n")
                            arduino.flush()
                            continue

                        # ---------------------------------
                        # JSON TELEMETRY
                        # ---------------------------------

                        if not line.startswith("{"):

                            print(
                                f"Ignoring Arduino output: {line}"
                            )

                            continue

                        try:

                            data = json.loads(line)

                            if (
                                isinstance(data, dict)
                                and data.get("event") in ("test_started", "test_cancelled")
                            ):
                                continue

                            record = build_log_record(data)
                            record_id = queue.enqueue(record)

                            try:
                                flush_pending_records(queue, session)
                            except requests.RequestException as error:
                                print("Cloud sync deferred; record remains queued:", error)

                            ack_status = "QUEUED" if queue.contains(record_id) else "SAVED"
                            send_ack(arduino, ack_status)

                            if ack_status == "SAVED":
                                print("Record synchronized to Firebase.")
                            else:
                                print("Record saved locally; cloud sync is pending.")

                            if "motorName" in record:
                                print(
                                    f"Motor: {record['motorName']}"
                                )

                            if "status" in record:
                                print(f"Status: {record['status']}")

                            if "timestamp" in record:
                                print(f"Timestamp: {record['timestamp']}")

                            print()

                        except (
                            json.JSONDecodeError,
                            ValueError,
                            sqlite3.Error,
                            OSError
                        ) as error:

                            print(
                                "Record processing or local queue write failed:",
                                error
                            )

                            send_ack(
                                arduino,
                                "ERROR",
                                str(error)
                            )

            except SerialException as error:

                print(
                    f"Arduino serial port unavailable: {error}"
                )

                print(
                    f"Retrying in {RECONNECT_DELAY} seconds..."
                )

                time.sleep(RECONNECT_DELAY)

    except KeyboardInterrupt:

        print()
        print("Y.U.T.A. gateway stopped.")

    finally:
        session.close()


# =====================================================
# MAIN
# =====================================================

if __name__ == "__main__":
    run_gateway()
