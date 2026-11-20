# YUTA Telemetry

## Raspberry Pi Arduino gateway

`gatewayy.py` runs on the Raspberry Pi for manual Arduino testing. It provides the motor list, employee login, and telemetry sync used by the keypad/LCD sketch.

Install the Python dependencies on the Pi:

```bash
python3 -m pip install -r requirements.txt
```

Connect the Arduino and run the gateway manually to test it:

```bash
SERIAL_PORT=/dev/ttyACM0 python3 gatewayy.py
```

Set `SERIAL_PORT` to the Arduino's actual device (for example `/dev/ttyUSB0`) and `BAUD_RATE` to match the Arduino sketch. The default baud rate is `9600`. If the Realtime Database requires an auth token, set `FIREBASE_AUTH_TOKEN` in the environment. `FIREBASE_DATABASE_URL` can also be set to the database's base URL.

The Arduino sends one JSON object followed by a newline for each test. A completed safe test includes `motorId`, `motorName`, `motorVoltage`, `testVoltage`, the two boolean safety values, all six readings (`raw_ab`, `raw_bc`, `raw_ca`, `raw_ag`, `raw_bg`, `raw_cg`), and the employee ID and operator name from the LCD login. The gateway writes the received fields to `/live` and `/history` without converting measurements or deriving status, safety, minimum/average IR, or threshold values. It adds a UTC `timestamp` only when the Arduino message does not include one.

### LCD employee login

Upload [`arduino/YUTA_Arduino.ino`](arduino/YUTA_Arduino.ino) to the Arduino Mega. On startup, the tester requests employees with the `Employee` role and an 8-12 digit PIN from Realtime Database. The LCD shows each employee name with the last three numeric digits of their employee ID. The operator selects their name, enters the PIN on the keypad, and the Pi verifies it against the current account before enabling tests. PINs are not included in the employee list or gateway logs. A Firebase connection is required to log in; authentication fails closed if the Pi cannot verify the account. Existing accounts with shorter PINs must have their PIN reset in Settings before they can log in on the tester. Press `C` on the ready screen to switch operators. Each submitted record includes the authenticated employee ID and name.

### Automatic startup in a monitorless box

The gateway keeps retrying the serial connection if the Arduino is not ready yet or is unplugged, so it can start before the Arduino. To have it start automatically when the Pi boots, install the systemd service after installing the Python dependencies:

```bash
sudo cp deploy/yuta-gateway.service /etc/systemd/system/yuta-gateway.service
sudo nano /etc/systemd/system/yuta-gateway.service
```

In the service file, replace `YOUR_PI_USERNAME` with the Pi login name. The example expects the repository at `/home/<username>/yuta` and the virtual environment at `/home/<username>/yuta/.venv`; update `WorkingDirectory` and `ExecStart` if yours differ. Set `SERIAL_PORT` to the Arduino's actual device. Add the Pi user to the `dialout` group if needed, then reboot or log out and back in:

```bash
sudo usermod -aG dialout YOUR_PI_USERNAME
sudo systemctl daemon-reload
sudo systemctl enable --now yuta-gateway.service
```

Check whether it is running and view its logs with:

```bash
systemctl status yuta-gateway.service
journalctl -u yuta-gateway.service -f
```

The optional `/etc/yuta-gateway.env` file can hold `FIREBASE_AUTH_TOKEN=...` if database authentication is required. Keep that file off the repository and restrict access to it. With the service enabled, the Pi can run headlessly: after power returns, systemd starts the gateway and it waits/retries for the Arduino.

Each Arduino test record is committed to a local SQLite queue before cloud sync. The default database is `~/.local/share/yuta-gateway/telemetry.sqlite3` on the Pi's local storage (normally its SD card); set `YUTA_QUEUE_DB_PATH` to use another path. The gateway retries pending records every five seconds and after restart. It removes a queued record only after both `/live` and `/history` accept it, and uses a stable history key so retries do not duplicate log entries. The LCD reports when a record is safely queued locally but still pending cloud sync.

The employee list, motor list, and PIN verification still require Firebase. This queue covers a connection drop after the operator has logged in and the motor list has loaded; starting a new test while already offline is not supported.

## Web application

The website is a React application built with Vite and ESLint.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
