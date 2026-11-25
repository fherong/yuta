import ipaddress
import json
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


SETUP_NETWORK = ipaddress.ip_network("10.42.0.0/24")
WIFI_CONFIGURATOR = "/usr/local/sbin/yuta-configure-wifi"


def configure_site_wifi(client_address, ssid, password):
    try:
        client_ip = ipaddress.ip_address(client_address)
    except ValueError as error:
        raise ValueError("Invalid client address") from error
    if client_ip not in SETUP_NETWORK:
        raise PermissionError("Wi-Fi setup is only available from the YUTA-Setup hotspot")
    if not isinstance(ssid, str) or not ssid.strip() or len(ssid.encode("utf-8")) > 32:
        raise ValueError("Network name must contain 1 to 32 bytes")
    if any(ord(character) < 32 or ord(character) == 127 for character in ssid):
        raise ValueError("Network name contains unsupported control characters")
    if not isinstance(password, str) or not 8 <= len(password.encode("utf-8")) <= 63:
        raise ValueError("Wi-Fi password must contain 8 to 63 bytes")

    try:
        result = subprocess.run(
            ["sudo", "-n", WIFI_CONFIGURATOR],
            input=json.dumps({
                "action": "save",
                "ssid": ssid.strip(),
                "password": password,
            }),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Wi-Fi setup timed out; the setup hotspot will remain available") from error
    except FileNotFoundError as error:
        raise RuntimeError("Wi-Fi setup helper is not installed on this Pi") from error

    if result.returncode != 0:
        raise RuntimeError(
            "Could not connect to that network. Check its name and password; "
            "the YUTA-Setup hotspot should remain available."
        )
    return "Network saved. The Pi will now try to join it; reconnect your phone to that Wi-Fi."


def activate_site_wifi():
    try:
        result = subprocess.run(
            ["sudo", "-n", WIFI_CONFIGURATOR],
            input=json.dumps({"action": "activate"}),
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        print("Could not activate saved site Wi-Fi; the YUTA-Setup hotspot remains available.")
        return

    if result.returncode != 0:
        print("Could not activate saved site Wi-Fi; the YUTA-Setup hotspot remains available.")


CAMERA_PREVIEW_PAGE = b"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#171717">
  <title>YUTA Camera Preview</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #171717; color: #f5f5f4; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
    main { width: min(100%, 900px); }
    h1 { font-size: 1.2rem; letter-spacing: .12em; margin: 0 0 .4rem; }
    p { color: #d6d3d1; font-size: .9rem; margin: 0 0 1rem; }
    .status { color: #86efac; font-weight: 700; min-height: 1.5rem; }
    .frame { position: relative; overflow: hidden; background: #292524; border: 1px solid #57534e; }
    img { display: block; width: 100%; height: auto; min-height: 180px; object-fit: contain; }
    .ocr-box { position: absolute; left: 8%; top: 20%; width: 84%; height: 60%; border: 2px solid #4ade80; box-shadow: 0 0 0 999px #0005; pointer-events: none; }
    .unit-box { position: absolute; left: 75.2%; top: 32%; width: 10.1%; height: 36%; border: 2px dashed #facc15; pointer-events: none; }
    .legend { display: flex; flex-wrap: wrap; gap: .75rem 1rem; padding-top: .75rem; color: #d6d3d1; font-size: .8rem; }
    .legend span::before { content: ""; display: inline-block; width: .75rem; height: .75rem; margin-right: .4rem; vertical-align: -.05rem; border: 2px solid #4ade80; }
    .legend .unit::before { border: 2px dashed #facc15; }
    details { margin-top: 1.5rem; border-top: 1px solid #57534e; padding-top: 1rem; }
    summary { cursor: pointer; font-weight: 700; }
    form { display: grid; gap: .75rem; max-width: 32rem; margin-top: 1rem; }
    label { display: grid; gap: .3rem; font-size: .85rem; }
    input, button { min-height: 2.75rem; border: 1px solid #78716c; border-radius: .25rem; padding: .6rem; font: inherit; }
    input { background: #292524; color: #f5f5f4; }
    button { background: #4ade80; color: #171717; font-weight: 800; cursor: pointer; }
    #network-status { min-height: 1.5rem; }
    @media (max-width: 480px) { body { padding: .6rem; } .frame img { min-height: 200px; } }
  </style>
</head>
<body>
  <main>
    <h1>Y.U.T.A. CAMERA PREVIEW</h1>
    <p>Aim the tester display inside the green box. Keep the M/G unit inside the yellow box.</p>
    <div id="status" class="status">Connecting to camera...</div>
    <div class="frame">
      <img id="camera" src="/stream.mjpg" alt="Live USB camera feed">
      <div class="ocr-box"></div>
      <div class="unit-box"></div>
    </div>
    <div class="legend"><span>OCR reading area</span><span class="unit">M/G unit area</span></div>
    <details>
      <summary>Set up site Wi-Fi</summary>
      <p>Available only while connected to the YUTA-Setup hotspot. The Pi saves the network and attempts to join it.</p>
      <form id="wifi-form">
        <label>Wi-Fi network name (SSID)<input name="ssid" autocomplete="off" maxlength="32" required></label>
        <label>Wi-Fi password<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="63" required></label>
        <button type="submit">SAVE AND CONNECT</button>
      </form>
      <div id="network-status" role="status"></div>
    </details>
  </main>
  <script>
    const camera = document.getElementById('camera');
    const status = document.getElementById('status');
    camera.onload = () => { status.textContent = 'LIVE'; };
    camera.onerror = () => { status.textContent = 'Camera feed unavailable. Check that the gateway is running.'; };
    document.getElementById('wifi-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = document.getElementById('network-status');
      const button = form.querySelector('button');
      button.disabled = true;
      message.textContent = 'Saving network...';
      try {
        const response = await fetch('/api/wifi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ssid: form.elements.ssid.value,
            password: form.elements.password.value
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to configure Wi-Fi.');
        form.reset();
        message.textContent = result.message;
      } catch (error) {
        message.textContent = error.message || 'Unable to configure Wi-Fi.';
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>
"""


class CameraFrameBuffer:
    def __init__(self):
        self._condition = threading.Condition()
        self._jpeg = None
        self._version = 0

    def publish(self, jpeg):
        with self._condition:
            self._jpeg = jpeg
            self._version += 1
            self._condition.notify_all()

    def wait_for_frame(self, previous_version, timeout=1):
        with self._condition:
            self._condition.wait_for(
                lambda: self._version != previous_version,
                timeout=timeout,
            )
            return self._version, self._jpeg


class CameraPreviewServer:
    def __init__(self, host="0.0.0.0", port=8080, frame_buffer=None):
        self.frame_buffer = frame_buffer or CameraFrameBuffer()
        frame_source = self.frame_buffer

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(CAMERA_PREVIEW_PAGE)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(CAMERA_PREVIEW_PAGE)
                    return

                if self.path != "/stream.mjpg":
                    self.send_error(404)
                    return

                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "multipart/x-mixed-replace; boundary=frame",
                )
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
                self.send_header("Connection", "close")
                self.end_headers()

                version = 0
                try:
                    while True:
                        version, jpeg = frame_source.wait_for_frame(version)
                        if jpeg is None:
                            continue
                        self.wfile.write(
                            b"--frame\r\n"
                            b"Content-Type: image/jpeg\r\n"
                            + f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii")
                            + jpeg
                            + b"\r\n"
                        )
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return

            def do_POST(self):
                if self.path != "/api/wifi":
                    self.send_error(404)
                    return

                try:
                    origin = self.headers.get("Origin")
                    if origin and urlsplit(origin).netloc != self.headers.get("Host"):
                        raise PermissionError("Wi-Fi setup requests must come from this page")
                    content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
                    if content_type.strip().lower() != "application/json":
                        raise ValueError("Expected JSON Wi-Fi settings")
                    content_length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < content_length <= 1024:
                        raise ValueError("Invalid request size")
                    payload = json.loads(self.rfile.read(content_length))
                    if not isinstance(payload, dict):
                        raise ValueError("Invalid Wi-Fi settings")
                    message = configure_site_wifi(
                        self.client_address[0],
                        payload.get("ssid"),
                        payload.get("password"),
                    )
                except PermissionError as error:
                    self._send_json(403, {"error": str(error)})
                except (ValueError, json.JSONDecodeError) as error:
                    self._send_json(400, {"error": str(error)})
                except RuntimeError as error:
                    self._send_json(502, {"error": str(error)})
                else:
                    self._send_json(200, {"message": message})
                    threading.Thread(
                        target=activate_site_wifi,
                        name="yuta-site-wifi-activation",
                        daemon=True,
                    ).start()

            def _send_json(self, status, payload):
                response = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(response)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(response)
                self.wfile.flush()

            def log_message(self, _format, *_args):
                return

        self._server = ThreadingHTTPServer((host, port), Handler)
        self._server.daemon_threads = True
        self._thread = None
        self._last_frame_at = 0.0
        self._publish_interval = 1 / 8

    @property
    def address(self):
        return self._server.server_address

    def start(self):
        if self._thread is not None:
            raise RuntimeError("Camera preview server has already been started")
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="yuta-camera-preview",
            daemon=True,
        )
        self._thread.start()

    def publish_frame(self, frame, cv2_module):
        now = time.monotonic()
        if now - self._last_frame_at < self._publish_interval:
            return

        height, width = frame.shape[:2]
        if width > 960:
            resized_height = round(height * 960 / width)
            frame = cv2_module.resize(frame, (960, resized_height))
        success, encoded = cv2_module.imencode(
            ".jpg",
            frame,
            [cv2_module.IMWRITE_JPEG_QUALITY, 75],
        )
        if not success:
            raise RuntimeError("Unable to encode a camera preview frame")

        self.frame_buffer.publish(encoded.tobytes())
        self._last_frame_at = now

    def close(self):
        if self._thread is not None:
            self._server.shutdown()
        self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
