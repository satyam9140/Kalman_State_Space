# State-Space Kalman ECG Experiment

A beginner-friendly React + Vite experiment that demonstrates a discrete state-space Kalman filter on ECG data.

## Recommended learning order

1. Select a dataset.
2. Keep **2 states: level + slope**.
3. Keep **Unforced** mode for the first run (`u(k)=0`).
4. Read the **Auto-estimate Q and R** card.
5. Run the experiment.
6. Follow the animated **state-space step solver** from measurement → prediction → innovation → correction.
7. Read the reference-validation graph and compare **Raw vs SG vs Kalman**.
8. Only then try 1-state, 3-state, forced mode, residuals, hidden states, and Kalman gain.

## What the experiment is actually doing

The signal is represented as a state-space model:

`x(k) = A x(k-1) + B u(k) + w(k)`

`z(k) = C x(k) + v(k)`

where:

- `x` = hidden state (level, slope, optional curvature)
- `u` = input; zero in unforced mode
- `A` = state-transition/memory matrix
- `B` = input matrix
- `C` = output matrix
- `Q` = process-noise covariance/scale used in prediction uncertainty
- `R` = measurement-noise variance
- `K` = Kalman gain

The filter performs four core operations:

1. **Predict:** `x⁻ = A x + B u`
2. **Predict uncertainty:** `P⁻ = A P Aᵀ + Q`
3. **Compute gain:** `K = P⁻ Cᵀ (C P⁻ Cᵀ + R)⁻¹`
4. **Correct:** `x = x⁻ + K(z - Cx⁻)`

## Automatic Q and R estimation

The app uses a Savitzky–Golay smooth curve as a local baseline.

- **R:** estimated from the variance of `raw ECG - SG smooth`.
- **Q:** estimated from the variance of the SG signal's first/second/third difference, matching the selected state-space size.

These are **automatic starting estimates**, not exact physical constants. They change when the dataset, analysis window, or state dimension changes.

## Validation

When the CSV contains a clean/reference ECG column, the app uses it only for **validation**, not to create the Kalman measurement itself. It compares:

- Raw ECG → reference MSE
- SG baseline → reference MSE
- Kalman estimate → reference MSE

A lower reference MSE is better. This is much stronger evidence than simply saying the residual became small.

## Forced mode limitation

Forced mode is included to demonstrate the mathematics of `B·u(k)`. Its input is derived from the signal/reference for teaching purposes. It is **not a measured actuator or physical control input**. Therefore, forced-vs-unforced results should be presented as a state-space demonstration, not as a real plant-control conclusion.

## Important interpretation rules

- A small **fit MSE** does not prove denoising because the Kalman filter is fitting the same measurement it receives.
- A small **post-update residual** does not prove that noise was removed.
- Reference-based MSE is the preferred accuracy check when a clean reference exists.
- `Q` controls how much the model is allowed to deviate from its predicted state.
- `R` controls how much the filter distrusts the measurement.
- Larger relative `R` generally makes the filter rely more on the model; larger relative `Q` generally makes it adapt more readily to measurements.


