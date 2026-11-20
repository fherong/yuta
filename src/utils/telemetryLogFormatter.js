import { getEmployeeId } from "./employeeId.js";

const MINIMUM_NORMAL_IR_MOHMS = 5;

function getArduinoManualStatus(item) {
  if (item.ncAuxSafe === false || item.zeroVoltageSafe === false) {
    return "SAFETY INTERLOCK FAILED";
  }
  if (item.ncAuxSafe !== true || item.zeroVoltageSafe !== true) {
    return "NOT PROVIDED";
  }

  const readingFields = ["raw_ab", "raw_bc", "raw_ca", "raw_ag", "raw_bg", "raw_cg"];
  const readings = readingFields.map((field) => item[field]);
  if (readings.some((reading) => reading === undefined || reading === null || reading === "")) {
    return "NOT PROVIDED";
  }

  const numericReadings = readings.map(Number);
  if (numericReadings.some((reading) => !Number.isFinite(reading) || reading < 0)) {
    return "NOT PROVIDED";
  }

  return numericReadings.some((reading) => reading < MINIMUM_NORMAL_IR_MOHMS)
    ? "MAINTENANCE ALERT"
    : "NORMAL";
}

export function formatTelemetryLog(item) {
  const testDate = item.timestamp
    ? new Date(item.timestamp).toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "LIVE";
  const isArduinoManualRecord = (
    item.ncAuxSafe !== undefined
    && item.zeroVoltageSafe !== undefined
    && item.employeeId !== undefined
    && item.operatorName !== undefined
  );
  const rawReading = (field, fallback) => {
    if (item[field] !== undefined && item[field] !== null) return item[field];
    if (item.rawIR !== undefined && item.rawIR !== null) return item.rawIR;
    return isArduinoManualRecord ? "" : fallback;
  };
  const rawAB = rawReading("raw_ab", 2.40);
  const rawBC = rawReading("raw_bc", 2.42);
  const rawCA = rawReading("raw_ca", 2.38);
  const rawAG = rawReading("raw_ag", 2.25);
  const rawBG = rawReading("raw_bg", 2.28);
  const rawCG = rawReading("raw_cg", 2.20);

  const temp = item.temperatureC == null
    ? (isArduinoManualRecord ? "" : 38.5)
    : Number(item.temperatureC);
  const correctionFactor = isArduinoManualRecord || temp === ""
    ? 1
    : temp >= 40.0
      ? Math.pow(0.5, (temp - 40.0) / 10.0)
      : Math.pow(2.0, (40.0 - temp) / 10.0);
  const displayReading = (value) => (
    isArduinoManualRecord || value === ""
      ? value
      : Number((Number(value) * correctionFactor).toFixed(2))
  );

  return {
    id: item.id || item.timestamp,
    motor_id: item.motorId || "motor-mock",
    ab_corrected: displayReading(rawAB),
    bc_corrected: displayReading(rawBC),
    ca_corrected: displayReading(rawCA),
    ag_corrected: displayReading(rawAG),
    bg_corrected: displayReading(rawBG),
    cg_corrected: displayReading(rawCG),
    raw_ir: isArduinoManualRecord
      ? (item.rawIR ?? "")
      : Number((Number(rawCG) * correctionFactor).toFixed(2)),
    temperature: isArduinoManualRecord ? (item.temperatureC ?? "") : temp,
    test_voltage: isArduinoManualRecord
      ? (item.testVoltage ?? item.test_voltage ?? item.ratedVoltage ?? "")
      : Number(item.testVoltage || item.test_voltage || item.ratedVoltage || 1000),
    minutes: isArduinoManualRecord ? (item.minutes ?? "") : Number(item.minutes || 1.0),
    ir_min: isArduinoManualRecord ? (item.thresholdIR ?? "") : Number(item.thresholdIR || 1.38),
    motor_status: item.status ?? (
      isArduinoManualRecord ? getArduinoManualStatus(item) : "NORMAL"
    ),
    operator_name: item.operatorName ?? (isArduinoManualRecord ? "" : "Python Gateway OCR"),
    employee_id: getEmployeeId(item),
    testDate,
    formattedDate: item.timestamp
      ? new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "LIVE",
  };
}
