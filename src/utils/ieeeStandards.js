/**
 * IEEE Std 43-2013 Engineering Formulation Utility[cite: 1]
 */

// 1. Minimum Acceptable Insulation Resistance Threshold: IR_min = kV + 1 (in MΩ)[cite: 1]
export const calculateIRMin = (ratedVoltageV) => {
  const ratedVoltageKV = (Number(ratedVoltageV) || 480) / 1000;
  return Number((ratedVoltageKV + 1).toFixed(3));
};

// 2. Temperature Correction Factor (KT) normalized to 40°C[cite: 1]
// Standard doubling/halving rule per 10°C delta: KT = 0.5^((40 - T) / 10)
export const calculateKT = (tempCelsius) => {
  const temp = Number(tempCelsius) || 40;
  return Math.pow(0.5, (40 - temp) / 10);
};

// 3. Temperature-Corrected Insulation Resistance: IR40 = IRT * KT[cite: 1]
export const calculateIR40 = (rawIR, tempCelsius) => {
  const raw = Number(rawIR) || 0;
  const kt = calculateKT(tempCelsius);
  return Number((raw * kt).toFixed(3));
};

// 4. Complete Threshold Condition Evaluation[cite: 1]
export const evaluateMotorStatus = (rawIR, tempCelsius, ratedVoltageV) => {
  const ir40 = calculateIR40(rawIR, tempCelsius);
  const irMin = calculateIRMin(ratedVoltageV);
  const isSafe = ir40 >= irMin;

  return {
    rawIR: Number(rawIR),
    tempCelsius: Number(tempCelsius),
    ratedVoltageV: Number(ratedVoltageV),
    ir40,
    irMin,
    status: isSafe ? "Normal" : "Requires Maintenance",
    isSafe,
  };
};

// Standard IEEE Voltage Threshold Matrix[cite: 1]
export const IEEE_VOLTAGE_THRESHOLDS = [
  { voltage: 208, kv: 0.208, irMin: 1.208 },
  { voltage: 220, kv: 0.220, irMin: 1.220 },
  { voltage: 230, kv: 0.230, irMin: 1.230 },
  { voltage: 240, kv: 0.240, irMin: 1.240 },
  { voltage: 380, kv: 0.380, irMin: 1.380 },
  { voltage: 400, kv: 0.400, irMin: 1.400 },
  { voltage: 440, kv: 0.440, irMin: 1.440 },
  { voltage: 480, kv: 0.480, irMin: 1.480 },
];