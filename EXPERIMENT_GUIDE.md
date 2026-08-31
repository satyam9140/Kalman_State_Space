# Kalman ECG Experiment — Quick Viva Guide

## 1. Aim

To model an ECG signal in state-space form and use a Kalman filter to estimate the hidden signal while automatically selecting reasonable starting values for process noise `Q` and measurement noise `R`.

## 2. Basic state-space model

`x(k) = A x(k-1) + B u(k) + w(k)`

`z(k) = C x(k) + v(k)`

- `x(k)`: hidden state
- `u(k)`: known input
- `w(k)`: process noise, covariance `Q`
- `z(k)`: measured ECG
- `v(k)`: measurement noise, variance `R`

## 3. Why use 2 states?

The default model is:

`x = [level, slope]ᵀ`

For a constant-velocity model:

`A = [[1, dt], [0, 1]]`

`B = [[dt²/2], [dt]]`

`C = [1, 0]`

This lets the filter remember both the current ECG level and its trend.

## 4. What are Q and R?

- **Q:** how uncertain the state model is. Larger Q allows the state estimate to change more freely.
- **R:** how uncertain the ECG measurement is. Larger R makes the filter trust the measurement less.

There is no universal correct Q/R pair. They depend on the signal, model, units, and sampling interval.

## 5. How this project estimates Q and R

A Savitzky–Golay smooth is used as a local signal baseline.

- `R ≈ variance(raw - SG smooth)`
- For 1 state, Q is based on first-difference dynamics.
- For 2 states, Q is based on second-difference (acceleration) dynamics.
- For 3 states, Q is based on third-difference (jerk) dynamics.

The resulting scalar process-noise estimate is converted into a discrete covariance matrix `Q` using the selected model's input vector.

## 6. Kalman algorithm

### Prediction

`x⁻(k) = A x(k-1) + B u(k)`

`P⁻(k) = A P(k-1) Aᵀ + Q`

### Gain

`K(k) = P⁻ Cᵀ (C P⁻ Cᵀ + R)⁻¹`

### Correction

`x(k) = x⁻(k) + K(k)[z(k) - Cx⁻(k)]`

The quantity `z(k) - Cx⁻(k)` is called the **innovation**.

## 7. What to observe

1. Raw ECG is the measurement.
2. SG smooth is a baseline used for noise estimation.
3. The Kalman prediction comes from the state model.
4. The Kalman correction moves the prediction according to the innovation and gain.
5. Changing Q/R changes the balance between model trust and measurement trust.
6. The 1-state model has no explicit slope; the 2-state model adds slope; the 3-state model adds curvature.

## 8. Validation

If a clean/reference column exists, compare MSE against that reference:

**Raw vs reference → SG vs reference → Kalman vs reference**

Lower MSE is better.

Do not use only the post-update residual or fit MSE as proof of denoising.

## 9. Forced mode

Forced mode is included to teach `B·u(k)` in the state-space equation. The project derives a teaching input from the signal/reference; it is not a measured physical actuator input. Therefore it should not be presented as a real control-system identification result.

## 10. Common viva questions

**Why is a Kalman filter needed?**  
To estimate a hidden state from noisy measurements while using a model of how the state evolves.

**What does Q represent?**  
Process/model uncertainty.

**What does R represent?**  
Measurement uncertainty.

**What happens if R increases?**  
The filter generally trusts the measurement less and relies more on the model.

**What happens if Q increases?**  
The filter generally allows more model uncertainty and adapts more readily to measurements.

**What is Kalman gain?**  
It determines how strongly the measurement changes the predicted state.

**What is innovation?**  
Measurement minus predicted measurement.

**What is the difference between prediction and correction?**  
Prediction uses the state model; correction uses the new measurement.

**Why use Savitzky–Golay?**  
It provides a local smooth baseline while preserving signal shape better than a simple moving average in many cases.

**Why is the reference column not used to create the filter output?**  
Because it should be kept as an independent validation target when it represents a clean signal.
