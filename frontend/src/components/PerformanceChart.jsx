import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, Activity } from 'lucide-react';

const RANGES = [
  { id: '1mo', label: '1M' },
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: '1y', label: '1Y' },
];

// Portfolio first and thickest — it is the subject, the indices are context.
const LINES = [
  { key: 'portfolio', color: '#818cf8', width: 2.5 },
  { key: 'nifty50', color: '#34d399', width: 1.4 },
  { key: 'nasdaq', color: '#fbbf24', width: 1.4 },
  { key: 'sp500', color: '#f472b6', width: 1.4 },
];

const W = 820;
const H = 280;
const PAD = { top: 16, right: 16, bottom: 26, left: 46 };

const fmtInr = (n) => n == null ? '—' :
  `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export default function PerformanceChart({ portfolioId }) {
  const [range, setRange] = useState('3mo');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const fetchHistory = useCallback(async () => {
    if (!portfolioId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/history?range=${range}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [portfolioId, range]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const panel = (children) => (
    <div className="glass-panel rounded-2xl border border-slate-800 p-5">{children}</div>
  );

  if (loading) return panel(
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-xs">Loading price history...</p>
    </div>
  );

  if (!data || !data.dates?.length) return panel(
    <div className="py-10 text-center text-slate-400 text-sm">
      <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-600" />
      {data?.warnings?.[0] || 'No price history available.'}
    </div>
  );

  const { dates, series, coverage, warnings } = data;
  const present = LINES.filter(l => series[l.key]?.indexed?.some(v => v != null));

  const all = present.flatMap(l => series[l.key].indexed).filter(v => v != null);
  const lo = Math.min(...all, 100);
  const hi = Math.max(...all, 100);
  const span = hi - lo || 1;
  const yLo = lo - span * 0.08;
  const yHi = hi + span * 0.08;

  const x = (i) => PAD.left + (i / Math.max(dates.length - 1, 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - yLo) / (yHi - yLo)) * (H - PAD.top - PAD.bottom);

  const path = (values) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'} ${x(i).toFixed(2)} ${y(v).toFixed(2)} `;
      pen = true;
    });
    return d.trim();
  };

  // Gridlines on round percentage moves.
  const ticks = [];
  const step = span > 40 ? 20 : span > 20 ? 10 : span > 8 ? 5 : 2;
  for (let t = Math.ceil(yLo / step) * step; t <= yHi; t += step) ticks.push(t);

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (px - PAD.left) / (W - PAD.left - PAD.right);
    const i = Math.round(ratio * (dates.length - 1));
    setHover(i >= 0 && i < dates.length ? i : null);
  };

  const labelEvery = Math.max(1, Math.ceil(dates.length / 7));

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
      <div className="p-5 pb-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-400" />
            Performance vs Benchmarks
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            All lines rebased to 100 at {shortDate(dates[0])}. Portfolio valued in ₹ at each day's close.
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                range === r.id
                  ? 'bg-indigo-500 text-white'
                  : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Day-on-day moves live in their own section — see DailyChangeTable. */}

      {/* Chart */}
      <div className="px-2 pb-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 'auto' }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map(t => (
            <g key={t}>
              <line
                x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                stroke={Math.abs(t - 100) < 0.01 ? '#475569' : '#1e293b'}
                strokeWidth="1"
                strokeDasharray={Math.abs(t - 100) < 0.01 ? '' : '3 3'}
              />
              <text
                x={PAD.left - 7} y={y(t) + 3} textAnchor="end"
                fill="#64748b" style={{ fontSize: 9 }}
              >
                {t > 100 ? '+' : ''}{(t - 100).toFixed(0)}%
              </text>
            </g>
          ))}

          {dates.map((d, i) => i % labelEvery === 0 && (
            <text
              key={d} x={x(i)} y={H - 8} textAnchor="middle"
              fill="#64748b" style={{ fontSize: 9 }}
            >
              {shortDate(d)}
            </text>
          ))}

          {present.map(l => (
            <path
              key={l.key}
              d={path(series[l.key].indexed)}
              fill="none"
              stroke={l.color}
              strokeWidth={l.width}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {hover != null && (
            <>
              <line
                x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom}
                stroke="#475569" strokeWidth="1"
              />
              {present.map(l => {
                const v = series[l.key].indexed[hover];
                return v == null ? null : (
                  <circle key={l.key} cx={x(hover)} cy={y(v)} r="3.5"
                          fill={l.color} stroke="#020617" strokeWidth="1.5" />
                );
              })}
            </>
          )}
        </svg>
      </div>

      {/* Legend / readout */}
      <div className="px-5 pb-4 pt-1 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-800/70 mt-1">
        {present.map(l => {
          const s = series[l.key];
          const shown = hover != null ? s.indexed[hover] : [...s.indexed].reverse().find(v => v != null);
          const change = shown == null ? null : shown - 100;
          return (
            <div key={l.key} className="flex items-center gap-2 text-[11px] pt-2">
              <span className="w-3 h-[3px] rounded-full shrink-0" style={{ background: l.color }} />
              <span className="text-slate-300">{s.label}</span>
              <span className={`font-bold tabular-nums ${
                change == null ? 'text-slate-500' : change >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}
              </span>
              {l.key === 'portfolio' && s.values_inr && (
                <span className="text-slate-500">
                  ({fmtInr(hover != null ? s.values_inr[hover] : s.values_inr[s.values_inr.length - 1])})
                </span>
              )}
            </div>
          );
        })}
        <span className="text-[10px] text-slate-600 ml-auto pt-2">
          {hover != null ? dates[hover] : `${coverage.priced}/${coverage.total} holdings priced`}
        </span>
      </div>

      {warnings?.length > 0 && (
        <div className="px-5 pb-4 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-500/80 flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0 mt-px" /> <span>{w}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
