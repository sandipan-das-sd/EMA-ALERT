import React, { useEffect, useState } from "react";
import { logout, addToWatchlist, API_URL } from "../lib/api.js";
import Sidebar from "../components/Sidebar.jsx";
import MarketClock from "../components/MarketClock.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import {
  convertToTradingViewSymbol,
  getInstrumentDisplayName,
} from "../lib/tradingview.js";

export default function Dashboard({ user, setUser }) {
  const [indices, setIndices] = useState([]);
  const [ticks, setTicks] = useState({});
  const [adding, setAdding] = useState({});
  const [nifty, setNifty] = useState({ ltp: null, ts: null, error: "" });
  const [wsFailed, setWsFailed] = useState(false);
  const [polling, setPolling] = useState(false);
  const [universe, setUniverse] = useState([]);
  const [showAllUniverse, setShowAllUniverse] = useState(false);
  const UNIVERSE_TOP_N = 10;

  useEffect(() => {
    // Load instrument universe from server
    fetch(`${API_URL}/api/market/universe`)
      .then((r) => r.json())
      .then((data) => {
        setUniverse(data?.data || []);
      })
      .catch(() => {});

    // Start WebSocket connection
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const port = isLocalhost ? ':4000' : '';
    const url = `${proto}://${window.location.hostname}${port}/ws/ticker`;
    const ws = new WebSocket(url);

    const failSafe = setTimeout(() => {
      setWsFailed(true);
    }, 5000);

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        switch (msg.type) {
          case "tick":
            if (msg.instrumentKey === "NSE_INDEX|Nifty 50") {
              setNifty({ ltp: msg.ltp, ts: msg.ts, error: "" });
            }
            setTicks((prev) => ({
              ...prev,
              [msg.instrumentKey]: {
                ltp: msg.ltp,
                ts: msg.ts,
                changePct: msg.changePct,
                change: msg.change,
              },
            }));
            clearTimeout(failSafe);
            break;
          case "indices":
            setIndices(msg.data || []);
            const niftyIndex = (msg.data || []).find(
              (i) => i.key === "NSE_INDEX|Nifty 50"
            );
            if (niftyIndex && typeof niftyIndex.ltp === "number") {
              setNifty({ ltp: niftyIndex.ltp, ts: Date.now(), error: "" });
              clearTimeout(failSafe);
            }
            break;
          case "quotes":
            const map = {};
            (msg.data || []).forEach((q) => {
              if (typeof q.ltp === "number") {
                map[q.key] = {
                  ltp: q.ltp,
                  ts: q.ts,
                  changePct: q.changePct,
                  change: q.change || (q.ltp && q.cp ? q.ltp - q.cp : null),
                };
              }
            });
            setTicks((prev) => ({ ...prev, ...map }));
            break;
          case "error":
            setNifty((s) => ({ ...s, error: msg.message }));
            break;
        }
      } catch (e) {
        console.error("WebSocket parse error:", e);
      }
    };

    ws.onerror = () => {
      setNifty((s) => ({ ...s, error: "Feed connection error" }));
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
        const res = await fetch(`${API_URL}/api/market/nifty`);
        if (res.ok) {
          const data = await res.json();
          if (data?.tick?.ltp) {
            if (!cancelled)
              setNifty({ ltp: data.tick.ltp, ts: data.tick.ts, error: "" });
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }

    const tick = async () => {
      if (cancelled) return;
      await pollOnce();
      if (cancelled) return;
      setTimeout(tick, 6000);
    };

    tick();

    return () => {
      cancelled = true;
      setPolling(false);
    };
  }, [wsFailed]);

  async function onLogout() {
    await logout();
    setUser(null);
  }

  async function handleAdd(key) {
    if (adding[key]) return;
    setAdding((a) => ({ ...a, [key]: true }));
    try {
      const updated = await addToWatchlist(key);
      if (updated && Array.isArray(updated)) {
        setUser((u) => ({ ...u, watchlist: updated }));
      }
    } catch (e) {
      console.error("Add to watchlist error:", e);
    } finally {
      setAdding((a) => ({ ...a, [key]: false }));
    }
  }

  function openChart(item) {
    const key = item.instrumentKey || `${item.segment}|${item.symbol}`;
    console.log("[DashboardSimple] Opening chart for item:", item);

    // Extract the actual trading symbol from the item
    const actualSymbol = item.symbol || item.tradingSymbol || "";

    const tvSymbol = convertToTradingViewSymbol(
      key,
      actualSymbol,
      item.underlying,
      item.expiry
    );
    const name = getInstrumentDisplayName(item);

    console.log(
      "[DashboardSimple] TradingView symbol:",
      tvSymbol,
      "Name:",
      name
    );

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
      <main className="flex-1 p-8 lg:p-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Welcome {user?.name}</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user?.email}</span>
            <button className="btn-primary" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>

        <div className="mb-6">
          <MarketClock exchange="NSE" fullWidth />
        </div>

        <div className="mb-6 flex items-center justify-end">
          <div className="flex items-center gap-4 text-sm">
            {!wsFailed ? (
              <span className="text-green-600 flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                Live Feed Active
              </span>
            ) : polling ? (
              <span className="text-yellow-600">Polling Mode...</span>
            ) : (
              <span className="text-gray-500">Offline</span>
            )}
          </div>
        </div>

        {/* Indices strip */}
        <div className="mb-6 space-y-2">
          <div className="flex flex-wrap gap-6">
            {["NSE_INDEX|Nifty 50", "NSE_INDEX|Nifty Bank"].map((key) => {
              const item = indices.find((i) => i.key === key);
              const ltp = item?.ltp;
              const changePct = item?.changePct;
              const isUp = typeof changePct === "number" && changePct >= 0;
              return (
                <div key={key} className="flex flex-col">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {key.split("|")[1]}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-xl font-semibold">
                      {typeof ltp === "number"
                        ? ltp.toLocaleString("en-IN")
                        : "—"}
                    </div>
                    <div
                      className={
                        "text-sm font-medium " +
                        (isUp ? "text-green-600" : "text-red-600")
                      }
                    >
                      {typeof changePct === "number"
                        ? (changePct >= 0 ? "+" : "") +
                          changePct.toFixed(2) +
                          "%"
                        : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {nifty.error && (
            <div className="text-sm text-red-600">{nifty.error}</div>
          )}
        </div>

        {/* Instrument Search */}
        <div className="mb-8">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Search & Add Instruments
              </h2>
              <p className="text-sm text-gray-600">
                Search across NSE & BSE equity, futures, options and indices
              </p>
            </div>
            <InstrumentSearch
              user={user}
              setUser={setUser}
              onInstrumentAdded={(instrument) => {
                console.log("Added to watchlist:", instrument);
              }}
            />
          </div>
        </div>

        {/* Popular Scrips with live ticks */}
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Popular Scrips</h2>
            {universe.length > UNIVERSE_TOP_N && (
              <button
                className="text-sm text-blue-600 underline"
                onClick={() => setShowAllUniverse((s) => !s)}
              >
                {showAllUniverse ? `Show top ${UNIVERSE_TOP_N}` : `Show all (${universe.length})`}
              </button>
            )}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {(showAllUniverse ? universe : universe.slice(0, UNIVERSE_TOP_N)).map((item) => {
              const key =
                item.instrumentKey || `${item.segment}|${item.symbol}`;
              const tick = ticks[key];
              const ltp = tick?.ltp;
              const changePct = tick?.changePct;
              const change = tick?.change;
              const isUp = typeof changePct === "number" && changePct >= 0;

              return (
                <div
                  key={key}
                  className="border rounded-xl p-4 bg-white flex flex-col gap-3 shadow-sm hover:shadow-lg transition transform hover:-translate-y-1 cursor-pointer"
                  onClick={() => openChart(item)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col">
                      <div
                        className="text-sm font-semibold tracking-wide"
                        title={item.underlying}
                      >
                        {item.symbol}
                      </div>
                      <div
                        className="text-xs text-slate-500 max-w-[220px] truncate"
                        title={item.underlying}
                      >
                        {item.underlying}
                      </div>
                    </div>
                    {user?.watchlist && user.watchlist.includes(key) ? (
                      <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        <span>Added</span>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAdd(key);
                        }}
                        className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700"
                        disabled={adding[key]}
                      >
                        {adding[key] ? "Adding…" : "Add"}
                      </button>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3">
                    <div
                      className={`text-xl font-semibold tabular-nums ${
                        typeof changePct === "number"
                          ? changePct >= 0
                            ? "text-green-600"
                            : "text-red-600"
                          : "text-gray-900"
                      }`}
                    >
                      {typeof ltp === "number"
                        ? ltp.toLocaleString("en-IN")
                        : "—"}
                    </div>
                    {typeof changePct === "number" && (
                      <div
                        className={`text-sm font-medium tabular-nums ${
                          isUp ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {isUp ? "+" : ""}
                        {changePct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                  {typeof change === "number" && (
                    <div
                      className={`text-xs tabular-nums ${
                        isUp ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {isUp ? "+" : ""}₹{Math.abs(change).toFixed(2)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {universe.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            Loading popular scrips...
          </div>
        )}
      </main>
    </div>
  );
}
