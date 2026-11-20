import assert from "node:assert/strict";
import test from "node:test";

import { formatTelemetryLog } from "../src/utils/telemetryLogFormatter.js";

test("keeps Arduino readings unchanged while deriving display status", () => {
  const record = formatTelemetryLog({
    id: "history-1",
    timestamp: "2026-11-20T10:00:00Z",
    motorId: "motor-001",
    motorVoltage: 480,
    employeeId: "EMP-2026-014",
    operatorName: "Ari Tech",
    ncAuxSafe: true,
    zeroVoltageSafe: true,
    testVoltage: 1000,
    raw_ab: 0,
    raw_bc: 2.34567,
    raw_ca: 2.6,
    raw_ag: 2.7,
    raw_bg: 2.8,
    raw_cg: 2.9,
  });

  assert.equal(record.ab_corrected, 0);
  assert.equal(record.bc_corrected, 2.34567);
  assert.equal(record.ca_corrected, 2.6);
  assert.equal(record.ag_corrected, 2.7);
  assert.equal(record.bg_corrected, 2.8);
  assert.equal(record.cg_corrected, 2.9);
  assert.equal(record.test_voltage, 1000);
  assert.equal(record.motor_status, "MAINTENANCE ALERT");
  assert.equal(record.temperature, "");
});

test("does not fill missing Arduino readings with sample values", () => {
  const record = formatTelemetryLog({
    motorId: "motor-001",
    employeeId: "EMP-2026-014",
    operatorName: "Ari Tech",
    ncAuxSafe: true,
    zeroVoltageSafe: true,
  });

  assert.equal(record.ab_corrected, "");
  assert.equal(record.cg_corrected, "");
  assert.equal(record.test_voltage, "");
  assert.equal(record.motor_status, "NOT PROVIDED");
});

test("shows normal status when every raw reading is at least 5 MOhm", () => {
  const record = formatTelemetryLog({
    motorId: "motor-001",
    motorVoltage: 480,
    employeeId: "EMP-2026-014",
    operatorName: "Ari Tech",
    ncAuxSafe: true,
    zeroVoltageSafe: true,
    raw_ab: 5,
    raw_bc: 5.1,
    raw_ca: 5.2,
    raw_ag: 5.3,
    raw_bg: 5.4,
    raw_cg: 5.5,
  });

  assert.equal(record.motor_status, "NORMAL");
  assert.equal(record.ab_corrected, 5);
});

test("shows maintenance when any raw reading is below 5 MOhm", () => {
  const record = formatTelemetryLog({
    motorId: "motor-001",
    employeeId: "EMP-2026-014",
    operatorName: "Ari Tech",
    ncAuxSafe: true,
    zeroVoltageSafe: true,
    raw_ab: 6,
    raw_bc: 6,
    raw_ca: 4.99,
    raw_ag: 6,
    raw_bg: 6,
    raw_cg: 6,
  });

  assert.equal(record.motor_status, "MAINTENANCE ALERT");
  assert.equal(record.ca_corrected, 4.99);
});

test("displays OCR readings in GOhm while deriving status from MOhm values", () => {
  const record = formatTelemetryLog({
    source: "ocr",
    measurementUnit: "GΩ",
    employeeId: "EMP-2026-014",
    operatorName: "Ari Tech",
    ncAuxSafe: true,
    zeroVoltageSafe: true,
    raw_ab: 1250,
    raw_bc: 1500,
    raw_ca: 4.9,
    raw_ag: 2000,
    raw_bg: 2250,
    raw_cg: 2500,
    raw_ab_GOhm: 1.25,
    raw_bc_GOhm: 1.5,
    raw_ca_GOhm: 0.0049,
    raw_ag_GOhm: 2,
    raw_bg_GOhm: 2.25,
    raw_cg_GOhm: 2.5,
  });

  assert.equal(record.ab_corrected, 1.25);
  assert.equal(record.ca_corrected, 0.0049);
  assert.equal(record.reading_unit, "GΩ");
  assert.equal(record.motor_status, "MAINTENANCE ALERT");
});

test("reports a failed safety interlock without requiring measurements", () => {
  const record = formatTelemetryLog({
    motorId: "motor-001",
    employeeId: "EMP-2026-014",
    operatorName: "Ari Tech",
    ncAuxSafe: false,
    zeroVoltageSafe: true,
  });

  assert.equal(record.motor_status, "SAFETY INTERLOCK FAILED");
  assert.equal(record.ab_corrected, "");
});

test("keeps temperature correction for non-Arduino history records", () => {
  const record = formatTelemetryLog({
    raw_ab: 2,
    temperatureC: 50,
  });

  assert.equal(record.ab_corrected, 1);
});
