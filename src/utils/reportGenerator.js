import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Export Tabular Telemetry Data to CSV[cite: 1]
export const exportTelemetryToCSV = (logs, motorInfo) => {
  const headers = ['Test ID,Timestamp,Raw IR (MOhm),Temp (C),Corrected IR 40C (MOhm),Threshold IRmin (MOhm),Status,Operator\n'];
  const rows = logs.map(log => [
    log.id,
    `"${log.formattedDate || new Date().toLocaleString()}"`,
    log.raw_ir,
    log.temperature,
    log.corrected_ir,
    log.ir_min || 1.48,
    `"${log.motor_status}"`,
    `"${log.user_name || 'Automated AMU'}"`
  ].join(','));

  const csvContent = 'data:text/csv;charset=utf-8,' + headers.concat(rows).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `YUTA_${motorInfo?.motor_name?.replace(/\s+/g, '_') || 'Motor'}_Telemetry_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Export Formal Technical Maintenance Report as PDF[cite: 1]
export const exportMaintenanceReportPDF = (logs, motorInfo, activeAlerts) => {
  const doc = new jsPDF();

  // Header Title
  doc.setFillColor(28, 25, 23); // Slate/Carbon
  doc.rect(0, 0, 210, 38, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('Y.U.T.A. Condition Monitoring System', 14, 18);
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(214, 203, 190);
  doc.text('IEEE Std 43-2013 Automated Insulation Resistance Compliance Report', 14, 25);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 31);

  // Asset Specifications
  doc.setTextColor(28, 25, 23);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Target Asset Parameters', 14, 48);

  const assetDetails = [
    ['Monitored Motor:', motorInfo?.motor_name || 'Water Pump Induction Motor', 'Location:', motorInfo?.location || 'Pump Station'],
    ['Operating Voltage:', `${motorInfo?.rated_voltage || 480} VAC (Sinusoidal Full-Wave)`, 'Insulation Class:', 'Class F (Reference: 40°C)'],
    ['IEEE IRmin Baseline:', `${((motorInfo?.rated_voltage || 480) / 1000 + 1).toFixed(3)} MΩ`, 'Active Interlocks:', 'Dual-Factor Verified Safe']
  ];

  autoTable(doc, {
    startY: 52,
    body: assetDetails,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [87, 83, 78], cellWidth: 35 },
      1: { cellWidth: 60 },
      2: { fontStyle: 'bold', textColor: [87, 83, 78], cellWidth: 35 },
      3: { cellWidth: 60 }
    }
  });

  // Telemetry Audit Table
  const tableRows = logs.map(l => [
    l.formattedDate || new Date().toLocaleTimeString(),
    `${l.raw_ir} MΩ`,
    `${l.temperature} °C`,
    `${l.corrected_ir} MΩ`,
    `${l.ir_min || 1.48} MΩ`,
    l.motor_status,
    l.user_name || 'System Edge'
  ]);

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [['Timestamp', 'Raw IR', 'Temp', 'Corrected IR (40°C)', 'Threshold (IRmin)', 'Motor Status', 'Operator']],
    body: tableRows,
    theme: 'striped',
    headStyles: { fillColor: [109, 40, 217], fontSize: 8.5, halign: 'center' },
    bodyStyles: { fontSize: 8, halign: 'center' },
    didParseCell: (data) => {
      if (data.column.index === 5 && data.cell.raw === 'Requires Maintenance') {
        data.cell.styles.textColor = [190, 18, 60];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  // Footer Signature Block
  const finalY = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(8.5);
  doc.setTextColor(120, 113, 108);
  doc.text('Certified By: ____________________________________', 14, finalY > 260 ? 275 : finalY);
  doc.text('Field Engineer / Quality Assurance Sign-off', 14, (finalY > 260 ? 275 : finalY) + 6);

  doc.save(`YUTA_Report_${Date.now()}.pdf`);
};