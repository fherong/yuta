import { getEmployeeId } from "./employeeId.js";

/**
 * Converts telemetry logs to CSV and triggers a browser download.
 * @param {Array} telemetryLogs - Array of historical/live telemetry log objects.
 * @param {Object} activeMotor - The currently selected motor asset.
 */
export function exportTelemetryToCSV(telemetryLogs, activeMotor) {
  if (!telemetryLogs || telemetryLogs.length === 0) {
    alert("No telemetry records available to export.");
    return;
  }

  const headers = [
    "Test Date & Time",
    "Employee ID",
    "Motor Name",
    "Location",
    "Test Voltage (V)",
    "Duration (min)",
    "A-B IR",
    "B-C IR",
    "C-A IR",
    "A-G IR",
    "B-G IR",
    "C-G IR",
    "Status",
  ];

  const escapeCsvCell = (value) => {
    const text = value == null ? "" : String(value);
    const safeText = typeof value === "string" && /^[\s]*[=+\-@]/.test(text)
      ? `'${text}`
      : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  const getTestDate = (log) => {
    if (log.testDate) return log.testDate;
    if (!log.timestamp) return log.formattedDate || "";
    const timestamp = new Date(log.timestamp);
    return Number.isNaN(timestamp.getTime())
      ? String(log.timestamp)
      : timestamp.toLocaleString([], {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
  };
  const rows = telemetryLogs.map((log) => [
    getTestDate(log),
    getEmployeeId(log),
    activeMotor?.motor_name || "Motor",
    activeMotor?.location || "Plant",
    log.test_voltage ?? log.testVoltage ?? "",
    log.minutes ?? "",
    log.ab_corrected == null || log.ab_corrected === "" ? "" : `${log.ab_corrected} ${log.reading_unit || "MΩ"}`,
    log.bc_corrected == null || log.bc_corrected === "" ? "" : `${log.bc_corrected} ${log.reading_unit || "MΩ"}`,
    log.ca_corrected == null || log.ca_corrected === "" ? "" : `${log.ca_corrected} ${log.reading_unit || "MΩ"}`,
    log.ag_corrected == null || log.ag_corrected === "" ? "" : `${log.ag_corrected} ${log.reading_unit || "MΩ"}`,
    log.bg_corrected == null || log.bg_corrected === "" ? "" : `${log.bg_corrected} ${log.reading_unit || "MΩ"}`,
    log.cg_corrected == null || log.cg_corrected === "" ? "" : `${log.cg_corrected} ${log.reading_unit || "MΩ"}`,
    log.motor_status ?? log.status ?? "",
  ]);

  const csvContent = "\uFEFF" + [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  const dateStr = new Date().toISOString().slice(0, 10);
  const motorTag = (activeMotor?.motor_name || "MOTOR").replace(/\s+/g, "_");

  link.setAttribute("href", url);
  link.setAttribute("download", `YUTA_${motorTag}_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
