function formatNoise(value) {
  if (!Number.isFinite(Number(value))) return '-';
  const n = Number(value);
  if (n === 0) return '0';
  if (Math.abs(n) >= 1000 || Math.abs(n) < 0.001) return n.toExponential(3);
  return n.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}

export default function AutoNoiseEstimator({ noiseQ, noiseR, dimension = 2, hasSignal }) {
  const derivativeName = dimension === 1 ? 'first-difference' : dimension === 3 ? 'third-difference' : 'second-difference';

  return (
    <section className="auto-estimator-card" aria-label="Automatic Q and R estimation">
      <div className="auto-estimator-kicker">Automatic parameter estimation</div>
      <h3>Auto-estimate Q and R</h3>
      <p className="auto-estimator-subtitle">Savitzky–Golay-based noise estimator</p>

      <div className="auto-estimator-values">
        <div>
          <span>Q · process-noise scale</span>
          <strong>{hasSignal ? formatNoise(noiseQ?.value) : '-'}</strong>
          <small>Uncertainty in state prediction</small>
        </div>
        <div>
          <span>R · measurement variance</span>
          <strong>{hasSignal ? formatNoise(noiseR?.value) : '-'}</strong>
          <small>Uncertainty in measured ECG</small>
        </div>
      </div>

      <div className="auto-estimator-flow">
        <span>Raw ECG</span><b>→</b><span>SG smooth</span><b>→</b><span>Estimate Q/R</span>
      </div>

      <div className="auto-estimator-method">
        <strong>How the estimate is made</strong>
        <p><b>R:</b> variance of raw − SG smooth.</p>
        <p><b>Q:</b> variance of the SG signal's {derivativeName}, matched to the selected state model.</p>
      </div>

      <p className="auto-estimator-note">
        These are automatic starting estimates, not exact physical constants. They are recomputed when the dataset, window, or state-space size changes.
      </p>
    </section>
  );
}
