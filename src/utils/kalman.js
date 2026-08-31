import {
  add,
  identity,
  matrixToVector,
  meanSquaredError,
  multiply,
  safeInverse,
  scalarMultiply,
  subtract,
  symmetrize,
  transpose,
  vectorStats,
  vectorToMatrix,
} from './matrix.js';
import { generateForce, savitzkyGolaySmooth } from './signal.js';

export function buildAutoModel(dimension = 2, dt = 1) {
  const dim = Math.max(1, Math.min(3, Number(dimension) || 2));
  const step = Math.max(1e-12, Number(dt) || 1);

  if (dim === 1) {
    return {
      A: [[1]],
      B: [[step]],
      C: [[1]],
      D: [[0]],
      names: ['level'],
      description: '1-state random-walk model: the state is the ECG level, with optional input changing the level over time.',
    };
  }

  if (dim === 3) {
    return {
      A: [
        [1, step, 0.5 * step * step],
        [0, 1, step],
        [0, 0, 1],
      ],
      B: [[(step ** 3) / 6], [0.5 * step * step], [step]],
      C: [[1, 0, 0]],
      D: [[0]],
      names: ['level', 'velocity/slope', 'acceleration/curvature'],
      description: '3-state constant-acceleration model: level, slope, and curvature are estimated while input behaves like jerk.',
    };
  }

  return {
    A: [
      [1, step],
      [0, 1],
    ],
    B: [[0.5 * step * step], [step]],
    C: [[1, 0]],
    D: [[0]],
    names: ['level', 'velocity/slope'],
    description: '2-state constant-velocity model: level and slope are estimated while input behaves like acceleration.',
  };
}

function isMatrixShape(matrix, rows, cols) {
  return Array.isArray(matrix)
    && matrix.length === rows
    && matrix.every((row) => Array.isArray(row) && row.length === cols && row.every((value) => Number.isFinite(Number(value))));
}

export function validateModel({ A, B, C, D }) {
  if (!Array.isArray(A) || !A.length || A.some((row) => !Array.isArray(row) || row.length !== A.length)) {
    throw new Error('A must be a square n × n matrix.');
  }
  const n = A.length;
  if (!isMatrixShape(A, n, n)) throw new Error('A contains invalid numbers.');
  if (!isMatrixShape(B, n, 1)) throw new Error('B must be n × 1.');
  if (!isMatrixShape(C, 1, n)) throw new Error('C must be 1 × n for single-output signal analysis.');
  if (!isMatrixShape(D, 1, 1)) throw new Error('D must be 1 × 1.');
}

function initialStateFromMeasurement(z0, dimension) {
  const x = Array(dimension).fill(0);
  x[0] = Number.isFinite(z0) ? z0 : 0;
  return vectorToMatrix(x);
}

function scalarOutput(C, x, D, u) {
  return multiply(C, x)[0][0] + D[0][0] * u;
}

function finiteOr(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function cleanReference(reference, total) {
  if (!reference || !reference.some(Number.isFinite)) return null;
  return reference.slice(0, total).map((value) => (Number.isFinite(value) ? Number(value) : NaN));
}

function buildDriverSeries(signal, total) {
  const measured = signal.values.slice(0, total).map((value, index) => finiteOr(value, index ? signal.values[index - 1] : 0));
  const reference = cleanReference(signal.reference, total);
  const source = reference || savitzkyGolaySmooth(measured, measured.length >= 9 ? 9 : 5);
  const driver = [];

  for (let i = 0; i < total; i += 1) {
    const fallback = measured[i] ?? driver[i - 1] ?? 0;
    driver.push(finiteOr(source[i], fallback));
  }

  return driver;
}

function regularizedLeastSquaresInput(model, state, target, lambda) {
  const naturalState = multiply(model.A, state);
  const naturalOutput = scalarOutput(model.C, naturalState, model.D, 0);
  const outputGain = multiply(model.C, model.B)[0][0] + model.D[0][0];
  const residual = target - naturalOutput;
  const denominator = outputGain * outputGain + lambda;
  const u = denominator > 1e-18 ? (outputGain * residual) / denominator : 0;
  return {
    u: Number.isFinite(u) ? u : 0,
    naturalState,
  };
}

function buildAutoForce(signal, model, total) {
  const driver = buildDriverSeries(signal, total);
  const u = [];
  const n = model.A.length;
  let xModel = initialStateFromMeasurement(driver[0], n);
  const measurementVariance = vectorStats(driver).variance || 1;
  const lambda = Math.max(1e-12, measurementVariance * 1e-8);

  for (let k = 0; k < total; k += 1) {
    const target = driver[k];
    const { u: uk, naturalState } = regularizedLeastSquaresInput(model, xModel, target, lambda);
    u.push(uk);
    xModel = add(naturalState, scalarMultiply(model.B, uk));
  }

  return u;
}

function buildProcessNoiseMatrix(dimension, dt, noiseScale) {
  // noiseScale is the variance of the highest-order model derivative:
  // 1-state -> velocity, 2-state -> acceleration, 3-state -> jerk.
  // Q = G * variance * Gᵀ is the discrete-time process covariance.
  const q = Math.max(1e-12, Number(noiseScale) || 1e-12);
  const t = Math.max(1e-12, Number(dt) || 1);

  if (dimension === 1) {
    const g = t;
    return [[q * g * g]];
  }

  if (dimension === 2) {
    const g = [[0.5 * t * t], [t]];
    return [
      [q * g[0][0] * g[0][0], q * g[0][0] * g[1][0]],
      [q * g[1][0] * g[0][0], q * g[1][0] * g[1][0]],
    ];
  }

  const g = [[(t ** 3) / 6], [0.5 * t * t], [t]];
  return g.map((row) => g.map((col) => q * row[0] * col[0]));
}

function sanitizeMeasurements(values) {
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    const current = Number(values[i]);
    if (Number.isFinite(current)) out.push(current);
    else out.push(out[i - 1] ?? 0);
  }
  return out;
}

