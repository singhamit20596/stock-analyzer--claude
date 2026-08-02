import React, { useState, useEffect, useCallback } from 'react';
import { History, CheckCircle2, AlertCircle, Clock, RefreshCw, Layers } from 'lucide-react';

export default function SyncLogsView() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sync-logs');
      if (res.ok) setLogs(await res.json());
    } catch (e) {
      console.error('Error fetching sync logs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="space-y-6">
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex justify-between items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center">
            <History className="w-5 h-5 mr-2 text-indigo-400" /> Holdings Update History
          </h2>
          <p className="text-xs text-slate-400">
            Every screenshot ingestion that was verified and saved, most recent first (last 50).
          </p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 shrink-0 transition-all"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        {logs.length === 0 && !loading ? (
          <div className="py-16 text-center space-y-2">
            <History className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm font-bold text-slate-300">No updates recorded yet</p>
            <p className="text-xs text-slate-500">
              Upload a broker screenshot from "Accounts Summary" to create the first entry.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {logs.map((log) => {
              const isSuccess = log.status === 'SUCCESS';
              return (
                <div key={log.id} className="p-4 flex items-center justify-between gap-4 hover:bg-slate-900/40 text-xs">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className={`p-2 rounded-xl border shrink-0 ${
                      isSuccess
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}>
                      {isSuccess ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-200 truncate">{log.account_name}</div>
                      <div className="text-[10px] text-slate-500 flex items-center mt-0.5">
                        <Clock className="w-3 h-3 mr-1 shrink-0" />
                        {log.synced_at ? new Date(log.synced_at).toLocaleString() : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    <span className="text-[10px] font-semibold text-slate-400 flex items-center">
                      <Layers className="w-3 h-3 mr-1 text-indigo-400" />
                      {log.holdings_count} holdings
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                      isSuccess
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}>
                      {log.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
