import { clamp, meanSquaredError, vectorStats } from './matrix.js';

function gaussianLikeNoise(index, scale = 1) {
  const a = Math.sin(index * 12.9898) * 43758.5453;
  const b = Math.sin((index + 31) * 78.233) * 12645.743;
  return (((a - Math.floor(a)) + (b - Math.floor(b))) - 1) * scale;
}

export function generateForce(type = 'sine', count = 500, dt = 1, amplitude = 1, frequency = 0.02) {
  return Array.from({ length: count }, (_, i) => {
    const t = i * dt;
    if (type === 'none') return 0;
    if (type === 'step') return i > count * 0.35 ? amplitude : 0;
    if (type === 'ramp') return amplitude * i / Math.max(1, count - 1);
    if (type === 'pulse') return i > count * 0.25 && i < count * 0.35 ? amplitude : 0;
    return amplitude * Math.sin(2 * Math.PI * frequency * t);
  });
}

function parseDelimitedText(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const input = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((value) => String(value).trim().length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => String(value).trim().length > 0)) rows.push(row);
  return rows;
}

function scoreDelimiter(text, delimiter) {
  const rows = parseDelimitedText(text.split(/\r?\n/).slice(0, 25).join('\n'), delimiter).slice(0, 20);
  if (rows.length < 2) return -Infinity;
  const lengths = rows.map((row) => row.length).filter((length) => length > 1);
  if (!lengths.length) return -Infinity;
  const meanLength = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  const variance = lengths.reduce((sum, length) => sum + (length - meanLength) ** 2, 0) / lengths.length;
  return meanLength * 10 - variance * 3 + lengths.length;
}

