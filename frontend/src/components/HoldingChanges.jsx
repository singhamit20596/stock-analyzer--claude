import React, { useCallback, useEffect, useState } from 'react';
import { History, Plus, Minus, TrendingUp, TrendingDown, Tag, Flag } from 'lucide-react';

// How each kind of change reads. OPENING is the balance written when change
// tracking began — the position already existed, it was not bought that day.
const KINDS = {
  ADDED:     { label: 'Added',     icon: Plus,         tone: 'text-emerald-400', ring: 'border-emerald-500/30 bg-emerald-500/10' },
  REMOVED:   { label: 'Removed',   icon: Minus,        tone: 'text-rose-400',    ring: 'border-rose-500/30 bg-rose-500/10' },
  INCREASED: { label: 'Increased', icon: TrendingUp,   tone: 'text-emerald-400', ring: 'border-emerald-500/30 bg-emerald-500/10' },
  DECREASED: { label: 'Decreased', icon: TrendingDown, tone: 'text-amber-400',   ring: 'border-amber-500/30 bg-amber-500/10' },
  REPRICED:  { label: 'Avg cost',  icon: Tag,          tone: 'text-sky-400',     ring: 'border-sky-500/30 bg-sky-500/10' },
  OPENING:   { label: 'Opening',   icon: Flag,         tone: 'text-slate-400',   ring: 'border-slate-600/40 bg-slate-700/20' },
};

const num = (n, d = 2) => n == null ? '—'
  : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d });

const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
};

export default function HoldingChanges({ accountId, currencySymbol = '₹', refreshKey }) {
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/changes`);
      if (res.ok) setChanges((await res.json()).changes || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [accountId, refreshKey]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  if (!changes.length) {
    return (
      <div className="glass-panel rounded-2xl border border-slate-800 p-5">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" /> Change history
        </h3>
        <p className="text-xs text-slate-500 mt-2">
          Nothing recorded yet. Each import from here on logs only what actually
          moved — stocks added, removed, or with a changed quantity or average cost.
        </p>
      </div>
    );
  }

  const shown = expanded ? changes : changes.slice(0, 12);

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
      <div className="p-5 pb-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" /> Change history
        </h3>
        <p className="text-[10px] text-slate-500 mt-0.5">
          What each import changed. Holdings that did not move are not re-written,
          so the performance chart can value each day with the quantities held then.
        </p>
      </div>

      <div className="divide-y divide-slate-800/60">
        {shown.map((c) => {
          const kind = KINDS[c.change_type] || KINDS.OPENING;
          const Icon = kind.icon;
          const delta = c.quantity_delta;
          return (
            <div key={c.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-800/30">
              <span className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${kind.ring}`}>
                <Icon className={`w-3 h-3 ${kind.tone}`} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-100">{c.symbol}</span>
                  <span className={`text-[10px] font-semibold ${kind.tone}`}>{kind.label}</span>
                  <span className="text-[10px] text-slate-600 truncate">{c.company_name}</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {c.change_type === 'REPRICED'
                    ? `avg cost ${currencySymbol}${num(c.avg_price_before)} → ${currencySymbol}${num(c.avg_price_after)}`
                    : `${num(c.quantity_before, 4)} → ${num(c.quantity_after, 4)} units`}
                  {c.avg_price_after != null && c.change_type !== 'REPRICED' && (
                    <span className="text-slate-600"> · avg {currencySymbol}{num(c.avg_price_after)}</span>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                {delta !== 0 && c.change_type !== 'REPRICED' && (
                  <div className={`text-xs font-bold ${delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {delta > 0 ? '+' : ''}{num(delta, 4)}
                  </div>
                )}
                <div className="text-[9px] text-slate-600">{when(c.changed_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {changes.length > 12 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200
                     hover:bg-slate-800/40 border-t border-slate-800 transition-colors"
        >
          {expanded ? 'Show less' : `Show all ${changes.length} changes`}
        </button>
      )}
    </div>
  );
}
