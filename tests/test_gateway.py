import json
import tempfile
import unittest
from concurrent.futures import Future
from types import SimpleNamespace
from unittest.mock import Mock, patch

from gateway import (
    OCR_FIELDS,
    _save_record,
    _handle_capture_event,
    build_ocr_test_record,
    capture_last_stable_reading,
    open_usb_camera,
    parse_ut501a_reading,
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

    def test_parses_a_single_ut501a_reading(self):
        self.assertEqual(parse_ut501a_reading(" 1,25 "), 1.25)
        with self.assertRaisesRegex(ValueError, "exactly one"):
            parse_ut501a_reading("OL")
        with self.assertRaisesRegex(ValueError, "exactly one"):
            parse_ut501a_reading("1.2 500")

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
        readings = iter(["1.0"] * 4 + ["2.0"] * 4)
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
        readings = iter(["1.0", "1.1"] * 4)
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
