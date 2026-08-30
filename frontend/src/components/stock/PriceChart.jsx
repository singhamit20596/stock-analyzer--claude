import React, { useEffect, useRef, useState } from 'react';
import { createChart, AreaSeries, HistogramSeries, CrosshairMode } from 'lightweight-charts';
import { Loader2, X } from 'lucide-react';
import { percent, symbolFor, ratio, toneFor } from './format';

// 1D and 5D would need intraday data the daily endpoints do not serve, and
// Groww's window does not reach 10Y reliably, so the range stops at 5Y.
const RANGES = ['1M', '6M', '1Y', '3Y', '5Y'];

const UP = '#10b981';
const DOWN = '#f43f5e';

const RANGE_KEY = 'stockChartRange';

/** "2025-12-24" -> "24 Dec 2025". Candle times are plain date strings. */
function shortDate(time) {
  if (typeof time !== 'string') return String(time ?? '');
  const [y, m, d] = time.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1] || ''} ${y}`;
}

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

  // Click one point to pin it, then read the move to wherever the cursor is.
  // Answering "how much since then" off the chart itself is the thing a
  // fixed range pill cannot do.
  const [anchor, setAnchor] = useState(null);
  const [hover, setHover] = useState(null);
  // Height of the time axis, so the shaded span stops at the plot floor
  // instead of bleeding over the dates.
  const [axisHeight, setAxisHeight] = useState(28);

  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const priceRef = useRef(null);
  const volumeRef = useRef(null);
  // The crosshair handler is subscribed once, so it reads the pinned point
  // through a ref rather than closing over a stale value.
  const anchorRef = useRef(null);
  useEffect(() => { anchorRef.current = anchor; }, [anchor]);

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
      // autoSize measures through a ResizeObserver, which does not fire until
      // after the first paint. Left to itself the chart is born zero-wide, and
      // the fitContent() below then computes a bar spacing against no width at
      // all — the whole series ends up squeezed against the right edge. Seed
      // the real size so the first fit has something to work with.
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
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

    // A closing line, not candles: this page is about how a holding has moved,
    // and a day's open/high/low is noise against that question.
    priceRef.current = instance.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
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

    const pointAt = (param) => {
      const point = param?.seriesData?.get(priceRef.current);
      if (!param?.time || !point || point.value == null) return null;
      return { time: param.time, value: point.value };
    };

    instance.subscribeClick((param) => {
      const point = pointAt(param);
      if (!point) return;                       // a click off the plot changes nothing
      setAnchor((current) =>
        current && current.time === point.time ? null : point);
    });

    // Fires at mouse rate. Positions are snapped to the session under the
    // cursor, so the state only changes when the cursor crosses onto a
    // different one — and the readout does not jitter between bars.
    instance.subscribeCrosshairMove((param) => {
      const point = pointAt(param);
      if (!point) { setHover((current) => (current === null ? current : null)); return; }
      const pinned = anchorRef.current;
      const next = {
        ...point,
        x: instance.timeScale().timeToCoordinate(point.time),
        y: priceRef.current.priceToCoordinate(point.value),
        anchorX: pinned ? instance.timeScale().timeToCoordinate(pinned.time) : null,
        anchorY: pinned ? priceRef.current.priceToCoordinate(pinned.value) : null,
        width: containerRef.current?.clientWidth || 0,
      };
      setHover((current) =>
        current && current.time === next.time && current.x === next.x
        && current.anchorX === next.anchorX ? current : next);
    });

    chartRef.current = instance;
    return () => { instance.remove(); chartRef.current = null; priceRef.current = null; };
  }, []);

  useEffect(() => {
    const candles = chart?.candles || [];
    if (!priceRef.current || !volumeRef.current) return;

    const up = !(chart?.change_percent < 0);
    priceRef.current.applyOptions({
      lineColor: up ? UP : DOWN,
      topColor: up ? 'rgba(16,185,129,0.30)' : 'rgba(244,63,94,0.30)',
      bottomColor: 'rgba(15,23,42,0)',
    });

    priceRef.current.setData(candles.map((c) => ({ time: c.time, value: c.close })));
    // Without an open to compare against, a bar is green when the session
    // closed above the one before it.
    volumeRef.current.setData(candles.map((c, i) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= (candles[i - 1]?.close ?? c.open)
        ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.35)',
    })));
    chartRef.current?.timeScale().fitContent();
    // And again once layout has settled, for the case where the series arrives
    // in the same commit that mounts the chart.
    requestAnimationFrame(() => {
      chartRef.current?.timeScale().fitContent();
      const height = chartRef.current?.timeScale().height();
      if (height) setAxisHeight(height);
    });

    // A pinned date need not exist in the range just loaded.
    setAnchor(null);
    setHover(null);
  }, [chart]);

  const change = chart?.change_percent;
  const unit = symbolFor(currency);
  const hasData = (chart?.candles || []).length > 0;

  // Measured earliest-to-latest whichever end was pinned first, so the span
  // always reads as "this period did X" rather than depending on which
  // direction the cursor happened to travel.
  const span = anchor && hover && hover.time !== anchor.time && (() => {
    const [from, to] = anchor.time <= hover.time ? [anchor, hover] : [hover, anchor];
    if (!(from.value > 0)) return null;
    return {
      from, to,
      absolute: (Math.round(to.value * 100) - Math.round(from.value * 100)) / 100,
      percent: (to.value / from.value - 1) * 100,
    };
  })();

  return (
    <section className="glass-panel rounded-2xl border border-slate-800 p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
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

        {/* The measurement, drawn over the chart: the span shaded, a dot at
            each end and the readout beside the cursor. Pointer events are off
            so every click and drag still reaches the chart underneath. */}
        {span && hover?.x != null && hover.anchorX != null && (() => {
          const up = span.percent >= 0;
          const rgb = up ? '16,185,129' : '244,63,94';
          const left = Math.min(hover.x, hover.anchorX);
          const width = Math.abs(hover.x - hover.anchorX);
          const tipLeft = Math.max(4, Math.min(hover.x + 14, (hover.width || 0) - 186));
          const tipTop = Math.max(4, Math.min((hover.y ?? 0) - 56, 340 - 64));
          const dot = (x, y) => ({
            left: x - 4, top: y - 4, width: 8, height: 8,
            background: `rgb(${rgb})`, boxShadow: '0 0 0 2px rgba(15,23,42,0.95)',
          });
          return (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute" style={{
                left, width, top: 0, bottom: axisHeight,
                background: `rgba(${rgb},0.10)`,
              }} />
              <div className="absolute" style={{
                left: hover.anchorX, width: 1, top: 0, bottom: axisHeight,
                background: `rgba(${rgb},0.55)`,
              }} />
              {hover.anchorY != null && (
                <span className="absolute rounded-full" style={dot(hover.anchorX, hover.anchorY)} />
              )}
              {hover.y != null && (
                <span className="absolute rounded-full" style={dot(hover.x, hover.y)} />
              )}
              <div
                className="absolute rounded-lg px-2.5 py-1.5 bg-slate-900/95 border border-slate-700
                           shadow-xl shadow-slate-950/60 whitespace-nowrap"
                style={{ left: tipLeft, top: tipTop }}
              >
                <div className={`text-[12px] font-bold ${toneFor(span.percent)}`}>
                  {span.absolute < 0 ? '-' : '+'}{unit}{ratio(Math.abs(span.absolute))}
                  {' '}({percent(span.percent, { sign: true })})
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {shortDate(span.from.time)} - {shortDate(span.to.time)}
                </div>
              </div>
            </div>
          );
        })()}

        {hasData && !anchor && !loading && (
          <div className="absolute top-1 left-1 text-[10px] text-slate-600 pointer-events-none">
            Click any point to measure from there
          </div>
        )}
        {hasData && anchor && (
          <button
            onClick={() => setAnchor(null)}
            className="absolute top-1 right-14 flex items-center gap-1 px-1.5 py-0.5 rounded-md
                       text-[10px] font-semibold text-slate-400 bg-slate-900/80 border
                       border-slate-700 hover:text-slate-100 hover:bg-slate-800"
          >
            <X className="w-2.5 h-2.5" /> clear
          </button>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
          </div>
        )}
        {!loading && !hasData && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs">
            No price history available for this range.
          </div>
        )}
      </div>

      <div className="mt-2 text-[10px] text-slate-600">
        Daily closes, {currency === 'USD' ? 'Nasdaq' : 'Groww'} · volume shown below price
      </div>
    </section>
  );
}
