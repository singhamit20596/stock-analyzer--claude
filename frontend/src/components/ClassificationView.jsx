import React, { useState, useEffect, useCallback } from 'react';
import { Tags, Search, X, RefreshCw, Check } from 'lucide-react';

export default function ClassificationView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/classification');
      if (res.ok) setData(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const update = async (row, field, value) => {
    const key = `${row.symbol}-${row.country}`;
    setSavingKey(key);
    try {
      const res = await fetch(`/api/classification/${encodeURIComponent(row.symbol)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value, country: row.country }),
      });
      if (res.ok) {
        setData(prev => ({
          ...prev,
          rows: prev.rows.map(r =>
            r.symbol === row.symbol && r.country === row.country
              ? { ...r, [field]: value }
              : r
          ),
        }));
        setSavedKey(key);
        setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1200);
      }
    } catch (e) { console.error(e); }
    finally { setSavingKey(null); }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-4">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium">Loading classification...</p>
    </div>
  );

  if (!data) return null;

  const { sectors, sections, rows } = data;
  const term = searchTerm.toLowerCase();
  const filtered = rows.filter(r =>
    r.symbol.toLowerCase().includes(term) ||
    r.company_name.toLowerCase().includes(term) ||
    (r.sector || '').toLowerCase().includes(term) ||
    (r.section || '').toLowerCase().includes(term)
  );

  const counts = sectors.map(s => ({ name: s, n: rows.filter(r => r.sector === s).length }));

  return (
    <div className="space-y-5">
      <div className="glass-panel p-5 rounded-2xl border border-slate-800">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center">
              <Tags className="w-5 h-5 mr-2 text-indigo-400" /> Sector &amp; Section Classification
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              One row per stock. Changes apply to every account holding that stock and save immediately.
            </p>
          </div>
          <button
            onClick={fetchData}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {counts.map(({ name, n }) => (
            <span
              key={name}
              className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                n > 0
                  ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25'
                  : 'bg-slate-800/60 text-slate-500 border-slate-700'
              }`}
            >
              {name} · {n}
            </span>
          ))}
        </div>
      </div>

      <div className="glass-panel p-3 rounded-2xl border border-slate-800 flex items-center gap-3">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search symbol, company, sector or section..."
          className="bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none flex-1 min-w-0"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        )}
        <span className="text-[10px] text-slate-500 whitespace-nowrap">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Stock</th>
                <th className="py-3 px-4">Market</th>
                <th className="py-3 px-4 text-right">Qty</th>
                <th className="py-3 px-4">Accounts</th>
                <th className="py-3 px-4">Sector</th>
                <th className="py-3 px-4">Section</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(row => {
                const key = `${row.symbol}-${row.country}`;
                const busy = savingKey === key;
                const saved = savedKey === key;
                return (
                  <tr key={key} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-100 flex items-center gap-2">
                        {row.symbol}
                        {saved && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{row.company_name}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        row.country === 'US'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {row.country === 'US' ? '🇺🇸 US' : '🇮🇳 IND'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-200 font-medium">{row.quantity}</td>
                    <td className="py-3 px-4 text-slate-400 text-[10px]">{row.accounts.join(', ')}</td>
                    <td className="py-3 px-4">
                      <select
                        value={row.sector}
                        disabled={busy}
                        onChange={e => update(row, 'sector', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                      >
                        {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={row.section}
                        disabled={busy}
                        onChange={e => update(row, 'section', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                      >
                        {sections.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-400 text-sm">No stocks match "{searchTerm}"</div>
        )}
      </div>
    </div>
  );
}
