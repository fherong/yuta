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
    "A-B IR (MΩ)",
    "B-C IR (MΩ)",
    "C-A IR (MΩ)",
    "A-G IR (MΩ)",
    "B-G IR (MΩ)",
    "C-G IR (MΩ)",
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
    log.ab_corrected ?? log.raw_ab ?? log.rawIR ?? "",
    log.bc_corrected ?? log.raw_bc ?? log.rawIR ?? "",
    log.ca_corrected ?? log.raw_ca ?? log.rawIR ?? "",
    log.ag_corrected ?? log.raw_ag ?? log.rawIR ?? "",
    log.bg_corrected ?? log.raw_bg ?? log.rawIR ?? "",
    log.cg_corrected ?? log.raw_cg ?? log.rawIR ?? "",
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

/**
 * Triggers a browser print preview formatted for maintenance reports.
 */
export function exportMaintenanceReportPDF(telemetryLogs, activeMotor, activeAlerts) {
  window.print();
}