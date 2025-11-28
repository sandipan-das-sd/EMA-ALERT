import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { listAlerts, dismissAlert, getInstrument } from '../lib/api.js';

const AlertContext = createContext();

export function useAlerts() {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlerts must be used within AlertProvider');
  return ctx;
}

export function AlertProvider({ children, user }) {
  const [active, setActive] = useState([]); // active alerts to show as toasts
  const lastPoll = useRef(0);
  const instrumentCache = useRef(new Map()); // Cache instrument details
  const wsRef = useRef(null);

  useEffect(() => {
    if (!user) { setActive([]); return; }
    let stop = false;
    // Real-time: connect to WS for instant alerts
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const port = isLocalhost ? ':4000' : '';
    const url = `${proto}://${window.location.hostname}${port}/ws/ticker`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        console.log('[AlertContext] WS message received:', msg.type, msg.alert ? `for ${msg.alert.instrumentKey}` : '');
        if (msg.type === 'alert' && msg.alert) {
          const a = msg.alert;
          console.log('[AlertContext] Processing alert for user', a.userId, 'current user', user.id);
          // Only show alerts for the current user
          if (String(a.userId) !== String(user.id)) {
            console.log('[AlertContext] Alert not for current user, skipping');
            return;
          }
          console.log('[AlertContext] Alert from server has instrumentName:', a.instrumentName);
          // Enrich instrument name - use provided name or fetch if needed
          let instrumentName = a.instrumentName; // Use name from server if available
          if (!instrumentName && !instrumentCache.current.has(a.instrumentKey)) {
            try {
              const inst = await getInstrument(a.instrumentKey);
              if (inst) {
                instrumentCache.current.set(a.instrumentKey, inst);
                // For FO instruments, prioritize tradingSymbol which has the full contract details
                instrumentName = inst.tradingSymbol || inst.name || a.instrumentKey;
              }
            } catch (err) {
              console.warn('[AlertContext] Failed to fetch instrument details:', err);
            }
          }
          if (!instrumentName && instrumentCache.current.has(a.instrumentKey)) {
            const inst = instrumentCache.current.get(a.instrumentKey);
            // For FO instruments, prioritize tradingSymbol which has the full contract details
            instrumentName = inst.tradingSymbol || inst.name || a.instrumentKey;
          }
          if (!instrumentName) {
            instrumentName = a.instrumentKey; // fallback
          }
          
          const enriched = {
            _id: a._id || `${a.userId}:${a.instrumentKey}:${a.candle?.ts || Date.now()}`, // synthetic id if missing
            instrumentKey: a.instrumentKey,
            instrumentName: instrumentName,
            timeframe: a.timeframe || '15m',
            strategy: a.strategy || 'ema20_cross_up',
            candle: a.candle,
            ema: a.ema,
            status: 'active',
            createdAt: a.createdAt || new Date().toISOString(),
          };
          console.log('[AlertContext] Adding enriched alert to UI:', enriched.instrumentName);
          setActive(prev => {
            const map = new Map(prev.map(x => [x._id, x]));
            map.set(enriched._id, enriched);
            console.log('[AlertContext] Active alerts count:', map.size);
            return Array.from(map.values());
          });
        }
      } catch (err) {
        console.error('[AlertContext] Error processing WS message:', err);
      }
    };
    ws.onopen = () => {
      console.log('[AlertContext] WebSocket connected successfully');
    };
    ws.onclose = () => { 
      console.log('[AlertContext] WebSocket disconnected');
      wsRef.current = null; 
    };
    ws.onerror = (err) => {
      console.error('[AlertContext] WebSocket error:', err);
    };
    const poll = async () => {
      try {
        const since = lastPoll.current ? lastPoll.current : undefined;
        const alerts = await listAlerts({ status: 'active', since });
        if (stop) return;
        if (alerts.length) {
          // Log alert details to browser console for debugging
          console.log('[AlertContext] New alerts received:', alerts.length);
          alerts.forEach(alert => {
            console.log('[AlertContext] Alert:', {
              instrumentKey: alert.instrumentKey,
              timeframe: alert.timeframe,
              strategy: alert.strategy,
              candle: alert.candle,
              ema: alert.ema,
              timestamp: new Date(alert.candle?.ts || 0).toISOString(),
              createdAt: alert.createdAt
            });
          });
          
          // Fetch instrument details for each alert
          const enrichedAlerts = await Promise.all(alerts.map(async (alert) => {
            if (!instrumentCache.current.has(alert.instrumentKey)) {
              try {
                const instrument = await getInstrument(alert.instrumentKey);
                if (instrument) {
                  instrumentCache.current.set(alert.instrumentKey, instrument);
                }
              } catch (err) {
                console.error(`[AlertContext] Failed to fetch instrument ${alert.instrumentKey}:`, err);
              }
            }
            
            const instrument = instrumentCache.current.get(alert.instrumentKey);
            return {
              ...alert,
              // For FO instruments, prioritize tradingSymbol which has the full contract details
              instrumentName: instrument?.tradingSymbol || instrument?.name || alert.instrumentKey
            };
          }));
          
          // Merge unique by id
          setActive(prev => {
            const map = new Map(prev.map(a => [a._id, a]));
            enrichedAlerts.forEach(a => { map.set(a._id, a); });
            return Array.from(map.values());
          });
        }
        lastPoll.current = Date.now();
      } catch (err) {
        console.error('[AlertContext] Error fetching alerts:', err);
      }
    };
    const id = setInterval(poll, 15_000);
    poll();
    return () => { stop = true; clearInterval(id); if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; } };
  }, [user]);

  async function dismiss(id) {
    try {
      await dismissAlert(id);
      setActive(prev => prev.filter(a => a._id !== id));
    } catch {}
  }

  const value = useMemo(() => ({ active, dismiss }), [active]);

  return (
    <AlertContext.Provider value={value}>
      {children}
      {/* Toasts overlay */}
      <div className="fixed top-4 right-4 z-50 space-y-3">
        {active.map(a => (
          <div key={a._id} className="w-80 bg-white border shadow-lg rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="font-semibold text-sm">EMA20 Cross Up</div>
              <button onClick={() => dismiss(a._id)} className="text-xs text-slate-500 hover:text-slate-700">Dismiss</button>
            </div>
            <div className="mt-2 text-sm">
              <div className="font-semibold text-slate-800 truncate" title={a.instrumentKey}>{a.instrumentName || a.instrumentKey}</div>
              <div className="text-slate-600 text-xs mt-1">15m | Close: ₹{a.candle?.close?.toFixed?.(2)} | EMA20: ₹{a.ema?.toFixed?.(2)}</div>
              <div className="text-slate-500 text-xs">High: ₹{a.candle?.high?.toFixed?.(2)} • Low: ₹{a.candle?.low?.toFixed?.(2)}</div>
              <div className="text-slate-400 text-xs mt-1">{new Date(a.candle?.ts || 0).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  );
}
