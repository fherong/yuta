import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, call

import requests

from gatewayy import (
    FIREBASE_DATABASE_URL,
    TelemetryQueue,
    authenticate_employee,
    build_log_record,
    eligible_employees,
    employee_id_suffix,
    flush_pending_records,
    send_ack,
    send_employee_list,
)


class EmployeeProtocolTests(unittest.TestCase):
    def test_lists_only_pinned_employee_accounts_in_name_order(self):
        users = {
            "EMP-2026-081": {
                "fullname": "Zoe Tech",
                "role": "Employee",
                "pin": "48213679",
            },
            "EMP-2026-012": {
                "fullname": "Max Tech",
                "role": "Employee",
                "pin": "123456789012",
            },
            "EMP-2026-014": {
                "fullname": "Ari Tech",
                "role": "Employee",
                "pin": "12345678",
            },
            "ADM-2026-003": {
                "fullname": "Site Admin",
                "role": "Admin",
                "pin": "5678",
            },
            "EMP-2026-099": {
                "fullname": "No PIN",
                "role": "Employee",
            },
            "EMP-2026-100": {
                "fullname": "Text PIN",
                "role": "Employee",
                "pin": "abc",
            },
            "EMP-2026-101": {
                "fullname": "Short PIN",
                "role": "Employee",
                "pin": "1234567",
            },
            "EMP-2026-102": {
                "fullname": "Long PIN",
                "role": "Employee",
                "pin": "1234567890123",
            },
        }

        self.assertEqual(
            [employee["employeeId"] for employee in eligible_employees(users)],
            ["EMP-2026-014", "EMP-2026-012", "EMP-2026-081"],
        )
        self.assertEqual(employee_id_suffix("EMP-2026-081"), "081")

    def test_serial_employee_list_displays_suffix_but_never_pin(self):
        response = Mock()
        response.json.return_value = {
            "EMP-2026-081": {
                "fullname": "Ari Tech",
                "role": "Employee",
                "pin": "48213679",
            }
        }
        session = Mock()
        session.get.return_value = response
        arduino = Mock()

        send_employee_list(arduino, session)

        output = b"".join(call.args[0] for call in arduino.write.call_args_list)
        self.assertIn(b"EMPLOYEE|EMP-2026-081|Ari Tech|081\n", output)
        self.assertIn(b"END\n", output)
        self.assertNotIn(b"48213679", output)

    def test_authenticates_current_employee_pin_and_rejects_other_roles(self):
        response = Mock()
        response.json.return_value = {"role": "Employee", "pin": "12345678"}
        session = Mock()
        session.get.return_value = response

        self.assertTrue(authenticate_employee("EMP-2026-014", "12345678", session))
        self.assertFalse(authenticate_employee("EMP-2026-014", "00000000", session))

        response.json.return_value = {"role": "Admin", "pin": "12345678"}
        self.assertFalse(authenticate_employee("ADM-2026-003", "12345678", session))

    def test_rejects_non_numeric_pin_without_database_request(self):
        session = Mock()

        self.assertFalse(authenticate_employee("EMP-2026-014", "AB12", session))
        session.get.assert_not_called()

    def test_rejects_pin_lengths_outside_eight_to_twelve_digits(self):
        session = Mock()

        self.assertFalse(authenticate_employee("EMP-2026-014", "1234567", session))
        self.assertFalse(authenticate_employee("EMP-2026-014", "1234567890123", session))
        session.get.assert_not_called()

    def test_authenticates_twelve_digit_pin(self):
        response = Mock()
        response.json.return_value = {"role": "Employee", "pin": "123456789012"}
        session = Mock()
        session.get.return_value = response

        self.assertTrue(authenticate_employee("EMP-2026-012", "123456789012", session))

    def test_test_record_keeps_authenticated_operator_identity(self):
        data = {
            "motorId": "motor-001",
            "motorName": "Pump 1",
            "motorVoltage": 480,
            "testVoltage": 1000,
            "ncAuxSafe": False,
            "zeroVoltageSafe": True,
            "raw_ab": "2.400",
            "raw_bc": 2.5,
            "raw_ca": 2.6,
            "raw_ag": 2.7,
            "raw_bg": 2.8,
            "raw_cg": 2.9,
            "employeeId": "EMP-2026-014",
            "operatorName": "Ari Tech",
            "timestamp": "2026-11-20T10:00:00Z",
        }
        record = build_log_record(data)

        self.assertEqual(record, data)
        self.assertIsNot(record, data)
        self.assertEqual(record["raw_ab"], "2.400")
        self.assertEqual(record["employeeId"], "EMP-2026-014")
        self.assertEqual(record["operatorName"], "Ari Tech")
        self.assertNotIn("minimumIR", record)
        self.assertNotIn("averageIR", record)
        self.assertNotIn("thresholdIR", record)
        self.assertNotIn("status", record)

    def test_adds_timestamp_without_changing_received_values(self):
        data = {"motorId": "motor-001", "raw_ab": "2.400"}

        record = build_log_record(data)

        self.assertEqual(record["motorId"], "motor-001")
        self.assertEqual(record["raw_ab"], "2.400")
        self.assertEqual(set(record) - set(data), {"timestamp"})
        self.assertTrue(record["timestamp"].endswith("Z"))

    def test_queue_survives_reopen_and_retries_without_duplicate_history(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "telemetry.sqlite3"
            queue = TelemetryQueue(path)
            record = build_log_record({"motorId": "motor-001", "raw_ab": 2.4})
            record_id = queue.enqueue(record)
            reopened_queue = TelemetryQueue(path)
            self.assertEqual(
                reopened_queue.pending_records(),
                [(record_id, record)],
            )

            offline_response = Mock()
            offline_response.raise_for_status.side_effect = requests.ConnectionError("offline")
            session = Mock()
            session.put.return_value = offline_response

            with self.assertRaises(requests.ConnectionError):
                flush_pending_records(reopened_queue, session)

            self.assertEqual(
                reopened_queue.pending_records(),
                [(record_id, record)],
            )

            session.put.return_value = Mock()
            self.assertEqual(flush_pending_records(reopened_queue, session), 1)
            self.assertEqual(reopened_queue.pending_records(), [])
            self.assertEqual(
                session.put.call_args_list[-2:],
                [
                    call(
                        f"{FIREBASE_DATABASE_URL}/live.json",
                        params=None,
                        json=record,
                        timeout=10,
                    ),
                    call(
                        f"{FIREBASE_DATABASE_URL}/history/{record_id}.json",
                        params=None,
                        json=record,
                        timeout=10,
                    ),
                ],
            )

    def test_acknowledges_local_queue_separately_from_cloud_sync(self):
        arduino = Mock()

        send_ack(arduino, "QUEUED")

        arduino.write.assert_called_once_with(b"ACK|QUEUED\n")
        arduino.flush.assert_called_once_with()

    def test_acknowledges_synced_records_as_saved(self):
        arduino = Mock()

        send_ack(arduino, "SAVED")

        arduino.write.assert_called_once_with(b"ACK|SAVED\n")
        arduino.flush.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
