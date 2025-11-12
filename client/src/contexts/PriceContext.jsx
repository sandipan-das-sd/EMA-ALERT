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
      // Start WebSocket connection
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${window.location.hostname}:4000/ws/ticker`;
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
            case 'error':
              console.error('WebSocket error:', msg.message);
              break;
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };

      const handleOpen = () => {
        console.log('WebSocket connected');
        setWsConnection(ws);
      };

      const handleClose = () => {
        console.log('WebSocket disconnected');
        setWsConnection(null);
      };

      const handleError = (err) => {
        console.error('WebSocket error:', err);
        setWsConnection(null);
      };

      ws.onmessage = handleMessage;
      ws.onopen = handleOpen;
      ws.onclose = handleClose;
      ws.onerror = handleError;

      return () => {
        ws.close();
        setWsConnection(null);
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

      const pollOnce = async () => {
        try {
          // Only poll for data we actually need based on current page
          const instrumentKeys = needs.needsUniverse 
            ? universe.map(u => u.instrumentKey).filter(Boolean)
            : needs.needsWatchlist 
            ? watchlist.map(w => w.key).filter(Boolean)
            : [];

          if (instrumentKeys.length === 0) return;

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
          console.error('Polling error:', e);
        }
      };

      const interval = setInterval(() => {
        if (!cancelled) {
          pollOnce();
        }
      }, 6000); // Poll every 6 seconds as fallback

      // Initial poll
      pollOnce();

      return () => {
        cancelled = true;
        clearInterval(interval);
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