import React, { useEffect, useState } from 'react';
import { marketStatus } from '../lib/api.js';

function formatIST(date) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    // Fallback without timezone if Intl unavailable
    return date.toLocaleTimeString();
  }
}

function formatISTDate(date) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: 'short', day: '2-digit', weekday: 'short'
    }).format(date);
  } catch {
    return date.toDateString();
  }
}

export default function MarketClock({ exchange = 'NSE', compact = false, fullWidth = false }) {
  const [now, setNow] = useState(new Date());
  const [status, setStatus] = useState({ exchange, isOpen: null, statusText: 'Loading…' });
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function load() {
      try {
        const data = await marketStatus(exchange);
        if (!cancelled) {
          setStatus(data);
          setError('');
        }
      } catch (e) {
        if (!cancelled) {
          setError('Status unavailable');
        }
      } finally {
        if (!cancelled) timer = setTimeout(load, 60_000);
      }
    }
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [exchange]);

  const color = status.isOpen === true ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : status.isOpen === false ? 'bg-rose-100 text-rose-700 border-rose-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';

  const time = formatIST(now);
  const dateStr = formatISTDate(now);
  const rawStatus = String(status.statusText || '').toUpperCase();
  let pillText = 'Unknown';
  let pillColor = color;
  // Map Upstox status appendix to UI-friendly pill
  switch (rawStatus) {
    case 'NORMAL_OPEN':
      pillText = 'Opened';
      pillColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
      break;
    case 'NORMAL_CLOSE':
      pillText = 'Closed';
      pillColor = 'bg-rose-100 text-rose-700 border-rose-200';
      break;
    case 'PRE_OPEN_START':
    case 'PRE_OPEN_END':
      pillText = 'Pre-Open';
      pillColor = 'bg-yellow-100 text-yellow-800 border-yellow-200';
      break;
    case 'CLOSING_START':
      pillText = 'Closing';
      pillColor = 'bg-yellow-100 text-yellow-800 border-yellow-200';
      break;
    case 'CLOSING_END':
      pillText = 'Closed';
      pillColor = 'bg-rose-100 text-rose-700 border-rose-200';
      break;
    default:
      if (status.isOpen === true) { pillText = 'Opened'; pillColor = 'bg-emerald-100 text-emerald-800 border-emerald-200'; }
      else if (status.isOpen === false) { pillText = 'Closed'; pillColor = 'bg-rose-100 text-rose-700 border-rose-200'; }
      else { pillText = 'Unknown'; pillColor = 'bg-slate-100 text-slate-700 border-slate-200'; }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <div className={`text-xs px-2 py-1 rounded border ${pillColor}`}>Market: {pillText}</div>
        <div className="text-xs text-slate-600">{exchange} • {time}</div>
      </div>
    );
  }

  if (fullWidth) {
    return (
      <div className="w-full mb-6 p-6 border rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-sm text-slate-600 font-medium">{exchange} Market</div>
              <div className="text-3xl font-bold tabular-nums text-slate-800">{time} IST</div>
              <div className="text-sm text-slate-500 mt-1">{dateStr}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`text-lg px-4 py-2 rounded-full border-2 font-semibold ${pillColor}`}>
              {pillText}
            </div>
            {error && <div className="text-sm text-rose-600 font-medium">{error}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 p-4 border rounded-lg bg-white shadow-sm flex items-center justify-between">
      <div>
        <div className="text-sm text-slate-500">{dateStr} • {exchange}</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{time} IST</div>
      </div>
      <div className="flex items-center gap-3">
        <div className={`text-sm px-3 py-1.5 rounded-full border ${pillColor}`}>{pillText}</div>
        {error && <div className="text-xs text-rose-600">{error}</div>}
      </div>
    </div>
  );
}
