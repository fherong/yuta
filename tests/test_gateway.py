import json
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
    load_motor_list,
    parse_ut501a_reading,
    run_gateway,
    run_ocr_gateway,
    send_motor_list,
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
        self.assertFalse(record["measurementAvailable"])
        self.assertEqual(record["status"], "SAFETY INTERLOCK FAILED")
        self.assertNotIn("rawIR", record)

    def test_accepts_the_arduino_six_line_payload_without_temperature(self):
        message = {
            "motorId": "motor-001",
            "motorName": "WATER PUMP 01",
            "motorVoltage": 480,
            "testVoltage": 1000,
            "ncAuxSafe": True,
            "zeroVoltageSafe": True,
            "raw_ab": 2.4,
            "raw_bc": 2.42,
            "raw_ca": 2.38,
            "raw_ag": 2.25,
            "raw_bg": 2.28,
            "raw_cg": 2.2,
        }

        record = build_log_record(message)

        self.assertEqual(record["rawIR"], 2.2)
        self.assertEqual(record["correctedIR"], 2.2)
        self.assertNotIn("temperatureC", record)
        self.assertTrue(record["measurementAvailable"])

    def test_caches_motor_list_for_offline_arduino_requests(self):
        class RequestException(Exception):
            pass

        with tempfile.TemporaryDirectory() as directory:
            outbox = DurableOutbox(f"{directory}/outbox.sqlite3")
            online_session = Mock()
            online_response = Mock()
            online_response.json.return_value = {
                "motor-001": {
                    "motor_name": "WATER PUMP 01",
                    "rated_voltage": 480,
                }
            }
            online_session.get.return_value = online_response

            motors = load_motor_list(online_session, None, outbox, RequestException)

            self.assertEqual(motors, [{
                "id": "motor-001",
                "name": "WATER PUMP 01",
                "ratedVoltage": 480.0,
            }])

            offline_session = Mock()
            offline_session.get.side_effect = RequestException("offline")
            arduino = Mock()
            send_motor_list(arduino, offline_session, None, outbox, RequestException)

            self.assertEqual(
                [call.args[0] for call in arduino.write.call_args_list],
                [
                    b"MOTOR|motor-001|WATER PUMP 01|480.00\n",
                    b"END\n",
                ],
            )

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

    def test_gateway_serves_motor_list_and_acknowledges_saved_arduino_record(self):
        arduino_message = {
            "motorId": "motor-001",
            "motorName": "WATER PUMP 01",
            "motorVoltage": 480,
            "testVoltage": 1000,
            "ncAuxSafe": True,
            "zeroVoltageSafe": True,
            "raw_ab": 2.4,
            "raw_bc": 2.42,
            "raw_ca": 2.38,
            "raw_ag": 2.25,
            "raw_bg": 2.28,
            "raw_cg": 2.2,
        }

        arduino = Mock()
        arduino.__enter__ = Mock(return_value=arduino)
        arduino.__exit__ = Mock(return_value=False)
        arduino.readline.side_effect = [
            b"LIST?\n",
            (json.dumps(arduino_message) + "\n").encode(),
            KeyboardInterrupt,
        ]
        serial_module = SimpleNamespace(SerialException=Exception)
        serial_module.Serial = Mock(return_value=arduino)
        session = Mock()
        motor_response = Mock()
        motor_response.json.return_value = {
            "motor-001": {
                "motor_name": "WATER PUMP 01",
                "rated_voltage": 480,
            }
        }
        session.get.return_value = motor_response

        with patch("gateway.time.sleep"):
            run_gateway(serial_module, Exception, session, None)

        self.assertEqual(
            [call.args[0] for call in arduino.write.call_args_list],
            [
                b"MOTOR|motor-001|WATER PUMP 01|480.00\n",
                b"END\n",
                b"ACK|SAVED\n",
            ],
        )

    def test_ocr_gateway_saves_only_the_captured_value_after_safe_result(self):
        class RequestException(Exception):
            pass

        with tempfile.TemporaryDirectory() as directory:
            outbox = DurableOutbox(f"{directory}/outbox.sqlite3")
            arduino = Mock()
            arduino.__enter__ = Mock(return_value=arduino)
            arduino.__exit__ = Mock(return_value=False)
            arduino.readline.side_effect = [
                b'{"event":"test_started","motorId":"motor-001"}\n',
                (
                    json.dumps({
                        "motorId": "motor-001",
                        "motorVoltage": 480,
                        "testVoltage": 1000,
                        "ncAuxSafe": True,
                        "zeroVoltageSafe": True,
                        "raw_ab": 2.4,
                        "raw_bc": 2.42,
                        "raw_ca": 2.38,
                        "raw_ag": 2.25,
                        "raw_bg": 2.28,
                        "raw_cg": 2.2,
                    }) + "\n"
                ).encode(),
                KeyboardInterrupt,
            ]
            serial_module = SimpleNamespace(SerialException=Exception)
            serial_module.Serial = Mock(return_value=arduino)
            session = Mock()
            session.put.side_effect = RequestException("offline")

            with patch("gateway.time.sleep"), patch(
                "gateway.capture_last_stable_reading", return_value=1.25
            ):
                run_ocr_gateway(
                    serial_module,
                    RequestException,
                    session,
                    None,
                    outbox,
                    Mock(),
                    lambda frame: "",
                )

            queued = outbox.oldest()
            self.assertIsNotNone(queued)
            self.assertEqual(queued[1]["source"], "ocr")
            self.assertEqual(queued[1]["rawIR_GOhm"], 1.25)
            self.assertNotIn("raw_ab", queued[1])
            self.assertEqual(arduino.write.call_args.args[0], b"ACK|SAVED\n")

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
