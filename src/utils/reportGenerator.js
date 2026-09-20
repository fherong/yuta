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
    "Timestamp",
    "Motor Name",
    "Location",
    "Operating Voltage (V)",
    "Direct IR (M-Ohm)",
    "Temperature (C)",
    "Normalized IR 40C (M-Ohm)",
    "Baseline Limit (M-Ohm)",
    "Status",
    "Operator"
  ];

  const rows = telemetryLogs.map((log) => [
    `"${log.formattedDate || ""}"`,
    `"${activeMotor?.motor_name || "Motor"}"`,
    `"${activeMotor?.location || "Plant"}"`,
    log.rated_voltage || activeMotor?.rated_voltage || 480,
    log.raw_ir,
    log.temperature,
    log.corrected_ir,
    log.ir_min,
    `"${log.motor_status}"`,
    `"${log.user_name || "Python Gateway"}"`
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(","))
  ].join("\n");

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