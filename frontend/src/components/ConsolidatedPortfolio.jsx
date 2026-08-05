import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Search, Plus,
  Layers, Trash2, X, CheckCircle2, AlertCircle, Edit2, Globe
} from 'lucide-react';
import AllocationPie from './AllocationPie';
import PerformanceChart from './PerformanceChart';

// Current value summed per distinct value of `key`, for the pie charts.
function groupBy(rows, key) {
  const totals = new Map();
  for (const r of rows || []) {
    const label = r[key] || 'Unclassified';
    totals.set(label, (totals.get(label) || 0) + (r.current_value_inr || 0));
  }
  return [...totals].map(([label, value]) => ({ label, value }));
}

// ─── Portfolio Creator Modal ───────────────────────────────────────────────────
function PortfolioCreatorModal({ accounts, existingPortfolio, onClose, onSave }) {
  const [name, setName] = useState(existingPortfolio?.name || '');
  const [selectedIds, setSelectedIds] = useState(existingPortfolio?.account_ids || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Portfolio name is required'); return; }
    if (selectedIds.length === 0) { setError('Select at least one account'); return; }
    setSaving(true);
    setError('');
    await onSave({ name: name.trim(), account_ids: selectedIds }, existingPortfolio?.id);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel max-w-md w-full rounded-2xl border border-slate-700 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-base font-bold text-slate-100 flex items-center">
            <Layers className="w-5 h-5 mr-2 text-indigo-400" />
            {existingPortfolio ? 'Edit Portfolio' : 'Create New Portfolio'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1.5">Portfolio Name</label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Family Portfolio, US Tech..."
              autoFocus
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 font-bold text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-2">Select Accounts to Include</label>
            <div className="space-y-2">
              {accounts.map(acc => (
                <label key={acc.id} className={`flex items-center space-x-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedIds.includes(acc.id)
                    ? 'border-indigo-500/50 bg-indigo-500/10'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-900/40'
                }`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(acc.id)}
                    onChange={() => toggle(acc.id)}
                    className="w-4 h-4 rounded accent-indigo-500"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-100">{acc.name}</p>
                    <p className="text-[10px] text-slate-400">{acc.currency_type === 'US' ? '🇺🇸 US Stocks ($)' : '🇮🇳 Indian Stocks (₹)'}</p>
                  </div>
                  {selectedIds.includes(acc.id) && <CheckCircle2 className="w-4 h-4 text-indigo-400" />}
                </label>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-400 flex items-center space-x-1">
              <AlertCircle className="w-3.5 h-3.5" /> <span>{error}</span>
            </p>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-between items-center">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center space-x-2"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Layers className="w-4 h-4" />}
            <span>{existingPortfolio ? 'Update Portfolio' : 'Create Portfolio'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Portfolio Table View ──────────────────────────────────────────────────────
function PortfolioTableView({ portfolioId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState('current_value_inr');
  const [sortAsc, setSortAsc] = useState(false);
  const [showCompleteOnly, setShowCompleteOnly] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!portfolioId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/detail`);
      if (res.ok) setDetail(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [portfolioId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-4">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium">Computing portfolio across accounts...</p>
    </div>
  );

  if (!detail) return null;

  const { summary, rows, accounts, usd_inr_rate } = detail;
  const isPositive = (summary.total_pnl_inr || 0) >= 0;

  // "Complete" = held in every account of this portfolio. A US-only account
  // can never hold an Indian stock, so only accounts of the row's own market
  // count towards completeness.
  const isComplete = (row) => {
    const eligible = accounts.filter(a =>
      (a.currency_type === 'US' ? 'US' : 'IND') === row.country
    );
    return eligible.length > 0 && eligible.every(a => row.per_account[a.id]);
  };

  const filtered = (rows || []).filter(r => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = r.symbol.toLowerCase().includes(term) ||
      r.company_name.toLowerCase().includes(term);
    return matchesSearch && (!showCompleteOnly || isComplete(r));
  });

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
    return sortAsc ? va - vb : vb - va;
  });

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ col }) => sortKey === col
    ? (sortAsc ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />)
    : null;

  const fmt = (n) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;
  const fmtN = (n, d = 2) => n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d });

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className={`glass-panel p-4 rounded-2xl border ${summary.total_wallet_inr > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-800'}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Wallet Balance</p>
          <p className={`text-xl font-bold ${summary.total_wallet_inr > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
            {summary.total_wallet_inr > 0 ? fmt(summary.total_wallet_inr) : '—'}
          </p>
          <span className="text-[10px] text-slate-500">Uninvested Cash (₹)</span>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Total Invested</p>
          <p className="text-xl font-bold text-slate-100">{fmt(summary.total_invested_inr)}</p>
          <span className="text-[10px] text-slate-500">All in ₹ INR</span>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <div className="flex justify-between items-center mb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Current Value</p>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center">
              <Globe className="w-2.5 h-2.5 mr-1" /> Live
            </span>
          </div>
          <p className="text-xl font-bold text-white">{fmt(summary.total_current_inr)}</p>
          <span className="text-[10px] text-slate-500">1 USD = ₹{usd_inr_rate}</span>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Overall P&L</p>
          <p className={`text-xl font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isPositive ? '+' : ''}{fmt(summary.total_pnl_inr)}
          </p>
          <span className={`text-[10px] font-bold ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
            {isPositive ? '+' : ''}{summary.total_pnl_percent}%
          </span>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Holdings</p>
          <p className="text-xl font-bold text-indigo-400">{summary.total_stocks}</p>
          <span className="text-[10px] text-slate-500">{accounts.length} Accounts</span>
        </div>
      </div>

      {/* Ratios */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Invested : Cash</p>
          <p className="text-lg font-bold text-slate-100">{summary.invested_to_cash_ratio || '—'}</p>
          <span className="text-[10px] text-slate-500">
            {summary.invested_to_cash_split} · {fmt(summary.total_invested_inr)} vs {fmt(summary.total_wallet_inr)}
          </span>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">US : India</p>
          <p className="text-lg font-bold text-slate-100">{summary.us_to_ind_ratio || '—'}</p>
          <span className="text-[10px] text-slate-500">
            {summary.us_to_ind_split} · {fmt(summary.us_total_inr)} vs {fmt(summary.ind_total_inr)} (current + wallet)
          </span>
        </div>
      </div>

      {/* Regional Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { label: '🇮🇳 India', metrics: summary.ind_metrics, tone: 'border-emerald-500/20 bg-emerald-500/5' },
          { label: '🇺🇸 United States', metrics: summary.us_metrics, tone: 'border-amber-500/20 bg-amber-500/5' },
        ].map(({ label, metrics, tone }) => {
          if (!metrics) return null;
          const pos = (metrics.pnl || 0) >= 0;
          return (
            <div key={label} className={`glass-panel p-5 rounded-2xl border ${tone}`}>
              <h4 className="text-sm font-bold text-slate-100 mb-4">{label}</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Invested</p>
                  <p className="text-base font-bold text-slate-100">{fmt(metrics.invested)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Current</p>
                  <p className="text-base font-bold text-white">{fmt(metrics.current)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">P&L</p>
                  <p className={`text-base font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pos ? '+' : ''}{fmt(metrics.pnl)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">P&L %</p>
                  <p className={`text-base font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pos ? '+' : ''}{metrics.pnl_percent}%
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Cash Position</p>
                  <p className="text-base font-bold text-amber-400">{fmt(metrics.wallet)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Performance over time */}
      <PerformanceChart portfolioId={portfolioId} />

      {/* Allocation breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AllocationPie
          title="Sector Allocation"
          subtitle="Share of current value, all markets"
          data={groupBy(rows, 'sector')}
        />
        <AllocationPie
          title="Section Allocation"
          subtitle="Share of current value, all markets"
          data={groupBy(rows, 'section')}
        />
      </div>

      {/* Search + Filter */}
      <div className="glass-panel p-3 rounded-2xl border border-slate-800 flex items-center gap-3">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by symbol or company..."
          className="bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none flex-1 min-w-0"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => setShowCompleteOnly(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
            showCompleteOnly
              ? 'bg-indigo-500 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {showCompleteOnly ? 'Showing Complete Only' : 'Complete Holdings Only'}
        </button>
        <span className="text-[10px] text-slate-500 whitespace-nowrap">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* Cross-Account Portfolio Table */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/60">
          <h3 className="text-sm font-bold text-slate-200">All values shown in ₹ INR · USD converted at live rate (₹{usd_inr_rate})</h3>
          <p className="text-xs text-slate-400">Click column headers to sort</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3 sticky left-0 bg-slate-900/80 z-10">Stock</th>
                <th className="py-3 px-3 whitespace-nowrap">Sector</th>
                {/* Per-account columns */}
                {accounts.map(acc => (
                  <React.Fragment key={acc.id}>
                    <th className="py-3 px-2 text-right whitespace-nowrap">
                      <span className="text-indigo-300">{acc.name}</span> Qty
                    </th>
                    <th className="py-3 px-2 text-right whitespace-nowrap">
                      <span className="text-indigo-300">{acc.name}</span> Avg (₹)
                    </th>
                  </React.Fragment>
                ))}
                <th className="py-3 px-3 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort('mkt_price_inr')}>
                  Mkt Price (₹)<SortIcon col="mkt_price_inr" />
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort('portfolio_qty')}>
                  Portfolio Qty<SortIcon col="portfolio_qty" />
                </th>
                <th className="py-3 px-3 text-right">Portfolio Avg (₹)</th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort('invested_value_inr')}>
                  Invested (₹)<SortIcon col="invested_value_inr" />
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort('current_value_inr')}>
                  Current (₹)<SortIcon col="current_value_inr" />
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort('pnl_percent')}>
                  P&L %<SortIcon col="pnl_percent" />
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort('allocation_percent')}>
                  Allocation<SortIcon col="allocation_percent" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {sorted.map((row) => {
                const pnlPos = row.pnl_percent >= 0;
                return (
                  <tr key={`${row.symbol}-${row.currency}`} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3 sticky left-0 bg-slate-950/90">
                      <div className="flex items-center space-x-2">
                        <div>
                          <div className="font-bold text-slate-100">{row.symbol}</div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{row.company_name}</div>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block ${
                            row.country === 'US'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}>
                            {row.country === 'US' ? '🇺🇸 US' : '🇮🇳 IND'}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-slate-300 whitespace-nowrap">
                      {row.sector || <span className="text-slate-600">—</span>}
                    </td>

                    {/* Per-account qty and avg */}
                    {accounts.map(acc => {
                      const entry = row.per_account[acc.id];
                      return (
                        <React.Fragment key={acc.id}>
                          <td className="py-3 px-2 text-right font-medium text-slate-200">
                            {entry ? fmtN(entry.qty, 4) : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="py-3 px-2 text-right font-medium text-slate-300">
                            {entry ? `₹${fmtN(entry.avg_inr)}` : <span className="text-slate-600">—</span>}
                          </td>
                        </React.Fragment>
                      );
                    })}

                    <td className="py-3 px-3 text-right font-bold text-indigo-400">
                      {row.mkt_price_inr > 0 ? `₹${fmtN(row.mkt_price_inr)}` : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-slate-200">
                      {fmtN(row.portfolio_qty, 4)}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-slate-200">
                      ₹{fmtN(row.portfolio_avg_inr)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300 font-medium">
                      {fmt(row.invested_value_inr)}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-slate-100">
                      {fmt(row.current_value_inr)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className={`font-bold ${pnlPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pnlPos ? '+' : ''}{row.pnl_percent}%
                      </span>
                      <div className={`text-[10px] ${pnlPos ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                        {pnlPos ? '+' : ''}{fmt(row.pnl_inr)}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="font-bold text-slate-200">{row.allocation_percent}%</span>
                      <div className="w-full bg-slate-800 rounded-full h-1 mt-1">
                        <div
                          className="bg-indigo-500 h-1 rounded-full"
                          style={{ width: `${Math.min(row.allocation_percent, 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="py-12 text-center text-slate-400 text-sm">No holdings found matching "{searchTerm}"</div>
        )}
      </div>
    </div>
  );
}

// ─── Main ConsolidatedPortfolio Component ─────────────────────────────────────
export default function ConsolidatedPortfolio({ accounts }) {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(null);
  const [showCreator, setShowCreator] = useState(false);
  const [editingPortfolio, setEditingPortfolio] = useState(null);
  const [loadingPortfolios, setLoadingPortfolios] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchPortfolios = useCallback(async () => {
    setLoadingPortfolios(true);
    try {
      const res = await fetch('/api/portfolios');
      if (res.ok) {
        const data = await res.json();
        setPortfolios(data);
        // Auto-select first portfolio if none selected
        if (data.length > 0 && !selectedPortfolioId) {
          setSelectedPortfolioId(data[0].id);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoadingPortfolios(false); }
  }, []);

  useEffect(() => { fetchPortfolios(); }, [fetchPortfolios]);

  const handleSavePortfolio = async (payload, existingId) => {
    try {
      const url = existingId ? `/api/portfolios/${existingId}` : '/api/portfolios';
      const method = existingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        setShowCreator(false);
        setEditingPortfolio(null);
        await fetchPortfolios();
        setSelectedPortfolioId(data.id || existingId);
      }
    } catch (e) { console.error(e); }
  };

  const handleDeletePortfolio = async (portfolioId) => {
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteConfirm(null);
        setSelectedPortfolioId(null);
        await fetchPortfolios();
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-6">
      {/* Header + Portfolio Tabs */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-800">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center">
              <Layers className="w-5 h-5 mr-2 text-indigo-400" /> Portfolio Builder
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Create named portfolios from selected accounts. All values in ₹ INR.</p>
          </div>
          <button
            onClick={() => { setEditingPortfolio(null); setShowCreator(true); }}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>New Portfolio</span>
          </button>
        </div>

        {/* Portfolio Tabs */}
        {portfolios.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {portfolios.map(p => (
              <div key={p.id} className="flex items-center">
                <button
                  onClick={() => setSelectedPortfolioId(p.id)}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-l-xl text-xs font-bold transition-all ${
                    selectedPortfolioId === p.id
                      ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{p.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    selectedPortfolioId === p.id ? 'bg-white/20' : 'bg-slate-700'
                  }`}>
                    {p.account_count} accts
                  </span>
                </button>
                <div className={`flex rounded-r-xl overflow-hidden border-l border-slate-700 ${
                  selectedPortfolioId === p.id ? 'bg-indigo-600' : 'bg-slate-800/80 border border-slate-700 border-l-0'
                }`}>
                  <button
                    onClick={() => { setEditingPortfolio(p); setShowCreator(true); }}
                    className="p-2 hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                    title="Edit portfolio"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(p)}
                    className="p-2 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                    title="Delete portfolio"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Empty State */}
      {!loadingPortfolios && portfolios.length === 0 && (
        <div className="glass-panel p-12 rounded-2xl border border-dashed border-slate-700 text-center space-y-4">
          <Layers className="w-12 h-12 text-slate-600 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-300">No Portfolios Yet</h3>
            <p className="text-xs text-slate-500 mt-1">Create a named portfolio by combining accounts to see a unified cross-account view.</p>
          </div>
          <button
            onClick={() => setShowCreator(true)}
            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>Create Your First Portfolio</span>
          </button>
        </div>
      )}

      {/* Portfolio Table */}
      {selectedPortfolioId && (
        <PortfolioTableView key={selectedPortfolioId} portfolioId={selectedPortfolioId} />
      )}

      {/* Portfolio Creator/Editor Modal */}
      {showCreator && (
        <PortfolioCreatorModal
          accounts={accounts}
          existingPortfolio={editingPortfolio}
          onClose={() => { setShowCreator(false); setEditingPortfolio(null); }}
          onSave={handleSavePortfolio}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-sm w-full p-6 rounded-2xl border border-rose-500/30 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">Delete "{deleteConfirm.name}"?</h3>
                <p className="text-xs text-slate-400 mt-0.5">This only removes the portfolio definition. Your account holdings are not affected.</p>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold">
                Cancel
              </button>
              <button
                onClick={() => handleDeletePortfolio(deleteConfirm.id)}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold"
              >
                Delete Portfolio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
