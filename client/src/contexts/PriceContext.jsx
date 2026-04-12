import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { API_URL, getWatchlist } from '../lib/api.js';

const PriceContext = createContext();

export const usePrices = () => {
  const context = useContext(PriceContext);
  if (!context) {
    throw new Error('usePrices must be used within a PriceProvider');
  }
  return context;
};

export const PriceProvider = ({ children, user }) => {
  const location = useLocation();
  const [ticks, setTicks] = useState({}); // instrumentKey -> { ltp, ts, changePct, change }
  const [indices, setIndices] = useState([]); // [{key, ltp, cp, changePct}]
  const [universe, setUniverse] = useState([]); // [{ underlying, symbol, segment, instrumentKey }]
  const [watchlist, setWatchlist] = useState([]);
  const [wsConnection, setWsConnection] = useState(null);
  const [polling, setPolling] = useState(false);

  // Determine what data we need based on current route
  const getCurrentPageNeeds = useCallback(() => {
    const path = location.pathname;
    if (path === '/dashboard') {
      return { needsUniverse: true, needsIndices: true, needsWatchlist: false };
    } else if (path === '/watchlist') {
      return { needsUniverse: false, needsIndices: false, needsWatchlist: true };
    } else {
      // /notes or other pages don't need real-time data
      return { needsUniverse: false, needsIndices: false, needsWatchlist: false };
    }
  }, [location.pathname]);

  // Load universe data when needed
  useEffect(() => {
    const needs = getCurrentPageNeeds();
    if (needs.needsUniverse && user) {
      fetch(`${API_URL}/api/market/universe`)
        .then(r => r.json())
        .then(data => {
          setUniverse(data?.data || []);
        })
        .catch(() => {});
    } else {
      setUniverse([]);
    }
  }, [location.pathname, user, getCurrentPageNeeds]);

  // Load watchlist when needed
  useEffect(() => {
    const needs = getCurrentPageNeeds();
    if (needs.needsWatchlist && user) {
      // First try to use user.watchlist if available
      if (user.watchlist && Array.isArray(user.watchlist)) {
        const wlData = user.watchlist.map(key => ({ key }));
        setWatchlist(wlData);
      } else {
        // Fallback to API call
        getWatchlist().then(wl => {
          const wlData = wl.map(item => ({ 
            key: item.key || item,
            price: item.price,
            changePct: item.changePct,
            change: item.change,
            ts: item.ts
          }));
          setWatchlist(wlData);
        }).catch(() => {});
      }
    } else {
      setWatchlist([]);
    }
  }, [location.pathname, user, getCurrentPageNeeds]);

  // WebSocket connection management
  useEffect(() => {
    const needs = getCurrentPageNeeds();
    const needsRealTime = needs.needsUniverse || needs.needsIndices || (needs.needsWatchlist && watchlist.length > 0);

    if (needsRealTime && user) {
      // Prevent multiple connections
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        console.log('[PriceContext] WebSocket already connected, skipping');
        return;
      }
      
      // Close any existing connection first
      if (wsConnection) {
        try {
          wsConnection.close();
        } catch (e) {
          console.warn('[PriceContext] Error closing existing WebSocket:', e);
        }
        setWsConnection(null);
      }
      
      // Start WebSocket connection
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const port = isLocalhost ? ':4000' : '';
      const url = `${proto}://${window.location.hostname}${port}/ws/ticker`;
      
      console.log('[PriceContext] Connecting to WebSocket:', url);
      const ws = new WebSocket(url);

      const handleMessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          switch (msg.type) {
            case 'tick':
              setTicks(prev => ({ 
                ...prev, 
                [msg.instrumentKey]: { 
                  ltp: msg.ltp, 
                  ts: msg.ts,
                  changePct: msg.changePct,
                  change: msg.change
                } 
              }));
              break;
            case 'quotes':
              if (msg.quotes && Array.isArray(msg.quotes)) {
                const quotesMap = {};
                msg.quotes.forEach(q => {
                  if (q.key && !q.missing) {
                    quotesMap[q.key] = {
                      ltp: q.ltp,
                      ts: q.ts,
                      changePct: q.changePct,
                      change: q.change
                    };
                  }
                });
                setTicks(prev => ({ ...prev, ...quotesMap }));
              }
              break;
            case 'indices':
              if (msg.indices && Array.isArray(msg.indices)) {
                setIndices(msg.indices);
              }
              break;
            case 'info':
              console.log('[WebSocket Info]:', msg.message);
              break;
            case 'error':
              console.error('WebSocket error:', msg.message);
              break;
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };

      const handleOpen = () => {
        console.log('[PriceContext] WebSocket connected');
        setWsConnection(ws);
      };

      const handleClose = () => {
        console.log('[PriceContext] WebSocket disconnected');
        if (wsConnection === ws) {
          setWsConnection(null);
        }
      };

      const handleError = (err) => {
        console.error('[PriceContext] WebSocket error:', err);
        if (wsConnection === ws) {
          setWsConnection(null);
        }
      };

      ws.onmessage = handleMessage;
      ws.onopen = handleOpen;
      ws.onclose = handleClose;
      ws.onerror = handleError;

      return () => {
        console.log('[PriceContext] Cleanup: closing WebSocket');
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        if (wsConnection === ws) {
          setWsConnection(null);
        }
      };
    } else {
      // Clean up when we don't need real-time data
      if (wsConnection) {
        wsConnection.close();
        setWsConnection(null);
      }
      setTicks({});
      setIndices([]);
    }
  }, [location.pathname, user, watchlist.length, getCurrentPageNeeds]);

  // REST API polling fallback (only when WebSocket fails or for critical data)
  useEffect(() => {
    const needs = getCurrentPageNeeds();
    const needsPolling = (needs.needsUniverse || (needs.needsWatchlist && watchlist.length > 0)) && !wsConnection && user;

    if (needsPolling) {
      setPolling(true);
      let cancelled = false;
      let timeoutId = null;

      const pollOnce = async () => {
        if (cancelled) return;
        
        try {
          // Only poll for data we actually need based on current page
          const instrumentKeys = needs.needsUniverse 
            ? universe.map(u => u.instrumentKey).filter(Boolean)
            : needs.needsWatchlist 
            ? watchlist.map(w => w.key).filter(Boolean)
            : [];

          if (instrumentKeys.length === 0) {
            // Retry after delay if no instruments yet
            if (!cancelled) {
              timeoutId = setTimeout(pollOnce, 5000);
            }
            return;
          }

          const batchSize = 50;
          const batches = [];
          for (let i = 0; i < instrumentKeys.length; i += batchSize) {
            batches.push(instrumentKeys.slice(i, i + batchSize));
          }

          const results = await Promise.all(batches.map(async batch => {
            const url = `${API_URL}/api/market/ltp?keys=${encodeURIComponent(batch.join(','))}`;
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) return { data: {} };
            return res.json();
          }));

          const merged = {};
          results.forEach(r => Object.assign(merged, r.data || {}));

          const now = Date.now();
          const quotesMap = {};
          instrumentKeys.forEach(key => {
            const q = merged[key];
            if (q && q.last_price) {
              quotesMap[key] = {
                ltp: q.last_price,
                ts: now,
                changePct: q.cp && q.cp > 0 ? ((q.last_price - q.cp) / q.cp) * 100 : null,
                change: q.cp ? q.last_price - q.cp : null
              };
            }
          });

          if (!cancelled) {
            setTicks(prev => ({ ...prev, ...quotesMap }));
          }
        } catch (e) {
          console.error('[PriceContext] Polling error:', e);
        } finally {
          // Schedule next poll
          if (!cancelled) {
            timeoutId = setTimeout(pollOnce, 10000); // Increased to 10s to reduce server load
          }
        }
      };

      // Start first poll after a small delay
      timeoutId = setTimeout(pollOnce, 1000);

      return () => {
        cancelled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        setPolling(false);
      };
    } else {
      setPolling(false);
    }
  }, [wsConnection, user, universe, watchlist, getCurrentPageNeeds]);

  const value = {
    ticks,
    indices,
    universe,
    watchlist,
    setWatchlist,
    polling,
    connected: !!wsConnection,
    currentPageNeeds: getCurrentPageNeeds()
  };

  return (
    <PriceContext.Provider value={value}>
      {children}
    </PriceContext.Provider>
  );
};