function covarianceUpdateJoseph(I, K, C, PPred, R) {
  const KC = multiply(K, C);
  const left = subtract(I, KC);
  const right = transpose(left);
  const KRKT = multiply(multiply(K, R), transpose(K));
  return symmetrize(add(multiply(multiply(left, PPred), right), KRKT));
}

export function runKalmanAnalysis({
  signal,
  model,
  modelType = 'unforced',
  processNoise = 0.0001,
  measurementNoise = 0.08,
  initialCovariance = 10,
  forceType = 'sine',
  forceAmplitude = 1,
  forceFrequency = 0.02,
  maxSteps = 0,
}) {
  validateModel(model);
  const n = model.A.length;
  const total = Math.min(signal.values.length, maxSteps && maxSteps > 0 ? maxSteps : signal.values.length);
  if (total < 2) throw new Error('At least two samples are required for Kalman analysis.');

  const dt = Math.max(1e-12, signal.derivedDt || (signal.time.length > 1 ? signal.time[1] - signal.time[0] : 1));
  const measurements = sanitizeMeasurements(signal.values.slice(0, total));
  const reference = cleanReference(signal.reference, total);
  const smooth = savitzkyGolaySmooth(measurements, measurements.length >= 9 ? 9 : 5);
  const time = signal.time.slice(0, total);
  const u = modelType === 'forced'
    ? (forceType === 'auto'
      ? buildAutoForce({ ...signal, values: measurements }, model, total)
      : generateForce(forceType, total, dt, forceAmplitude, forceFrequency))
    : Array(total).fill(0);

  const Q = buildProcessNoiseMatrix(n, dt, processNoise);
  const R = [[Math.max(1e-12, Number(measurementNoise) || 0)]];
  let P = identity(n, Math.max(1e-12, Number(initialCovariance) || 1));
  let xHat = initialStateFromMeasurement(measurements[0], n);
  let xModel = initialStateFromMeasurement(measurements[0], n);
  const I = identity(n);
  const AT = transpose(model.A);
  const CT = transpose(model.C);

  const filtered = [];
  const predicted = [];
  const deterministic = [];
  const residuals = [];
  const innovations = [];
  const states = [];
  const gains = [];

  for (let k = 0; k < total; k += 1) {
    const uk = finiteOr(u[k], 0);
    const Bu = scalarMultiply(model.B, uk);

    const xPred = add(multiply(model.A, xHat), Bu);
    const PPred = symmetrize(add(multiply(multiply(model.A, P), AT), Q));
    const yPred = scalarOutput(model.C, xPred, model.D, uk);
    predicted.push(yPred);

    if (k > 0) xModel = add(multiply(model.A, xModel), Bu);
    deterministic.push(scalarOutput(model.C, xModel, model.D, uk));

    const innovationValue = measurements[k] - yPred;
    const innovation = [[innovationValue]];
    const S = add(multiply(multiply(model.C, PPred), CT), R);
    const K = multiply(multiply(PPred, CT), safeInverse(S));
    xHat = add(xPred, multiply(K, innovation));
    P = covarianceUpdateJoseph(I, K, model.C, PPred, R);

    const yFilt = scalarOutput(model.C, xHat, model.D, uk);
    filtered.push(yFilt);
    residuals.push(measurements[k] - yFilt);
    innovations.push(innovationValue);
    states.push(matrixToVector(xHat));
    gains.push(matrixToVector(K));
  }

  const measurementStats = vectorStats(measurements);
  const residualStats = vectorStats(residuals);
  const fitMse = meanSquaredError(measurements, filtered);
  const modelMse = meanSquaredError(measurements, deterministic);
  const predictionMse = meanSquaredError(measurements, predicted);
  const fitRmse = Math.sqrt(fitMse);
  const predictionRmse = Math.sqrt(predictionMse);
  const fitMae = measurements.reduce((sum, value, index) => sum + Math.abs(value - filtered[index]), 0) / total;
  const normalizedFitError = measurementStats.variance > 1e-12 ? fitMse / measurementStats.variance : fitMse;
  const residualVarianceReduction = measurementStats.variance > 1e-12
    ? 100 * (1 - residualStats.variance / measurementStats.variance)
    : 0;
  const innovationStats = vectorStats(innovations);
  const rawVsSmoothMse = meanSquaredError(measurements, smooth);
  const kalmanVsSmoothMse = meanSquaredError(filtered, smooth);

  let referenceStats = null;
  if (reference) {
    const rawReferenceMse = meanSquaredError(measurements, reference);
    const smoothReferenceMse = meanSquaredError(smooth, reference);
    const filteredReferenceMse = meanSquaredError(filtered, reference);
    const modelReferenceMse = meanSquaredError(deterministic, reference);
    const referenceImprovement = rawReferenceMse > 1e-12
      ? 100 * (1 - filteredReferenceMse / rawReferenceMse)
      : 0;
    referenceStats = {
      stats: vectorStats(reference.filter(Number.isFinite)),
      rawReferenceMse,
      smoothReferenceMse,
      filteredReferenceMse,
      modelReferenceMse,
      referenceImprovement,
    };
  }

  return {
    time,
    measurements,
    reference,
    filtered,
    smooth,
    predicted,
    deterministic,
    residuals,
    states,
    gains,
    force: u,
    finalGain: gains[gains.length - 1] || [],
    finalState: states[states.length - 1] || [],
    stats: {
      samples: total,
      measurement: measurementStats,
      residual: residualStats,
      innovation: innovationStats,
      reference: referenceStats,
      fitMse,
      fitRmse,
      fitMae,
      modelMse,
      predictionMse,
      predictionRmse,
      normalizedFitError,
      rawVsSmoothMse,
      kalmanVsSmoothMse,
      residualVarianceReduction,
      noiseReduction: residualVarianceReduction,
    },
    matrices: {
      A: model.A,
      B: model.B,
      C: model.C,
      D: model.D,
      Q,
      R,
    },
  };
}

