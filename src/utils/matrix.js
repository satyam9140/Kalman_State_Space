export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertMatrix(A, name = 'matrix') {
  if (!Array.isArray(A) || !A.length || !Array.isArray(A[0])) {
    throw new Error(`${name} must be a non-empty 2D matrix.`);
  }
  const cols = A[0].length;
  if (!cols) throw new Error(`${name} must have at least one column.`);
  for (let i = 0; i < A.length; i += 1) {
    if (!Array.isArray(A[i]) || A[i].length !== cols) {
      throw new Error(`${name} rows must all have the same length.`);
    }
    for (let j = 0; j < cols; j += 1) {
      if (!Number.isFinite(Number(A[i][j]))) {
        throw new Error(`${name} contains a non-finite value.`);
      }
    }
  }
  return { rows: A.length, cols };
}

export function zeros(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

export function identity(n, scale = 1) {
  const out = zeros(n, n);
  for (let i = 0; i < n; i += 1) out[i][i] = scale;
  return out;
}

export function transpose(A) {
  const { rows, cols } = assertMatrix(A, 'A');
  const out = zeros(cols, rows);
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) out[j][i] = Number(A[i][j]);
  }
  return out;
}

export function add(A, B) {
  const a = assertMatrix(A, 'A');
  const b = assertMatrix(B, 'B');
  if (a.rows !== b.rows || a.cols !== b.cols) throw new Error('Matrix addition dimension mismatch.');
  return A.map((row, i) => row.map((value, j) => Number(value) + Number(B[i][j])));
}

export function subtract(A, B) {
  const a = assertMatrix(A, 'A');
  const b = assertMatrix(B, 'B');
  if (a.rows !== b.rows || a.cols !== b.cols) throw new Error('Matrix subtraction dimension mismatch.');
  return A.map((row, i) => row.map((value, j) => Number(value) - Number(B[i][j])));
}

export function multiply(A, B) {
  const a = assertMatrix(A, 'A');
  const b = assertMatrix(B, 'B');
  if (a.cols !== b.rows) throw new Error(`Matrix multiplication dimension mismatch: ${a.rows}×${a.cols} cannot multiply ${b.rows}×${b.cols}.`);
  const out = zeros(a.rows, b.cols);
  for (let i = 0; i < a.rows; i += 1) {
    for (let j = 0; j < b.cols; j += 1) {
      let sum = 0;
      for (let k = 0; k < a.cols; k += 1) sum += Number(A[i][k]) * Number(B[k][j]);
      out[i][j] = sum;
    }
  }
  return out;
}

export function scalarMultiply(A, scalar) {
  assertMatrix(A, 'A');
  const s = Number.isFinite(Number(scalar)) ? Number(scalar) : 0;
  return A.map((row) => row.map((value) => Number(value) * s));
}

export function vectorToMatrix(v) {
  return v.map((value) => [Number.isFinite(Number(value)) ? Number(value) : 0]);
}

export function matrixToVector(A) {
  assertMatrix(A, 'A');
  return A.map((row) => Number(row[0]));
}

export function symmetrize(A) {
  const { rows, cols } = assertMatrix(A, 'A');
  if (rows !== cols) throw new Error('Only square matrices can be symmetrized.');
  const out = zeros(rows, cols);
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) out[i][j] = 0.5 * (Number(A[i][j]) + Number(A[j][i]));
  }
  return out;
}

export function safeInverse(A) {
  const { rows, cols } = assertMatrix(A, 'A');
  if (rows !== cols) throw new Error('Only square matrices can be inverted.');

  if (rows === 1) {
    const value = Number(A[0][0]);
    const stable = Math.abs(value) < 1e-12 ? (value < 0 ? -1e-12 : 1e-12) : value;
    return [[1 / stable]];
  }

  const n = rows;
  const M = A.map((row, i) => [
    ...row.map((value, j) => Number(value) + (i === j ? 1e-12 : 0)),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let pivotValue = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const candidate = Math.abs(M[row][col]);
      if (candidate > pivotValue) {
        pivot = row;
        pivotValue = candidate;
      }
    }

    if (pivotValue < 1e-12) M[pivot][col] = M[pivot][col] < 0 ? -1e-12 : 1e-12;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];

    const divisor = M[col][col];
    for (let j = 0; j < 2 * n; j += 1) M[col][j] /= divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = M[row][col];
      if (Math.abs(factor) < 1e-18) continue;
      for (let j = 0; j < 2 * n; j += 1) M[row][j] -= factor * M[col][j];
    }
  }

  return M.map((row) => row.slice(n));
}

