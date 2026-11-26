import json
import tempfile
import unittest
from concurrent.futures import Future
from urllib.error import HTTPError
from types import SimpleNamespace
from urllib.request import Request, urlopen
from unittest.mock import Mock, patch

from camera_preview import CameraPreviewServer, configure_site_wifi
from gateway import (
    OCR_FIELDS,
    _save_record,
    _handle_capture_event,
    build_ocr_test_record,
    capture_last_stable_reading,
    open_camera,
    open_usb_camera,
    parse_ut501a_reading,
    read_ut501a_frame,
    run_ocr_gateway,
)
from gatewayy import TelemetryQueue


class OCRReadingTests(unittest.TestCase):
    class ImmediateExecutor:
        def submit(self, function, frame):
            future = Future()
            future.set_result(function(frame))
            return future

    def test_opens_default_usb_camera_by_index(self):
        cv2 = Mock()
        camera = Mock()
        camera.isOpened.return_value = True
        cv2.VideoCapture.return_value = camera

        with patch("gateway.os.getenv", return_value="0"):
            opened_camera = open_usb_camera(cv2)

        self.assertIs(opened_camera, camera)
        cv2.VideoCapture.assert_called_once_with(0)

    def test_accepts_usb_device_path_and_releases_unavailable_camera(self):
        cv2 = Mock()
        camera = Mock()
        camera.isOpened.return_value = False
        cv2.VideoCapture.return_value = camera

        with self.assertRaisesRegex(RuntimeError, "/dev/video1"):
            open_usb_camera(cv2, "/dev/video1")

        cv2.VideoCapture.assert_called_once_with("/dev/video1")
        camera.release.assert_called_once_with()

    def test_opens_picamera2_camera_and_adapts_frames_for_gateway(self):
        picamera2 = Mock()
        picamera2.capture_array.return_value = object()
        picamera2_module = SimpleNamespace(Picamera2=Mock(return_value=picamera2))
        cv2 = Mock()

        with patch.dict("sys.modules", {"picamera2": picamera2_module}):
            camera = open_camera(cv2, backend="picamera2")

        picamera2.configure.assert_called_once_with(
            picamera2.create_video_configuration.return_value
        )
        picamera2.start.assert_called_once_with()
        success, frame = camera.read()
        self.assertTrue(success)
        self.assertIs(frame, picamera2.capture_array.return_value)
        camera.release()
        picamera2.stop.assert_called_once_with()
        picamera2.close.assert_called_once_with()
        cv2.VideoCapture.assert_not_called()

    def test_usb_backend_remains_available(self):
        cv2 = Mock()
        camera = Mock()
        camera.isOpened.return_value = True
        cv2.VideoCapture.return_value = camera

        self.assertIs(open_camera(cv2, backend="usb", device="/dev/video2"), camera)
        cv2.VideoCapture.assert_called_once_with("/dev/video2")

    def test_local_camera_preview_serves_page_and_mjpeg_frames(self):
        server = CameraPreviewServer("127.0.0.1", 0)
        server.frame_buffer.publish(b"test-jpeg-frame")
        server.start()

        try:
            base_url = f"http://127.0.0.1:{server.address[1]}"
            with urlopen(f"{base_url}/", timeout=2) as response:
                page = response.read().decode("utf-8")
            self.assertIn("Y.U.T.A. CAMERA PREVIEW", page)
            self.assertIn("ocr-box", page)
            self.assertIn("unit-box", page)
            self.assertIn("Set up site Wi-Fi", page)

            with urlopen(f"{base_url}/stream.mjpg", timeout=2) as response:
                self.assertIn("multipart/x-mixed-replace", response.headers["Content-Type"])
                self.assertEqual(response.readline(), b"--frame\r\n")
                response.readline()
                response.readline()
                self.assertEqual(response.readline(), b"\r\n")
                frame_bytes = response.read(len(b"test-jpeg-frame"))
            self.assertEqual(frame_bytes, b"test-jpeg-frame")
        finally:
            server.close()

    def test_wifi_setup_endpoint_rejects_non_hotspot_clients(self):
        server = CameraPreviewServer("127.0.0.1", 0)
        server.start()

        try:
            request = Request(
                f"http://127.0.0.1:{server.address[1]}/api/wifi",
                data=json.dumps({
                    "ssid": "Plant-WiFi",
                    "password": "password123",
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(HTTPError) as error:
                urlopen(request, timeout=2)
            self.assertEqual(error.exception.code, 403)
        finally:
            server.close()

    def test_wifi_configuration_is_restricted_to_setup_hotspot_clients(self):
        with patch("camera_preview.subprocess.run") as run:
            with self.assertRaisesRegex(PermissionError, "YUTA-Setup"):
                configure_site_wifi("192.168.1.25", "Plant-WiFi", "password123")
        run.assert_not_called()

    def test_wifi_configuration_uses_the_privileged_fixed_helper(self):
        with patch(
            "camera_preview.subprocess.run",
            return_value=SimpleNamespace(returncode=0),
        ) as run:
            message = configure_site_wifi(
                "10.42.0.25",
                "Plant-WiFi",
                "password123",
            )

        self.assertIn("will now try to join", message)
        self.assertEqual(
            run.call_args.args[0],
            ["sudo", "-n", "/usr/local/sbin/yuta-configure-wifi"],
        )
        self.assertEqual(
            json.loads(run.call_args.kwargs["input"]),
            {
                "action": "save",
                "ssid": "Plant-WiFi",
                "password": "password123",
            },
        )
        self.assertEqual(run.call_args.kwargs["timeout"], 30)

    def test_parses_a_single_ut501a_reading(self):
        self.assertEqual(parse_ut501a_reading(" 1,25 GΩ "), 1.25)
        with self.assertRaisesRegex(ValueError, "exactly one"):
            parse_ut501a_reading("OL")
        with self.assertRaisesRegex(ValueError, "exactly one"):
            parse_ut501a_reading("1.2 500 G")

    def test_normalizes_milliohms_to_gigaohms_and_rejects_missing_units(self):
        self.assertEqual(parse_ut501a_reading("110 MΩ"), 0.11)
        self.assertEqual(parse_ut501a_reading("0.11 GΩ"), 0.11)
        with self.assertRaisesRegex(ValueError, "MΩ or GΩ"):
            parse_ut501a_reading("110")

    def test_reads_the_numeric_value_and_unit_separately(self):
        class Frame:
            shape = (100, 120)

        class Image:
            width = 100
            height = 60

            def crop(self, _region):
                return self

            def convert(self, _mode):
                return self

            def resize(self, size, _resample):
                self.width, self.height = size
                return self

            def filter(self, _filter):
                return self

            def point(self, _transform):
                return self

        image = Image()
        pytesseract = Mock()
        pytesseract.image_to_string.side_effect = ("110", "M")

        with patch("PIL.Image.fromarray", return_value=image), patch(
            "PIL.ImageOps.autocontrast",
            side_effect=lambda value: value,
        ):
            text = read_ut501a_frame(Frame(), pytesseract)

        self.assertEqual(text, "110 M")
        self.assertIn(
            "tessedit_char_whitelist=0123456789.,",
            pytesseract.image_to_string.call_args_list[0].kwargs["config"],
        )
        self.assertIn(
            "tessedit_char_whitelist=MG",
            pytesseract.image_to_string.call_args_list[1].kwargs["config"],
        )

    def test_retries_thresholded_images_when_grayscale_ocr_is_unclear(self):
        class Frame:
            shape = (100, 120)

        class Image:
            width = 100
            height = 60

            def crop(self, _region):
                return self

            def convert(self, _mode):
                return self

            def resize(self, size, _resample):
                self.width, self.height = size
                return self

            def filter(self, _filter):
                return self

            def point(self, _transform):
                return self

        pytesseract = Mock()
        pytesseract.image_to_string.side_effect = ("", "", "110", "M")

        with patch("PIL.Image.fromarray", return_value=Image()), patch(
            "PIL.ImageOps.autocontrast",
            side_effect=lambda value: value,
        ):
            text = read_ut501a_frame(Frame(), pytesseract)

        self.assertEqual(text, "110 M")
        self.assertEqual(pytesseract.image_to_string.call_count, 4)

    def test_builds_record_with_raw_gohm_and_mohm_values_for_status(self):
        data = {
            "motorId": "motor-001",
            "motorName": "Pump 1",
            "motorVoltage": 480,
            "testVoltage": 1000,
            "ncAuxSafe": True,
            "zeroVoltageSafe": True,
            "employeeId": "EMP-2026-014",
            "operatorName": "Ari Tech",
            "minutes": 6,
        }
        captures = dict(zip(OCR_FIELDS, (1.25, 1.5, 1.75, 2.0, 2.25, 2.5)))

        record = build_ocr_test_record(
            data,
            captures,
            timestamp="2026-11-20T10:00:00Z",
        )

        self.assertEqual(record["source"], "ocr")
        self.assertEqual(record["measurementUnit"], "GΩ")
        self.assertEqual(record["raw_ab_GOhm"], 1.25)
        self.assertEqual(record["raw_ab"], 1250)
        self.assertEqual(record["raw_cg_GOhm"], 2.5)
        self.assertEqual(record["raw_cg"], 2500)
        self.assertEqual(record["timestamp"], "2026-11-20T10:00:00Z")
        self.assertNotIn("status", record)
        self.assertNotIn("temperatureC", record)

    def test_safety_failure_does_not_require_ocr_measurements(self):
        data = {
            "motorId": "motor-001",
            "motorVoltage": 480,
            "ncAuxSafe": False,
            "zeroVoltageSafe": True,
            "employeeId": "EMP-2026-014",
            "operatorName": "Ari Tech",
        }

        record = build_ocr_test_record(data, {})

        self.assertEqual(record["source"], "ocr")
        self.assertFalse(record["ncAuxSafe"])
        self.assertNotIn("raw_ab", record)

    def test_rejects_safe_test_without_all_six_captures(self):
        data = {
            "motorId": "motor-001",
            "motorVoltage": 480,
            "testVoltage": 1000,
            "ncAuxSafe": True,
            "zeroVoltageSafe": True,
        }

        with self.assertRaisesRegex(ValueError, "All six"):
            build_ocr_test_record(data, {"raw_ab": 1.25})

    def test_capture_keeps_the_latest_stable_value_in_the_window(self):
        class Clock:
            now = 0

            def monotonic(self):
                return self.now

            def sleep(self, duration):
                self.now += duration

        class Camera:
            frame = 0

            def read(self):
                self.frame += 1
                return True, self.frame

        clock = Clock()
        readings = iter(["1.0 G"] * 4 + ["2.0 G"] * 4)
        preview_frames = []
        value = capture_last_stable_reading(
            Camera(),
            lambda frame: next(readings),
            duration=2,
            sample_interval=0.25,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
            preview_frame=preview_frames.append,
            ocr_executor=self.ImmediateExecutor(),
        )

        self.assertEqual(value, 2.0)
        self.assertGreater(len(preview_frames), 80)

    def test_capture_fails_when_no_four_samples_are_within_tolerance(self):
        class Clock:
            now = 0

            def monotonic(self):
                return self.now

            def sleep(self, duration):
                self.now += duration

        class Camera:
            frame = 0

            def read(self):
                self.frame += 1
                return True, self.frame

        clock = Clock()
        readings = iter(["1.0 G", "1.1 G"] * 4)
        with self.assertRaisesRegex(ValueError, "No stable"):
            capture_last_stable_reading(
                Camera(),
                lambda frame: next(readings),
                duration=2,
                sample_interval=0.25,
                monotonic=clock.monotonic,
                sleep=clock.sleep,
                ocr_executor=self.ImmediateExecutor(),
            )


class OCRSerialFlowTests(unittest.TestCase):
    def test_acknowledges_local_queue_before_attempting_cloud_sync(self):
        events = []
        arduino = Mock()
        arduino.write.side_effect = lambda message: events.append("ack")
        queue = Mock()
        queue.enqueue.return_value = "record-001"

        with patch(
            "gateway.gatewayy.retry_pending_records",
            side_effect=lambda *args: events.append("sync"),
        ):
            record_id = _save_record(arduino, {"motorId": "motor-001"}, queue, Mock())

        self.assertEqual(record_id, "record-001")
        self.assertEqual(events, ["ack", "sync"])
        arduino.write.assert_called_once_with(b"ACK|QUEUED\n")

    def test_preview_keeps_refreshing_and_reassembles_partial_serial_lines(self):
        arduino = Mock()
        arduino.__enter__ = Mock(return_value=arduino)
        arduino.__exit__ = Mock(return_value=False)
        arduino.readline.side_effect = [
            b'{"event":"test_',
            b'cancelled"}\n',
            KeyboardInterrupt,
        ]
        serial_module = SimpleNamespace(SerialException=Exception)
        serial_module.Serial = Mock(return_value=arduino)
        camera = Mock()
        camera.read.return_value = (True, object())
        preview_frame = Mock()

        with patch("gateway.gatewayy.retry_pending_records"):
            run_ocr_gateway(
                serial_module,
                Exception,
                Mock(),
                Mock(),
                camera,
                lambda frame: "",
                preview_frame=preview_frame,
            )

        self.assertEqual(serial_module.Serial.call_args.kwargs["timeout"], 0.03)
        self.assertGreater(preview_frame.call_count, 2)

    def test_captures_six_positions_and_saves_camera_values(self):
        with tempfile.TemporaryDirectory() as directory:
            queue = TelemetryQueue(f"{directory}/telemetry.sqlite3")
            captures = dict(zip(OCR_FIELDS, (1.25, 1.5, 1.75, 2, 2.25, 2.5)))
            arduino = Mock()
            arduino.__enter__ = Mock(return_value=arduino)
            arduino.__exit__ = Mock(return_value=False)
            arduino.readline.side_effect = [
                *[
                    (
                        json.dumps({
                            "event": "ocr_capture_started",
                            "motorId": "motor-001",
                            "index": OCR_FIELDS.index(field),
                        }) + "\n"
                    ).encode()
                    for field in OCR_FIELDS
                ],
                (
                    json.dumps({
                        "motorId": "motor-001",
                        "motorName": "Pump 1",
                        "motorVoltage": 480,
                        "testVoltage": 1000,
                        "ncAuxSafe": True,
                        "zeroVoltageSafe": True,
                        "employeeId": "EMP-2026-014",
                        "operatorName": "Ari Tech",
                        "minutes": 6,
                    }) + "\n"
                ).encode(),
                KeyboardInterrupt,
            ]
            serial_module = SimpleNamespace(SerialException=Exception)
            serial_module.Serial = Mock(return_value=arduino)
            session = Mock()

            with patch("gateway.time.sleep"), patch(
                "gateway.capture_last_stable_reading",
                side_effect=[captures[field] for field in OCR_FIELDS],
            ):
                run_ocr_gateway(
                    serial_module,
                    Exception,
                    session,
                    queue,
                    Mock(),
                    lambda frame: "",
                )

            responses = b"".join(call.args[0] for call in arduino.write.call_args_list)
            for index, field in enumerate(OCR_FIELDS):
                value = captures[field]
                self.assertIn(f"OCR_RESULT|{index}|{value:.6f}\n".encode(), responses)
            self.assertIn(b"ACK|QUEUED\n", responses)

            history_payload = session.put.call_args_list[-1].kwargs["json"]
            for field, value in captures.items():
                self.assertEqual(history_payload[f"{field}_GOhm"], value)
                self.assertEqual(history_payload[field], value * 1000)
            self.assertEqual(history_payload["employeeId"], "EMP-2026-014")
            self.assertEqual(queue.pending_records(), [])

    def test_failed_ocr_capture_returns_error_without_a_value(self):
        arduino = Mock()
        pending = {
            "motorId": "motor-001",
            "captured": {},
        }
        message = {
            "event": "ocr_capture_started",
            "motorId": "motor-001",
            "index": 0,
        }

        with patch(
            "gateway.capture_last_stable_reading",
            side_effect=ValueError("No stable value"),
        ):
            result = _handle_capture_event(
                arduino,
                message,
                pending,
                Mock(),
                lambda frame: "",
            )

        self.assertIs(result, pending)
        arduino.write.assert_called_once_with(b"OCR_ERROR|0\n")
        self.assertEqual(pending["captured"], {})


if __name__ == "__main__":
    unittest.main()