export function makeConclusion(result, model, modelType) {
  const { stats } = result;
  const lines = [];

  lines.push('Q and R were estimated automatically from the selected ECG window using a Savitzky–Golay baseline. They are data-driven starting estimates, not ground-truth values.');

  if (stats.reference) {
    const raw = stats.reference.rawReferenceMse;
    const sg = stats.reference.smoothReferenceMse;
    const kalman = stats.reference.filteredReferenceMse;
    const improvement = raw > 1e-12 ? 100 * (1 - kalman / raw) : 0;
    const sgImprovement = raw > 1e-12 ? 100 * (1 - sg / raw) : 0;
    if (improvement > 0) {
      lines.push(`Reference validation: Kalman MSE is ${improvement.toFixed(1)}% lower than raw ECG. The SG baseline changes MSE by ${sgImprovement.toFixed(1)}%, so the Kalman result should be judged against both baselines.`);
    } else {
      lines.push(`Reference validation: Kalman does not improve on the raw ECG (change ${improvement.toFixed(1)}%). Do not claim successful denoising from this run.`);
    }
  } else {
    lines.push('No clean reference column was available, so this run can show filtering behavior but cannot prove denoising accuracy.');
  }

  if (modelType === 'unforced') {
    lines.push('Unforced mode sets u(k)=0. The signal is explained only by the state transition A plus process uncertainty Q. This is the cleanest baseline for learning the Kalman recursion.');
  } else {
    lines.push('Forced mode uses B·u(k). Here u(k) is a teaching input derived from the available signal/reference, not a measured physical actuator input. It demonstrates the mathematics of a forced state-space model, not a physical control experiment.');
  }

  if (model.A.length === 1) lines.push('1-state model: only the signal level is stored. It is the simplest model and the easiest to explain, but it cannot explicitly represent slope.');
  if (model.A.length === 2) lines.push('2-state model: level + slope. This is the recommended beginner model because it gives the filter memory of both position and trend.');
  if (model.A.length >= 3) lines.push('3-state model: level + slope + curvature. It is more expressive, but the extra state makes tuning and interpretation harder.');

  lines.push(`Prediction MSE = ${stats.predictionMse.toExponential(2)} and filtered-fit MSE = ${stats.fitMse.toExponential(2)}. A low fit error alone is not evidence of denoising because the Kalman filter also sees the same measurement it is fitting.`);
  return lines;
}
