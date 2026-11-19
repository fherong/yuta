import {
  ref,
  onValue,
  get,
  set,
  push,
  update,
  remove,
  off,
} from "firebase/database";

import { db } from "../firebase";

// =====================================================
// LIVE TELEMETRY
// =====================================================

export function subscribeToLiveTelemetry(callback) {
  const liveRef = ref(db, "live");

  const listener = onValue(liveRef, (snapshot) => {
    callback(
      snapshot.exists()
        ? snapshot.val()
        : null
    );
  });

  return () => off(liveRef, "value", listener);
}

// =====================================================
// HISTORICAL TELEMETRY
// =====================================================

export async function fetchTelemetryHistory() {
  try {
    const historyRef = ref(db, "history");

    const snapshot = await get(historyRef);

    if (!snapshot.exists()) {
      return [];
    }

    return Object.entries(snapshot.val())
      .map(([key, record]) => ({
        id: key,
        ...record,
      }))
      .sort((a, b) => {
        return (
          new Date(b.timestamp).getTime() -
          new Date(a.timestamp).getTime()
        );
      });

  } catch (error) {
    console.error(
      "Failed to retrieve telemetry history:",
      error
    );

    return [];
  }
}

// =====================================================
// MOTOR MANAGEMENT
// =====================================================

export function subscribeToMotors(callback) {
  const motorsRef = ref(db, "motors");

  const listener = onValue(motorsRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback([]);
      return;
    }

    const motors = Object.entries(snapshot.val())
      .map(([id, value]) => ({
        id,
        ...value,
        motorName: value.motor_name || value.name || "",
        ratedVoltage:
          Number(value.rated_voltage ?? value.voltage ?? 0),
      }));

    callback(motors);
  });

  return () => off(motorsRef, "value", listener);
}

export async function createMotorAsset({
  motorName,
  location,
  ratedVoltage,
}) {
  const motorsRef = ref(db, "motors");

  const newMotorRef = push(motorsRef);

  await set(newMotorRef, {
    motor_name: motorName,
    location,
    rated_voltage: Number(ratedVoltage),
    createdAt: new Date().toISOString(),
  });

  return newMotorRef.key;
}

export async function updateMotorAsset(
  motorId,
  data
) {
  await update(
    ref(db, `motors/${motorId}`),
    {
      motor_name: data.motorName,
      location: data.location,
      rated_voltage: Number(data.ratedVoltage),
    }
  );
}

export async function deleteMotorAsset(motorId) {
  await remove(
    ref(db, `motors/${motorId}`)
  );
}

// =====================================================
// SAVE TEST READING
// =====================================================

export async function logTestReading({
  motorId,
  motorName,
  motorVoltage,
  testVoltage,

  raw_ab,
  raw_bc,
  raw_ca,
  raw_ag,
  raw_bg,
  raw_cg,

  employeeId,
  operatorName,

  ncAuxSafe,
  zeroVoltageSafe,

  testMode = false,
}) {

  if (!ncAuxSafe || !zeroVoltageSafe) {
    throw new Error(
      "Safety verification failed. Record cannot be saved as a completed test."
    );
  }

  const readings = {
    raw_ab: Number(raw_ab),
    raw_bc: Number(raw_bc),
    raw_ca: Number(raw_ca),
    raw_ag: Number(raw_ag),
    raw_bg: Number(raw_bg),
    raw_cg: Number(raw_cg),
  };

  const values = Object.values(readings);

  if (
    values.some(
      (value) =>
        !Number.isFinite(value) ||
        value < 0
    )
  ) {
    throw new Error(
      "All six IR readings must be valid non-negative numbers."
    );
  }

  const voltage = Number(motorVoltage);
  const appliedVoltage = Number(testVoltage);

  if (
    !Number.isFinite(voltage) ||
    voltage <= 0 ||
    !Number.isFinite(appliedVoltage) ||
    appliedVoltage <= 0
  ) {
    throw new Error(
      "Motor voltage and test voltage must be greater than zero."
    );
  }

  const minimumIR = Math.min(...values);

  const averageIR =
    values.reduce((sum, value) => sum + value, 0) /
    values.length;

  const thresholdIR =
    voltage / 1000 + 1;

  const status =
    minimumIR >= thresholdIR
      ? "NORMAL"
      : "MAINTENANCE ALERT";

  const timestamp = new Date().toISOString();

  const record = {
    timestamp,

    motorId,
    motorName,
    motorVoltage: voltage,
    ratedVoltage: voltage,
    testVoltage: appliedVoltage,

    ...readings,

    irL1L2: readings.raw_ab,
    irL2L3: readings.raw_bc,
    irL3L1: readings.raw_ca,
    irL1G: readings.raw_ag,
    irL2G: readings.raw_bg,
    irL3G: readings.raw_cg,

    rawIR: minimumIR,
    minimumIR,
    averageIR: Number(averageIR.toFixed(3)),
    thresholdIR: Number(thresholdIR.toFixed(3)),

    employeeId: employeeId || "N/A",
    operatorName: operatorName || "Operator",

    ncAuxSafe: true,
    zeroVoltageSafe: true,
    safetyOK: true,

    testMode,
    dataSource: testMode
      ? "MANUAL_SIMULATION"
      : "DASHBOARD_MANUAL_ENTRY",

    status,
  };

  const historyRef = push(ref(db, "history"));

  await set(historyRef, record);

  await set(ref(db, "live"), record);

  return {
    id: historyRef.key,
    ...record,
  };
}

// =====================================================
// REGISTERED USERS
// =====================================================

export async function provisionUserWithId(
  employeeId,
  { fullname, role, pin }
) {
  const cleanId = String(employeeId).trim();

  if (!cleanId) {
    throw new Error("Employee ID is required.");
  }

  await set(
    ref(db, `users/${cleanId}`),
    {
      employeeId: cleanId,
      fullname,
      role,
      pin,
      createdAt: new Date().toISOString(),
    }
  );
}

export async function fetchRegisteredUsers() {
  const usersRef = ref(db, "users");

  const snapshot = await get(usersRef);

  if (!snapshot.exists()) {
    return [];
  }

  return Object.entries(snapshot.val()).map(
    ([id, value]) => ({
      id,
      ...value,
    })
  );
}
