import json
import math
import os
import re
import time

from datetime import datetime, timezone

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


IR_FIELDS = (
    "raw_ab",
    "raw_bc",
    "raw_ca",
    "raw_ag",
    "raw_bg",
    "raw_cg",
)

NUMERIC_FIELDS = IR_FIELDS + (
    "testVoltage",
    "motorVoltage",
)


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


# =====================================================
# VALIDATION
# =====================================================

def validate_numeric_fields(data):
    values = {}

    for field in NUMERIC_FIELDS:

        if field not in data:
            continue

        value = data[field]

        if isinstance(value, bool):
            raise ValueError(
                f"{field} must be numeric."
            )

        try:
            value = float(value)

        except (TypeError, ValueError):
            raise ValueError(
                f"{field} must be numeric."
            ) from None

        if not math.isfinite(value):
            raise ValueError(
                f"{field} must be finite."
            )

        values[field] = value

    return values


def build_log_record(data):

    if not isinstance(data, dict):
        raise ValueError(
            "Arduino message must be a JSON object."
        )

    required_fields = (
        "motorId",
        "motorVoltage",
        "ncAuxSafe",
        "zeroVoltageSafe",
    )

    missing = [
        field
        for field in required_fields
        if field not in data
    ]

    if missing:
        raise ValueError(
            "Missing required fields: "
            + ", ".join(missing)
        )

    motor_id = data["motorId"]

    if not isinstance(motor_id, str) or not motor_id.strip():
        raise ValueError(
            "motorId must be a non-empty string."
        )

    for field in (
        "ncAuxSafe",
        "zeroVoltageSafe"
    ):

        if not isinstance(data[field], bool):
            raise ValueError(
                f"{field} must be a JSON boolean."
            )

    values = validate_numeric_fields(data)

    motor_voltage = values["motorVoltage"]

    if motor_voltage <= 0:
        raise ValueError(
            "motorVoltage must be greater than zero."
        )

    safety_ok = (
        data["ncAuxSafe"]
        and data["zeroVoltageSafe"]
    )

    timestamp = datetime.now(
        timezone.utc
    ).isoformat().replace("+00:00", "Z")

    record = {
        "timestamp": timestamp,

        "motorId": motor_id.strip(),

        "motorName": str(
            data.get("motorName", "Unknown Motor")
        ),

        "motorVoltage": motor_voltage,
        "ratedVoltage": motor_voltage,

        "ncAuxSafe": data["ncAuxSafe"],
        "zeroVoltageSafe": data["zeroVoltageSafe"],
        "safetyOK": safety_ok,

        "employeeId": str(
            data.get("employeeId", "N/A")
        ),

        "operatorName": str(
            data.get(
                "operatorName",
                "Arduino Operator"
            )
        ),

        "dataSource": "ARDUINO_MANUAL_ENTRY",
        "testMode": False,
    }

    # -------------------------------------------------
    # SAFETY FAILURE
    # -------------------------------------------------

    if not safety_ok:

        record["status"] = "SAFETY INTERLOCK FAILED"

        record["message"] = (
            "Insulation resistance testing was blocked "
            "because safety verification failed."
        )

        return record

    # -------------------------------------------------
    # MEASUREMENT VALIDATION
    # -------------------------------------------------

    missing_ir = [
        field
        for field in IR_FIELDS
        if field not in values
    ]

    if missing_ir:
        raise ValueError(
            "Missing IR measurements: "
            + ", ".join(missing_ir)
        )

    test_voltage = values.get("testVoltage")

    if test_voltage is None or test_voltage <= 0:
        raise ValueError(
            "testVoltage must be greater than zero."
        )

    readings = {}

    for field in IR_FIELDS:

        reading = values[field]

        if reading < 0:
            raise ValueError(
                f"{field} cannot be negative."
            )

        readings[field] = reading

    # -------------------------------------------------
    # IR SUMMARY
    # -------------------------------------------------

    minimum_ir = min(readings.values())

    average_ir = (
        sum(readings.values()) / len(readings)
    )

    # IEEE Std 43-2013 reference:
    # IRmin = kV + 1 MOhm
    #
    # This is a reference comparison only.
    # No temperature correction is applied.

    threshold_ir = (
        motor_voltage / 1000.0
    ) + 1.0

    if minimum_ir >= threshold_ir:
        status = "NORMAL"

    else:
        status = "MAINTENANCE ALERT"

    # -------------------------------------------------
    # COMPLETE RECORD
    # -------------------------------------------------

    record.update({

        "testVoltage": test_voltage,

        "rawIR": minimum_ir,

        "minimumIR": minimum_ir,

        "averageIR": round(
            average_ir,
            3
        ),

        "thresholdIR": round(
            threshold_ir,
            3
        ),

        "status": status,

    })

    record.update(readings)

    # Dashboard-friendly measurement names.
    record.update({
        "irL1L2": readings["raw_ab"],
        "irL2L3": readings["raw_bc"],
        "irL3L1": readings["raw_ca"],
        "irL1G": readings["raw_ag"],
        "irL2G": readings["raw_bg"],
        "irL3G": readings["raw_cg"],
    })

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

                            print(
                                f"Motor: {record['motorName']}"
                            )

                            print(
                                f"Status: {record['status']}"
                            )

                            print(
                                f"Timestamp: {record['timestamp']}"
                            )

                            if "minimumIR" in record:

                                print(
                                    f"Minimum IR: "
                                    f"{record['minimumIR']} MOhm"
                                )

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