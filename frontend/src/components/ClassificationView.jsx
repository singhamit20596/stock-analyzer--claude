import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Tags, Search, X, RefreshCw, Check, Plus, Upload, Trash2,
  AlertCircle, Type, Loader2,
} from 'lucide-react';

const MARKET_LABEL = { US: '🇺🇸 US', IND: '🇮🇳 IND' };

function MarketBadge({ country }) {
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
      country === 'US'
        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
    }`}>
      {MARKET_LABEL[country] || country}
    </span>
  );
}

// ─── Add-stocks modal ─────────────────────────────────────────────────────────
// Two ways in — typed names or a screenshot — both land on the same editable
// confirmation list before anything is written.
function AddStocksModal({ sectors, sections, onClose, onAdded }) {
  const [mode, setMode] = useState('type');
  const [text, setText] = useState('');
  const [proposals, setProposals] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const resolveNames = async () => {
    const names = text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    if (names.length === 0) { setError('Enter at least one stock name.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/classification/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.detail || 'Could not resolve those names.'); return; }
      setProposals(body.proposals);
    } catch { setError('Could not reach the server.'); }
    finally { setBusy(false); }
  };

  const resolveImage = async (files) => {
    if (!files?.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      [...files].forEach(f => fd.append('files', f));
      const res = await fetch('/api/classification/resolve-image', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) { setError(body.detail || 'Could not read that screenshot.'); return; }
      if (!body.proposals?.length) {
        setError(body.warnings?.[0] || 'No stock names detected in that screenshot.');
        return;
      }
      setProposals(body.proposals);
    } catch { setError('Could not reach the server.'); }
    finally { setBusy(false); }
  };

  const setField = (i, field, value) => {
    setProposals(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  };

  const removeRow = (i) => setProposals(prev => prev.filter((_, idx) => idx !== i));

  const confirm = async () => {
    const keep = proposals.filter(p => !p.already_exists);
    if (keep.length === 0) { setError('Nothing left to add.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/classification/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stocks: keep }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.detail || 'Could not save.'); return; }
      onAdded(body);
    } catch { setError('Could not reach the server.'); }
    finally { setBusy(false); }
  };

  const newCount = proposals?.filter(p => !p.already_exists).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className="glass-panel max-w-3xl w-full my-8 rounded-2xl border border-slate-700 shadow-2xl">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-base font-bold text-slate-100 flex items-center">
            <Plus className="w-5 h-5 mr-2 text-indigo-400" /> Add More Stocks
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!proposals && (
          <div className="p-6 space-y-5">
            <div className="flex gap-2">
              {[
                { id: 'type', label: 'Type names', icon: Type },
                { id: 'image', label: 'Upload screenshot', icon: Upload },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setMode(id); setError(''); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    mode === id
                      ? 'bg-indigo-500 text-white'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            {mode === 'type' ? (
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1.5">
                  Stock names or tickers — one per line, or comma separated
                </label>
                <textarea
                  value={text}
                  onChange={e => { setText(e.target.value); setError(''); }}
                  rows={6}
                  autoFocus
                  placeholder={'NVDA\nReliance Industries\nTCS, Apple'}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 text-sm font-medium focus:outline-none focus:border-indigo-500 resize-y"
                />
                <button
                  onClick={resolveNames}
                  disabled={busy}
                  className="mt-3 px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Classify these
                </button>
              </div>
            ) : (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={e => resolveImage(e.target.files)}
                  className="hidden"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="w-full border-2 border-dashed border-slate-700 hover:border-indigo-500/60 rounded-2xl py-12 flex flex-col items-center gap-3 text-slate-400 hover:text-slate-200 transition-all disabled:opacity-50"
                >
                  {busy
                    ? <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                    : <Upload className="w-8 h-8" />}
                  <span className="text-sm font-semibold">
                    {busy ? 'Reading screenshot...' : 'Click to choose a screenshot'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Stock names are read off the image; quantities are ignored.
                  </span>
                </button>
              </div>
            )}

            {error && (
              <p className="text-xs text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> <span>{error}</span>
              </p>
            )}
          </div>
        )}

        {proposals && (
          <>
            <div className="px-6 pt-5 pb-2">
              <p className="text-xs text-slate-300 font-semibold">
                Confirm the classification below — edit anything that looks wrong.
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Sector and section were guessed. {newCount} to add
                {proposals.length - newCount > 0 && `, ${proposals.length - newCount} already tracked`}.
              </p>
            </div>

            <div className="px-6 pb-4 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-2 pr-3">Stock</th>
                    <th className="py-2 px-2">Market</th>
                    <th className="py-2 px-2">Sector</th>
                    <th className="py-2 px-2">Section</th>
                    <th className="py-2 pl-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {proposals.map((p, i) => (
                    <tr key={`${p.symbol}-${p.country}-${i}`} className={p.already_exists ? 'opacity-40' : ''}>
                      <td className="py-2.5 pr-3">
                        <input
                          value={p.symbol}
                          onChange={e => setField(i, 'symbol', e.target.value.toUpperCase())}
                          className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-100 focus:outline-none focus:border-indigo-500"
                        />
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[140px]">
                          {p.already_exists ? 'already tracked' : `from "${p.input}"`}
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <select
                          value={p.country}
                          onChange={e => setField(i, 'country', e.target.value)}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-indigo-500"
                        >
                          <option value="IND">🇮🇳 IND</option>
                          <option value="US">🇺🇸 US</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-2">
                        <select
                          value={p.sector}
                          onChange={e => setField(i, 'sector', e.target.value)}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-indigo-500"
                        >
                          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="py-2.5 px-2">
                        <select
                          value={p.section}
                          onChange={e => setField(i, 'section', e.target.value)}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-indigo-500"
                        >
                          {sections.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="py-2.5 pl-2">
                        <button
                          onClick={() => removeRow(i)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                          title="Drop this row"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && (
              <p className="px-6 pb-3 text-xs text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> <span>{error}</span>
              </p>
            )}

            <div className="p-4 border-t border-slate-800 flex justify-between items-center">
              <button
                onClick={() => { setProposals(null); setError(''); }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Back
              </button>
              <button
                onClick={confirm}
                disabled={busy || newCount === 0}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Add {newCount} stock{newCount === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ClassificationView({ onSelectStock }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const [search, setSearch] = useState('');
  const [fMarket, setFMarket] = useState('');
  const [fSector, setFSector] = useState('');
  const [fSection, setFSection] = useState('');
  const [fAccount, setFAccount] = useState('');
  const [fHeld, setFHeld] = useState('');

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
            r.symbol === row.symbol && r.country === row.country ? { ...r, [field]: value } : r
          ),
        }));
        setSavedKey(key);
        setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1200);
      }
    } catch (e) { console.error(e); }
    finally { setSavingKey(null); }
  };

  const removeWatch = async (row) => {
    try {
      const res = await fetch(
        `/api/classification/stocks/${encodeURIComponent(row.symbol)}?country=${row.country}`,
        { method: 'DELETE' }
      );
      if (res.ok) await fetchData();
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-4">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium">Loading classification...</p>
    </div>
  );

  if (!data) return null;

  const { sectors, sections, rows, account_names: accountNames = [] } = data;
  const term = search.toLowerCase();

  const filtered = rows.filter(r => {
    if (term && !(
      r.symbol.toLowerCase().includes(term) ||
      r.company_name.toLowerCase().includes(term)
    )) return false;
    if (fMarket && r.country !== fMarket) return false;
    if (fSector && r.sector !== fSector) return false;
    if (fSection && r.section !== fSection) return false;
    if (fAccount && !r.accounts.includes(fAccount)) return false;
    if (fHeld === 'held' && !r.held) return false;
    if (fHeld === 'watch' && r.held) return false;
    return true;
  });

  const activeFilters = [fMarket, fSector, fSection, fAccount, fHeld].filter(Boolean).length
    + (search ? 1 : 0);

  const clearAll = () => {
    setSearch(''); setFMarket(''); setFSector(''); setFSection('');
    setFAccount(''); setFHeld('');
  };

  const selectCls = 'bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-100 font-semibold focus:outline-none focus:border-indigo-500';

  return (
    <div className="space-y-5">
      <div className="glass-panel p-5 rounded-2xl border border-slate-800">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center">
              <Tags className="w-5 h-5 mr-2 text-indigo-400" /> Stock Classification
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Every stock you hold or track, with its market, accounts, sector and section.
              Edits apply across all accounts and save immediately.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20"
            >
              <Plus className="w-4 h-4" /> Add More Stocks
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel p-3 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol or company..."
            className="bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none flex-1 min-w-0"
          />
          <span className="text-[10px] text-slate-500 whitespace-nowrap">
            {filtered.length} of {rows.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/70">
          <select value={fMarket} onChange={e => setFMarket(e.target.value)} className={selectCls}>
            <option value="">All markets</option>
            <option value="IND">🇮🇳 India</option>
            <option value="US">🇺🇸 US</option>
          </select>
          <select value={fSector} onChange={e => setFSector(e.target.value)} className={selectCls}>
            <option value="">All sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={fSection} onChange={e => setFSection(e.target.value)} className={selectCls}>
            <option value="">All sections</option>
            {sections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={fAccount} onChange={e => setFAccount(e.target.value)} className={selectCls}>
            <option value="">All accounts</option>
            {accountNames.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={fHeld} onChange={e => setFHeld(e.target.value)} className={selectCls}>
            <option value="">Held + watch list</option>
            <option value="held">Held only</option>
            <option value="watch">Watch list only</option>
          </select>
          {activeFilters > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
            >
              <X className="w-3 h-3" /> Clear ({activeFilters})
            </button>
          )}
        </div>
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
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(row => {
                const key = `${row.symbol}-${row.country}`;
                const busy = savingKey === key;
                return (
                  <tr key={key} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4">
                      {/* The rest of the row is dropdowns, so only the ticker
                          opens the deep dive. */}
                      <div className="font-bold text-slate-100 flex items-center gap-2">
                        <button
                          onClick={() => onSelectStock && onSelectStock(row.symbol, row.country)}
                          className="hover:text-indigo-400 transition-colors"
                        >
                          {row.symbol}
                        </button>
                        {savedKey === key && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{row.company_name}</div>
                    </td>
                    <td className="py-3 px-4"><MarketBadge country={row.country} /></td>
                    <td className="py-3 px-4 text-right text-slate-200 font-medium">
                      {row.held ? row.quantity : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-3 px-4 text-[10px]">
                      {row.held
                        ? <span className="text-slate-400">{row.accounts.join(', ')}</span>
                        : <span className="text-indigo-400/80 font-semibold">Watch list</span>}
                    </td>
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
                    <td className="py-3 px-4 text-right">
                      {!row.held && (
                        <button
                          onClick={() => removeWatch(row)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                          title="Remove from watch list"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-400 text-sm">
            No stocks match the current filters.
          </div>
        )}
      </div>

      {showAdd && (
        <AddStocksModal
          sectors={sectors}
          sections={sections}
          onClose={() => setShowAdd(false)}
          onAdded={async () => { setShowAdd(false); await fetchData(); }}
        />
      )}
    </div>
  );
}
