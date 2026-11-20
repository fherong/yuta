const DEMO_EMPLOYEE_IDS = {
  "demo-admin-01": "EMP-ADM-001",
  "demo-employee-01": "EMP-2026-001",
};

export function getEmployeeId(record) {
  const value = record.employee_id ?? record.employeeId ?? record.employeeID;
  if (value == null || String(value).trim() === "" || value === "N/A") return "";

  const employeeId = String(value).trim();
  return DEMO_EMPLOYEE_IDS[employeeId] || employeeId;
}
