import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

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
