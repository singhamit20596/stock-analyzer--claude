import React, { useEffect, useState } from 'react';
import { LineChart, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { login, register } from '../auth';

export default function LoginView({ onSignedIn }) {
  const [mode, setMode] = useState('login');       // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Nobody has registered yet, so this browser is about to create the admin.
  const [firstRun, setFirstRun] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status')
      .then((res) => (res.ok ? res.json() : { has_users: true }))
      .then(({ has_users: hasUsers }) => {
        setFirstRun(!hasUsers);
        if (!hasUsers) setMode('register');
      })
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = mode === 'login'
        ? await login(username, password)
        : await register(username, password);
      onSignedIn(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const registering = mode === 'register';

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 mb-3">
            <LineChart className="w-6 h-6 text-indigo-400" />
          </div>
          <h1 className="text-lg font-bold text-slate-100">Stocks Analyzer</h1>
          <p className="text-xs text-slate-500 mt-1">
            {registering ? 'Create your login' : 'Sign in to your portfolio'}
          </p>
        </div>

        {firstRun && (
          <div className="mb-4 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.06] p-3
                          text-[11px] text-indigo-200/90 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-px text-indigo-400" />
            <span>
              No one has registered yet. <strong className="font-semibold">The first
              account becomes the admin</strong> and takes ownership of the
              portfolios already in this app — so make this one yours.
            </span>
          </div>
        )}

        <form onSubmit={submit} className="glass-panel rounded-2xl border border-slate-800 p-5 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm
                         text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              placeholder="amit"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={registering ? 'new-password' : 'current-password'}
              className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm
                         text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              placeholder={registering ? 'at least 8 characters' : '••••••••'}
            />
          </div>

          {error && (
            <p className="text-[11px] text-rose-400 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40
                       disabled:hover:bg-indigo-600 text-white text-sm font-bold transition-colors
                       flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {registering ? 'Create account' : 'Sign in'}
          </button>

          {!firstRun && (
            <button
              type="button"
              onClick={() => { setMode(registering ? 'login' : 'register'); setError(''); }}
              className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition-colors pt-1"
            >
              {registering
                ? 'Already have a login? Sign in'
                : "Don't have a login? Create one"}
            </button>
          )}
        </form>

        <p className="text-[10px] text-slate-600 text-center mt-4">
          Runs on this machine only. Passwords are stored hashed, never in plain text.
        </p>
      </div>
    </div>
  );
}
