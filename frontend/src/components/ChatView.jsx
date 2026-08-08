import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Search, AlertCircle, Trash2, Loader2 } from 'lucide-react';

const SUGGESTIONS = [
  'Which of my holdings are down the most, and why?',
  "What's the latest guidance from Meta for next quarter?",
  'How concentrated am I in Financials — is that risky?',
  'Compare my US holdings to how the Nasdaq has done this year.',
];

// The reply is Markdown-ish. Rather than pull in a Markdown library, render the
// handful of constructs the model actually uses: headings, bullets, tables,
// code, bold, and links.
function renderInline(text, keyPrefix) {
  const parts = [];
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  let last = 0;
  let match;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      parts.push(
        <a key={`${keyPrefix}-a${i}`} href={match[3]} target="_blank" rel="noreferrer"
           className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      parts.push(<strong key={`${keyPrefix}-b${i}`} className="font-bold text-slate-100">{match[5]}</strong>);
    } else if (match[6]) {
      parts.push(
        <code key={`${keyPrefix}-c${i}`} className="px-1 py-0.5 rounded bg-slate-800 text-[11px] text-amber-300">
          {match[7]}
        </code>
      );
    }
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdown({ text }) {
  const lines = (text || '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table: a header row followed by a |---|---| separator.
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      const body = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) { body.push(cells(lines[i])); i += 1; }
      out.push(
        <div key={`t${i}`} className="overflow-x-auto my-2">
          <table className="text-[11px] border-collapse">
            <thead>
              <tr className="border-b border-slate-700">
                {head.map((h, x) => (
                  <th key={x} className="py-1.5 px-2.5 text-left font-bold text-slate-400 whitespace-nowrap">
                    {renderInline(h, `th${x}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {body.map((r, y) => (
                <tr key={y}>
                  {r.map((c, x) => (
                    <td key={x} className="py-1.5 px-2.5 text-slate-300 whitespace-nowrap">
                      {renderInline(c, `td${y}-${x}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      out.push(
        <p key={`h${i}`} className="font-bold text-slate-100 mt-3 mb-1">
          {renderInline(heading[2], `h${i}`)}
        </p>
      );
      i += 1;
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      out.push(
        <ul key={`l${i}`} className="my-1.5 space-y-1">
          {items.map((item, x) => (
            <li key={x} className="flex gap-2">
              <span className="text-slate-600 shrink-0">•</span>
              <span>{renderInline(item, `li${i}-${x}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (line.trim() === '') { i += 1; continue; }

    const para = [];
    while (i < lines.length && lines[i].trim() !== ''
           && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^\s*\|/.test(lines[i])
           && !/^#{1,4}\s/.test(lines[i])) {
      para.push(lines[i]); i += 1;
    }
    out.push(
      <p key={`p${i}`} className="my-1.5 leading-relaxed">
        {renderInline(para.join(' '), `p${i}`)}
      </p>
    );
  }
  return <div>{out}</div>;
}

export default function ChatView({ initialPrompt = '', onPromptConsumed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  // A question handed over from a stock page is filled in rather than sent, so
  // it can be edited before it goes.
  useEffect(() => {
    if (!initialPrompt) return;
    setInput(initialPrompt);
    taRef.current?.focus();
    onPromptConsumed?.();
  }, [initialPrompt, onPromptConsumed]);

  // The box starts one row tall, which would hide most of a handed-over
  // question, so it grows to fit what is in it.
  useEffect(() => {
    const box = taRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [input]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;

    const next = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setError('');
    setBusy(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail || 'The assistant could not be reached.');
        setMessages(messages);
        setInput(question);
        return;
      }
      setMessages([...next, {
        role: 'assistant',
        content: body.reply,
        searches: body.searches || [],
      }]);
    } catch {
      setError('Could not reach the server.');
      setMessages(messages);
      setInput(question);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="space-y-4">
      <div className="glass-panel p-5 rounded-2xl border border-slate-800 flex justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center">
            <Sparkles className="w-5 h-5 mr-2 text-indigo-400" /> Portfolio Assistant
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Knows every holding, sector and target in this app, and searches the web for
            anything current. Analysis only — not financial advice.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setError(''); }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 flex flex-col" style={{ minHeight: '55vh' }}>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {messages.length === 0 && !busy && (
            <div className="py-10 text-center space-y-5">
              <Sparkles className="w-10 h-10 text-slate-700 mx-auto" />
              <p className="text-sm text-slate-400">Ask anything about your portfolio.</p>
              <div className="flex flex-wrap justify-center gap-2 max-w-2xl mx-auto">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="px-3 py-2 rounded-xl bg-slate-800/70 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-300 text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              {m.role === 'user' ? (
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-indigo-500/15 border border-indigo-500/25 px-4 py-2.5 text-sm text-slate-100">
                  {m.content}
                </div>
              ) : (
                <div className="max-w-[92%]">
                  {m.searches?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {m.searches.map((q, x) => (
                        <span key={x} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/70 border border-slate-700 text-[10px] text-slate-400">
                          <Search className="w-2.5 h-2.5" /> {q}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-sm text-slate-300">
                    <Markdown text={m.content} />
                  </div>
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              Thinking — may take a moment if it needs to search.
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-400 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> <span>{error}</span>
            </p>
          )}

          <div ref={endRef} />
        </div>

        <div className="border-t border-slate-800 p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={taRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask about your holdings, or anything current on the web..."
              className="flex-1 resize-none bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 max-h-40"
              style={{ minHeight: '42px' }}
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              className="p-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white disabled:opacity-40 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-slate-600 mt-1.5 px-1">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}
