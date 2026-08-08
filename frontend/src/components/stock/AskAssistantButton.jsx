import React from 'react';
import { Sparkles } from 'lucide-react';
import { exact, money, percent, ratio } from './format';

/** The page deliberately draws no conclusion from the indicators, so the
 *  hand-off carries the figures it is showing into the chat. The assistant
 *  already has the whole portfolio in its context, but not these ratios or
 *  technicals, so they are restated here. */
function buildPrompt(detail) {
  const { symbol, company, position, ratios, technicals, price, currency, is_etf: isEtf } = detail;
  const name = company?.name || position?.company_name || symbol;
  const lines = [];

  lines.push(`Give me your read on ${name} (${symbol}).`);
  lines.push('');

  if (position?.held) {
    lines.push(`My position: ${ratio(position.quantity, position.quantity % 1 ? 4 : 0)} units, ` +
      `avg cost ${exact(position.avg_cost_inr)}, now worth ${money(position.current_value_inr)} ` +
      `(${percent(position.pnl_percent, { sign: true })}, ${money(position.pnl_inr)}). ` +
      `That is ${percent(position.portfolio_percent)} of the portfolio, ` +
      `classified ${position.sector || 'unclassified'} / ${position.section || 'regular'}.`);
  } else {
    lines.push('I do not currently hold this stock.');
  }

  if (price?.current != null) {
    lines.push(`Last close ${currency === 'USD' ? '$' : '₹'}${ratio(price.current)}.`);
  }

  if (!isEtf && ratios && Object.keys(ratios).length) {
    lines.push(`Ratios: P/E ${ratio(ratios.pe)}, P/B ${ratio(ratios.pb)}, ` +
      `ROE ${percent(ratios.roe)}, ROCE ${percent(ratios.roce)}, ` +
      `dividend yield ${percent(ratios.dividend_yield)}.`);
  }

  if (technicals?.rsi_14 != null) {
    lines.push(`Technicals: RSI ${ratio(technicals.rsi_14, 1)}, ` +
      `MACD histogram ${ratio(technicals.macd?.histogram, 2)}, ` +
      `price vs SMA200 ${percent(technicals.price_vs_sma_200, { sign: true })}.`);
  }

  lines.push('');
  lines.push('What do the recent results and current news say about it, and what ' +
    'should I be watching? Cite your sources.');

  return lines.join('\n');
}

export default function AskAssistantButton({ detail, onAsk }) {
  const name = detail.company?.name || detail.position?.company_name || detail.symbol;

  return (
    <section className="glass-panel rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.03] p-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" /> Ask the assistant about this stock
          </h3>
          <p className="text-[11px] text-slate-500 mt-1 max-w-xl">
            Opens the chat with this page's figures already written in. The
            assistant searches the web and cites what it finds — this page does
            not tell you whether to buy or sell.
          </p>
        </div>
        <button
          onClick={() => onAsk(buildPrompt(detail))}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold
                     transition-colors flex items-center gap-2 shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          Ask about {name.length > 22 ? `${name.slice(0, 22)}…` : name}
        </button>
      </div>
    </section>
  );
}
