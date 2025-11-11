import React, { useEffect, useState, useRef } from 'react';
import { getWatchlist, removeFromWatchlist } from '../lib/api.js';
import Sidebar from '../components/Sidebar.jsx';
import MarketClock from '../components/MarketClock.jsx';

export default function Watchlist({ user }) {
  const [items, setItems] = useState([]); // [{key, price, changePct, ts}]
  const wsRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    getWatchlist().then((wl) => { if (mounted) setItems(wl); });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.hostname}:4000/ws/ticker`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'tick') {
          setItems((prev) => prev.map(it => it.key === msg.instrumentKey ? { 
            ...it, 
            price: msg.ltp, 
            ts: msg.ts,
            changePct: msg.changePct,
            change: msg.change 
          } : it));
        }
      } catch {}
    };
    return () => { mounted = false; ws.close(); };
  }, []);

  async function onRemove(key) {
    await removeFromWatchlist(key);
    const wl = await getWatchlist();
    setItems(wl);
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Your Watchlist</h2>
          <div className="text-sm text-slate-500">{user?.email}</div>
        </div>
        <MarketClock exchange="NSE" compact />
        {items.length === 0 && <div className="text-sm text-slate-500">Empty watchlist. Add instruments from Dashboard.</div>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map(item => {
            const isUp = typeof item.changePct === 'number' && item.changePct >= 0;
            return (
              <div key={item.key} className="border rounded-lg p-3 bg-white flex flex-col gap-2 shadow-sm hover:shadow-md transition">
                <div className="flex items-start justify-between">
                  <div className="flex flex-col">
                    <div className="text-sm font-semibold tracking-wide" title={item.key}>{item.key.split('|')[1]}</div>
                    <div className="text-xs text-slate-500">{item.key.split('|')[0]}</div>
                  </div>
                  <button onClick={() => onRemove(item.key)} className="text-xs text-red-600 hover:text-red-700">Remove</button>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className={`text-xl font-semibold tabular-nums ${
                    typeof item.changePct === 'number' 
                      ? (item.changePct >= 0 ? 'text-green-600' : 'text-red-600')
                      : 'text-gray-900'
                  }`}>
                    {typeof item.price === 'number' ? item.price.toLocaleString('en-IN') : '—'}
                  </span>
                  {typeof item.changePct === 'number' && (
                    <span className={`text-sm font-medium tabular-nums ${isUp ? 'text-green-600' : 'text-red-600'}`}>
                      {isUp ? '+' : ''}{item.changePct.toFixed(2)}%
                    </span>
                  )}
                </div>
                {typeof item.change === 'number' && (
                  <div className={`text-xs tabular-nums ${isUp ? 'text-green-600' : 'text-red-600'}`}>
                    {isUp ? '+' : ''}₹{Math.abs(item.change).toFixed(2)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
