import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } from 'lightweight-charts';
import { Loader2 } from 'lucide-react';
import { percent, symbolFor, ratio, toneFor, DASH } from './format';

// 1D and 5D would need intraday data the daily endpoints do not serve, and
// Groww's window does not reach 10Y reliably, so the range stops at 5Y.
const RANGES = ['1M', '6M', '1Y', '3Y', '5Y'];

const UP = '#10b981';
const DOWN = '#f43f5e';

const RANGE_KEY = 'stockChartRange';

export default function PriceChart({ symbol, country, currency, initialChart }) {
  // The chosen range is a reading preference, so it outlives the page and
  // carries over to the next stock opened.
  const [range, setRange] = useState(() => {
    const saved = localStorage.getItem(RANGE_KEY);
    return RANGES.includes(saved) ? saved : initialChart?.range || '1Y';
  });

  const pickRange = (next) => {
    localStorage.setItem(RANGE_KEY, next);
    setRange(next);
  };
  const [chart, setChart] = useState(initialChart);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);

  // Ranges are slices of one cached series on the server, so switching a pill
  // is a cheap request rather than a refetch of the whole page.
  useEffect(() => {
    if (range === initialChart?.range) { setChart(initialChart); return; }

    let live = true;
    setLoading(true);
    fetch(`/api/stock/${encodeURIComponent(symbol)}/candles?country=${country}&range=${range}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((body) => { if (live) setChart(body); })
      .catch(() => { if (live) setChart({ range, candles: [] }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range, symbol, country, initialChart]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const instance = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(51,65,85,0.25)' },
        horzLines: { color: 'rgba(51,65,85,0.25)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(51,65,85,0.5)' },
      timeScale: { borderColor: 'rgba(51,65,85,0.5)', rightOffset: 4 },
    });

    candleRef.current = instance.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN,
      borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN,
    });
    // Volume shares the pane but gets its own hidden scale, pinned to the
    // bottom fifth so it reads as a footer rather than competing with price.
    volumeRef.current = instance.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    instance.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });

    chartRef.current = instance;
    return () => { instance.remove(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    const candles = chart?.candles || [];
    if (!candleRef.current || !volumeRef.current) return;

    candleRef.current.setData(candles.map((c) => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    volumeRef.current.setData(candles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.35)',
    })));
    chartRef.current?.timeScale().fitContent();
  }, [chart]);

  const change = chart?.change_percent;
  const unit = symbolFor(currency);

  return (
    <section className="glass-panel rounded-2xl border border-slate-800 p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-200">Price</h3>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-lg font-bold ${toneFor(change)}`}>
              {percent(change, { sign: true })}
            </span>
            <span className="text-[11px] text-slate-500">over {range}</span>
            {chart?.period_high != null && (
              <span className="text-[11px] text-slate-500">
                · range {unit}{ratio(chart.period_low)} – {unit}{ratio(chart.period_high)}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-1 bg-slate-900/60 p-1 rounded-lg border border-slate-800">
          {RANGES.map((key) => (
            <button
              key={key}
              onClick={() => pickRange(key)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                range === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <div ref={containerRef} className="h-[340px] w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
          </div>
        )}
        {!loading && !(chart?.candles || []).length && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs">
            No price history available for this range.
          </div>
        )}
      </div>

      <div className="mt-2 text-[10px] text-slate-600">
        Daily candles, {currency === 'USD' ? 'Nasdaq' : 'Groww'} · volume shown below price
      </div>
    </section>
  );
}
