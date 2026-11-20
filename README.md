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

The Arduino should send one JSON object followed by a newline for each completed test. Required values are:

For a completed safe test, the Arduino sends `motorId`, `motorName`, `motorVoltage`, `testVoltage`, the two boolean safety values, and all six readings (`raw_ab`, `raw_bc`, `raw_ca`, `raw_ag`, `raw_bg`, `raw_cg`). It also includes the employee ID and operator name from the LCD login. The gateway records unsafe interlock responses too, marking them `SAFETY INTERLOCK FAILED`; it does not mark them as safe or discard them. For safe tests, it calculates minimum and average IR readings and compares the minimum with the voltage-based threshold, then writes records to `/live` and `/history`, which are the paths consumed by the website.

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

The optional `/etc/yuta-gateway.env` file can hold `FIREBASE_AUTH_TOKEN=...` if database authentication is required. Keep that file off the repository and restrict access to it. With the service enabled, the Pi can run headlessly: after power returns, systemd starts the gateway and it waits/retries for the Arduino. The Pi needs internet access when a reading is sent; if Firebase is unreachable during sync, the gateway reports the error but does not queue that record for later.

## Web application

The website is a React application built with Vite and ESLint.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
