import { ref, onValue, get, set, push, update, remove, off } from "firebase/database";
import { db } from "../firebase";

// ==========================================
// 1. PYTHON GATEWAY REALTIME LISTENERS
// ==========================================

export function subscribeToLiveTelemetry(callback) {
  const liveRef = ref(db, "live");
  const listener = onValue(
    liveRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.val());
      } else {
        callback(null);
      }
    },
    (error) => {
      console.error("Firebase Live Telemetry Error:", error);
    }
  );
  return () => off(liveRef, "value", listener);
}

export async function fetchTelemetryHistory() {
  try {
    const historyRef = ref(db, "history");
    const snapshot = await get(historyRef);
    if (!snapshot.exists()) return [];

    const rawData = snapshot.val();
    return Object.entries(rawData)
      .map(([key, record]) => ({
        id: key,
        ...record,
      }))
      .reverse();
  } catch (error) {
    console.error("Error fetching telemetry history:", error);
    return [];
  }
}

// ==========================================
// 2. FLEET ASSET & USER MANAGEMENT
// ==========================================

export function subscribeToMotors(callback) {
  const motorsRef = ref(db, "motors");
  const listener = onValue(motorsRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      const list = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      callback(list);
    } else {
      callback([]);
    }
  });
  return () => off(motorsRef, "value", listener);
}

export function subscribeToMotorTelemetry(motorId, callback) {
  const telemetryRef = ref(db, `telemetry/${motorId}`);
  const listener = onValue(telemetryRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      const list = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      callback(list);
    } else {
      callback([]);
    }
  });
  return () => off(telemetryRef, "value", listener);
}

export function subscribeToMotorAlerts(motorId, callback) {
  const alertsRef = ref(db, `alerts/${motorId}`);
  const listener = onValue(alertsRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      const list = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      callback(list);
    } else {
      callback([]);
    }
  });
  return () => off(alertsRef, "value", listener);
}

export async function logTestReading({ motorId, rawIR, temperature, ratedVoltage, userId, userName, ncAuxSafe, zeroVoltageSafe }) {
  if (!ncAuxSafe || !zeroVoltageSafe) {
    throw new Error("Safety interlocks failed: Zero-energy state not verified.");
  }
  const telemetryRef = ref(db, `telemetry/${motorId}`);
  const newLogRef = push(telemetryRef);
  const record = {
    raw_ir: Number(rawIR),
    temperature: Number(temperature),
    rated_voltage: Number(ratedVoltage),
    user_id: userId,
    user_name: userName,
    timestamp: new Date().toISOString()
  };
  await set(newLogRef, record);
  return newLogRef.key;
}

export async function createMotorAsset({ motorName, location, ratedVoltage }) {
  const motorsRef = ref(db, "motors");
  const newMotorRef = push(motorsRef);
  await set(newMotorRef, {
    motor_name: motorName,
    location,
    rated_voltage: Number(ratedVoltage)
  });
  return newMotorRef.key;
}

export async function updateMotorAsset(motorId, { motorName, location, ratedVoltage }) {
  const motorRef = ref(db, `motors/${motorId}`);
  await update(motorRef, {
    motor_name: motorName,
    location,
    rated_voltage: Number(ratedVoltage)
  });
}

export async function deleteMotorAsset(motorId) {
  const motorRef = ref(db, `motors/${motorId}`);
  await remove(motorRef);
}

export async function provisionUserAccount(uid, { fullname, email, role }) {
  const userRef = ref(db, `users/${uid}`);
  await set(userRef, { fullname, email, role });
}

export async function fetchRegisteredUsers() {
  const usersRef = ref(db, "users");
  const snapshot = await get(usersRef);
  if (!snapshot.exists()) return [];
  const data = snapshot.val();
  return Object.entries(data).map(([id, val]) => ({ id, ...val }));
}