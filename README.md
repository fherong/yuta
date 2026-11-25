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
SERIAL_PORT=/dev/ttyACM0 CAMERA_DEVICE=0 .venv/bin/python gateway.py
```

The default USB camera is index `0`; no model name is required. If it is not detected, check `/dev/video*` and set `CAMERA_DEVICE` to another index (such as `1`) or a device path (such as `/dev/video0`).

The OCR gateway serves a phone-friendly live preview at `http://<PI-IP>:8080/`, including a green outline for the OCR area and a yellow outline for the M/G unit. Open it from a phone or tablet on the same local Wi-Fi network as the Pi. The video stream is served directly from the Pi and does not require internet; the cloud-hosted YUTA dashboard still requires internet. Find the Pi's local address with `hostname -I`. Set `CAMERA_WEB_PORT` to change the port. The optional OpenCV desktop preview can still be enabled with `CAMERA_PREVIEW=1` from a desktop session.

The preview server listens on all Pi network interfaces by default for local phone access. Keep it on a trusted private network and do not forward its port to the public internet.

#### Headless Wi-Fi onboarding and recovery (Raspberry Pi OS Trixie)

Install the NetworkManager hotspot fallback once before placing the Pi in its box:

```bash
sudo bash deploy/setup-yuta-network.sh YOUR_PI_USERNAME
```

The script asks for a WPA2 password and creates a `YUTA-Setup` recovery hotspot with a low autoconnect priority. The password is shown once at install time; record it securely. It also installs a restricted root helper so the gateway can save a site Wi-Fi profile without running the gateway itself as root. The helper accepts changes only while the Pi is connected to its `YUTA-Setup` hotspot.

Run the OCR gateway as described above, connect a phone or tablet to `YUTA-Setup`, and open `http://10.42.0.1:8080/`. Use **Set up site Wi-Fi** to enter the site's WPA2 network name and password. The Pi saves that network with a higher priority and attempts to join it. On future boots it will automatically prefer the saved site network; if that network is unavailable, NetworkManager can activate `YUTA-Setup` again. The camera preview works through either connection without internet. Firebase login and cloud sync still need internet.

If the Wi-Fi interface is not named `wlan0`, pass its name as the second installer argument, for example `sudo bash deploy/setup-yuta-network.sh YOUR_PI_USERNAME wlan1`. This setup targets Raspberry Pi OS Trixie with NetworkManager; do not use it on older Raspberry Pi OS releases.

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

Use the OCR service so the camera preview and OCR gateway start automatically after power-up. The separate `yuta-gateway.service` remains configured for manual keypad mode; run only one gateway at a time because both use the same Arduino serial port.

```bash
sudo cp deploy/yuta-ocr-gateway.service /etc/systemd/system/yuta-ocr-gateway.service
sudo nano /etc/systemd/system/yuta-ocr-gateway.service
```

Replace `YOUR_PI_USERNAME` with the Pi login name. The example expects the repository at `/home/<username>/yuta` and the virtual environment at `/home/<username>/yuta/.venv`; update `WorkingDirectory` and `ExecStart` if yours differ. Set `SERIAL_PORT` and `CAMERA_DEVICE` to the actual devices. Add the Pi user to the `dialout` group if needed:

```bash
sudo usermod -aG dialout YOUR_PI_USERNAME
sudo systemctl daemon-reload
sudo systemctl enable --now yuta-ocr-gateway.service
```

Check the service and logs with `systemctl status yuta-ocr-gateway.service` and `journalctl -u yuta-ocr-gateway.service -f`. The optional `/etc/yuta-gateway.env` file can hold `FIREBASE_AUTH_TOKEN=...`; keep it off the repository and restrict access to it.

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
