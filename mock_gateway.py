import json
import random
import time
from datetime import datetime
import requests

LIVE_URL = "https://yuta-db-default-rtdb.asia-southeast1.firebasedatabase.app/live.json"
HISTORY_URL = "https://yuta-db-default-rtdb.asia-southeast1.firebasedatabase.app/history.json"

print("Starting Mock Gateway (Logging to /live and /history)...")
print("Press Ctrl + C to stop.\n")

while True:
    temp = round(random.uniform(35.0, 48.0), 2)
    raw_ir = round(random.uniform(1.2, 3.5), 2)
    motor_voltage = 380.0
    threshold_ir = 1.38

    # IEEE Std. 43-2013 temperature correction
    if temp >= 40.0:
        kt = 0.5 ** ((temp - 40.0) / 10.0)
    else:
        kt = 2.0 ** ((40.0 - temp) / 10.0)
    corrected_ir = round(raw_ir * kt, 2)

    status = "NORMAL" if corrected_ir >= threshold_ir else "MAINTENANCE ALERT"
    timestamp = datetime.utcnow().isoformat() + "Z"

    payload = {
        "timestamp": timestamp,
        "safetyOK": True,
        "motorVoltage": motor_voltage,
        "temperatureC": temp,
        "rawIR": raw_ir,
        "correctedIR": corrected_ir,
        "thresholdIR": threshold_ir,
        "status": status
    }

    try:
        # Overwrite live view
        live_res = requests.put(LIVE_URL, json=payload)
        # Append to historical records
        hist_res = requests.post(HISTORY_URL, json=payload)

        if live_res.status_code == 200 and hist_res.status_code == 200:
            print(f"[{timestamp}] Live & History synced | Temp: {temp}°C | Corrected IR: {corrected_ir} MΩ | Status: {status}")
        else:
            print(f"Firebase response error: Live={live_res.status_code}, Hist={hist_res.status_code}")
    except Exception as err:
        print(f"Sync error: {err}")

    time.sleep(4)
