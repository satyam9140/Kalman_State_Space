import { useEffect, useMemo, useRef, useState } from 'react';
import { downsampleSeries } from '../utils/matrix.js';

const SERIES_COLORS = ['#2563eb', '#e11d48', '#7c3aed', '#0f766e', '#f97316', '#0891b2', '#16a34a', '#dc2626', '#ca8a04', '#db2777', '#9333ea', '#f43f5e'];

function niceNumber(value) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000 || (Math.abs(value) < 0.001 && value !== 0)) return value.toExponential(2);
  return value.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function nearestIndex(values, target) {
  if (!values.length) return 0;
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(values[lo - 1] - target) < Math.abs(values[lo] - target)) return lo - 1;
  return lo;
}

export default function CanvasPlot({
  title,
  description = '',
  xLabel = 'Time step',
  yLabel = 'Value',
  x = [],
  series = [],
  revealIndex = null,
  height = 340,
  maxPoints = 2600,
}) {
  const canvasRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [visibleLines, setVisibleLines] = useState({});

  const allSeries = useMemo(() => series
    .filter((item) => Array.isArray(item.values) && item.values.some(Number.isFinite))
    .map((item, idx) => ({ ...item, color: item.color || SERIES_COLORS[idx % SERIES_COLORS.length] })), [series]);

  const cleanSeries = useMemo(() => allSeries.filter((item) => visibleLines[item.name] !== false), [allSeries, visibleLines]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, height);

    if (!x.length || !cleanSeries.length) {
      ctx.fillStyle = '#111';
      ctx.font = '14px Inter, system-ui, sans-serif';
      ctx.fillText('No data available for this graph', 24, 42);
      return;
    }

    const reveal = Number.isFinite(Number(revealIndex))
      ? Math.min(x.length - 1, Math.max(0, Math.floor(Number(revealIndex))))
      : x.length - 1;
    const margin = { top: 34, right: 28, bottom: 74, left: 88 };
    const w = rect.width;
    const h = height;
    const plotW = Math.max(10, w - margin.left - margin.right);
    const plotH = Math.max(10, h - margin.top - margin.bottom);
    const allY = cleanSeries.flatMap((item) => item.values).filter(Number.isFinite);
    let yMin = Math.min(...allY);
    let yMax = Math.max(...allY);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = -1; yMax = 1; }
    if (Math.abs(yMax - yMin) < 1e-12) { yMax += 1; yMin -= 1; }
    const yPad = (yMax - yMin) * 0.08;
    yMin -= yPad;
    yMax += yPad;
    const xClean = x.filter(Number.isFinite);
    let xMin = Math.min(...xClean);
    let xMax = Math.max(...xClean);
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || Math.abs(xMax - xMin) < 1e-12) { xMin = 0; xMax = Math.max(1, x.length - 1); }
    const mapX = (value) => margin.left + ((value - xMin) / Math.max(1e-12, xMax - xMin)) * plotW;
    const mapY = (value) => margin.top + (1 - (value - yMin) / Math.max(1e-12, yMax - yMin)) * plotH;

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(1, '#f3f7ff');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.font = '12px Inter, system-ui, sans-serif';

    for (let i = 0; i <= 5; i += 1) {
      const y = margin.top + (plotH * i) / 5;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(w - margin.right, y);
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.fillText(niceNumber(yMax - ((yMax - yMin) * i) / 5), 10, y + 4);
    }
    for (let i = 0; i <= 5; i += 1) {
      const xx = margin.left + (plotW * i) / 5;
      ctx.beginPath();
      ctx.moveTo(xx, margin.top);
      ctx.lineTo(xx, h - margin.bottom);
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.fillText(niceNumber(xMin + ((xMax - xMin) * i) / 5), xx - 16, h - 43);
    }

    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);

    cleanSeries.forEach((item) => {
      const raw = x.map((xValue, idx) => ({ x: xValue, y: item.values[idx] })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      const allPoints = downsampleSeries(raw, maxPoints);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      allPoints.forEach((point, idx) => {
        const px = mapX(point.x);
        const py = mapY(point.y);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();

      const revealedRaw = x
        .map((xValue, idx) => ({ x: xValue, y: item.values[idx], idx }))
        .filter((point) => point.idx <= reveal && Number.isFinite(point.x) && Number.isFinite(point.y));
      const points = downsampleSeries(revealedRaw, maxPoints);
      ctx.save();
      ctx.shadowColor = item.color;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.width || 2.6;
      ctx.beginPath();
      points.forEach((point, idx) => {
        const px = mapX(point.x);
        const py = mapY(point.y);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    });

    const activeIndex = hover && hover.index >= 0 ? hover.index : reveal;
    if (activeIndex >= 0 && x[activeIndex] !== undefined) {
      const hx = mapX(x[activeIndex]);
      ctx.strokeStyle = '#111';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, margin.top);
      ctx.lineTo(hx, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      cleanSeries.forEach((item) => {
        const value = item.values[activeIndex];
        if (!Number.isFinite(value)) return;
        ctx.fillStyle = item.color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, mapY(value), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      ctx.fillStyle = '#111';
      ctx.font = '800 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`step ${activeIndex + 1}`, Math.min(w - 42, Math.max(margin.left + 42, hx)), margin.top - 12);
    }

    ctx.fillStyle = '#111';
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(xLabel, margin.left + plotW / 2, h - 12);

    ctx.save();
    ctx.translate(18, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
  }, [x, cleanSeries, revealIndex, height, maxPoints, xLabel, yLabel, hover]);

  function handleMove(event) {
    if (!x.length) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const marginLeft = 88;
    const marginRight = 28;
    const plotW = Math.max(10, rect.width - marginLeft - marginRight);
    const xClean = x.filter(Number.isFinite);
    const xMin = Math.min(...xClean);
    const xMax = Math.max(...xClean);
    const relative = Math.min(1, Math.max(0, (event.clientX - rect.left - marginLeft) / plotW));
    const target = xMin + relative * (xMax - xMin);
    setHover({ index: nearestIndex(x, target) });
  }

  const activeTooltipIndex = hover && x[hover.index] !== undefined
    ? hover.index
    : (Number.isFinite(Number(revealIndex)) ? Math.min(x.length - 1, Math.max(0, Math.floor(Number(revealIndex)))) : null);
  const hoverRows = activeTooltipIndex !== null && x[activeTooltipIndex] !== undefined
    ? cleanSeries.map((item) => ({ name: item.name, color: item.color, value: item.values[activeTooltipIndex] })).filter((row) => Number.isFinite(row.value))
    : [];

  return (
    <section className="plot-card" aria-label={title}>
      <div className="section-title-row compact">
        <h3>{title}</h3>
      </div>
      {description && <p className="graph-purpose">{description}</p>}
      <div className="line-control-box">
        <div className="legend-row line-toggle-row">
          {allSeries.map((item) => (
            <button
              key={item.name}
              type="button"
              className={visibleLines[item.name] !== false ? 'line-toggle active' : 'line-toggle'}
              onClick={() => setVisibleLines((old) => ({ ...old, [item.name]: old[item.name] === false }))}
              aria-pressed={visibleLines[item.name] !== false}
            >
              <i style={{ background: item.color }} />
              {visibleLines[item.name] !== false ? '✓' : '○'} {item.name}
            </button>
          ))}
        </div>
      </div>
      <div className="canvas-wrap">
        <canvas ref={canvasRef} onMouseMove={handleMove} onMouseLeave={() => setHover(null)} style={{ width: '100%', height }} />
        {hoverRows.length > 0 && (
          <div className="plot-tooltip">
            <b>t = {niceNumber(x[activeTooltipIndex])}</b>
            {hoverRows.map((row) => <span key={row.name}><i style={{ background: row.color }} />{row.name}: {niceNumber(row.value)}</span>)}
          </div>
        )}
      </div>
      <div className="graph-label-row" aria-hidden="true">
        <span>X-axis: {xLabel}</span>
        <span>Y-axis: {yLabel}</span>
      </div>
    </section>
  );
}
