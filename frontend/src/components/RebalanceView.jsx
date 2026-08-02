import React, { useState, useEffect, useCallback } from 'react';
import {
  PieChart, Save, AlertCircle, CheckCircle2, ArrowUpRight, ArrowDownRight,
  MinusCircle, Plus, RefreshCw, Trash2
} from 'lucide-react';

export default function RebalanceView({ targetAllocations, onSaveTargetAllocation, onDeleteTargetAllocation }) {
  const [targets, setTargets] = useState([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [newTargetPct, setNewTargetPct] = useState('');
  const [saving, setSaving] = useState(false);

  const [rebalanceData, setRebalanceData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Mirror the saved allocations into local editable state whenever they change.
  useEffect(() => { setTargets(targetAllocations || []); }, [targetAllocations]);

  const fetchRebalance = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rebalance');
      if (res.ok) setRebalanceData(await res.json());
    } catch (e) {
      console.error('Error fetching rebalance data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRebalance(); }, [fetchRebalance]);

  const handlePctChange = (symbol, val) => {
    setTargets(targets.map(t =>
      t.symbol === symbol ? { ...t, target_percentage: parseFloat(val) || 0 } : t
    ));
  };

  const handleAddTarget = () => {
    const sym = newSymbol.trim().toUpperCase();
    const pct = parseFloat(newTargetPct);
    if (!sym || isNaN(pct)) return;
    if (targets.some(t => t.symbol === sym)) return;

    setTargets([...targets, { symbol: sym, company_name: sym, target_percentage: pct }]);
    setNewSymbol('');
    setNewTargetPct('');
  };

  const handleRemoveTarget = async (target) => {
    setTargets(targets.filter(t => t.symbol !== target.symbol));
    if (target.id) {
      await onDeleteTargetAllocation(target.id);
      await fetchRebalance();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // The API upserts one allocation at a time, keyed on symbol.
      for (const t of targets) {
        await onSaveTargetAllocation({
          symbol: t.symbol,
          company_name: t.company_name || t.symbol,
          target_percentage: Number(t.target_percentage) || 0,
          asset_class: t.asset_class || 'EQUITY',
        });
      }
      await fetchRebalance();
    } finally {
      setSaving(false);
    }
  };

  const totalTargetPct = targets.reduce((acc, t) => acc + (parseFloat(t.target_percentage) || 0), 0);
  const isValidTarget = Math.abs(totalTargetPct - 100.0) <= 0.5;

  const summary = rebalanceData?.summary || {};
  const matrix = rebalanceData?.matrix || [];
  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  return (
    <div className="space-y-6">

      {/* Target Allocation Editor */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center">
              <PieChart className="w-5 h-5 mr-2 text-indigo-400" /> Target Portfolio Strategy Builder
            </h2>
            <p className="text-xs text-slate-400">
              Define the ideal percentage per stock. Allocations should total 100%.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <span className={`text-xs font-bold px-3 py-1.5 rounded-xl flex items-center border ${
              isValidTarget
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            }`}>
              {isValidTarget
                ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                : <AlertCircle className="w-3.5 h-3.5 mr-1.5" />}
              Total Target: {totalTargetPct.toFixed(1)}%
            </span>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save Strategy'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-2">
          {targets.map((t) => (
            <div key={t.symbol} className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-xs text-slate-200 truncate">{t.symbol}</span>
                <button
                  onClick={() => handleRemoveTarget(t)}
                  className="text-slate-500 hover:text-rose-400 shrink-0"
                  title="Remove target"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center space-x-1">
                <input
                  type="number"
                  step="0.5"
                  value={t.target_percentage}
                  onChange={(e) => handlePctChange(t.symbol, e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-indigo-400 focus:outline-none focus:border-indigo-500"
                />
                <span className="text-xs font-semibold text-slate-400">%</span>
              </div>
            </div>
          ))}

          <div className="bg-slate-950/60 p-3 rounded-xl border border-dashed border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-400">Add Stock</span>
            <div className="flex space-x-1">
              <input
                type="text"
                placeholder="SYMBOL"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTarget()}
                className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-[11px] font-bold text-slate-200 uppercase"
              />
              <input
                type="number"
                placeholder="%"
                value={newTargetPct}
                onChange={(e) => setNewTargetPct(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTarget()}
                className="w-12 bg-slate-900 border border-slate-700 rounded-lg px-1 py-1 text-[11px] font-bold text-indigo-400"
              />
              <button
                onClick={handleAddTarget}
                className="p-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-500">
          Edits apply once you press "Save Strategy". Removing a saved target deletes it immediately.
        </p>
      </div>

      {/* Drift & Rebalancing Matrix */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex justify-between items-center gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Portfolio Drift & Rebalancing Matrix
            </h3>
            <p className="text-xs text-slate-400">
              All accounts · values in ₹ INR · sorted by largest drift
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-xs text-slate-400 font-medium">
              Portfolio Value: {fmt(summary.portfolio_value)}
            </span>
            <button
              onClick={fetchRebalance}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              title="Refresh live prices"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-4">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium">Calculating portfolio drift & rebalancing actions...</p>
          </div>
        ) : matrix.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <PieChart className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm font-bold text-slate-300">Nothing to rebalance yet</p>
            <p className="text-xs text-slate-500">Add holdings and set target percentages above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Stock</th>
                  <th className="py-3.5 px-4 text-right">LTP (₹)</th>
                  <th className="py-3.5 px-4 text-right">Current Value</th>
                  <th className="py-3.5 px-4 text-right">Current %</th>
                  <th className="py-3.5 px-4 text-right">Target %</th>
                  <th className="py-3.5 px-4 text-right">Target Value</th>
                  <th className="py-3.5 px-4 text-right">Drift %</th>
                  <th className="py-3.5 px-4 text-center">Action</th>
                  <th className="py-3.5 px-4 text-right">Trade Amount</th>
                  <th className="py-3.5 px-4 text-right">Est. Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {matrix.map((row) => {
                  const isBuy = row.action === 'BUY';
                  const isSell = row.action === 'SELL';
                  return (
                    <tr key={`${row.symbol}-${row.country}`} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-100 flex items-center gap-1.5">
                          {row.symbol}
                          {row.country === 'US' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              🇺🇸 US
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[180px]">{row.company_name}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-300">{fmt(row.current_price)}</td>
                      <td className="py-3.5 px-4 text-right font-semibold text-slate-100">{fmt(row.current_value)}</td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-300">{row.current_pct}%</td>
                      <td className="py-3.5 px-4 text-right font-bold text-indigo-400">{row.target_pct}%</td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-300">{fmt(row.target_value)}</td>
                      <td className="py-3.5 px-4 text-right">
                        <span className={`font-bold ${
                          row.drift_pct > 0 ? 'text-amber-400' : row.drift_pct < 0 ? 'text-indigo-400' : 'text-slate-400'
                        }`}>
                          {row.drift_pct > 0 ? '+' : ''}{row.drift_pct}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                          isBuy
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : isSell
                            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {isBuy && <ArrowUpRight className="w-3 h-3 mr-1" />}
                          {isSell && <ArrowDownRight className="w-3 h-3 mr-1" />}
                          {!isBuy && !isSell && <MinusCircle className="w-3 h-3 mr-1" />}
                          {row.action}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-100">
                        {row.action !== 'HOLD' ? fmt(row.action_amount) : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-extrabold text-indigo-300">
                        {row.action !== 'HOLD' && row.action_quantity > 0 ? `${row.action_quantity} shares` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
