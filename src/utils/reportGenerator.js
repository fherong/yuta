import { getEmployeeId } from "./employeeId.js";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

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

/**
 * Triggers a browser print preview formatted for maintenance reports.
 */
export function exportMaintenanceReportPDF(telemetryLogs, activeMotor, activeAlerts) {
  window.print();
}

export function exportArchiveReportPDF(archivedItems) {
  if (!archivedItems || archivedItems.length === 0) {
    alert("No archived employees or motors are available to export.");
    return;
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const generatedAt = new Date();
  const dateTag = generatedAt.toISOString().slice(0, 10);
  const rows = archivedItems.map((item) => [
    item.type === "employee" ? "Employee" : "Motor",
    item.type === "employee"
      ? item.fullname || "Unnamed employee"
      : item.motorName || item.motor_name || "Unnamed motor",
    item.employeeId || item.originalId || item.id || "",
    item.type === "employee" ? item.role || "" : item.ratedVoltage ? `${item.ratedVoltage} V` : "",
    item.location || "",
    item.archivedAt && !Number.isNaN(new Date(item.archivedAt).getTime())
      ? new Date(item.archivedAt).toLocaleString()
      : "",
    item.archivedById
      ? `${item.archivedBy || "Administrator"} (${item.archivedById})`
      : item.archivedBy || "",
  ]);

  doc.setProperties({
    title: "YUTA Archive Register",
    subject: "Archived employee and motor records",
    author: "YUTA System",
  });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Y.U.T.A. | ARCHIVE REGISTER", 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Generated ${generatedAt.toLocaleString()}  |  ${rows.length} archived records`, 14, 25);

  autoTable(doc, {
    startY: 31,
    head: [["Type", "Name", "Employee / Asset ID", "Role / Voltage", "Location", "Archived At", "Archived By"]],
    body: rows,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
    headStyles: { fillColor: [60, 42, 91], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 245, 238] },
    margin: { left: 14, right: 14, bottom: 14 },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, doc.internal.pageSize.getWidth() - 24, doc.internal.pageSize.getHeight() - 7);
    },
  });

  doc.save(`YUTA_Archive_Register_${dateTag}.pdf`);
}