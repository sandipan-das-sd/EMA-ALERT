import React, { useEffect, useState } from 'react';
import { logout, API_URL } from '../lib/api.js';

function Sidebar() {
  return (
    <aside className="w-64 bg-white border-r border-slate-200 p-4">
      <div className="text-lg font-semibold mb-6 text-brand">EMA Alert</div>
      <nav className="space-y-2">
        <a className="block rounded px-3 py-2 hover:bg-slate-100" href="#">Dashboard</a>
        <a className="block rounded px-3 py-2 hover:bg-slate-100" href="#">Watchlist</a>
        <a className="block rounded px-3 py-2 hover:bg-slate-100" href="#">Notifications</a>
      </nav>
    </aside>
  );
}

export default function Dashboard({ user, setUser }) {
  const [nifty, setNifty] = useState({ ltp: null, ts: null, error: '' });
  const [wsFailed, setWsFailed] = useState(false);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.hostname}:4000/ws/ticker`;
    const ws = new WebSocket(url);
    const failSafe = setTimeout(() => {
      // If after 5s we have no price, trigger REST fallback
      setWsFailed(true);
    }, 5000);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'tick') {
          setNifty({ ltp: msg.ltp, ts: msg.ts, error: '' });
          clearTimeout(failSafe);
        } else if (msg.type === 'error') {
          setNifty((s) => ({ ...s, error: msg.message }));
        }
      } catch {}
    };
    ws.onerror = () => {
      setNifty((s) => ({ ...s, error: 'Feed connection error' }));
      setWsFailed(true);
    };
    return () => {
      clearTimeout(failSafe);
      ws.close();
    };
  }, []);

  // REST poll fallback if WS fails
  useEffect(() => {
    if (!wsFailed || polling) return;
    setPolling(true);
    let cancelled = false;
    async function pollOnce() {
      try {
        // First attempt local cached tick
        const resCache = await fetch(`${API_URL}/api/market/nifty`);
        if (resCache.ok) {
          const dataCache = await resCache.json();
          if (dataCache?.tick?.ltp) {
            setNifty({ ltp: dataCache.tick.ltp, ts: dataCache.tick.ts, error: '' });
            return true; // prefer websocket-derived / cached tick
          }
        }
        // Then direct LTP hit if cached tick absent
        const res = await fetch(`${API_URL}/api/market/ltp`);
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data?.ltp === 'number') {
          setNifty({ ltp: data.ltp, ts: data.rawTs, error: '' });
        }
      } catch {}
      return false;
    }
    const tick = async () => {
      if (cancelled) return;
      await pollOnce();
      if (cancelled) return;
      const delay = Number(import.meta.env.VITE_LTP_POLL_MS) || 6000;
      setTimeout(tick, delay);
    };
    tick();
    return () => { cancelled = true; setPolling(false); };
  }, [wsFailed]);
  async function onLogout() {
    await logout();
    setUser(null);
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Welcome</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user?.email}</span>
            <button className="btn-primary" onClick={onLogout}>Log out</button>
          </div>
        </div>
        <div className="mb-6">
          <div className="flex items-baseline gap-3">
            <div className="text-sm uppercase tracking-wide text-slate-500">NIFTY 50</div>
            <div className="text-3xl font-semibold">
              {nifty.ltp !== null ? nifty.ltp.toLocaleString('en-IN') : '—'}
            </div>
          </div>
          {nifty.error && (
            <div className="mt-2 text-sm text-red-600">{nifty.error}</div>
          )}
        </div>
      </main>
    </div>
  );
}
