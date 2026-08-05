import React, { useState, useEffect, useCallback } from 'react';
import { Target, Plus, Trash2, Edit2, X, AlertCircle, ArrowRight, Check, ChevronRight } from 'lucide-react';

const MARKETS = [
  { id: 'IND', label: '🇮🇳 India' },
  { id: 'US', label: '🇺🇸 United States' },
];

const fmt = (n) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const emptyRules = () => ({
  IND: { sector: {}, section: {} },
  US: { sector: {}, section: {} },
});

// ─── Target editor ────────────────────────────────────────────────────────────
function TargetEditor({ sectors, sections, existing, onClose, onSave }) {
  const [name, setName] = useState(existing?.name || '');
  const [indPercent, setIndPercent] = useState(existing?.ind_percent ?? 50);
  const [cash, setCash] = useState({
    IND: existing?.ind_cash_percent ?? 0,
    US: existing?.us_cash_percent ?? 0,
  });
  const [rules, setRules] = useState(() => {
    const base = emptyRules();
    if (existing?.rules) {
      for (const m of ['IND', 'US']) {
        base[m].sector = { ...(existing.rules[m]?.sector || {}) };
        base[m].section = { ...(existing.rules[m]?.section || {}) };
      }
    }
    return base;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const setRule = (market, dim, key, value) => {
    setRules(prev => ({
      ...prev,
      [market]: { ...prev[market], [dim]: { ...prev[market][dim], [key]: value } },
    }));
  };

  const sum = (market, dim) =>
    Object.values(rules[market][dim]).reduce((s, v) => s + (Number(v) || 0), 0);

  const handleSave = async () => {
    if (!name.trim()) { setError('Target name is required'); return; }
    for (const m of ['IND', 'US']) {
      for (const dim of ['sector', 'section']) {
        const total = sum(m, dim);
        if (total > 0 && Math.abs(total - 100) > 0.5) {
          setError(`${m} ${dim} percentages add to ${total.toFixed(1)}% — must be 100% (or all blank to skip).`);
          return;
        }
      }
    }
    setSaving(true);
    setError('');
    const err = await onSave({
      name: name.trim(),
      ind_percent: Number(indPercent),
      ind_cash_percent: Number(cash.IND) || 0,
      us_cash_percent: Number(cash.US) || 0,
      rules,
    }, existing?.id);
    setSaving(false);
    if (err) setError(err);
  };

  const PctInput = ({ value, onChange }) => (
    <input
      type="number" min="0" max="100" step="0.5"
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-right text-slate-100 font-semibold focus:outline-none focus:border-indigo-500"
    />
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className="glass-panel max-w-3xl w-full my-8 rounded-2xl border border-slate-700 shadow-2xl">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-950/95 rounded-t-2xl z-10">
          <h3 className="text-base font-bold text-slate-100 flex items-center">
            <Target className="w-5 h-5 mr-2 text-indigo-400" />
            {existing ? 'Edit Target' : 'New Target Portfolio'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1.5">1 · Target Name</label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="e.g. 2027 Allocation Plan"
              autoFocus
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 font-bold text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-2">2 · India : US Split</label>
            <div className="flex items-center gap-4">
              <input
                type="range" min="0" max="100" step="1"
                value={indPercent}
                onChange={e => setIndPercent(Number(e.target.value))}
                className="flex-1 accent-indigo-500"
              />
              <span className="text-sm font-bold text-slate-100 tabular-nums whitespace-nowrap">
                🇮🇳 {indPercent}% : {100 - indPercent}% 🇺🇸
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Share of total money (invested + cash) in each market.</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-2">3 · Cash Position per Market</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {MARKETS.map(m => (
                <div key={m.id} className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2.5">
                  <span className="text-xs font-semibold text-slate-300">{m.label}</span>
                  <div className="flex items-center gap-1.5">
                    <PctInput value={cash[m.id]} onChange={v => setCash(c => ({ ...c, [m.id]: v }))} />
                    <span className="text-xs text-slate-500">% cash</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Cash as a share of that market's money. 20% means a 20 : 80 cash-to-invested ratio.</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-2">4 · Sector &amp; Section Split per Market</label>
            <p className="text-[10px] text-slate-500 mb-3">
              Percentages of that market's <em>invested</em> money. Leave a whole group blank to skip it; otherwise it must total 100%.
            </p>

            <div className="space-y-5">
              {MARKETS.map(m => (
                <div key={m.id} className="border border-slate-800 rounded-xl overflow-hidden">
                  <div className="bg-slate-900/70 px-4 py-2 text-xs font-bold text-slate-200">{m.label}</div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                      { dim: 'sector', keys: sectors, label: 'Sectors' },
                      { dim: 'section', keys: sections, label: 'Sections' },
                    ].map(({ dim, keys, label }) => {
                      const total = sum(m.id, dim);
                      const ok = total === 0 || Math.abs(total - 100) <= 0.5;
                      return (
                        <div key={dim}>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{label}</span>
                            <span className={`text-[10px] font-bold ${ok ? 'text-slate-500' : 'text-amber-400'}`}>
                              {total.toFixed(1)}%
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {keys.map(k => (
                              <div key={k} className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-slate-400 truncate">{k}</span>
                                <PctInput
                                  value={rules[m.id][dim][k]}
                                  onChange={v => setRule(m.id, dim, k, v)}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> <span>{error}</span>
            </p>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-between items-center sticky bottom-0 bg-slate-950/95 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
            <span>{existing ? 'Update Target' : 'Create Target'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Diff table ───────────────────────────────────────────────────────────────
// `expandable` turns each bucket row into a toggle that reveals the stocks
// inside it, with an equal-weighted per-stock target.
function DiffTable({ title, note, lines, expandable = false }) {
  const [open, setOpen] = useState({});
  const rows = (lines || []).filter(l => l.target_percent != null || l.current_inr > 0);
  if (rows.length === 0) return null;

  const colSpan = 6;

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/60">
        <h4 className="text-xs font-bold text-slate-200">{title}</h4>
        {note && <p className="text-[10px] text-slate-500 mt-0.5">{note}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-900/40 border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 px-4">Bucket</th>
              <th className="py-2.5 px-4 text-right">Current</th>
              <th className="py-2.5 px-4 text-right">Current %</th>
              <th className="py-2.5 px-4 text-right">Target %</th>
              <th className="py-2.5 px-4 text-right">Target ₹</th>
              <th className="py-2.5 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {rows.map(l => {
              const untargeted = l.target_percent == null;
              const over = l.delta_inr > 0;
              // Under half a percent is noise, not a trade worth making.
              const onTarget = !untargeted && Math.abs(l.delta_percent) < 0.5;
              const stocks = l.stocks || [];
              const canExpand = expandable && stocks.length > 0;
              const isOpen = !!open[l.key];

              return (
                <React.Fragment key={l.key}>
                  <tr
                    className={`hover:bg-slate-800/30 ${canExpand ? 'cursor-pointer' : ''}`}
                    onClick={canExpand ? () => setOpen(o => ({ ...o, [l.key]: !o[l.key] })) : undefined}
                  >
                    <td className="py-2.5 px-4 font-bold text-slate-100">
                      <span className="flex items-center gap-1.5">
                        {canExpand && (
                          <ChevronRight className={`w-3 h-3 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        )}
                        {l.key}
                        {canExpand && (
                          <span className="text-[9px] font-semibold text-slate-500">
                            ({stocks.length})
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-300">{fmt(l.current_inr)}</td>
                    <td className="py-2.5 px-4 text-right text-slate-300">{l.current_percent}%</td>
                    <td className="py-2.5 px-4 text-right text-slate-400">
                      {untargeted ? <span className="text-slate-600">not set</span> : `${l.target_percent}%`}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-400">
                      {untargeted ? <span className="text-slate-600">—</span> : fmt(l.target_inr)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {untargeted ? (
                        <span className="text-slate-600">—</span>
                      ) : onTarget ? (
                        <span className="text-[10px] font-bold text-emerald-400">On target</span>
                      ) : (
                        <div>
                          <span className={`font-bold ${over ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {over ? 'REDUCE' : 'ADD'} {fmt(Math.abs(l.delta_inr))}
                          </span>
                          <div className={`text-[10px] ${over ? 'text-rose-500/80' : 'text-emerald-500/80'}`}>
                            {over ? '+' : ''}{l.delta_percent}% vs target
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>

                  {canExpand && isOpen && (
                    <tr className="bg-slate-900/40">
                      <td colSpan={colSpan} className="px-4 py-3">
                        <p className="text-[10px] text-slate-500 mb-2">
                          Equal-weighted target inside {l.key}
                          {l.target_percent != null && ` — ${fmt(l.target_inr)} across ${stocks.length} stock${stocks.length === 1 ? '' : 's'}`}.
                          Percentages are share of the bucket.
                        </p>
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead>
                            <tr className="text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800">
                              <th className="py-1.5 pr-3">Stock</th>
                              <th className="py-1.5 px-2 text-right">Current</th>
                              <th className="py-1.5 px-2 text-right">Current %</th>
                              <th className="py-1.5 px-2 text-right">Target %</th>
                              <th className="py-1.5 px-2 text-right">Target ₹</th>
                              <th className="py-1.5 pl-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/40">
                            {stocks.map(s => {
                              const sOver = s.delta_inr > 0;
                              const sOnTarget = s.target_inr != null
                                && Math.abs(s.delta_inr) < Math.max(s.target_inr * 0.02, 500);
                              return (
                                <tr key={s.symbol}>
                                  <td className="py-1.5 pr-3">
                                    <span className="font-bold text-slate-200">{s.symbol}</span>
                                    <span className="text-slate-500 ml-2 truncate">{s.company_name}</span>
                                  </td>
                                  <td className="py-1.5 px-2 text-right text-slate-300">{fmt(s.current_inr)}</td>
                                  <td className="py-1.5 px-2 text-right text-slate-300">{s.current_percent}%</td>
                                  <td className="py-1.5 px-2 text-right text-slate-400">
                                    {s.target_percent == null ? '—' : `${s.target_percent}%`}
                                  </td>
                                  <td className="py-1.5 px-2 text-right text-slate-400">
                                    {s.target_inr == null ? '—' : fmt(s.target_inr)}
                                  </td>
                                  <td className="py-1.5 pl-2 text-right">
                                    {s.delta_inr == null ? (
                                      <span className="text-slate-600">—</span>
                                    ) : sOnTarget ? (
                                      <span className="text-[9px] font-bold text-emerald-400">On target</span>
                                    ) : (
                                      <span className={`font-bold ${sOver ? 'text-rose-400' : 'text-emerald-400'}`}>
                                        {sOver ? 'REDUCE' : 'ADD'} {fmt(Math.abs(s.delta_inr))}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function RebalanceView() {
  const [meta, setMeta] = useState({ sectors: [], sections: [], targets: [] });
  const [portfolios, setPortfolios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const [targetId, setTargetId] = useState('');
  const [portfolioId, setPortfolioId] = useState('');
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, pRes] = await Promise.all([
        fetch('/api/targets'),
        fetch('/api/portfolios'),
      ]);
      if (tRes.ok) {
        const data = await tRes.json();
        setMeta(data);
        setTargetId(prev => (data.targets.some(t => t.id === prev) ? prev : data.targets[0]?.id || ''));
      }
      if (pRes.ok) {
        const data = await pRes.json();
        setPortfolios(data);
        setPortfolioId(prev => (data.some(p => p.id === prev) ? prev : data[0]?.id || ''));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!targetId || !portfolioId) { setDiff(null); return; }
    let cancelled = false;
    (async () => {
      setDiffLoading(true);
      try {
        const res = await fetch(`/api/targets/${targetId}/compare?portfolio_id=${portfolioId}`);
        if (res.ok && !cancelled) setDiff(await res.json());
      } catch (e) { console.error(e); }
      finally { if (!cancelled) setDiffLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [targetId, portfolioId]);

  const handleSave = async (payload, existingId) => {
    try {
      const res = await fetch(existingId ? `/api/targets/${existingId}` : '/api/targets', {
        method: existingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.detail || 'Could not save the target.';
      }
      const saved = await res.json();
      setShowEditor(false);
      setEditing(null);
      await fetchAll();
      setTargetId(saved.id);
      return null;
    } catch (e) {
      return 'Could not reach the server.';
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/targets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteConfirm(null);
        if (targetId === id) setTargetId('');
        await fetchAll();
      }
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-4">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium">Loading targets...</p>
    </div>
  );

  const selectedTarget = meta.targets.find(t => t.id === targetId);

  return (
    <div className="space-y-5">
      <div className="glass-panel p-5 rounded-2xl border border-slate-800">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center">
              <Target className="w-5 h-5 mr-2 text-indigo-400" /> Target Rebalancing
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Define the shape you want, then compare any portfolio against it.
            </p>
          </div>
          <button
            onClick={() => { setEditing(null); setShowEditor(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>New Target</span>
          </button>
        </div>

        {meta.targets.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mt-5">
            <div className="flex-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Target</label>
              <div className="flex gap-2">
                <select
                  value={targetId}
                  onChange={e => setTargetId(e.target.value)}
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-indigo-500"
                >
                  {meta.targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {selectedTarget && (
                  <>
                    <button
                      onClick={() => { setEditing(selectedTarget); setShowEditor(true); }}
                      className="px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
                      title="Edit target"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(selectedTarget)}
                      className="px-3 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400"
                      title="Delete target"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="hidden sm:flex items-end pb-3">
              <ArrowRight className="w-4 h-4 text-slate-600" />
            </div>

            <div className="flex-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Compare Against Portfolio</label>
              <select
                value={portfolioId}
                onChange={e => setPortfolioId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-indigo-500"
              >
                {portfolios.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.account_count} accts)</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {meta.targets.length === 0 && (
        <div className="glass-panel p-12 rounded-2xl border border-dashed border-slate-700 text-center space-y-4">
          <Target className="w-12 h-12 text-slate-600 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-300">No Targets Yet</h3>
            <p className="text-xs text-slate-500 mt-1">
              Create a target to describe the India/US split, cash ratio, and sector/section mix you want.
            </p>
          </div>
          <button
            onClick={() => setShowEditor(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>Create Your First Target</span>
          </button>
        </div>
      )}

      {diffLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-3">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs">Comparing...</p>
        </div>
      )}

      {!diffLoading && diff && (
        <div className="space-y-4">
          <div className="glass-panel p-4 rounded-2xl border border-slate-800">
            <p className="text-xs text-slate-400">
              <span className="font-bold text-slate-100">{diff.target_name}</span>
              <ArrowRight className="w-3 h-3 inline mx-2 text-slate-600" />
              <span className="font-bold text-slate-100">{diff.portfolio_name}</span>
              <span className="text-slate-500"> · total money {fmt(diff.total_money_inr)}</span>
            </p>
          </div>

          <DiffTable
            title="Market Split"
            note="Share of total money (invested + cash) in each market."
            lines={diff.market}
          />
          <DiffTable
            title="Cash Position"
            note="Cash as a share of that market's own money."
            lines={diff.cash}
          />

          {MARKETS.map(m => {
            const b = diff.breakdown[m.id];
            const dimLabel = b.dimension === 'sector' ? 'Sectors' : 'Sections';
            return (
              <DiffTable
                key={m.id}
                title={`${m.label} · ${dimLabel}`}
                note={`Share of ${m.id} invested money (${fmt(diff.invested_inr[m.id])}). Click a row for the stocks inside it.`}
                lines={b.lines}
                expandable
              />
            );
          })}
        </div>
      )}

      {showEditor && (
        <TargetEditor
          sectors={meta.sectors}
          sections={meta.sections}
          existing={editing}
          onClose={() => { setShowEditor(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-sm w-full p-6 rounded-2xl border border-rose-500/30 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">Delete "{deleteConfirm.name}"?</h3>
                <p className="text-xs text-slate-400 mt-0.5">This removes the target only. Your holdings are not affected.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold"
              >
                Delete Target
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
