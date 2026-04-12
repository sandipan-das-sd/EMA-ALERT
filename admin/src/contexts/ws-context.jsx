/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { WS_URL } from '../lib/runtime-config';

const WsContext = createContext(null);

export function WsProvider({ children }) {
  const socketRef = useRef(null);
  const reconnectRef = useRef(null);
  const attemptRef = useRef(0);

  const [connected, setConnected] = useState(false);
  const [lastMessageAt, setLastMessageAt] = useState(null);
  const [lastError, setLastError] = useState('');
  const [latestType, setLatestType] = useState('');
  const [alertsReceived, setAlertsReceived] = useState(0);
  const [ticksReceived, setTicksReceived] = useState(0);
  const [quotesReceived, setQuotesReceived] = useState(0);
  const [indicesReceived, setIndicesReceived] = useState(0);

  useEffect(() => {
    let alive = true;

    const connect = () => {
      if (!alive) return;
      try {
        const ws = new WebSocket(WS_URL);
        socketRef.current = ws;

        ws.onopen = () => {
          attemptRef.current = 0;
          setConnected(true);
          setLastError('');
        };

        ws.onmessage = (event) => {
          setLastMessageAt(new Date().toISOString());
          try {
            const data = JSON.parse(event.data);
            const type = String(data?.type || '');
            setLatestType(type);

            if (type === 'alert') setAlertsReceived((n) => n + 1);
            if (type === 'tick') setTicksReceived((n) => n + 1);
            if (type === 'quotes') setQuotesReceived((n) => n + 1);
            if (type === 'indices') setIndicesReceived((n) => n + 1);
          } catch {
            setLatestType('unknown');
          }
        };

        ws.onerror = () => {
          setLastError('WebSocket error');
        };

        ws.onclose = () => {
          setConnected(false);
          attemptRef.current += 1;
          const delay = Math.min(1200 * Math.pow(1.6, attemptRef.current), 15000);
          reconnectRef.current = setTimeout(connect, delay);
        };
      } catch (e) {
        setConnected(false);
        setLastError(String(e?.message || e));
      }
    };

    connect();

    return () => {
      alive = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      wsUrl: WS_URL,
      connected,
      lastMessageAt,
      lastError,
      latestType,
      alertsReceived,
      ticksReceived,
      quotesReceived,
      indicesReceived,
    }),
    [alertsReceived, connected, indicesReceived, lastError, lastMessageAt, latestType, quotesReceived, ticksReceived]
  );

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

export function useWsContext() {
  const value = useContext(WsContext);
  if (!value) throw new Error('useWsContext must be used within WsProvider');
  return value;
}
