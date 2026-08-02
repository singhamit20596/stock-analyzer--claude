import React from 'react';
import { History, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

export default function SyncLogsModal({ logs }) {
  return (
    <div className="space-y-6">
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center">
            <History className="w-5 h-5 mr-2 text-indigo-400" /> Automated & Manual Sync Execution Audit Logs
          </h2>
          <p className="text-xs text-slate-400">Shows daily end-of-day background job runs and manual refresh history.</p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="divide-y divide-slate-800">
          {(logs || []).map((log) => {
            const isSuccess = log.status === 'SUCCESS';
            return (
              <div key={log.id} className="p-4 flex items-center justify-between hover:bg-slate-900/40 text-xs">
                <div className="flex items-center space-x-3">
                  {isSuccess ? (
                    <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-slate-200">{log.message}</div>
                    <div className="text-[10px] text-slate-500 flex items-center mt-0.5">
                      <Clock className="w-3 h-3 mr-1" />
                      {new Date(log.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>

                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  isSuccess ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                }`}>
                  {log.status}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
