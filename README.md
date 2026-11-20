# YUTA Telemetry

## Raspberry Pi gateways

Use `gateway.py` with the OCR Arduino sketch, or `gatewayy.py` with the manual-entry sketch. Both provide the motor list and employee login, and both persist completed records in the SQLite queue on the Pi's SD card before syncing to Firebase.

### UT501A camera OCR

Connect a USB camera to the Pi and frame the UNI-T UT501A display. Install Tesseract and the Python environment tools:

```bash
sudo apt install tesseract-ocr python3-venv
```

Create a virtual environment and install the project dependencies:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

If you installed the earlier headless OpenCV package, remove it before installing the GUI-enabled package:

```bash
.venv/bin/pip uninstall -y opencv-python-headless
.venv/bin/pip install -r requirements.txt
```

Upload [arduino/YUTA_Arduino_OCR.ino](arduino/YUTA_Arduino_OCR.ino) to the Arduino Mega 2560 and run the OCR gateway:

```bash
SERIAL_PORT=/dev/ttyACM0 CAMERA_DEVICE=0 CAMERA_PREVIEW=1 .venv/bin/python gateway.py
```

The default USB camera is index `0`; no model name is required. If it is not detected, check `/dev/video*` and set `CAMERA_DEVICE` to another index (such as `1`) or a device path (such as `/dev/video0`).
Run the command from the Pi's desktop session to see the live preview while waiting and during captures. The preview refreshes independently while OCR samples are processed in the background. `CAMERA_PREVIEW=1` requires a display session; set it to `0` for headless use.

The sketch requests one camera capture for each of the six winding positions. Each capture lasts 60 seconds; four consecutive OCR samples must agree within 0.5%, and the latest stable sample in that window is kept. The LCD shows the captured GΩ value for review before the final safety check and save. If no stable value is found, the operator can retry that position or cancel the test.

The OCR reads the numeric display separately from its MΩ/GΩ unit. MΩ readings are normalized to GΩ before saving, so the website and maintenance threshold receive consistent values. If the unit is not recognized, that sample is rejected rather than being interpreted at the wrong scale.

OCR values are normalized into `raw_ab_GOhm` through `raw_cg_GOhm`. Corresponding `raw_ab` through `raw_cg` values are stored in MΩ so the website can apply its existing `<5 MΩ` maintenance rule. The website displays the normalized GΩ values. OCR does not invent temperature, status, or safety values.

### Manual Arduino telemetry

Use the separate manual sketch and gateway when readings are typed on the Arduino keypad:

```bash
SERIAL_PORT=/dev/ttyACM0 .venv/bin/python gatewayy.py
```

Upload [arduino/YUTA_Arduino.ino](arduino/YUTA_Arduino.ino) for this mode. Its six keypad readings pass to `gatewayy.py` unchanged.

### Employee login and database configuration

Both sketches request eligible employees at startup. The LCD shows each employee name with the last three numeric digits of their employee ID. The operator selects their name, enters the 8–12 digit PIN on the keypad, and the Pi verifies it against the current account before enabling tests. A Firebase connection is required to log in; authentication fails closed if the Pi cannot verify the account. Each submitted record includes the authenticated employee ID and name.

Set `SERIAL_PORT` to the Arduino device (for example `/dev/ttyUSB0`) and `BAUD_RATE` to match the sketch; the default is `9600`. If the Realtime Database requires an auth token, set `FIREBASE_AUTH_TOKEN`. `FIREBASE_DATABASE_URL` can also be set to the database's base URL.

### Automatic startup in a monitorless box

The included systemd service runs the manual gateway (`gatewayy.py`). For OCR mode, change its `ExecStart` in `/etc/systemd/system/yuta-gateway.service` to `/home/YOUR_PI_USERNAME/yuta/.venv/bin/python /home/YOUR_PI_USERNAME/yuta/gateway.py`. Run only one gateway at a time because both use the same Arduino serial port.

```bash
sudo cp deploy/yuta-gateway.service /etc/systemd/system/yuta-gateway.service
sudo nano /etc/systemd/system/yuta-gateway.service
```

In the service file, replace `YOUR_PI_USERNAME` with the Pi login name. The example expects the repository at `/home/<username>/yuta` and the virtual environment at `/home/<username>/yuta/.venv`; update `WorkingDirectory` and `ExecStart` if yours differ. Set `SERIAL_PORT` to the Arduino's actual device. Add the Pi user to the `dialout` group if needed:

```bash
sudo usermod -aG dialout YOUR_PI_USERNAME
sudo systemctl daemon-reload
sudo systemctl enable --now yuta-gateway.service
```

Check the service and logs with `systemctl status yuta-gateway.service` and `journalctl -u yuta-gateway.service -f`. The optional `/etc/yuta-gateway.env` file can hold `FIREBASE_AUTH_TOKEN=...`; keep it off the repository and restrict access to it.

Each Arduino test record is committed to a local SQLite queue before cloud sync. The default database is `~/.local/share/yuta-gateway/telemetry.sqlite3` on the Pi's local storage (normally its SD card); set `YUTA_QUEUE_DB_PATH` to use another path. The gateway retries pending records every five seconds and after restart, and removes a queued record only after both `/live` and `/history` accept it. Employee and motor lists and PIN verification still require Firebase, so the Pi must be online before login and motor selection.

## Web application

The website is a React application built with Vite and ESLint.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
