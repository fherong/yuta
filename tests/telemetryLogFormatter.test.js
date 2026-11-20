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

test("shows normal status when the minimum raw reading meets the previous threshold", () => {
  const record = formatTelemetryLog({
    motorId: "motor-001",
    motorVoltage: 480,
    employeeId: "EMP-2026-014",
    operatorName: "Ari Tech",
    ncAuxSafe: true,
    zeroVoltageSafe: true,
    raw_ab: 2.4,
    raw_bc: 2.5,
    raw_ca: 2.6,
    raw_ag: 2.7,
    raw_bg: 2.8,
    raw_cg: 2.9,
  });

  assert.equal(record.motor_status, "NORMAL");
  assert.equal(record.ab_corrected, 2.4);
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
