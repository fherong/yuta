import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from gateway import (
    FIREBASE_DATABASE_URL,
    build_log_record,
    run_gateway,
    sync_to_firebase,
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
