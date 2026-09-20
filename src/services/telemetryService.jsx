import { ref, onValue, get, set, push, update, remove, off } from "firebase/database";
import { db } from "../firebase";

// --- GATEWAY & LOGS ---
export function subscribeToLiveTelemetry(callback) {
  const liveRef = ref(db, "live");
  const listener = onValue(liveRef, (snapshot) => callback(snapshot.exists() ? snapshot.val() : null));
  return () => off(liveRef, "value", listener);
}

export async function fetchTelemetryHistory() {
  try {
    const historyRef = ref(db, "history");
    const snapshot = await get(historyRef);
    if (!snapshot.exists()) return [];
    return Object.entries(snapshot.val())
      .map(([key, record]) => ({ id: key, ...record }))
      .reverse();
  } catch {
    return [];
  }
}

// --- FLEET ASSETS ---
export function subscribeToMotors(callback) {
  const motorsRef = ref(db, "motors");
  const listener = onValue(motorsRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(Object.entries(snapshot.val()).map(([id, val]) => ({ id, ...val })));
    } else {
      callback([]);
    }
  });
  return () => off(motorsRef, "value", listener);
}

export async function createMotorAsset({ motorName, location, ratedVoltage }) {
  const motorsRef = ref(db, "motors");
  const newRef = push(motorsRef);
  await set(newRef, { motor_name: motorName, location, rated_voltage: Number(ratedVoltage) });
  return newRef.key;
}

export async function updateMotorAsset(motorId, data) {
  await update(ref(db, `motors/${motorId}`), {
    motor_name: data.motorName,
    location: data.location,
    rated_voltage: Number(data.ratedVoltage)
  });
}

export async function deleteMotorAsset(motorId) {
  await remove(ref(db, `motors/${motorId}`));
}

export async function logTestReading({ motorId, rawIR, temperature, ratedVoltage, employeeId, operatorName, ncAuxSafe, zeroVoltageSafe }) {
  if (!ncAuxSafe || !zeroVoltageSafe) {
    throw new Error("Safety interlocks failed: Zero-energy state not confirmed.");
  }
  const histRef = push(ref(db, "history"));
  const record = {
    motorId,
    rawIR: Number(rawIR),
    temperatureC: Number(temperature),
    motorVoltage: Number(ratedVoltage),
    employeeId: employeeId || "N/A",
    operatorName: operatorName || "Operator",
    safetyOK: true,
    status: "NORMAL",
    timestamp: new Date().toISOString()
  };
  await set(histRef, record);
}

// --- EMPLOYEE ID-BASED USER MANAGEMENT ---
export async function provisionUserWithId(employeeId, { fullname, role, pin }) {
  const cleanId = String(employeeId).trim();
  const userRef = ref(db, `users/${cleanId}`);
  await set(userRef, {
    employeeId: cleanId,
    fullname,
    role,
    pin: pin || "1234",
    createdAt: new Date().toISOString()
  });
}

export async function fetchRegisteredUsers() {
  const usersRef = ref(db, "users");
  const snapshot = await get(usersRef);
  if (!snapshot.exists()) return [];
  return Object.entries(snapshot.val()).map(([id, val]) => ({ id, ...val }));
}