export function parseMatrix(text, expectedRows = null, expectedCols = null) {
  const rows = String(text || '')
    .trim()
    .split(';')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(/[\s,]+/).filter(Boolean).map(Number));

  if (!rows.length) throw new Error('Matrix is empty.');
  const cols = rows[0].length;
  if (!cols) throw new Error('Matrix has no columns.');
  if (rows.some((row) => row.length !== cols)) throw new Error('All matrix rows must have the same number of columns.');
  if (rows.flat().some((value) => !Number.isFinite(value))) throw new Error('Matrix contains a non-numeric value.');
  if (expectedRows !== null && rows.length !== expectedRows) throw new Error(`Expected ${expectedRows} row(s).`);
  if (expectedCols !== null && cols !== expectedCols) throw new Error(`Expected ${expectedCols} column(s).`);
  return rows;
}

export function formatMatrix(A, digits = 4) {
  return A.map((row) => `[ ${row.map((value) => Number(value).toFixed(digits)).join('   ')} ]`).join('\n');
}

export function vectorStats(values) {
  let count = 0;
  let mean = 0;
  let m2 = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const value of values || []) {
    const x = Number(value);
    if (!Number.isFinite(x)) continue;
    count += 1;
    const delta = x - mean;
    mean += delta / count;
    m2 += delta * (x - mean);
    min = Math.min(min, x);
    max = Math.max(max, x);
  }

  if (!count) return { min: 0, max: 0, mean: 0, variance: 0, std: 0, count: 0 };
  const variance = m2 / count;
  return { min, max, mean, variance, std: Math.sqrt(Math.max(0, variance)), count };
}

export function meanSquaredError(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0);
  if (!n) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const error = x - y;
      sum += error * error;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function triangleArea(a, b, c) {
  return Math.abs((a.x - c.x) * (b.y - a.y) - (a.x - b.x) * (c.y - a.y)) * 0.5;
}

export function downsampleSeries(points, maxPoints = 1800) {
  const clean = (points || []).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (clean.length <= maxPoints || maxPoints < 3) return clean;

  const threshold = Math.max(3, Math.floor(maxPoints));
  const sampled = [clean[0]];
  const bucketSize = (clean.length - 2) / (threshold - 2);
  let aIndex = 0;

  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    const rangeStart = Math.floor(bucket * bucketSize) + 1;
    const rangeEnd = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.floor((bucket + 2) * bucketSize) + 1;

    const currentBucket = clean.slice(rangeStart, Math.min(rangeEnd, clean.length - 1));
    const nextBucket = clean.slice(nextStart, Math.min(nextEnd, clean.length));

    const avg = nextBucket.length
      ? {
        x: nextBucket.reduce((sum, point) => sum + point.x, 0) / nextBucket.length,
        y: nextBucket.reduce((sum, point) => sum + point.y, 0) / nextBucket.length,
      }
      : clean[clean.length - 1];

    let bestPoint = currentBucket[0] || clean[Math.min(rangeStart, clean.length - 1)];
    let bestArea = -1;
    const a = clean[aIndex];
    for (const candidate of currentBucket.length ? currentBucket : [bestPoint]) {
      const area = triangleArea(a, candidate, avg);
      if (area > bestArea) {
        bestArea = area;
        bestPoint = candidate;
      }
    }

    sampled.push(bestPoint);
    aIndex = clean.indexOf(bestPoint);
  }

  sampled.push(clean[clean.length - 1]);
  return sampled;
}
