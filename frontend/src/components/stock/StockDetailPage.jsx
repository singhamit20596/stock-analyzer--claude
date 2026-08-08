import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, AlertTriangle, Globe, Building2 } from 'lucide-react';
import PositionBand from './PositionBand';
import PriceChart from './PriceChart';
import RatiosGrid from './RatiosGrid';
import QuarterlyTable from './QuarterlyTable';
import TechnicalIndicators from './TechnicalIndicators';
import AskAssistantButton from './AskAssistantButton';
import { ratio, percent, symbolFor, toneFor, date } from './format';

function Header({ detail, onClose }) {
  const { symbol, company, position, price, currency, country, is_etf: isEtf } = detail;
  const name = company?.name || position?.company_name || symbol;
  const unit = symbolFor(currency);

  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4
                    bg-slate-950/90 backdrop-blur border-b border-slate-800">
      <button
        onClick={onClose}
        className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 mb-3 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to portfolio
      </button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-slate-100 truncate">{name}</h2>
            <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-300">
              {symbol}
            </span>
            {isEtf && (
              <span className="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-[10px] font-bold text-sky-300">
                ETF
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3" /> {country === 'US' ? 'United States' : 'India'}
            </span>
            {company?.industry && (
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" /> {company.industry}
              </span>
            )}
            {company?.exchange && <span>{company.exchange}</span>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-slate-100">
            {unit}{ratio(price?.current)}
          </div>
          <div className={`text-xs font-bold ${toneFor(price?.change)}`}>
            {price?.change == null ? '' : `${price.change > 0 ? '+' : ''}${ratio(price.change)} `}
            {percent(price?.change_percent, { sign: true })}
          </div>
          {price?.as_of && (
            <div className="text-[10px] text-slate-600 mt-0.5">close {date(price.as_of)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StockDetailPage({ symbol, country, portfolioId, onClose, onAskAssistant }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');

    const params = new URLSearchParams({ country: country || 'IND' });
    if (portfolioId) params.set('portfolio_id', portfolioId);

    fetch(`/api/stock/${encodeURIComponent(symbol)}/analysis?${params}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.detail || 'Could not load this stock.');
        return body;
      })
      .then((body) => { if (live) setDetail(body); })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });

    return () => { live = false; };
  }, [symbol, country, portfolioId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-40 bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
          Loading {symbol}…
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="fixed inset-0 z-40 bg-slate-950 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <p className="text-sm text-slate-300">{error || 'Could not load this stock.'}</p>
          <button onClick={onClose}
                  className="mt-4 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200">
            Back to portfolio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-950 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <Header detail={detail} onClose={onClose} />

        {detail.warnings?.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3
                          text-[11px] text-amber-200/90 space-y-1">
            {detail.warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                {warning}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-4 mt-4">
          {/* The position leads: it is the part a generic stock site cannot show. */}
          <PositionBand position={detail.position} tracking={detail.target_tracking} />

          <PriceChart
            symbol={detail.requested_symbol || detail.symbol}
            country={detail.country}
            currency={detail.currency}
            initialChart={detail.chart}
          />

          <RatiosGrid
            ratios={detail.ratios}
            etfFacts={detail.etf_facts}
            isEtf={detail.is_etf}
            currency={detail.currency}
            price={detail.price?.current}
          />

          {/* Funds have no quarterly results to show. */}
          {!detail.is_etf && (
            <QuarterlyTable quarterly={detail.quarterly} currency={detail.currency} />
          )}

          <TechnicalIndicators technicals={detail.technicals} currency={detail.currency} />

          <AskAssistantButton detail={detail} onAsk={onAskAssistant} />

          {detail.company?.description && (
            <section className="glass-panel rounded-2xl border border-slate-800 p-5">
              <h3 className="text-sm font-bold text-slate-200 mb-2">About</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{detail.company.description}</p>
            </section>
          )}

          {detail.sources?.length > 0 && (
            <p className="text-[10px] text-slate-600 text-center pt-2">
              Data from {detail.sources.join(', ')}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
