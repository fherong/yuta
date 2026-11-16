import json
import math
import os
import time
from datetime import datetime, timezone


FIREBASE_DATABASE_URL = os.getenv(
    "FIREBASE_DATABASE_URL",
    "https://yuta-db-default-rtdb.asia-southeast1.firebasedatabase.app",
).rstrip("/")
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyACM0")
BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))
import serial
import json
import time
import requests

# Configuration (Adjust port and URL as needed for your setup)
SERIAL_PORT = "/dev/cu.usbserial-110"  # or 'COM3' on Windows
BAUD_RATE = 9600
FIREBASE_URL = "https://yuta-telemetry-default-rtdb.firebaseio.com/telemetry.json"

try:
    ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    time.sleep(2)  # Allow Arduino connection to settle
    print(f"Connected to serial port {SERIAL_PORT}")
except Exception as e:
    print(f"Failed to connect on {SERIAL_PORT}: {e}")
    exit() 

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
    "rawIR",
    "temperatureC",
    "testVoltage",
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

    if values["rawIR"] < 0 or values["temperatureC"] < -273.15:
        raise ValueError("rawIR and temperatureC must be physically valid")
    if values["testVoltage"] <= 0 or values["motorVoltage"] <= 0:
        raise ValueError("testVoltage and motorVoltage must be greater than zero")

    temperature = values["temperatureC"]
    correction = (
        0.5 ** ((temperature - 40.0) / 10.0)
        if temperature >= 40.0
        else 2.0 ** ((40.0 - temperature) / 10.0)
    )
    corrected_ir = round(values["rawIR"] * correction, 3)
    threshold_ir = round(values["motorVoltage"] / 1000.0 + 1.0, 3)
    if not math.isfinite(corrected_ir) or not math.isfinite(threshold_ir):
        raise ValueError("calculated IR values must be finite")
    safety_ok = data["ncAuxSafe"] and data["zeroVoltageSafe"]

    if not safety_ok:
        status = "SAFETY INTERLOCK FAILED"
    else:
        status = "NORMAL" if corrected_ir >= threshold_ir else "MAINTENANCE ALERT"

    record = {
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "motorId": motor_id.strip(),
        "rawIR": values["rawIR"],
        "temperatureC": temperature,
        "testVoltage": values["testVoltage"],
        "motorVoltage": values["motorVoltage"],
        "ratedVoltage": values["motorVoltage"],
        "correctedIR": corrected_ir,
        "thresholdIR": threshold_ir,
        "ncAuxSafe": data["ncAuxSafe"],
        "zeroVoltageSafe": data["zeroVoltageSafe"],
        "safetyOK": safety_ok,
        "status": status,
        "employeeId": str(data.get("employeeId", "N/A")),
        "operatorName": str(data.get("operatorName", "Arduino Operator")),
    }

    if "minutes" in values:
        record["minutes"] = values["minutes"]
    for field in ("raw_ab", "raw_bc", "raw_ca", "raw_ag", "raw_bg", "raw_cg"):
        if field in values:
            record[field] = values[field]

    return record


def sync_to_firebase(record, session, auth_token=None):
    auth = {"auth": auth_token} if auth_token else None
    live_response = session.put(
        f"{FIREBASE_DATABASE_URL}/live.json",
        params=auth,
        json=record,
        timeout=10,
    )
    live_response.raise_for_status()

    history_response = session.post(
        f"{FIREBASE_DATABASE_URL}/history.json",
        params=auth,
        json=record,
        timeout=10,
    )
    history_response.raise_for_status()


def run_gateway(serial_module, request_exception, session, auth_token):
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
                        if not line.startswith("{"):
                            print(f"Ignoring Arduino output: {line}")
                            continue

                        try:
                            data = json.loads(line)
                            record = build_log_record(data)
                            sync_to_firebase(record, session, auth_token)
                            print(
                                f"Logged motor {record['motorId']} | "
                                f"{record['status']} | {record['timestamp']}"
                            )
                        except (json.JSONDecodeError, ValueError) as error:
                            print(f"Invalid Arduino record: {error}")
                        except request_exception as error:
                            print(f"Firebase sync failed; record was not confirmed: {error}")
            except serial_module.SerialException as error:
                print(
                    f"Arduino serial port {SERIAL_PORT} unavailable: {error}. "
                    "Retrying in 5 seconds..."
                )
                time.sleep(5)
    except KeyboardInterrupt:
        print("\nGateway stopped.")


def main():
    import serial
    import requests

    auth_token = os.getenv("FIREBASE_AUTH_TOKEN")
    session = requests.Session()
    run_gateway(serial, requests.RequestException, session, auth_token)


if __name__ == "__main__":
    main()
        if ser.in_waiting > 0:
            raw_line = ser.readline().decode('utf-8', errors='ignore').strip()

            if raw_line.startswith("{") and raw_line.endswith("}"):
                data = json.loads(raw_line)
                print(f"\nReceived Telemetry: {data}")
                
                response = requests.put(FIREBASE_URL, json=data)
                
                if response.status_code == 200:
                    print("Status: Successfully synced to Firebase!")
                else:
                    print(f"Firebase Error: {response.status_code}\n{response.text}")
    except Exception as err:
        print(f"Error: {err}")
        
    time.sleep(0.05)
