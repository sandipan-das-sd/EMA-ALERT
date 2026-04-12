import React, { useEffect, useRef, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import {
  getPortfolioFunds,
  getPortfolioOrders,
  getPortfolioPositions,
  getPortfolioHoldings,
} from '../lib/api.js';
import { API_URL } from '../lib/api.js';

// ---------- helpers ----------
const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : '—');
const fmtCrore = (n) => {
  if (typeof n !== 'number') return '—';
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${n.toFixed(2)}`;
};
const pnlClass = (n) =>
  typeof n === 'number' && n < 0 ? 'text-red-600' : 'text-green-600';

const ORDER_STATUS_BADGE = {
  complete: 'bg-green-100 text-green-700',
  open: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-slate-100 text-slate-600',
  rejected: 'bg-red-100 text-red-700',
  'put order req received': 'bg-yellow-100 text-yellow-700',
  'validation pending': 'bg-yellow-100 text-yellow-700',
  'open pending': 'bg-blue-100 text-blue-700',
  trigger_pending: 'bg-purple-100 text-purple-700',
};

function StatusBadge({ status = '' }) {
  const cls = ORDER_STATUS_BADGE[status.toLowerCase()] || 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ---------- sub-components ----------

function FundsCard({ funds }) {
  if (!funds) return null;
  const eq = funds.equity || {};
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      <div className="card text-center">
        <div className="text-xs text-slate-500 mb-1">Available Margin</div>
        <div className="text-2xl font-bold text-green-600">{fmtCrore(eq.available_margin)}</div>
      </div>
      <div className="card text-center">
        <div className="text-xs text-slate-500 mb-1">Used Margin</div>
        <div className="text-2xl font-bold text-red-500">{fmtCrore(eq.used_margin)}</div>
      </div>
      <div className="card text-center">
        <div className="text-xs text-slate-500 mb-1">Today Payin</div>
        <div className="text-2xl font-bold">{fmtCrore(eq.payin_amount)}</div>
      </div>
      <div className="card text-center">
        <div className="text-xs text-slate-500 mb-1">Exposure Margin</div>
        <div className="text-2xl font-bold">{fmtCrore(eq.exposure_margin)}</div>
      </div>
    </div>
  );
}

function PositionsTable({ positions }) {
  if (!positions.length)
    return <p className="text-slate-500 text-sm py-6 text-center">No open positions today.</p>;

  const totalPnl = positions.reduce((s, p) => {
    const qty = p.quantity ?? 0;
    const buyVal = p.buy_value ?? 0;
    const sellVal = p.sell_value ?? 0;
    // For open positions, unrealised = qty * (ltp - avg)
    const dayPnl = sellVal - buyVal + (qty * (p.average_price ?? 0) - (p.overnight_buy_amount ?? 0));
    // Simple: day_sell_value - day_buy_value
    return s + ((p.day_sell_value ?? 0) - (p.day_buy_value ?? 0));
  }, 0);

  return (
    <>
      <div className={`text-right text-sm font-semibold mb-2 ${pnlClass(totalPnl)}`}>
        Day P&L: {fmtCrore(totalPnl)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500 text-xs">
              <th className="pb-2 pr-4">Symbol</th>
              <th className="pb-2 pr-4 text-right">Qty</th>
              <th className="pb-2 pr-4 text-right">Avg Buy</th>
              <th className="pb-2 pr-4 text-right">Buy Val</th>
              <th className="pb-2 pr-4 text-right">Sell Val</th>
              <th className="pb-2 text-right">Day P&L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const dayPnl = (p.day_sell_value ?? 0) - (p.day_buy_value ?? 0);
              return (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">
                    {p.trading_symbol || p.instrument_token}
                    <span className="ml-1 text-xs text-slate-400">{p.product}</span>
                  </td>
                  <td className="py-2 pr-4 text-right">{p.quantity ?? 0}</td>
                  <td className="py-2 pr-4 text-right">{fmt(p.day_buy_price ?? p.buy_price)}</td>
                  <td className="py-2 pr-4 text-right">{fmt(p.day_buy_value)}</td>
                  <td className="py-2 pr-4 text-right">{fmt(p.day_sell_value)}</td>
                  <td className={`py-2 text-right font-semibold ${pnlClass(dayPnl)}`}>
                    {fmt(dayPnl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function HoldingsTable({ holdings }) {
  if (!holdings.length)
    return <p className="text-slate-500 text-sm py-6 text-center">No long-term holdings found.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500 text-xs">
            <th className="pb-2 pr-4">Symbol</th>
            <th className="pb-2 pr-4 text-right">Qty</th>
            <th className="pb-2 pr-4 text-right">Avg Price</th>
            <th className="pb-2 pr-4 text-right">T1 Qty</th>
            <th className="pb-2 text-right">Exchange</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-2 pr-4 font-medium">{h.trading_symbol || h.isin}</td>
              <td className="py-2 pr-4 text-right">{h.quantity}</td>
              <td className="py-2 pr-4 text-right">{fmt(h.average_price)}</td>
              <td className="py-2 pr-4 text-right">{h.t1_quantity ?? 0}</td>
              <td className="py-2 text-right text-slate-500">{h.exchange}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrdersTable({ orders }) {
  // Dedupe by order_id, keep latest status entry
  const seen = new Map();
  orders.forEach((o) => {
    const prev = seen.get(o.order_id);
    if (!prev || new Date(o.order_timestamp) >= new Date(prev.order_timestamp)) {
      seen.set(o.order_id, o);
    }
  });
  const deduped = Array.from(seen.values()).sort(
    (a, b) => new Date(b.order_timestamp) - new Date(a.order_timestamp)
  );

  if (!deduped.length)
    return <p className="text-slate-500 text-sm py-6 text-center">No orders placed today.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500 text-xs">
            <th className="pb-2 pr-4">Symbol</th>
            <th className="pb-2 pr-4">Type</th>
            <th className="pb-2 pr-4">Side</th>
            <th className="pb-2 pr-4 text-right">Qty</th>
            <th className="pb-2 pr-4 text-right">Price</th>
            <th className="pb-2 pr-4 text-right">Avg</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2">Time</th>
          </tr>
        </thead>
        <tbody>
          {deduped.map((o) => (
            <tr key={o.order_id} className="border-b last:border-0">
              <td className="py-2 pr-4 font-medium">
                {o.trading_symbol}
                <span className="ml-1 text-xs text-slate-400">{o.product}</span>
              </td>
              <td className="py-2 pr-4 text-slate-600">{o.order_type}</td>
              <td className={`py-2 pr-4 font-semibold ${o.transaction_type === 'BUY' ? 'text-green-600' : 'text-red-500'}`}>
                {o.transaction_type}
              </td>
              <td className="py-2 pr-4 text-right">{o.filled_quantity}/{o.quantity}</td>
              <td className="py-2 pr-4 text-right">{o.price ? fmt(o.price) : 'MARKET'}</td>
              <td className="py-2 pr-4 text-right">{o.average_price ? fmt(o.average_price) : '—'}</td>
              <td className="py-2 pr-4"><StatusBadge status={o.status} /></td>
              <td className="py-2 text-xs text-slate-500">
                {o.order_timestamp?.split(' ')[1] || o.order_timestamp}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Main Page ----------

const TABS = ['Positions', 'Orders', 'Holdings'];

export default function Portfolio({ user }) {
  const [tab, setTab] = useState('Positions');
  const [funds, setFunds] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const wsRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [f, pos, ord, hold] = await Promise.allSettled([
        getPortfolioFunds(),
        getPortfolioPositions(),
        getPortfolioOrders(),
        getPortfolioHoldings(),
      ]);
      if (f.status === 'fulfilled') setFunds(f.value);
      if (pos.status === 'fulfilled') setPositions(pos.value || []);
      if (ord.status === 'fulfilled') setOrders(ord.value || []);
      if (hold.status === 'fulfilled') setHoldings(hold.value || []);
      setLastUpdated(new Date());
      // Report first error if all failed
      const firstErr = [f, pos, ord, hold].find((r) => r.status === 'rejected');
      if (firstErr) setError(firstErr.reason?.message || 'Some data failed to load');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { refresh(); }, [refresh]);

  // WebSocket — listen for real-time portfolio updates
  useEffect(() => {
    const WS_URL = (API_URL || 'http://localhost:4000').replace(/^http/, 'ws') + '/ws/ticker';
    const ws = new window.WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (user?.id) {
        ws.send(JSON.stringify({ type: 'identify', userId: user.id }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'portfolio_update') {
          const update = msg.data;
          const ut = update?.update_type;
          if (ut === 'order') {
            setOrders((prev) => {
              const idx = prev.findIndex((o) => o.order_id === update.order_id);
              if (idx === -1) return [update, ...prev];
              const next = [...prev];
              next[idx] = update;
              return next;
            });
          } else if (ut === 'position') {
            setPositions((prev) => {
              const idx = prev.findIndex(
                (p) => p.instrument_token === update.instrument_token && p.product === update.product
              );
              if (idx === -1) return [update, ...prev];
              const next = [...prev];
              next[idx] = update;
              return next;
            });
          } else if (ut === 'holding') {
            setHoldings((prev) => {
              const idx = prev.findIndex((h) => h.isin === update.isin);
              if (idx === -1) return [update, ...prev];
              const next = [...prev];
              next[idx] = update;
              return next;
            });
          }
        }
      } catch {}
    };

    return () => ws.close();
  }, [user?.id]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 bg-slate-50">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Portfolio</h1>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-slate-400">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={refresh}
              disabled={loading}
              className="btn-primary text-sm px-3 py-1.5"
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-700 text-sm">
            {error} — make sure your Upstox token is connected in Settings.
          </div>
        )}

        <FundsCard funds={funds} />

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t}
              {t === 'Positions' && positions.length > 0 && (
                <span className="ml-1 text-xs bg-blue-100 text-blue-700 rounded-full px-1.5">{positions.length}</span>
              )}
              {t === 'Orders' && orders.length > 0 && (
                <span className="ml-1 text-xs bg-slate-100 text-slate-600 rounded-full px-1.5">
                  {Array.from(new Set(orders.map((o) => o.order_id))).length}
                </span>
              )}
              {t === 'Holdings' && holdings.length > 0 && (
                <span className="ml-1 text-xs bg-slate-100 text-slate-600 rounded-full px-1.5">{holdings.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="card">
          {loading && !funds && (
            <div className="py-12 text-center text-slate-400">Loading portfolio data…</div>
          )}
          {tab === 'Positions' && <PositionsTable positions={positions} />}
          {tab === 'Orders' && <OrdersTable orders={orders} />}
          {tab === 'Holdings' && <HoldingsTable holdings={holdings} />}
        </div>
      </main>
    </div>
  );
}
