/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const AnimationContext = createContext(null);

export function useAnimation() {
  const ctx = useContext(AnimationContext);
  if (!ctx) throw new Error('useAnimation must be used inside AnimationProvider');
  return ctx;
}

export function AnimationProvider({ children }) {
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [speed, setSpeed] = useState(30); // steps per second
  const rafRef = useRef(null);
  const lastRef = useRef(null);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((v) => !v), []);
  const stepTo = useCallback((i) => setIndex((old) => {
    const n = Number.isFinite(Number(i)) ? Number(i) : old;
    if (n < start) return start;
    if (n > end) return end;
    return n;
  }), [start, end]);
  const stepForward = useCallback(() => setIndex((i) => Math.min(end, i + 1)), [end]);
  const stepBackward = useCallback(() => setIndex((i) => Math.max(start, i - 1)), [start]);

  const setRange = useCallback(({ start: s = 0, end: e = 0, autoPlay = false, resetIndex = true } = {}) => {
    const nextStart = Number.isFinite(Number(s)) ? Number(s) : 0;
    const nextEnd = Math.max(nextStart, Number.isFinite(Number(e)) ? Number(e) : 0);
    setStart(nextStart);
    setEnd(nextEnd);
    setIndex((old) => {
      if (resetIndex) return nextStart;
      return Math.max(nextStart, Math.min(nextEnd, old));
    });
    if (autoPlay) setPlaying(true);
  }, []);

  const updateSpeed = useCallback((s) => setSpeed(Math.max(1, Math.min(240, Number(s) || 1))), []);

  // drive RAF-based stepping using speed (steps per second)
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        lastRef.current = null;
      }
      return;
    }

    function tick(now) {
      if (!lastRef.current) lastRef.current = now;
      const delta = now - lastRef.current;
      const stepDuration = 1000 / Math.max(1, speed);
      if (delta >= stepDuration) {
        setIndex((i) => {
          const next = i + Math.floor(delta / stepDuration);
          if (next >= end) {
            setPlaying(false);
            return end;
          }
          return next;
        });
        lastRef.current = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
    };
  }, [playing, speed, end]);

  const value = useMemo(() => ({
    playing,
    play,
    pause,
    toggle,
    index,
    setIndex: stepTo,
    stepForward,
    stepBackward,
    speed,
    setSpeed: updateSpeed,
    start,
    end,
    setRange,
  }), [playing, play, pause, toggle, index, stepTo, stepForward, stepBackward, speed, updateSpeed, start, end, setRange]);

  return (
    <AnimationContext.Provider value={value}>
      {children}
    </AnimationContext.Provider>
  );
}
