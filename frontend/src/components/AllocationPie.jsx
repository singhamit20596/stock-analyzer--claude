import React from 'react';

// A donut chart drawn as SVG arcs — avoids pulling in a charting dependency
// for what is a handful of slices.
const PALETTE = [
  '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4',
  '#8b5cf6', '#ef4444', '#84cc16', '#f97316', '#14b8a6',
];

const R = 60;
const THICKNESS = 26;

function arcPath(startFrac, endFrac) {
  const toXY = (frac, radius) => {
    // Start at 12 o'clock and sweep clockwise.
    const angle = 2 * Math.PI * frac - Math.PI / 2;
    return [80 + radius * Math.cos(angle), 80 + radius * Math.sin(angle)];
  };
  const inner = R - THICKNESS;
  const [x1, y1] = toXY(startFrac, R);
  const [x2, y2] = toXY(endFrac, R);
  const [x3, y3] = toXY(endFrac, inner);
  const [x4, y4] = toXY(startFrac, inner);
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

export default function AllocationPie({ title, subtitle, data }) {
  const entries = (data || []).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  const total = entries.reduce((s, d) => s + d.value, 0);

  if (total <= 0) {
    return (
      <div className="glass-panel p-5 rounded-2xl border border-slate-800">
        <h4 className="text-sm font-bold text-slate-200">{title}</h4>
        <p className="text-xs text-slate-500 mt-6 text-center">No data</p>
      </div>
    );
  }

  let cursor = 0;
  const slices = entries.map((d, i) => {
    const frac = d.value / total;
    const slice = {
      ...d,
      color: PALETTE[i % PALETTE.length],
      percent: frac * 100,
      // A single 100% slice cannot be drawn as an arc (start === end), so
      // render it as a full ring instead.
      path: frac >= 0.999 ? null : arcPath(cursor, cursor + frac),
    };
    cursor += frac;
    return slice;
  });

  const fmt = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div className="glass-panel p-5 rounded-2xl border border-slate-800">
      <h4 className="text-sm font-bold text-slate-200">{title}</h4>
      {subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}

      <div className="flex items-center gap-5 mt-3">
        <svg viewBox="0 0 160 160" className="w-[132px] h-[132px] shrink-0">
          {slices.map(s => s.path === null ? (
            <circle
              key={s.label} cx="80" cy="80" r={R - THICKNESS / 2}
              fill="none" stroke={s.color} strokeWidth={THICKNESS}
            />
          ) : (
            <path key={s.label} d={s.path} fill={s.color}>
              <title>{`${s.label}: ${s.percent.toFixed(1)}% (${fmt(s.value)})`}</title>
            </path>
          ))}
          <text
            x="80" y="76" textAnchor="middle"
            className="fill-slate-400" style={{ fontSize: 9, fontWeight: 600 }}
          >
            TOTAL
          </text>
          <text
            x="80" y="90" textAnchor="middle"
            className="fill-slate-100" style={{ fontSize: 13, fontWeight: 700 }}
          >
            {total >= 1e7
              ? `₹${(total / 1e7).toFixed(2)}Cr`
              : `₹${(total / 1e5).toFixed(1)}L`}
          </text>
        </svg>

        <div className="flex-1 min-w-0 space-y-1.5">
          {slices.map(s => (
            <div key={s.label} className="flex items-center gap-2 text-[11px]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-slate-300 truncate flex-1">{s.label}</span>
              <span className="font-bold text-slate-100 tabular-nums">{s.percent.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
