import React, { useState } from 'react';
import {
  Newspaper, Loader2, AlertCircle, ExternalLink, ChevronDown, ChevronUp,
  ArrowUpRight, ArrowDownRight, Minus, Search,
} from 'lucide-react';

// Materiality drives the visual weight: a shareholder scanning this should see
// the things worth acting on before the things worth knowing.
const LEVELS = {
  high:   { label: 'High',   ring: 'border-amber-500/40 bg-amber-500/[0.07]', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  medium: { label: 'Medium', ring: 'border-slate-800 bg-slate-900/40',        chip: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  low:    { label: 'Low',    ring: 'border-slate-800/60 bg-slate-900/20',     chip: 'bg-slate-800/40 text-slate-500 border-slate-700/40' },
};

const DIRECTION = {
  positive: { icon: ArrowUpRight,   tone: 'text-emerald-400' },
  negative: { icon: ArrowDownRight, tone: 'text-rose-400' },
  mixed:    { icon: Minus,          tone: 'text-amber-400' },
  unclear:  { icon: Minus,          tone: 'text-slate-500' },
};

function NewsItem({ item, onDeepDive, busySymbol }) {
  const level = LEVELS[item.materiality] || LEVELS.medium;
  const dir = DIRECTION[item.direction] || DIRECTION.unclear;
  const DirIcon = dir.icon;

  return (
    <div className={`rounded-xl border p-4 ${level.ring}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-100">{item.symbol}</span>
          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${level.chip}`}>
            {level.label}
          </span>
          <DirIcon className={`w-3.5 h-3.5 ${dir.tone}`} />
          {item.published && (
            <span className="text-[10px] text-slate-500">{item.published}</span>
          )}
        </div>
        <button
          onClick={() => onDeepDive(item.symbol)}
          disabled={!!busySymbol}
          className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 disabled:opacity-40
                     flex items-center gap-1 shrink-0"
        >
          {busySymbol === item.symbol
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Reading…</>
            : <><Search className="w-3 h-3" /> More on {item.symbol}</>}
        </button>
      </div>

      <p className="text-sm font-semibold text-slate-100 mt-2 leading-snug">{item.headline}</p>
      {item.summary && <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{item.summary}</p>}

      {item.impact && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-800/70">
          <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">Why it matters</span>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">{item.impact}</p>
        </div>
      )}

      {item.url && (
        <a href={item.url} target="_blank" rel="noopener noreferrer"
           className="text-[10px] text-slate-500 hover:text-indigo-400 mt-2.5 inline-flex items-center gap-1">
          <ExternalLink className="w-3 h-3" /> {item.source || 'source'}
        </a>
      )}
    </div>
  );
}

function DeepDive({ detail, onClose }) {
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.05] p-4 mb-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-bold text-slate-100">{detail.symbol} — closer look</h4>
        <button onClick={onClose} className="text-[10px] text-slate-400 hover:text-slate-200">Close</button>
      </div>

      {detail.summary && (
        <p className="text-xs text-slate-300 mt-2 leading-relaxed">{detail.summary}</p>
      )}

      {detail.watch?.length > 0 && (
        <div className="mt-3">
          <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">What to watch</span>
          <ul className="mt-1 space-y-1">
            {detail.watch.map((w, i) => (
              <li key={i} className="text-xs text-slate-300 flex gap-2">
                <span className="text-indigo-400">·</span>{w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.items?.length > 0 && (
        <div className="mt-3 space-y-2">
          {detail.items.map((item, i) => (
            <div key={i} className="text-xs border-t border-slate-800/70 pt-2">
              <p className="text-slate-200 font-semibold">{item.headline}</p>
              {item.impact && <p className="text-slate-400 mt-0.5">{item.impact}</p>}
              {item.url && (
                <a href={item.url} target="_blank" rel="noopener noreferrer"
                   className="text-[10px] text-slate-500 hover:text-indigo-400 inline-flex items-center gap-1 mt-1">
                  <ExternalLink className="w-3 h-3" /> {item.source || 'source'}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PortfolioNews({ portfolioId }) {
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [deepDive, setDeepDive] = useState(null);
  const [busySymbol, setBusySymbol] = useState('');

  const fetchNews = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setDeepDive(null);
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/news`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || 'Could not fetch the news.');
      setNews(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const openDeepDive = async (symbol) => {
    setBusySymbol(symbol);
    setError('');
    try {
      const item = news?.items?.find((i) => i.symbol === symbol);
      const params = new URLSearchParams({
        country: item?.country || 'IND',
        company_name: item?.company_name || '',
      });
      const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}/news?${params}`,
                              { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || 'Could not load that stock.');
      setDeepDive(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusySymbol('');
    }
  };

  const items = news?.items || [];
  const shown = expanded ? items : items.slice(0, 8);

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-indigo-400" /> Latest news
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5 max-w-xl">
            Pulls headlines for every holding, then keeps what could move the
            price — earnings, regulation, ratings, contracts, insider dealing.
            Price commentary and 13F filings are dropped. Nothing here is advice.
          </p>
        </div>
        <button
          onClick={fetchNews}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-white text-xs font-bold flex items-center gap-2 shrink-0 transition-colors"
        >
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Searching…</>
                   : <><Newspaper className="w-4 h-4" /> {news ? 'Refresh' : 'Fetch news'}</>}
        </button>
      </div>

      {loading && (
        <p className="text-[11px] text-slate-500 mt-4">
          Gathering headlines across your holdings, then judging what matters.
        </p>
      )}

      {error && (
        <p className="text-xs text-rose-400 mt-4 flex items-start gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> {error}
        </p>
      )}

      {news && !loading && (
        <div className="mt-4">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <p className="text-[10px] text-slate-500">
              {items.length === 0
                ? `Nothing material found across ${news.holdings} holdings in the last ${news.window_days} days.`
                : `${items.length} item${items.length === 1 ? '' : 's'} across ${news.covered} of ${news.holdings} holdings, last ${news.window_days} days.`}
            </p>
            {/* Says plainly whether a model judged these or keywords did, so a
                thin "why it matters" line is never mistaken for analysis. */}
            {news.note && (
              <p className={`text-[10px] ${news.interpreted ? 'text-slate-500' : 'text-amber-400/80'} max-w-md text-right`}>
                {news.note}
              </p>
            )}
          </div>

          {deepDive && <DeepDive detail={deepDive} onClose={() => setDeepDive(null)} />}

          <div className="space-y-2.5">
            {shown.map((item, i) => (
              <NewsItem key={`${item.symbol}-${i}`} item={item}
                        onDeepDive={openDeepDive} busySymbol={busySymbol} />
            ))}
          </div>

          {items.length > 8 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full mt-3 py-2 text-[11px] font-semibold text-slate-400 hover:text-slate-200
                         border border-slate-800 rounded-xl hover:bg-slate-800/40 flex items-center justify-center gap-1"
            >
              {expanded
                ? <>Show less <ChevronUp className="w-3 h-3" /></>
                : <>Show all {items.length} <ChevronDown className="w-3 h-3" /></>}
            </button>
          )}
        </div>
      )}

      {!news && !loading && !error && (
        <p className="text-xs text-slate-600 mt-4">
          Nothing fetched yet. Press the button when you want a read on your holdings.
        </p>
      )}
    </div>
  );
}
