import React, { useEffect, useState, useRef } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { listAlerts, dismissAlert, getInstrument, API_URL } from '../lib/api.js';

export default function Notifications() {
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState('active');
  const [instrumentNames, setInstrumentNames] = useState({});
  const wsRef = useRef(null);

  // Fetch instrument name helper
  const fetchInstrumentName = async (instrumentKey) => {
    try {
      const instrument = await getInstrument(instrumentKey);
      if (instrument) {
        return instrument.tradingSymbol || instrument.name || instrumentKey;
      }
    } catch (err) {
      console.error(`Failed to fetch instrument ${instrumentKey}:`, err);
    }
    return instrumentKey;
  };

  // Load alerts from API
  const loadAlerts = async () => {
    const alertList = await listAlerts({ status });
    setAlerts(alertList);
    
    // Fetch instrument names for all alerts
    const names = {};
    await Promise.all(alertList.map(async (alert) => {
      names[alert.instrumentKey] = await fetchInstrumentName(alert.instrumentKey);
    }));
    setInstrumentNames(names);
  };

  useEffect(() => {
    let mounted = true;
    loadAlerts().then(() => {
      if (!mounted) return;
      
      // Setup WebSocket for real-time alerts
      if (status === 'active') {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = API_URL.replace(/^http/, 'ws') + '/ws/ticker';
        
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        
        ws.onmessage = async (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'alert' && msg.alert) {
              const alert = msg.alert;
              // Fetch instrument name
              const name = await fetchInstrumentName(alert.instrumentKey);
              
              // Create alert object matching API format
              const newAlert = {
                _id: alert._id || `${alert.userId}:${alert.instrumentKey}:${alert.candle?.ts || Date.now()}`,
                userId: alert.userId,
                instrumentKey: alert.instrumentKey,
                timeframe: alert.timeframe || '15m',
                strategy: alert.strategy || 'ema20_cross_up',
                candle: alert.candle,
                ema: alert.ema,
                status: 'active',
                createdAt: alert.createdAt || new Date().toISOString(),
                crossDetectedAt: alert.crossDetectedAt,
                notificationSentAt: alert.notificationSentAt
              };
              
              setAlerts(prev => {
                // Check if alert already exists
                if (prev.some(a => a._id === newAlert._id)) return prev;
                return [newAlert, ...prev];
              });
              
              setInstrumentNames(prev => ({
                ...prev,
                [alert.instrumentKey]: name
              }));
            }
          } catch (err) {
            console.error('[Notifications] WS error:', err);
          }
        };
        
        ws.onerror = (err) => console.error('[Notifications] WebSocket error:', err);
      }
      
      // Poll every 30 seconds for updates
      const pollInterval = setInterval(() => {
        if (mounted) loadAlerts();
      }, 30000);
      
      return () => {
        mounted = false;
        clearInterval(pollInterval);
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      };
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
