import React, { useEffect, useRef } from 'react';
import { X, Maximize2, Globe, Building2 } from 'lucide-react';
import PriceChart from './PriceChart';

/**
 * The price chart over the portfolio rather than instead of it, so a glance at
 * one holding does not cost you your place in the table. Everything the chart
 * needs comes from /candles, so this opens without waiting for the fundamentals
 * the deep-dive page loads.
 */
export default function StockChartPopup({ symbol, country, onClose, onExpand }) {
  // Only a press that both starts and ends on the backdrop dismisses. Dragging
  // the chart's time scale and releasing past its edge lands a click on the
  // backdrop, which would otherwise close what you were reading mid-gesture.
  const startedOnBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const isUS = country === 'US';

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-sm
                 flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(event) => {
        startedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && startedOnBackdrop.current) onClose();
      }}
      role="presentation"
    >
      <div
        className="w-full max-w-3xl my-auto"
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} price chart`}
      >
        {/* Sits above the chart's own panel rather than wrapping it, so there
            is one border around the content instead of two. */}
        <div className="flex items-center justify-between gap-3 mb-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-bold text-slate-100 truncate">{symbol}</h2>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900/70
                             border border-slate-800 text-[10px] font-bold text-slate-400">
              {isUS ? <Globe className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
              {isUS ? 'US' : 'NSE'}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onExpand}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold
                         bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            >
              <Maximize2 className="w-3 h-3" />
              Full details
            </button>
            <button
              onClick={onClose}
              aria-label="Close chart"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100
                         hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <PriceChart
          symbol={symbol}
          country={country}
          currency={isUS ? 'USD' : 'INR'}
        />

        <p className="mt-2 px-1 text-[10px] text-slate-500">
          Click outside or press Esc to close · Full details for ratios, quarterly results and technicals
        </p>
      </div>
    </div>
  );
}
