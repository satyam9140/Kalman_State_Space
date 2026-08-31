function fmt(value) {
  if (!Number.isFinite(Number(value))) return '-';
  const n = Number(value);
  if (Math.abs(n) >= 10000 || (Math.abs(n) < 0.0001 && n !== 0)) return n.toExponential(2);
  return n.toFixed(4).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function intensity(value, maxAbs = 1) {
  const n = Math.abs(Number(value));
  if (!Number.isFinite(n) || n === 0) return 0;
  const ratio = n / Math.max(maxAbs, 1e-12);
  if (ratio >= 0.8) return 5;
  if (ratio >= 0.5) return 4;
  if (ratio >= 0.25) return 3;
  if (ratio >= 0.08) return 2;
  return 1;
}

function vectorText(values = [], labels = []) {
  return values.map((value, index) => `${labels[index] || `x${index + 1}`}=${fmt(value)}`).join(', ');
}

function Matrix({ label, matrix, rowLabels = [], colLabels = [], meaning = '' }) {
  const maxAbs = Math.max(...matrix.flat().map((value) => Math.abs(Number(value) || 0)), 1e-12);

  return (
    <div className="visual-matrix-card">
      <div className="visual-matrix-label">{label}</div>
      {meaning && <p className="matrix-meaning">{meaning}</p>}
      <div className="matrix-bracket-wrap">
        <span className="bracket left">[</span>
        <table className="visual-matrix-table">
          <tbody>
            {matrix.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td className={`shade-${intensity(cell, maxAbs)}`} key={c} title={`${rowLabels[r] || `row ${r + 1}`} receives from ${colLabels[c] || `col ${c + 1}`}`}>
                    <small>{rowLabels[r] || `r${r + 1}`} from {colLabels[c] || `c${c + 1}`}</small>
                    <b>{fmt(cell)}</b>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <span className="bracket right">]</span>
      </div>
    </div>
  );
}

function StepCard({ index, title, value, detail, active }) {
  return (
    <div className={active ? 'solver-step-card active' : 'solver-step-card'}>
      <span>{index}</span>
      <strong>{title}</strong>
      <code>{value}</code>
      <p>{detail}</p>
    </div>
  );
}

export default function StateSpaceVisual({ result, model, modelType, stepIndex = 0 }) {
  if (!result || !model) return null;
  const states = model.names || [];
  const step = Math.min(result.time.length - 1, Math.max(0, Number(stepIndex) || 0));
  const inputName = modelType === 'forced' ? 'estimated input u(k)' : 'u(k) = 0';
  const currentState = result.states[step] || [];
  const previousState = result.states[Math.max(0, step - 1)] || currentState;
  const gain = result.gains[step] || [];
  const measurement = result.measurements[step];
  const input = result.force[step] || 0;
  const prediction = result.predicted[step];
  const filtered = result.filtered[step];
  const residual = result.residuals[step];
  const deterministic = result.deterministic[step];
  const innovation = measurement - prediction;
  const progress = Math.round(((step + 1) / result.time.length) * 100);

  return (
    <section className="state-space-visual">
      <div className="section-title-row compact">
        <h2>State-space step solver</h2>
        <span>{modelType === 'forced' ? 'forced model active' : 'unforced model active'}</span>
      </div>

      <div className="solver-head">
        <div>
          <span>Current step</span>
          <strong>{step + 1} / {result.time.length}</strong>
          <p>t = {fmt(result.time[step])}; playback progress = {progress}%</p>
        </div>
        <div>
          <span>State vector x(k)</span>
          <strong>{vectorText(currentState, states)}</strong>
          <p>Previous state: {vectorText(previousState, states)}</p>
        </div>
      </div>
      <div className="solver-steps">
        <StepCard
          index="1"
          title="Read measurement"
          value={`z(k) = ${fmt(measurement)}`}
          detail="This is the raw ECG value at the current animated step."
          active
        />
        <StepCard
          index="2"
          title="Apply input"
          value={`${inputName}: ${fmt(input)}`}
          detail={modelType === 'forced' ? 'B multiplies this input before prediction.' : 'Input is zero, so the model evolves freely.'}
          active={modelType === 'forced'}
        />
        <StepCard
          index="3"
          title="Predict output"
          value={`y-(k) = ${fmt(prediction)}`}
          detail={`Model-only output before correction is ${fmt(deterministic)}.`}
          active
        />
        <StepCard
          index="4"
          title="Correct estimate"
          value={`x(k) = ${vectorText(currentState, states)}`}
          detail={`Innovation z(k)-y-(k) = ${fmt(innovation)}; residual after update = ${fmt(residual)}.`}
          active
        />
      </div>

      <div className="equation-strip kalman-equations">
        <div>
          <strong>Prediction</strong>
          <code>x⁻(k) = A x(k−1) + B u(k)</code>
          <small>The model predicts the next hidden state.</small>
        </div>
        <div>
          <strong>Prediction uncertainty</strong>
          <code>P⁻(k) = A P(k−1) Aᵀ + Q</code>
          <small>Q says how uncertain that prediction is.</small>
        </div>
        <div>
          <strong>Kalman gain</strong>
          <code>K = P⁻ Cᵀ (C P⁻ Cᵀ + R)⁻¹</code>
          <small>R says how much to distrust the measurement.</small>
        </div>
        <div>
          <strong>Correction</strong>
          <code>x(k) = x⁻(k) + K [z(k) − Cx⁻(k)]</code>
          <small>Innovation = measurement − prediction.</small>
        </div>
      </div>

      <div className="solver-teaching-note">
        <strong>Read the animation like this:</strong> prediction comes from A/B, uncertainty comes from Q, the measurement is weighted using R, and K decides how much the prediction should move toward the measurement.
      </div>

      <div className="flow-diagram visual-flow">
        <div className="flow-node input-node"><span>Input</span><strong>{inputName}</strong><small>Current u(k): {fmt(input)}</small></div>
        <div className="flow-arrow">B</div>
        <div className="flow-node state-node"><span>Hidden state</span>{states.map((s, idx) => <strong key={s}>x{idx + 1}: {s} = {fmt(currentState[idx])}</strong>)}<small>A carries memory into the next step.</small></div>
        <div className="flow-arrow">C</div>
        <div className="flow-node output-node"><span>Visible output</span><strong>Filtered ECG = {fmt(filtered)}</strong><small>Gain K: {vectorText(gain, states)}</small></div>
      </div>

      <div className="matrix-explain-grid">
        <Matrix label="A: next-state memory" matrix={result.matrices.A} rowLabels={states} colLabels={states} meaning="How each current state contributes to the next state." />
        <Matrix label="B: input path" matrix={result.matrices.B} rowLabels={states} colLabels={['u(k)']} meaning="How external input enters the hidden state." />
        <Matrix label="C: output selector" matrix={result.matrices.C} rowLabels={['y(k)']} colLabels={states} meaning="Which hidden state becomes the visible ECG output." />
        <Matrix label="D: direct feedthrough" matrix={result.matrices.D} rowLabels={['y(k)']} colLabels={['u(k)']} meaning="Direct input-to-output path; it is zero in this experiment." />
        <Matrix label="Q: process noise" matrix={result.matrices.Q} rowLabels={states} colLabels={states} meaning="How much uncertainty is allowed in state prediction." />
        <Matrix label="R: measurement noise" matrix={result.matrices.R} rowLabels={['z(k)']} colLabels={['z(k)']} meaning="How noisy the measured ECG is assumed to be." />
      </div>

      <div className="interpretation-box">
        <h3>Step interpretation</h3>
        <p>At this step, the model predicts {fmt(prediction)}, reads measurement {fmt(measurement)}, computes innovation {fmt(innovation)}, and corrects the estimate to {fmt(filtered)}.</p>
        <p><b>Innovation</b> is the error before correction. <b>Residual</b> is the error after correction. A small residual does not by itself prove that noise was removed.</p>
        <p>Final estimated state after the full run: {vectorText(result.finalState, states)}.</p>
      </div>
    </section>
  );
}