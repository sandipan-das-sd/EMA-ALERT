import React, { useEffect, useState } from 'react';
import { logout, API_URL, addToWatchlist } from '../lib/api.js';
import Sidebar from '../components/Sidebar.jsx';
import MarketClock from '../components/MarketClock.jsx';
import InstrumentDebug from '../components/InstrumentDebug.jsx';

// Sidebar moved to shared component

export default function Dashboard({ user, setUser }) {
  const [indices, setIndices] = useState([]); // [{key, ltp, cp, changePct}]
  const [ticks, setTicks] = useState({}); // instrumentKey -> { ltp, ts }
  const [adding, setAdding] = useState({}); // instrumentKey -> boolean
  const [nifty, setNifty] = useState({ ltp: null, ts: null, error: '' });
  const [wsFailed, setWsFailed] = useState(false);
  const [polling, setPolling] = useState(false);
  const [universe, setUniverse] = useState([]); // [{ underlying, symbol, segment, instrumentKey }]

  useEffect(() => {
    // Load instrument universe from server (scales to 200+)
    fetch(`${API_URL}/api/market/universe`).then(r => r.json()).then(data => {
      setUniverse(data?.data || []);
    }).catch(()=>{});

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
        switch (msg.type) {
          case 'tick':
            // If we have indices list, update matching key
            if (msg.instrumentKey === 'NSE_INDEX|Nifty 50') {
              setNifty({ ltp: msg.ltp, ts: msg.ts, error: '' });
            }
            setTicks(prev => ({ 
              ...prev, 
              [msg.instrumentKey]: { 
                ltp: msg.ltp, 
                ts: msg.ts,
                changePct: msg.changePct,
                change: msg.change
              } 
            }));
            clearTimeout(failSafe);
            break;
          case 'indices':
            setIndices(msg.data || []);
            const niftyIndex = (msg.data || []).find(i => i.key === 'NSE_INDEX|Nifty 50');
            if (niftyIndex && typeof niftyIndex.ltp === 'number') {
              setNifty({ ltp: niftyIndex.ltp, ts: Date.now(), error: '' });
              clearTimeout(failSafe);
            }
            break;
          case 'quotes':
            // Bulk quotes update
            const map = {};
            (msg.data || []).forEach(q => {
              if (typeof q.ltp === 'number') {
                map[q.key] = { 
                  ltp: q.ltp, 
                  ts: q.ts, 
                  changePct: q.changePct,
                  change: q.change || (q.ltp && q.cp ? q.ltp - q.cp : null)
                };
              }
            });
            setTicks(prev => ({ ...prev, ...map }));
            break;
          // gainers/losers removed per request
          case 'error':
            setNifty((s) => ({ ...s, error: msg.message }));
            break;
          default:
            break;
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

  async function handleAdd(key) {
    if (adding[key]) return;
    setAdding(a => ({ ...a, [key]: true }));
    try {
      await addToWatchlist(key);
    } catch (e) {
      // Could toast error; keep silent for now
    } finally {
      setAdding(a => ({ ...a, [key]: false }));
    }
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Welcome {user?.name}</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user?.email}</span>
            <button className="btn-primary" onClick={onLogout}>Log out</button>
          </div>
        </div>
        <MarketClock exchange="NSE" />
        {/* Indices strip */}
        <div className="mb-6 space-y-2">
          <div className="flex flex-wrap gap-6">
            {['NSE_INDEX|Nifty 50','NSE_INDEX|Nifty Bank'].map(key => {
              const item = indices.find(i => i.key === key);
              const ltp = item?.ltp;
              const changePct = item?.changePct;
              const isUp = typeof changePct === 'number' && changePct >= 0;
              return (
                <div key={key} className="flex flex-col">
                  <div className="text-xs uppercase tracking-wide text-slate-500">{key.split('|')[1]}</div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-xl font-semibold">
                      {typeof ltp === 'number' ? ltp.toLocaleString('en-IN') : '—'}
                    </div>
                    <div className={"text-sm font-medium " + (isUp ? 'text-green-600' : 'text-red-600')}>
                      {typeof changePct === 'number' ? (changePct >=0 ? '+' : '') + changePct.toFixed(2) + '%' : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {nifty.error && <div className="text-sm text-red-600">{nifty.error}</div>}
        </div>

        {/* Instrument universe with live ticks */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-3">Instruments</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {universe.map(item => {
              const key = item.instrumentKey || `${item.segment}|${item.symbol}`;
              const tick = ticks[key];
              const ltp = tick?.ltp;
              const changePct = tick?.changePct;
              const change = tick?.change;
              const isUp = typeof changePct === 'number' && changePct >= 0;
              
              return (
                <div key={key} className="border rounded-lg p-3 bg-white flex flex-col gap-2 shadow-sm hover:shadow-md transition">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col">
                      <div className="text-sm font-semibold tracking-wide" title={item.underlying}>{item.symbol}</div>
                      <div className="text-xs text-slate-500 max-w-[160px] truncate" title={item.underlying}>{item.underlying}</div>
                    </div>
                    <button
                      onClick={() => handleAdd(key)}
                      className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700"
                      disabled={adding[key]}
                    >{adding[key] ? 'Adding…' : 'Add'}</button>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <div className={`text-xl font-semibold tabular-nums ${
                      typeof changePct === 'number' 
                        ? (changePct >= 0 ? 'text-green-600' : 'text-red-600')
                        : 'text-gray-900'
                    }`}>
                      {typeof ltp === 'number' ? ltp.toLocaleString('en-IN') : '—'}
                    </div>
                    {typeof changePct === 'number' && (
                      <div className={`text-sm font-medium tabular-nums ${isUp ? 'text-green-600' : 'text-red-600'}`}>
                        {isUp ? '+' : ''}{changePct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                  {typeof change === 'number' && (
                    <div className={`text-xs tabular-nums ${isUp ? 'text-green-600' : 'text-red-600'}`}>
                      {isUp ? '+' : ''}₹{Math.abs(change).toFixed(2)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Gainers/Losers removed per request */}
      </main>
      <InstrumentDebug />
    </div>
  );
}
