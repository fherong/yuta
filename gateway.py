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

print("Listening for telemetry data...")

while True:
    try:
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
