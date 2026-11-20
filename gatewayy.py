import json
import hmac
import os
import re
import time

from datetime import datetime, timezone
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


# =====================================================
# FIREBASE SYNCHRONIZATION
# =====================================================

def sync_to_firebase(record, session):

    params = firebase_params()

    # Update latest telemetry.
    live_response = session.put(
        f"{FIREBASE_DATABASE_URL}/live.json",
        params=params,
        json=record,
        timeout=10
    )

    live_response.raise_for_status()

    # Add historical record.
    history_response = session.post(
        f"{FIREBASE_DATABASE_URL}/history.json",
        params=params,
        json=record,
        timeout=10
    )

    history_response.raise_for_status()

    return True


# =====================================================
# SERIAL ACKNOWLEDGEMENT
# =====================================================

def send_ack(arduino, success, message=""):

    if success:
        arduino.write(b"ACK|SAVED\n")

    else:
        safe_message = (
            str(message)
            .replace("|", " ")
            .replace("\n", " ")
            .replace("\r", " ")
        )

        response = f"ACK|ERROR|{safe_message}\n"

        arduino.write(
            response.encode("utf-8")
        )

    arduino.flush()


# =====================================================
# SERIAL GATEWAY
# =====================================================

def run_gateway():

    session = requests.Session()

    print("======================================")
    print("       Y.U.T.A. RASPBERRY PI")
    print("          SERIAL GATEWAY")
    print("======================================")

    print(f"Firebase: {FIREBASE_DATABASE_URL}")
    print(f"Serial port: {SERIAL_PORT}")
    print(f"Baud rate: {BAUD_RATE}")
    print("Waiting for Arduino...")
    print()

    try:

        while True:

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

                            record = build_log_record(data)

                            sync_to_firebase(
                                record,
                                session
                            )

                            send_ack(
                                arduino,
                                True
                            )

                            print()
                            print(
                                "Firebase synchronization successful."
                            )

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
                            requests.RequestException
                        ) as error:

                            print(
                                "Record processing failed:",
                                error
                            )

                            send_ack(
                                arduino,
                                False,
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
