

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
                    print(f"Firebase Error: {response.status_code} - {response.text}")
    except Exception as err:
        print(f"Error: {err}")
        
    time.sleep(0.05)Last login: Fri Sep 18 17:11:37 on ttys000