function detectDelimiter(text) {
  const candidates = [',', ';', '\t', '|'];
  return candidates
    .map((delimiter) => ({ delimiter, score: scoreDelimiter(text, delimiter) }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter || ',';
}

export function toNumber(value) {
  if (value === null || value === undefined) return NaN;
  const raw = String(value).trim().replace(/^"|"$/g, '');
  if (!raw) return NaN;

  const compact = raw.replace(/,/g, '');
  const numeric = Number(compact);
  if (Number.isFinite(numeric)) return numeric;

  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? dateMs : NaN;
}

function median(values) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return NaN;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function madVariance(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return NaN;
  const med = median(clean);
  const mad = median(clean.map((value) => Math.abs(value - med)));
  const sigma = 1.4826 * mad;
  return sigma * sigma;
}

function numericScore(rows, colIdx) {
  let count = 0;
  let finiteSum = 0;
  const limit = Math.min(rows.length, 3000);
  for (let row = 0; row < limit; row += 1) {
    const value = toNumber(rows[row][colIdx]);
    if (Number.isFinite(value)) {
      count += 1;
      finiteSum += 1;
    }
  }
  return limit ? finiteSum : count;
}

function looksMonotonicTime(rows, colIdx) {
  let last = null;
  let goodDiffs = 0;
  let totalDiffs = 0;
  const diffs = [];

  for (let row = 0; row < Math.min(rows.length, 3000); row += 1) {
    const value = toNumber(rows[row][colIdx]);
    if (!Number.isFinite(value)) continue;
    if (last !== null) {
      const diff = value - last;
      if (diff > 0) goodDiffs += 1;
      if (Number.isFinite(diff)) {
        totalDiffs += 1;
        if (diff > 0) diffs.push(diff);
      }
    }
    last = value;
  }

  if (totalDiffs <= 10 || goodDiffs / totalDiffs < 0.95) return false;
  const med = median(diffs);
  const stats = vectorStats(diffs);
  return Number.isFinite(med) && med > 0 && stats.std / Math.max(Math.abs(med), 1e-12) < 10;
}

function detectTimeColumn(headers, rows, numericScores) {
  const namedTime = headers.findIndex((h) => /(^|[_\s-])(time|date|timestamp|seconds|sec|sample_time|step|sample)([_\s-]|$)/i.test(h));
  if (namedTime >= 0 && numericScores[namedTime] > Math.min(rows.length * 0.3, 10)) return namedTime;

  const monotonicNumeric = numericScores
    .map((score, index) => ({ score, index }))
    .filter((item) => item.score > Math.min(rows.length * 0.8, 2000))
    .find((item) => looksMonotonicTime(rows, item.index));

  return monotonicNumeric?.index ?? null;
}

function columnVariance(rows, colIdx) {
  const values = [];
  for (let row = 0; row < Math.min(rows.length, 3000); row += 1) {
    const value = toNumber(rows[row][colIdx]);
    if (Number.isFinite(value)) values.push(value);
  }
  return vectorStats(values).variance;
}

function detectValueColumn(headers, rows, numericScores, timeCol) {
  const candidates = numericScores
    .map((score, index) => ({ score, index, header: headers[index] || '', variance: columnVariance(rows, index) }))
    .filter((item) => item.index !== timeCol && item.score > Math.min(rows.length * 0.3, 10))
    .sort((a, b) => {
      const aRaw = /(ecg|signal|raw|value|amplitude|measurement)/i.test(a.header) ? 1 : 0;
      const bRaw = /(ecg|signal|raw|value|amplitude|measurement)/i.test(b.header) ? 1 : 0;
      const aBad = /(filtered|filter|clean|reference|ref|smooth|smoothed|denois|target|label|class)/i.test(a.header) ? 1 : 0;
      const bBad = /(filtered|filter|clean|reference|ref|smooth|smoothed|denois|target|label|class)/i.test(b.header) ? 1 : 0;
      return (bRaw - bBad) - (aRaw - aBad) || b.score - a.score || b.variance - a.variance || a.index - b.index;
    });

  return candidates[0]?.index ?? 0;
}

export function detectReferenceColumn(headers, numericScores, timeCol, valueCol) {
  const valueName = String(headers[valueCol] || '').toLowerCase();
  const candidates = numericScores
    .map((score, index) => ({ score, index, header: String(headers[index] || '') }))
    .filter((item) => item.index !== timeCol && item.index !== valueCol && item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!candidates.length) return null;

  const cleanNamed = candidates.find((item) => /(filtered|filter|clean|reference|ref|smooth|smoothed|denois)/i.test(item.header));
  if (cleanNamed) return cleanNamed.index;

  const sibling = candidates.find((item) => {
    const h = item.header.toLowerCase();
    return valueName && h.length > 2 && (h.includes(valueName) || valueName.includes(h));
  });

  return sibling?.index ?? null;
}

export function parseCsvText(text, maxRows = 300000) {
  const delimiter = detectDelimiter(text);
  const parsedRows = parseDelimitedText(text, delimiter).filter((row) => row.some((cell) => String(cell).trim().length > 0));
  if (parsedRows.length < 2) throw new Error('CSV needs at least two rows.');

  const first = parsedRows[0];
  const firstNumericRatio = first.filter((cell) => Number.isFinite(toNumber(cell))).length / Math.max(1, first.length);
  const namedHeaderRatio = first.filter((cell) => /[a-zA-Z_]/.test(String(cell))).length / Math.max(1, first.length);
  const hasHeader = firstNumericRatio < 0.6 || namedHeaderRatio > 0.4;
  const width = Math.max(...parsedRows.slice(0, 100).map((row) => row.length));
  const headers = hasHeader
    ? Array.from({ length: width }, (_, idx) => first[idx] || `Column ${idx + 1}`)
    : Array.from({ length: width }, (_, idx) => `Column ${idx + 1}`);
  const startIndex = hasHeader ? 1 : 0;
  const rows = [];
  const limit = Math.min(parsedRows.length, startIndex + maxRows);

  for (let i = startIndex; i < limit; i += 1) {
    const cells = parsedRows[i];
    rows.push(headers.map((_, colIdx) => cells[colIdx] ?? ''));
  }

  const numericScores = headers.map((_, colIdx) => numericScore(rows, colIdx));
  const timeCol = detectTimeColumn(headers, rows, numericScores);
  const valueCol = detectValueColumn(headers, rows, numericScores, timeCol);
  const referenceCol = detectReferenceColumn(headers, numericScores, timeCol, valueCol);

  return {
    headers,
    rows,
    numericScores,
    truncated: parsedRows.length > limit,
    detectedTimeColumn: timeCol,
    detectedValueColumn: valueCol,
    detectedReferenceColumn: referenceCol,
    delimiter: delimiter === '\t' ? 'tab' : delimiter,
  };
}

function normalizeTime(rawValue, firstTime) {
  if (!Number.isFinite(rawValue)) return NaN;
  if (Math.abs(rawValue) > 10000000000) return (rawValue - firstTime) / 1000;
  return rawValue - firstTime;
}

export function csvToSignal(parsed, timeColumnIndex, valueColumnIndex, dt = 1, referenceColumnIndex = null) {
  const paired = [];
  const referenceEnabled = referenceColumnIndex !== null && referenceColumnIndex !== undefined && referenceColumnIndex >= 0;
  let firstTime = null;
  const fallbackDt = Math.max(1e-12, Number(dt) || 1);
  let validRows = 0;

  for (const row of parsed.rows) {
    const y = toNumber(row[valueColumnIndex]);
    if (!Number.isFinite(y)) continue;

    let t;
    if (timeColumnIndex !== null && timeColumnIndex !== undefined && timeColumnIndex >= 0) {
      const rawT = toNumber(row[timeColumnIndex]);
      if (Number.isFinite(rawT)) {
        if (firstTime === null) firstTime = rawT;
        t = normalizeTime(rawT, firstTime);
      }
    }
    if (!Number.isFinite(t)) t = paired.length * fallbackDt;

    const ref = referenceEnabled ? toNumber(row[referenceColumnIndex]) : NaN;
    paired.push({ t, y, ref: Number.isFinite(ref) ? ref : NaN });
    validRows += 1;
  }

  if (paired.length < 2) throw new Error('Could not find enough numeric signal values in the selected column.');

  paired.sort((a, b) => a.t - b.t);
  const unique = [];
  for (const item of paired) {
    const last = unique[unique.length - 1];
    if (last && Math.abs(last.t - item.t) < 1e-12) {
      last.y = (last.y + item.y) / 2;
      if (Number.isFinite(item.ref)) last.ref = Number.isFinite(last.ref) ? (last.ref + item.ref) / 2 : item.ref;
    } else {
      unique.push({ ...item });
    }
  }

  const time = unique.map((item) => item.t);
  const values = unique.map((item) => item.y);
  const reference = referenceEnabled ? unique.map((item) => item.ref) : null;

  const diffs = [];
  for (let i = 1; i < time.length; i += 1) {
    const diff = time[i] - time[i - 1];
    if (Number.isFinite(diff) && diff > 0) diffs.push(diff);
  }
  const derivedDt = median(diffs);

  return {
    time,
    values,
    reference,
    source: 'Uploaded CSV',
    derivedDt: Number.isFinite(derivedDt) ? derivedDt : fallbackDt,
    validRows,
    totalRows: parsed.rows.length,
    hasDatasetTime: timeColumnIndex !== null && timeColumnIndex !== undefined && timeColumnIndex >= 0 && Number.isFinite(derivedDt),
  };
}

function reflectIndex(index, length) {
  if (length <= 1) return 0;
  if (index < 0) return -index;
  if (index >= length) return length - 1 - (index - length + 1);
  return index;
}

export function savitzkyGolaySmooth(values, windowSize = 7) {
  const clean = (values || []).map((value) => Number(value));
  if (clean.length < 5) return clean;
  const window = Math.max(5, Math.min(clean.length % 2 ? clean.length : clean.length - 1, windowSize % 2 ? windowSize : windowSize + 1));
  const radius = Math.floor(window / 2);

  // Standard quadratic Savitzky-Golay convolution coefficients for 5, 7, and 9 point windows.
  const coeffs = {
    5: [-3, 12, 17, 12, -3].map((v) => v / 35),
    7: [-2, 3, 6, 7, 6, 3, -2].map((v) => v / 21),
    9: [-21, 14, 39, 54, 59, 54, 39, 14, -21].map((v) => v / 231),
  }[window] || [-2, 3, 6, 7, 6, 3, -2].map((v) => v / 21);

  return clean.map((_, index) => {
    let sum = 0;
    let weight = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sample = clean[reflectIndex(index + offset, clean.length)];
      const c = coeffs[offset + radius];
      if (Number.isFinite(sample)) {
        sum += c * sample;
        weight += c;
      }
    }
    return Math.abs(weight) > 1e-12 ? sum / weight : clean[index];
  });
}

export function estimateMeasurementNoise(signal) {
  const values = (signal.values || []).map(Number).filter(Number.isFinite);
  if (values.length < 2) {
    return {
      value: 1e-12,
      source: 'Fallback: insufficient samples',
      hasReference: false,
      rawReferenceMse: null,
      smooth: values,
      residualStd: 0,
      signalVariance: 0,
      ratio: 0,
    };
  }

  // Savitzky–Golay is used only as a local baseline.  R is the variance of
  // the part of the measurement that is not explained by that smooth baseline.
  const smooth = savitzkyGolaySmooth(values, values.length >= 9 ? 9 : 5);
  const residual = values.map((value, idx) => value - smooth[idx]).filter(Number.isFinite);
  const robustVariance = madVariance(residual);
  const residualVariance = vectorStats(residual).variance;
  const signalVariance = vectorStats(values).variance;
  const estimate = robustVariance || residualVariance || signalVariance * 0.01 || 1e-6;

  let rawReferenceMse = null;
  if (signal.reference && signal.reference.some(Number.isFinite)) {
    rawReferenceMse = meanSquaredError(values, signal.reference);
  }

  return {
    value: Math.max(1e-12, estimate),
    source: 'Savitzky–Golay residual variance',
    hasReference: Boolean(signal.reference && signal.reference.some(Number.isFinite)),
    rawReferenceMse,
    smooth,
    residualStd: Math.sqrt(Math.max(0, estimate)),
    signalVariance,
    ratio: signalVariance > 1e-12 ? estimate / signalVariance : 0,
  };
}

export function estimateProcessNoiseScale(signal, measurementNoiseEstimate = null, dimension = 2) {
  const values = (signal.values || []).map(Number).filter(Number.isFinite);
  const dt = Math.max(1e-12, Number(signal.derivedDt) || 1);
  const r = Number(measurementNoiseEstimate);
  const dim = Math.max(1, Math.min(3, Number(dimension) || 2));
  const derivativeOrder = dim === 1 ? 1 : dim === 3 ? 3 : 2;

  if (values.length < 4) {
    const fallback = Number.isFinite(r) && r > 0 ? r * 0.1 : 1e-6;
    return {
      value: Math.max(1e-12, fallback),
      source: 'Fallback: short signal window',
      derivativeOrder,
      dynamicsStd: Math.sqrt(Math.max(0, fallback)),
    };
  }

  const smooth = savitzkyGolaySmooth(values, values.length >= 9 ? 9 : 5);
  const dynamics = [];

  if (derivativeOrder === 1) {
    for (let i = 1; i < smooth.length; i += 1) {
      dynamics.push((smooth[i] - smooth[i - 1]) / dt);
    }
  } else if (derivativeOrder === 2) {
    for (let i = 2; i < smooth.length; i += 1) {
      dynamics.push((smooth[i] - 2 * smooth[i - 1] + smooth[i - 2]) / (dt * dt));
    }
  } else {
    for (let i = 3; i < smooth.length; i += 1) {
      dynamics.push((smooth[i] - 3 * smooth[i - 1] + 3 * smooth[i - 2] - smooth[i - 3]) / (dt ** 3));
    }
  }

  const dynamicsVariance = madVariance(dynamics) || vectorStats(dynamics).variance;
  const measurementVariance = vectorStats(values).variance;
  // A tiny floor prevents a perfectly smooth window from making the Kalman
  // model unrealistically certain.  The value remains data-derived.
  const floor = Number.isFinite(r) && r > 0 ? r * 0.001 : measurementVariance * 1e-6;
  const estimate = Math.max(dynamicsVariance || 0, floor || 0, 1e-12);

  return {
    value: estimate,
    source: `SG-smoothed ${derivativeOrder === 1 ? 'first' : derivativeOrder === 2 ? 'second' : 'third'}-difference variance`,
    derivativeOrder,
    dynamicsStd: Math.sqrt(Math.max(0, estimate)),
  };
}
