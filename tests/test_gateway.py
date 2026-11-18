import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from gateway import (
    DurableOutbox,
    FIREBASE_DATABASE_URL,
    build_ocr_record,
    build_log_record,
    capture_last_stable_reading,
    parse_ut501a_reading,
    run_gateway,
    sync_to_firebase,
    sync_outbox_once,
)


class BuildLogRecordTests(unittest.TestCase):
    def setUp(self):
        self.message = {
            "motorId": "motor-001",
            "rawIR": 2.4,
            "temperatureC": 40,
            "testVoltage": 1000,
            "motorVoltage": 480,
            "ncAuxSafe": True,
            "zeroVoltageSafe": True,
        }

    def test_builds_website_log_record(self):
        record = build_log_record(self.message, timestamp="2026-01-01T00:00:00Z")

        self.assertEqual(record["motorId"], "motor-001")
        self.assertEqual(record["correctedIR"], 2.4)
        self.assertEqual(record["thresholdIR"], 1.48)
        self.assertTrue(record["safetyOK"])
        self.assertEqual(record["status"], "NORMAL")
        self.assertEqual(record["timestamp"], "2026-01-01T00:00:00Z")

    def test_keeps_unsafe_interlock_in_log(self):
        self.message["ncAuxSafe"] = False

        record = build_log_record(self.message)

        self.assertFalse(record["safetyOK"])
        self.assertEqual(record["status"], "SAFETY INTERLOCK FAILED")

    def test_rejects_missing_required_values(self):
        del self.message["motorId"]

        with self.assertRaisesRegex(ValueError, "motorId"):
            build_log_record(self.message)

    def test_rejects_non_boolean_safety_value(self):
        self.message["zeroVoltageSafe"] = "yes"

        with self.assertRaisesRegex(ValueError, "JSON boolean"):
            build_log_record(self.message)

    def test_rejects_non_finite_measurement(self):
        self.message["rawIR"] = float("nan")

        with self.assertRaisesRegex(ValueError, "finite number"):
            build_log_record(self.message)

    def test_rejects_non_finite_calculation(self):
        self.message["rawIR"] = 1.7e308
        self.message["temperatureC"] = 0

        with self.assertRaisesRegex(ValueError, "calculated IR"):
            build_log_record(self.message)

    def test_syncs_live_and_history_records(self):
        session = Mock()
        record = build_log_record(self.message)

        sync_to_firebase(record, session, "test-token")

        session.put.assert_called_once_with(
            f"{FIREBASE_DATABASE_URL}/live.json",
            params={"auth": "test-token"},
            json=record,
            timeout=10,
        )
        session.post.assert_called_once_with(
            f"{FIREBASE_DATABASE_URL}/history.json",
            params={"auth": "test-token"},
            json=record,
            timeout=10,
        )

    def test_outbox_persists_until_idempotent_firebase_sync_succeeds(self):
        class RequestException(Exception):
            pass

        with tempfile.TemporaryDirectory() as directory:
            path = f"{directory}/outbox.sqlite3"
            outbox = DurableOutbox(path)
            record = build_log_record(self.message)
            record_id = outbox.enqueue(record)
            reopened = DurableOutbox(path)
            session = Mock()
            session.put.side_effect = [
                Mock(),
                RequestException("offline"),
                Mock(),
                Mock(),
            ]

            self.assertFalse(
                sync_outbox_once(reopened, session, None, RequestException)
            )
            self.assertEqual(reopened.oldest(), (record_id, record))

            self.assertTrue(
                sync_outbox_once(reopened, session, None, RequestException)
            )
            self.assertIsNone(reopened.oldest())
            session.put.assert_any_call(
                f"{FIREBASE_DATABASE_URL}/live.json",
                params=None,
                json=record,
                timeout=10,
            )
            session.put.assert_any_call(
                f"{FIREBASE_DATABASE_URL}/history/{record_id}.json",
                params=None,
                json=record,
                timeout=10,
            )

    def test_parses_ut501a_reading_as_gigaohms(self):
        self.assertEqual(parse_ut501a_reading(" 1.25 "), 1.25)
        with self.assertRaisesRegex(ValueError, "exactly one"):
            parse_ut501a_reading("OL")
        with self.assertRaisesRegex(ValueError, "exactly one"):
            parse_ut501a_reading("1.2 500")

    def test_ocr_record_preserves_gigaohms_and_supplies_website_megohms(self):
        record = build_ocr_record(1.25, "motor-001", "2026-01-01T00:00:00Z")

        self.assertEqual(record["rawIR_GOhm"], 1.25)
        self.assertEqual(record["rawIR"], 1250)
        self.assertEqual(record["source"], "ocr")
        self.assertNotIn("temperatureC", record)
        self.assertNotIn("safetyOK", record)

    def test_capture_uses_the_last_stable_value_in_the_test_window(self):
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
        readings = ["1.0"] * 4 + ["2.0"] * 4
        value = capture_last_stable_reading(
            Camera(),
            lambda frame: readings[frame - 1],
            duration=2,
            sample_interval=0.25,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
        )

        self.assertEqual(value, 2.0)

    def test_retries_serial_connection_until_arduino_is_ready(self):
        class SerialException(Exception):
            pass

        arduino = Mock()
        arduino.__enter__ = Mock(return_value=arduino)
        arduino.__exit__ = Mock(return_value=False)
        arduino.readline.side_effect = KeyboardInterrupt
        serial_module = SimpleNamespace(SerialException=SerialException)
        serial_module.Serial = Mock(side_effect=[SerialException("not ready"), arduino])

        with patch("gateway.time.sleep") as sleep:
            run_gateway(serial_module, Exception, Mock(), None)

        self.assertEqual(serial_module.Serial.call_count, 2)
        sleep.assert_any_call(5)
        sleep.assert_any_call(2)


if __name__ == "__main__":
    unittest.main()
