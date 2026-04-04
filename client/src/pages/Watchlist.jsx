import React, { useEffect, useState, useRef } from "react";
import { getWatchlist, removeFromWatchlist, updateWatchlistLots } from "../lib/api.js";
import Sidebar from "../components/Sidebar.jsx";
import MarketClock from "../components/MarketClock.jsx";
import {
  convertToTradingViewSymbol,
  getInstrumentDisplayName,
} from "../lib/tradingview.js";

export default function Watchlist({ user, setUser }) {
  const [items, setItems] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    getWatchlist().then((wl) => {
      if (mounted) {
        setItems(wl);
        console.log(
          "[Watchlist] Loaded watchlist items:",
          wl.map((item) => `${item.key}: ${item.price}`)
        );
      }
    });

    // Periodic refresh as fallback to ensure prices stay updated
    const refreshInterval = setInterval(() => {
      if (mounted) {
        getWatchlist()
          .then((wl) => {
            if (mounted) {
              setItems(wl);
              console.log("[Watchlist] Periodic refresh completed");
            }
          })
          .catch((err) => console.error("Periodic refresh failed:", err));
      }
    }, 30000); // Refresh every 30 seconds

    // Only start WebSocket for watchlist page - this implements route-based calling
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const port = isLocalhost ? ':4000' : '';
    const url = `${proto}://${window.location.hostname}${port}/ws/ticker`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      console.log("[Watchlist] WebSocket connected, refreshing data...");
      // Refresh watchlist data when WebSocket connects to get latest prices
      getWatchlist().then((wl) => {
        setItems(wl);
        console.log(
          "[Watchlist] Refreshed watchlist on WS connect:",
          wl.map((item) => `${item.key}: ${item.price}`)
        );
      });
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        console.log("[Watchlist] WebSocket message:", msg);

        if (msg.type === "tick") {
          console.log(
            `[Watchlist] Processing tick for ${msg.instrumentKey}: ${msg.ltp}`
          );
          setItems((prev) => {
            const updated = prev.map((it) => {
              // Try to match on exact key or try alternative formats
              const keyMatches =
                it.key === msg.instrumentKey ||
                it.key.replace(/\|/g, ":") === msg.instrumentKey ||
                it.key.replace(/:/g, "|") === msg.instrumentKey;

              if (keyMatches) {
                console.log(
                  `[Watchlist] Updating ${it.key}: ${it.price} -> ${msg.ltp}`
                );
                return {
                  ...it,
                  price: msg.ltp,
                  ts: msg.ts,
                  changePct: msg.changePct,
                  change: msg.change,
                };
              }
              return it;
            });
            return updated;
          });
        } else if (msg.type === "quotes") {
          console.log(
            `[Watchlist] Processing quotes batch: ${msg.data?.length} items`
          );
          setItems((prev) => {
            const updated = prev.map((it) => {
              const quote = msg.data?.find(
                (q) =>
                  q.key === it.key ||
                  q.key.replace(/\|/g, ":") === it.key ||
                  q.key.replace(/:/g, "|") === it.key ||
                  it.key.replace(/\|/g, ":") === q.key ||
                  it.key.replace(/:/g, "|") === q.key
              );
              if (quote && !quote.missing && typeof quote.ltp === "number") {
                console.log(
                  `[Watchlist] Updating from quotes ${it.key}: ${it.price} -> ${quote.ltp}`
                );
                return {
                  ...it,
                  price: quote.ltp,
                  ts: quote.ts,
                  changePct: quote.changePct,
                  change: quote.change,
                };
              }
              return it;
            });
            return updated;
          });
        }
      } catch (e) {
        console.error("WebSocket message error:", e);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error in Watchlist:", err);
      setWsConnected(false);
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      mounted = false;
      ws.close();
      clearInterval(refreshInterval);
    };
  }, []);

  async function onRemove(key) {
    try {
      const updatedWatchlist = await removeFromWatchlist(key);
      // Update global user state to trigger re-renders in other components
      if (updatedWatchlist && Array.isArray(updatedWatchlist)) {
        setUser((prevUser) => ({ ...prevUser, watchlist: updatedWatchlist }));
      }
      // Refresh local watchlist data
      const wl = await getWatchlist();
      setItems(wl);
    } catch (error) {
      console.error("Error removing from watchlist:", error);
    }
  }

  async function onUpdateLots(key, newLots) {
    if (!Number.isInteger(newLots) || newLots < 1) return;
    try {
      await updateWatchlistLots(key, newLots);
      setItems((prev) => prev.map((it) => it.key === key ? { ...it, lots: newLots } : it));
    } catch (error) {
      console.error("Error updating lots:", error);
    }
  }

  function openChart(item) {
    console.log("[Watchlist] Opening chart for item:", item);

    // For F&O instruments, construct a proper key using segment and tradingSymbol
    // Otherwise use the existing key
    let instrumentKey = item.key;
    if (item.segment && item.segment.includes('FO') && item.tradingSymbol) {
      instrumentKey = `${item.segment}|${item.tradingSymbol}`;
    }

    // Extract the actual trading symbol
    const actualSymbol = item.tradingSymbol || item.symbol || "";

    const tvSymbol = convertToTradingViewSymbol(
      instrumentKey,
      actualSymbol,
      item.name,
      item.expiry
    );
    const name = getInstrumentDisplayName(item);

    console.log("[Watchlist] TradingView symbol:", tvSymbol, "Name:", name);

    if (tvSymbol) {
      const url = `https://in.tradingview.com/chart/YsevYcgp/?symbol=${encodeURIComponent(
        tvSymbol
      )}&interval=15`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Your Watchlist</h2>
          <div className="text-sm text-slate-500">{user?.email}</div>
        </div>
        <div className="mb-6 flex items-center justify-between">
          <MarketClock exchange="NSE" compact />
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-400">
              {items.length} instrument{items.length !== 1 ? "s" : ""} in
              watchlist
            </div>
            <div className="flex items-center gap-2 text-sm">
              {wsConnected ? (
                <span className="text-green-600 flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  Live Feed
                </span>
              ) : (
                <span className="text-gray-500 flex items-center gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                  Offline
                </span>
              )}
            </div>
          </div>
        </div>
        {items.length === 0 && (
          <div className="text-sm text-slate-500">
            Empty watchlist. Add instruments from Dashboard.
          </div>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item) => {
            const isUp =
              typeof item.changePct === "number" && item.changePct >= 0;
            const hasPrice = typeof item.price === "number";

            return (
              <div
                key={item.key}
                className="border rounded-xl p-4 bg-white flex flex-col gap-3 shadow-sm hover:shadow-lg transition transform hover:-translate-y-1 cursor-pointer"
                onClick={() => openChart(item)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex flex-col">
                    <div
                      className="text-sm font-bold tracking-wide text-gray-900"
                      title={item.name}
                    >
                      {item.tradingSymbol || item.name}
                    </div>
                    {item.name && item.tradingSymbol !== item.name && (
                      <div
                        className="text-xs text-gray-600 mt-1 truncate"
                        title={item.name}
                      >
                        {item.name.length > 25
                          ? `${item.name.substring(0, 25)}...`
                          : item.name}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(item.key);
                    }}
                    className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100"
                  >
                    Remove
                  </button>
                </div>
                {/* Lots / qty control */}
                {(() => {
                  const lots = item.lots ?? 1;
                  const lotSize = item.lotSize ?? 1;
                  const totalQty = lots * lotSize;
                  const showLots = lotSize > 1 || lots > 1;
                  return showLots ? (
                    <div
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-xs text-gray-500">Lots:</span>
                      <button
                        className="w-6 h-6 rounded border text-sm font-bold leading-none hover:bg-gray-100"
                        onClick={() => onUpdateLots(item.key, lots - 1)}
                        disabled={lots <= 1}
                      >−</button>
                      <span className="text-sm font-semibold tabular-nums w-6 text-center">{lots}</span>
                      <button
                        className="w-6 h-6 rounded border text-sm font-bold leading-none hover:bg-gray-100"
                        onClick={() => onUpdateLots(item.key, lots + 1)}
                      >+</button>
                      <span className="text-xs text-gray-400">{lotSize > 1 ? `× ${lotSize} = ${totalQty} qty` : `qty`}</span>
                    </div>
                  ) : null;
                })()}
                <div className="flex items-baseline gap-3">
                  <span
                    className={`text-xl font-semibold tabular-nums ${
                      hasPrice && typeof item.changePct === "number"
                        ? item.changePct >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : "text-gray-900"
                    }`}
                  >
                    {hasPrice
                      ? `₹${item.price.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "No data"}
                  </span>
                  {hasPrice && typeof item.changePct === "number" && (
                    <span
                      className={`text-sm font-medium tabular-nums ${
                        isUp ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {isUp ? "+" : ""}
                      {item.changePct.toFixed(2)}%
                    </span>
                  )}
                </div>
                {hasPrice && typeof item.change === "number" && (
                  <div
                    className={`text-xs tabular-nums ${
                      isUp ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {isUp ? "+" : ""}₹{Math.abs(item.change).toFixed(2)}
                  </div>
                )}
                {!hasPrice && (
                  <div className="text-xs text-gray-400">
                    API credentials required for real-time data
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