import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { listAlerts, dismissAlert, getInstrument } from '../lib/api.js';

export default function Notifications() {
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState('active');
  const [instrumentNames, setInstrumentNames] = useState({});

  useEffect(() => {
    let mounted = true;
    listAlerts({ status }).then(async (alertList) => { 
      if (!mounted) return;
      setAlerts(alertList);
      
      // Fetch instrument names for all alerts
      const names = {};
      await Promise.all(alertList.map(async (alert) => {
        try {
          const instrument = await getInstrument(alert.instrumentKey);
          if (instrument) {
            // For FO instruments, prioritize tradingSymbol which has the full contract details
            names[alert.instrumentKey] = instrument.tradingSymbol || instrument.name || alert.instrumentKey;
          }
        } catch (err) {
          console.error(`Failed to fetch instrument ${alert.instrumentKey}:`, err);
        }
      }));
      
      if (mounted) {
        setInstrumentNames(names);
      }
    });
    return () => { mounted = false; };
  }, [status]);

  async function onDismiss(id) {
    await dismissAlert(id);
    setAlerts(prev => prev.filter(a => a._id !== id));
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Notifications</h2>
          <div className="flex items-center gap-2">
            <select value={status} onChange={e => setStatus(e.target.value)} className="border rounded px-2 py-1 text-sm">
              <option value="active">Active</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
        </div>
        {alerts.length === 0 && <div className="text-sm text-slate-500">No notifications.</div>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {alerts.map(a => (
            <div key={a._id} className="border rounded-xl p-4 bg-white flex flex-col gap-2 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="font-semibold text-sm">EMA20 Cross Up</div>
                {a.status === 'active' && (
                  <button onClick={() => onDismiss(a._id)} className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100">Dismiss</button>
                )}
              </div>
              <div className="font-semibold text-slate-800 truncate" title={a.instrumentKey}>
                {instrumentNames[a.instrumentKey] || a.instrumentKey}
              </div>
              <div className="text-sm">Close: ₹{a.candle?.close?.toFixed?.(2)} | EMA20: ₹{a.ema?.toFixed?.(2)}</div>
              <div className="text-xs text-slate-500">High: ₹{a.candle?.high?.toFixed?.(2)} • Low: ₹{a.candle?.low?.toFixed?.(2)}</div>
              <div className="text-xs text-slate-400">{new Date(a.candle?.ts || 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
