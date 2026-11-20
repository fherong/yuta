import { ref, onValue, get, set, push, update, remove, off, runTransaction } from "firebase/database";
import { db } from "../firebase";
import { sortTelemetryHistoryNewestFirst } from "../utils/sortTelemetryHistory.js";

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
    return sortTelemetryHistoryNewestFirst(
      Object.entries(snapshot.val()).map(([key, record]) => ({ id: key, ...record }))
    );
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

export async function archiveMotorAsset(motor, archivedBy) {
  const motorId = String(motor?.id || "").trim();
  if (!motorId || motorId === "motor-mock") {
    throw new Error("This motor cannot be archived.");
  }

  const motorRef = ref(db, `motors/${motorId}`);
  const snapshot = await get(motorRef);
  const storedMotor = snapshot.val();
  const motorData = storedMotor && typeof storedMotor === "object" ? storedMotor : motor;
  const archiveId = push(ref(db, "archives")).key;
  if (!archiveId) {
    throw new Error("Unable to create an archive record.");
  }

  const archiveRecord = {
    type: "motor",
    originalId: motorId,
    motorName: motorData.motor_name || motor.motor_name || "Unnamed motor",
    location: motorData.location || motor.location || "",
    ratedVoltage: motorData.rated_voltage || motor.rated_voltage || "",
    archivedAt: new Date().toISOString(),
    archivedBy: archivedBy?.fullname || archivedBy?.email || "Administrator",
    archivedById: archivedBy?.employeeId || archivedBy?.uid || "",
  };

  await update(ref(db), {
    [`archives/${archiveId}`]: archiveRecord,
    [`motors/${motorId}`]: null,
  });

  return { id: archiveId, ...archiveRecord };
}

// --- EMPLOYEE ID-BASED USER MANAGEMENT ---
export async function provisionUserWithId(employeeId, { fullname, role, pin }) {
  const cleanId = String(employeeId).trim();
  const cleanPin = String(pin || "").trim();
  if (!/^[0-9]{8,12}$/.test(cleanPin)) {
    throw new Error("PIN must contain 8 to 12 digits for the Arduino keypad.");
  }

  const userRef = ref(db, `users/${cleanId}`);
  await set(userRef, {
    employeeId: cleanId,
    fullname,
    role,
    pin: cleanPin,
    createdAt: new Date().toISOString()
  });
}

export async function updateRegisteredUser(employeeId, { fullname, role, pin }) {
  const cleanId = String(employeeId).trim();
  const cleanName = String(fullname).trim();
  if (!cleanId || !cleanName) {
    throw new Error("Employee ID and full name are required.");
  }
  if (role !== "Employee" && role !== "Admin") {
    throw new Error("Select a valid account role.");
  }

  const cleanPin = typeof pin === "string" ? pin.trim() : "";
  if (cleanPin && !/^[0-9]{8,12}$/.test(cleanPin)) {
    throw new Error("PIN must contain 8 to 12 digits for the Arduino keypad.");
  }

  const userRef = ref(db, `users/${cleanId}`);
  const result = await runTransaction(userRef, (currentUser) => {
    if (!currentUser || typeof currentUser !== "object") return;
    return {
      ...currentUser,
      employeeId: cleanId,
      fullname: cleanName,
      role,
      ...(cleanPin ? { pin: cleanPin } : {}),
      updatedAt: new Date().toISOString(),
    };
  });

  if (!result.committed) {
    throw new Error("This account no longer exists. Refresh the personnel list and try again.");
  }
}

export async function fetchRegisteredUsers() {
  const usersRef = ref(db, "users");
  const snapshot = await get(usersRef);
  if (!snapshot.exists()) return [];
  return Object.entries(snapshot.val()).map(([id, val]) => ({ id, ...val }));
}

export async function archiveRegisteredUser(employeeId, archivedBy) {
  const cleanId = String(employeeId).trim();
  if (!cleanId) {
    throw new Error("Employee ID is required.");
  }

  const userRef = ref(db, `users/${cleanId}`);
  const snapshot = await get(userRef);
  if (!snapshot.exists()) {
    throw new Error("This account no longer exists. Refresh the personnel list and try again.");
  }

  const userData = { ...snapshot.val() };
  delete userData.pin;
  const archiveId = push(ref(db, "archives")).key;
  if (!archiveId) {
    throw new Error("Unable to create an archive record.");
  }

  const archiveRecord = {
    ...userData,
    type: "employee",
    originalId: cleanId,
    archivedAt: new Date().toISOString(),
    archivedBy: archivedBy?.fullname || archivedBy?.email || "Administrator",
    archivedById: archivedBy?.employeeId || archivedBy?.uid || "",
  };

  await update(ref(db), {
    [`archives/${archiveId}`]: archiveRecord,
    [`users/${cleanId}`]: null,
  });

  return { id: archiveId, ...archiveRecord };
}

export async function fetchArchivedItems() {
  const archivesRef = ref(db, "archives");
  const snapshot = await get(archivesRef);
  if (!snapshot.exists()) return [];

  return Object.entries(snapshot.val())
    .map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : {}) }))
    .filter((item) => item.type === "employee" || item.type === "motor")
    .sort((a, b) => {
      const timeA = Date.parse(a.archivedAt);
      const timeB = Date.parse(b.archivedAt);
      return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA);
    });
}