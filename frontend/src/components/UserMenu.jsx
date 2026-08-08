import React, { useEffect, useRef, useState } from 'react';
import { UserCircle, LogOut, Eye, Check, ShieldCheck } from 'lucide-react';

/** Signed-in identity, plus the admin's switcher for viewing another user. */
export default function UserMenu({ user, viewAs, onViewAs, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const isAdmin = user.role === 'admin';
  const others = (user.users || []).filter((u) => u.id !== user.id);
  const viewing = (user.users || []).find((u) => u.id === viewAs);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-700
                   bg-slate-900/70 hover:bg-slate-800 transition-colors"
      >
        <UserCircle className="w-4 h-4 text-slate-400" />
        <span className="text-xs font-semibold text-slate-200">
          {viewing ? viewing.username : user.username}
        </span>
        {viewing && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
            viewing
          </span>
        )}
        {!viewing && isAdmin && (
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" aria-label="admin" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-700 bg-slate-900
                        shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-800">
            <p className="text-xs font-bold text-slate-100">{user.username}</p>
            <p className="text-[10px] text-slate-500">
              {isAdmin ? 'Admin' : 'Standard user'}
            </p>
          </div>

          {isAdmin && others.length > 0 && (
            <div className="py-1 border-b border-slate-800">
              <p className="px-3 py-1 text-[9px] uppercase tracking-wider font-bold text-slate-600">
                View another user
              </p>
              <button
                onClick={() => { onViewAs(null); setOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800
                           flex items-center justify-between"
              >
                <span>{user.username} (me)</span>
                {!viewAs && <Check className="w-3.5 h-3.5 text-indigo-400" />}
              </button>
              {others.map((u) => (
                <button
                  key={u.id}
                  onClick={() => { onViewAs(u.id); setOpen(false); }}
                  className="w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800
                             flex items-center justify-between"
                >
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-3 h-3 text-slate-500" /> {u.username}
                  </span>
                  {viewAs === u.id && <Check className="w-3.5 h-3.5 text-amber-400" />}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onLogout}
            className="w-full px-3 py-2.5 text-left text-xs text-slate-300 hover:bg-slate-800
                       flex items-center gap-2"
          >
            <LogOut className="w-3.5 h-3.5 text-slate-500" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
