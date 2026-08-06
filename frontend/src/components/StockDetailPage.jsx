import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, TrendingUp, TrendingDown, Globe, Activity, Target, 
  BarChart3, DollarSign, AlertCircle, CheckCircle2, XCircle, 
  ChevronRight, ExternalLink, Building2, Users, Briefcase, 
  Shield, Zap, PieChart, Info
} from 'lucide-react';
import { createChart, CrosshairMode } from 'lightweight-charts';

// Utility for formatting numbers
const formatNumber = (num, currency = '', isPercent = false) => {
  if (num === null || num === undefined) return '—';
  
  if (isPercent) {
    return `${num.toFixed(2)}%`;
  }
  
  let formatted = '';
  const absNum = Math.abs(num);
  
  if (absNum >= 1e12) {
    formatted = (num / 1e12).toFixed(2) + 'T';
  } else if (absNum >= 1e9) {
    formatted = (num / 1e9).toFixed(2) + 'B';
  } else if (absNum >= 1e7 && currency === '₹') {
    formatted = (num / 1e7).toFixed(2) + 'Cr';
  } else if (absNum >= 1e5 && currency === '₹') {
    formatted = (num / 1e5).toFixed(2) + 'L';
  } else if (absNum >= 1e6) {
    formatted = (num / 1e6).toFixed(2) + 'M';
  } else if (absNum >= 1e3) {
    formatted = (num / 1e3).toFixed(2) + 'K';
  } else {
    formatted = num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  
  return `${currency}${formatted}`;
};

const formatRatio = (num) => {
  if (num === null || num === undefined) return '—';
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const PERIODS = ['1D', '5D', '1W', '1M', '6M', '1Y', '3Y', '5Y', '10Y'];

export default function StockDetailPage({ symbol, country, onClose }) {
  const [data, setData] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [chartChangePercent, setChartChangePercent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartPeriod, setChartPeriod] = useState('1Y');
  
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const seriesRef = useRef();
  const volumeSeriesRef = useRef();

  // Initial Data Fetch
  useEffect(() => {
    const fetchFullData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/stock/${symbol}/analysis?country=${country}&chart_period=${chartPeriod}`);
        if (!res.ok) throw new Error('Failed to fetch data');
        const json = await res.json();
        setData(json);
        setChartData(json.chart_data || []);
        setChartChangePercent(json.chart_change_percent || 0);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchFullData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, country]);

  // Chart Data Fetch on Period Change
  useEffect(() => {
    if (!data) return; // skip if initial load not done
    let isMounted = true;
    const fetchChartData = async () => {
      setChartLoading(true);
      try {
        const res = await fetch(`/api/stock/${symbol}/analysis?country=${country}&chart_period=${chartPeriod}`);
        if (!res.ok) throw new Error('Failed to fetch chart data');
        const json = await res.json();
        if (isMounted) {
          setChartData(json.chart_data || []);
          setChartChangePercent(json.chart_change_percent || 0);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (isMounted) setChartLoading(false);
      }
    };
    fetchChartData();
    return () => { isMounted = false; };
  }, [chartPeriod, symbol, country, data]);

  // Chart Rendering
  useEffect(() => {
    if (!chartContainerRef.current || chartData.length === 0) return;
    
    if (!chartRef.current) {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: '#94a3b8',
        },
        grid: {
          vertLines: { color: '#1e293b' },
          horzLines: { color: '#1e293b' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        rightPriceScale: {
          borderColor: '#1e293b',
        },
        timeScale: {
          borderColor: '#1e293b',
          timeVisible: true,
        },
      });

      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#10b981',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      });

      const volumeSeries = chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '', // set as an overlay
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

      chartRef.current = chart;
      seriesRef.current = candlestickSeries;
      volumeSeriesRef.current = volumeSeries;

      const handleResize = () => {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      };
      window.addEventListener('resize', handleResize);
      
      // Cleanup resize listener
      chartRef.current.cleanupResize = () => window.removeEventListener('resize', handleResize);
    }
    
    // Process data for lightweight-charts
    const cData = chartData.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close }));
    const vData = chartData.map(d => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
    }));

    seriesRef.current.setData(cData);
    volumeSeriesRef.current.setData(vData);
    chartRef.current.timeScale().fitContent();

    return () => {
      // Don't fully destroy here to avoid flashing on period change, just clean up on unmount
    };
  }, [chartData]);

  // Unmount chart cleanup
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        if (chartRef.current.cleanupResize) chartRef.current.cleanupResize();
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
        <div className="text-slate-400">Loading {symbol} analysis...</div>
      </div>
    );
  }

  if (!data) return null;

  const currencySymbol = data.company?.currency_symbol || (country === 'IND' ? '₹' : '$');
  const currencyParams = [currencySymbol, false];

  const { company, technicals, ratios, quarterly_results, insights, recommendation } = data;

  const getRSICategory = (rsi) => {
    if (!rsi) return { label: 'N/A', color: 'text-slate-400' };
    if (rsi < 30) return { label: 'Oversold', color: 'text-emerald-500' };
    if (rsi > 70) return { label: 'Overbought', color: 'text-rose-500' };
    return { label: 'Neutral', color: 'text-amber-500' };
  };

  const rsiInfo = getRSICategory(technicals?.rsi_14);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-slate-200 overflow-y-auto no-scrollbar font-sans">
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button 
              onClick={onClose}
              className="mt-1 p-2 bg-slate-900 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors border border-slate-800"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-3xl font-bold text-white tracking-tight">{company?.name || symbol}</h1>
                <span className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-sm font-semibold border border-slate-700">
                  {symbol}
                </span>
                <span className="text-xl">{country === 'US' ? '🇺🇸' : '🇮🇳'}</span>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-slate-400 mt-2 flex-wrap">
                <span className="flex items-center gap-1"><Briefcase className="w-4 h-4" /> {company?.sector || 'Unknown Sector'}</span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1"><Building2 className="w-4 h-4" /> {company?.industry || 'Unknown Industry'}</span>
                {company?.website && (
                  <>
                    <span className="text-slate-600">•</span>
                    <a href={company.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-indigo-400 transition-colors">
                      <Globe className="w-4 h-4" /> Website
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-4xl font-bold text-white">
              {currencySymbol}{technicals?.current_price?.toLocaleString() || '—'}
            </div>
            <div className={`flex items-center justify-end gap-1 font-medium mt-1 text-lg ${chartChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {chartChangePercent >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              <span>{Math.abs(chartChangePercent).toFixed(2)}% ({chartPeriod})</span>
            </div>
          </div>
        </div>

        {/* INTERACTIVE PRICE CHART */}
        <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-4">
          <div className="flex flex-wrap items-center justify-between mb-4 gap-4">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-400" /> Price Action
            </h3>
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {PERIODS.map(period => (
                <button
                  key={period}
                  onClick={() => setChartPeriod(period)}
                  className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                    chartPeriod === period 
                      ? 'bg-indigo-600 text-white' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            {chartLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm rounded-lg">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500"></div>
              </div>
            )}
            <div ref={chartContainerRef} className="w-full h-[400px]" />
          </div>
        </div>

        {/* VERDICT & RECOMMENDATION */}
        {recommendation && (
          <div className="bg-gradient-to-br from-slate-900 to-slate-900/80 rounded-xl border border-slate-800 p-6 shadow-xl relative overflow-hidden">
            <div className="absolute -right-10 -top-10 opacity-5 pointer-events-none">
              <Target className="w-64 h-64" />
            </div>
            
            <div className="flex flex-col md:flex-row gap-8">
              <div className="md:w-1/3 flex flex-col items-center justify-center p-6 bg-slate-950/50 rounded-xl border border-slate-800/50">
                <h3 className="text-slate-400 font-medium mb-2 uppercase tracking-wider text-sm">AI Verdict</h3>
                <div className={`text-4xl font-extrabold tracking-tight mb-2 ${
                  recommendation.verdict?.includes('BUY') ? 'text-emerald-500' :
                  recommendation.verdict?.includes('SELL') ? 'text-rose-500' :
                  'text-amber-500'
                }`}>
                  {recommendation.verdict || 'HOLD'}
                </div>
                {recommendation.target_price && (
                  <div className="text-center mt-4">
                    <div className="text-sm text-slate-500">Target Price</div>
                    <div className="text-2xl font-bold text-white">{currencySymbol}{recommendation.target_price}</div>
                  </div>
                )}
                {recommendation.analyst_rating && (
                  <div className="mt-4 px-3 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-sm font-medium border border-indigo-500/20 capitalize">
                    Consensus: {recommendation.analyst_rating}
                  </div>
                )}
              </div>
              
              <div className="md:w-2/3">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-indigo-400" /> Key Drivers
                </h3>
                <ul className="space-y-3">
                  {(recommendation.reasons || []).map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <div className="mt-1 flex-shrink-0">
                        {idx % 2 === 0 ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Info className="w-5 h-5 text-indigo-400" />}
                      </div>
                      <span className="text-slate-300 leading-relaxed">{reason}</span>
                    </li>
                  ))}
                  {(!recommendation.reasons || recommendation.reasons.length === 0) && (
                    <li className="text-slate-500 italic">No specific drivers provided.</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* TECHNICAL INDICATORS */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-400" /> Technical Analysis
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            
            {/* RSI */}
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-5 flex flex-col justify-between">
              <div className="text-sm text-slate-400 font-medium mb-4">RSI (14)</div>
              <div className="flex items-end justify-between">
                <div className="text-3xl font-bold text-white">{formatRatio(technicals?.rsi_14)}</div>
                <div className={`font-semibold ${rsiInfo.color}`}>{rsiInfo.label}</div>
              </div>
              <div className="w-full bg-slate-800 h-2 mt-4 rounded-full overflow-hidden flex">
                <div className="h-full bg-emerald-500" style={{ width: '30%' }} />
                <div className="h-full bg-amber-500" style={{ width: '40%' }} />
                <div className="h-full bg-rose-500" style={{ width: '30%' }} />
              </div>
              <div className="w-full relative mt-1">
                <div 
                  className="absolute top-0 w-2 h-3 bg-white -ml-1 rounded-sm shadow-sm"
                  style={{ left: `${Math.min(Math.max(technicals?.rsi_14 || 0, 0), 100)}%` }}
                />
              </div>
            </div>

            {/* Trend & Zones */}
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-5">
              <div className="text-sm text-slate-400 font-medium mb-3">Trend & Zones</div>
              <div className="mb-4">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-bold uppercase ${
                  technicals?.trend?.includes('BULL') ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                  technicals?.trend?.includes('BEAR') ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' :
                  'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                }`}>
                  {technicals?.trend?.includes('BULL') ? <TrendingUp className="w-4 h-4"/> : 
                   technicals?.trend?.includes('BEAR') ? <TrendingDown className="w-4 h-4"/> : <Activity className="w-4 h-4"/>}
                  {technicals?.trend || 'NEUTRAL'}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Entry Zone:</span>
                  <span className="text-emerald-400 font-medium">{technicals?.entry_zone || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Exit Zone:</span>
                  <span className="text-rose-400 font-medium">{technicals?.exit_zone || '—'}</span>
                </div>
              </div>
            </div>

            {/* Support / Resistance */}
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-5">
              <div className="text-sm text-slate-400 font-medium mb-3">Support & Resistance</div>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-400">Resistance</span>
                    <span className="text-white font-medium">{currencySymbol}{technicals?.resistance_level || '—'}</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500/50 w-full" />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-400">Current Price</span>
                    <span className="text-white font-medium">{currencySymbol}{technicals?.current_price || '—'}</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 w-2/3" />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-400">Support</span>
                    <span className="text-white font-medium">{currencySymbol}{technicals?.support_level || '—'}</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500/50 w-1/3" />
                  </div>
                </div>
              </div>
            </div>

            {/* Moving Averages */}
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-5">
              <div className="text-sm text-slate-400 font-medium mb-3">Moving Averages</div>
              <div className="space-y-3">
                {[
                  { label: 'SMA 20', val: technicals?.sma_20 },
                  { label: 'SMA 50', val: technicals?.sma_50 },
                  { label: 'SMA 200', val: technicals?.sma_200 },
                ].map((sma, i) => (
                  <div key={i} className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">{sma.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{currencySymbol}{sma.val || '—'}</span>
                      {sma.val && technicals?.current_price && (
                        technicals.current_price > sma.val 
                          ? <div className="w-2 h-2 rounded-full bg-emerald-500" title="Bullish"/> 
                          : <div className="w-2 h-2 rounded-full bg-rose-500" title="Bearish"/>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* FUNDAMENTALS & RATIOS */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <PieChart className="w-6 h-6 text-indigo-400" /> Fundamental Analysis
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Valuation */}
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-4">
              <h3 className="text-indigo-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">Valuation</h3>
              <div className="space-y-3">
                <RatioRow label="P/E Ratio" value={formatRatio(ratios?.pe_ratio)} />
                <RatioRow label="Forward P/E" value={formatRatio(ratios?.forward_pe)} />
                <RatioRow label="PEG Ratio" value={formatRatio(ratios?.peg_ratio)} />
                <RatioRow label="P/B Ratio" value={formatRatio(ratios?.pb_ratio)} />
                <RatioRow label="P/S Ratio" value={formatRatio(ratios?.ps_ratio)} />
              </div>
            </div>

            {/* Profitability */}
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-4">
              <h3 className="text-indigo-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">Profitability</h3>
              <div className="space-y-3">
                <RatioRow label="ROE" value={formatNumber(ratios?.roe, '', true)} />
                <RatioRow label="ROA" value={formatNumber(ratios?.roa, '', true)} />
                <RatioRow label="Profit Margin" value={formatNumber(ratios?.profit_margin, '', true)} />
                <RatioRow label="Operating Margin" value={formatNumber(ratios?.operating_margin, '', true)} />
              </div>
            </div>

            {/* Growth */}
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-4">
              <h3 className="text-indigo-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">Growth</h3>
              <div className="space-y-3">
                <RatioRow label="Revenue Growth" value={formatNumber(ratios?.revenue_growth, '', true)} colorize />
                <RatioRow label="Earnings Growth" value={formatNumber(ratios?.earnings_growth, '', true)} colorize />
                <RatioRow label="EPS (TTM)" value={`${currencySymbol}${formatRatio(ratios?.eps)}`} />
                <RatioRow label="Forward EPS" value={`${currencySymbol}${formatRatio(ratios?.forward_eps)}`} />
              </div>
            </div>

            {/* Financial Health & Market */}
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-4">
              <h3 className="text-indigo-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">Health & Market</h3>
              <div className="space-y-3">
                <RatioRow label="D/E Ratio" value={formatRatio(ratios?.de_ratio)} />
                <RatioRow label="Current Ratio" value={formatRatio(ratios?.current_ratio)} />
                <RatioRow label="Div Yield" value={formatNumber(ratios?.dividend_yield, '', true)} />
                <RatioRow label="Beta" value={formatRatio(ratios?.beta)} />
                <RatioRow label="Market Cap" value={formatNumber(company?.market_cap, currencySymbol)} />
              </div>
            </div>

          </div>
        </div>

        {/* QUARTERLY RESULTS */}
        {quarterly_results && quarterly_results.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-indigo-400" /> Quarterly Financials
            </h2>
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-400 uppercase bg-slate-900/80 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Quarter</th>
                    <th className="px-6 py-4 font-semibold">Revenue</th>
                    <th className="px-6 py-4 font-semibold">Net Income</th>
                    <th className="px-6 py-4 font-semibold">EBITDA</th>
                    <th className="px-6 py-4 font-semibold">Net Margin</th>
                    <th className="px-6 py-4 font-semibold">Rev Growth (YoY)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {quarterly_results.map((q, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-white">{q.quarter || '—'}</td>
                      <td className="px-6 py-4 text-slate-300">{formatNumber(q.revenue, currencySymbol)}</td>
                      <td className="px-6 py-4 text-slate-300">{formatNumber(q.net_income, currencySymbol)}</td>
                      <td className="px-6 py-4 text-slate-300">{formatNumber(q.ebitda, currencySymbol)}</td>
                      <td className="px-6 py-4 text-slate-300">{formatNumber(q.net_margin, '', true)}</td>
                      <td className="px-6 py-4 font-medium">
                        <span className={q.revenue_growth_yoy > 0 ? 'text-emerald-400' : q.revenue_growth_yoy < 0 ? 'text-rose-400' : 'text-slate-400'}>
                          {formatNumber(q.revenue_growth_yoy, '', true)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* INSIGHTS */}
        {insights && insights.length > 0 && (
          <div className="space-y-4 pb-12">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Shield className="w-6 h-6 text-indigo-400" /> Management & Market Insights
            </h2>
            <div className="bg-slate-900/50 backdrop-blur-md rounded-xl border border-slate-800 p-6">
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {insights.map((insight, idx) => (
                  <li key={idx} className="flex items-start gap-3 bg-slate-950/50 p-4 rounded-lg border border-slate-800/50">
                    <ChevronRight className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-300 leading-relaxed text-sm">{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function RatioRow({ label, value, colorize = false }) {
  let valueClass = "text-white font-medium";
  if (colorize && typeof value === 'string') {
    if (value.startsWith('-')) valueClass = "text-rose-400 font-medium";
    else if (value !== '—' && value !== '0.00%') valueClass = "text-emerald-400 font-medium";
  }
  
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}
