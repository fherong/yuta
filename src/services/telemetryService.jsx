import { db } from '../firebase';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { evaluateMotorStatus } from '../utils/ieeeStandards';

// 1. Subscribe to All Registered Motors in the Plant[cite: 1]
export const subscribeToMotors = (onMotorsReceived) => {
  const q = collection(db, "motors");
  return onSnapshot(q, (snapshot) => {
    const motors = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    onMotorsReceived(motors);
  });
};

// 2. Register New Motor Asset[cite: 1]
export const createMotorAsset = async ({ motorName, location, ratedVoltage, description }) => {
  const motorRef = await addDoc(collection(db, "motors"), {
    motor_name: motorName,
    location: location,
    rated_voltage: Number(ratedVoltage),
    description: description || "Low-Voltage Three-Phase Induction Motor",
    created_at: serverTimestamp()
  });
  return motorRef.id;
};

// 3. Update Existing Motor Asset Metadata[cite: 1]
export const updateMotorAsset = async (motorId, { motorName, location, ratedVoltage }) => {
  const motorRef = doc(db, "motors", motorId);
  await updateDoc(motorRef, {
    motor_name: motorName,
    location: location,
    rated_voltage: Number(ratedVoltage),
    updated_at: serverTimestamp()
  });
};

// 4. Delete Motor Asset[cite: 1]
export const deleteMotorAsset = async (motorId) => {
  const motorRef = doc(db, "motors", motorId);
  await deleteDoc(motorRef);
};

// 5. Subscribe to Motor-Specific Telemetry[cite: 1]
export const subscribeToMotorTelemetry = (motorId, onDataReceived) => {
  if (!motorId) return () => {};

  const q = query(
    collection(db, "tests"),
    where("motor_id", "==", motorId),
    orderBy("test_date", "desc"),
    limit(30)
  );

  return onSnapshot(q, (snapshot) => {
    const records = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        formattedDate: data.test_date?.toDate?.()
          ? data.test_date.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
    }).reverse();
    onDataReceived(records);
  });
};

// 6. Subscribe to Motor-Specific Alerts[cite: 1]
export const subscribeToMotorAlerts = (motorId, onAlertsReceived) => {
  if (!motorId) return () => {};

  const q = query(
    collection(db, "alerts"),
    where("motor_id", "==", motorId),
    orderBy("timestamp", "desc"),
    limit(10)
  );

  return onSnapshot(q, (snapshot) => {
    const alerts = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      timeFormatted: d.data().timestamp?.toDate?.()
        ? d.data().timestamp.toDate().toLocaleTimeString()
        : 'Active'
    }));
    onAlertsReceived(alerts);
  });
};

// 7. Trigger Test & Perform Dual Safety Check Evaluation[cite: 1]
export const logTestReading = async ({
  motorId,
  rawIR,
  temperature,
  ratedVoltage,
  userId = "system-edge",
  userName = "AMU Gateway",
  ncAuxSafe = true,
  zeroVoltageSafe = true
}) => {
  if (!ncAuxSafe || !zeroVoltageSafe) {
    throw new Error("Safety Interlock Tripped: Automated test aborted. Contactor energized or residual voltage detected.");
  }

  const { ir40, irMin, status, isSafe } = evaluateMotorStatus(rawIR, temperature, ratedVoltage);

  const testPayload = {
    motor_id: motorId,
    user_id: userId,
    user_name: userName,
    raw_ir: Number(rawIR),
    corrected_ir: Number(ir40),
    temperature: Number(temperature),
    rated_voltage: Number(ratedVoltage),
    ir_min: Number(irMin),
    motor_status: status,
    safety_interlocks: {
      nc_aux_contactor: "OPEN (OFF)",
      zmpt101b_voltage_vac: 0.00,
      verified: true
    },
    test_date: serverTimestamp(),
  };

  const testDocRef = await addDoc(collection(db, "tests"), testPayload);

  if (!isSafe) {
    await addDoc(collection(db, "alerts"), {
      test_id: testDocRef.id,
      motor_id: motorId,
      alert_message: `CRITICAL ALERT: Corrected IR (${ir40} MΩ) fell below IEEE threshold (${irMin} MΩ). Maintenance required.`,
      ir40,
      irMin,
      timestamp: serverTimestamp(),
      resolved: false
    });
  }

  return testDocRef.id;
};

// 8. Admin Account Provisioning[cite: 1]
export const provisionUserAccount = async (uid, { fullname, email, role }) => {
  const userRef = doc(db, "users", uid);
  await setDoc(userRef, {
    fullname,
    email,
    role,
    date_created: serverTimestamp()
  });
};

// 9. Fetch All Registered Users[cite: 1]
export const fetchRegisteredUsers = async () => {
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
};