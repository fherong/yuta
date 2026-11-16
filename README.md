# YUTA Telemetry

## Raspberry Pi Arduino gateway

`gateway.py` runs on the Raspberry Pi, reads newline-delimited JSON from the Arduino, updates the website's live telemetry, and appends each accepted reading to its history logs.

Install the Python dependencies on the Pi:

```bash
python3 -m pip install -r requirements.txt
```

Connect the Arduino and run the gateway:

```bash
SERIAL_PORT=/dev/ttyACM0 python3 gateway.py
```

Set `SERIAL_PORT` to the Arduino's actual device (for example `/dev/ttyUSB0`) and `BAUD_RATE` to match the Arduino sketch. The default baud rate is `9600`. If the Realtime Database requires an auth token, set `FIREBASE_AUTH_TOKEN` in the environment. `FIREBASE_DATABASE_URL` can also be set to the database's base URL.

The Arduino should send one JSON object followed by a newline for each completed test. Required values are:

```json
{
  "motorId": "motor-001",
  "rawIR": 2.4,
  "temperatureC": 38.5,
  "testVoltage": 1000,
  "motorVoltage": 480,
  "ncAuxSafe": true,
  "zeroVoltageSafe": true
}
```

The two safety values must be JSON booleans. Optional fields are `employeeId`, `operatorName`, `minutes`, and the individual readings `raw_ab`, `raw_bc`, `raw_ca`, `raw_ag`, `raw_bg`, and `raw_cg`. The gateway records unsafe interlock responses too, marking them `SAFETY INTERLOCK FAILED`; it does not mark them as safe or discard them. It calculates temperature-corrected IR and the threshold, then writes records to `/live` and `/history`, which are the paths consumed by the website.

## Web application

The website is a React application built with Vite and ESLint.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
