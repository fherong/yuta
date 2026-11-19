# YUTA Telemetry

## Raspberry Pi gateways

Both gateway programs save accepted readings to a SQLite outbox on the Pi's SD card (`gateway-outbox.sqlite3` beside the scripts) before uploading them to Firebase. If the internet or Firebase is unavailable, records remain queued and are retried every two seconds. History writes use stable record IDs, so a retry after an interrupted upload does not create duplicates. `GATEWAY_QUEUE_PATH` can move the outbox to another SD-card directory.

Install the Python dependencies on the Pi and the Tesseract OCR engine:

```bash
python3 -m pip install -r requirements.txt
sudo apt install tesseract-ocr
```

Both modes implement the Arduino's two-way serial protocol. On `LIST?`, the Pi sends the Firebase motor assets as `MOTOR|id|name|ratedVoltage` lines followed by `END`. The most recently fetched list is cached in the SD-card database for offline startup. After a test result is safely written to the local outbox, the Pi returns `ACK|SAVED`; this confirms local persistence, not that Firebase is already online. The gateway later syncs the queued record automatically.

### Arduino Mega sketch

The connected sketch is [arduino/YUTA_Arduino.ino](./arduino/YUTA_Arduino.ino). Select **Arduino Mega 2560** at **9600 baud** and install the `Keypad` and `LiquidCrystal_I2C` libraries. It requests the motor list on startup, sends the OCR start/cancel events, and waits for the Pi's save acknowledgement. The LCD now reports that the record is saved on the Pi; cloud sync may still be pending.

### UT501A camera OCR (`gateway.py`)

Connect a USB camera pointed at the UNI-T UT501A LCD, framing the main digits near the center of the image. Set `CAMERA_DEVICE` if the camera is not `/dev/video0` (default index `0`). The gateway waits for an Arduino test-start event, captures for 60 seconds, and queues the last stable LCD resistance reading. The LCD value is stored as `rawIR_GOhm`; a converted MΩ value is also included for compatibility. No temperature, voltage, or safety values are fabricated. Set `MOTOR_ID` to the matching motor key in Firebase, or include `motorId` in the Arduino event.

The Arduino sketch sends a newline-delimited `test_started` event after its initial safety check. After the test and final safety recheck, it sends the six manually entered line values. In OCR mode, those values are used to validate the completed test and are not stored; only the camera reading is stored for a safe test. A failed safety check is saved as a safety-only record. A cancelled test discards the pending OCR reading.

The website's Logs page shows OCR readings and lets each user select Ω, kΩ, MΩ, GΩ, or TΩ; the selection is remembered in that browser.

### Manual Arduino telemetry (`gatewayy.py`)

Use the separate serial gateway to test direct Arduino values:

```bash
SERIAL_PORT=/dev/ttyACM0 python3 gatewayy.py
```

Set `SERIAL_PORT` to the Arduino's actual device (for example `/dev/ttyUSB0`) and `BAUD_RATE` to match the Arduino sketch. The default baud rate is `9600`. If the Realtime Database requires an auth token, set `FIREBASE_AUTH_TOKEN`; `FIREBASE_DATABASE_URL` can also be set to the database's base URL.

`gatewayy.py` stores the Arduino sketch's manual six-line JSON readings. A normal test includes these fields:

```json
{
  "motorId": "motor-001",
  "motorName": "WATER PUMP 01",
  "motorVoltage": 480,
  "testVoltage": 1000,
  "ncAuxSafe": true,
  "zeroVoltageSafe": true,
  "raw_ab": 2.4,
  "raw_bc": 2.42,
  "raw_ca": 2.38,
  "raw_ag": 2.25,
  "raw_bg": 2.28,
  "raw_cg": 2.2
}
```

The gateway derives `rawIR` from the lowest of the supplied line readings. `temperatureC` is optional; if omitted, no temperature correction is applied and the website leaves temperature blank. The two safety values must be JSON booleans. `employeeId` and `operatorName` are optional. Safety-failure messages are saved without inventing measurement values.

### Automatic startup in a monitorless box

The OCR gateway keeps retrying the serial connection if the Arduino is not ready yet or is unplugged, so it can start before the Arduino. To have it start automatically when the Pi boots, install the systemd service after installing the dependencies:

```bash
sudo cp deploy/yuta-gateway.service /etc/systemd/system/yuta-gateway.service
sudo nano /etc/systemd/system/yuta-gateway.service
```

In the service file, replace `YOUR_PI_USERNAME` with the Pi login name. The example expects the repository at `/home/<username>/yuta` and the virtual environment at `/home/<username>/yuta/.venv`; update `WorkingDirectory` and `ExecStart` if yours differ. Set `SERIAL_PORT` to the Arduino's actual device, and configure `MOTOR_ID` in `/etc/yuta-gateway.env` if the Arduino event does not include it. Add the Pi user to both the `dialout` and `video` groups if needed, then reboot or log out and back in:

```bash
sudo usermod -aG dialout,video YOUR_PI_USERNAME
sudo systemctl daemon-reload
sudo systemctl enable --now yuta-gateway.service
```

Check whether it is running and view its logs with:

```bash
systemctl status yuta-gateway.service
journalctl -u yuta-gateway.service -f
```

The optional `/etc/yuta-gateway.env` file can hold `MOTOR_ID=...`, `CAMERA_DEVICE=0`, `FIREBASE_AUTH_TOKEN=...`, and `GATEWAY_QUEUE_PATH=...`. Keep that file off the repository and restrict access to it. With the service enabled, the Pi can run headlessly: after power returns, systemd starts the OCR gateway and waits for Arduino test-start events. The gateway retries queued readings as soon as Firebase becomes available.

## Web application

The website is a React application built with Vite and ESLint.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
