/**
 * Auto-Trade Service
 * Listens for EMA crossover signals and auto-places LIMIT BUY orders.
 * Trail SL ratchets to each subsequent 15m candle's high (never down).
 * Exits via MARKET SELL when candle low touches trailing SL.
 */

const UPSTOX_V3_BASE = process.env.UPSTOX_SANDBOX === 'true'
  ? 'https://api-sandbox.upstox.com/v3'
  : 'https://api-hft.upstox.com/v3';
const UPSTOX_V2_BASE = process.env.UPSTOX_SANDBOX === 'true'
  ? 'https://api-sandbox.upstox.com/v2'
  : 'https://api.upstox.com/v2';

// Map: `${userId}:${instrumentKey}` -> TradeState
const activeTrades = new Map();

// ------------------ Upstox API helpers ------------------

async function placeOrder(accessToken, orderData) {
  const res = await fetch(`${UPSTOX_V3_BASE}/order/place`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(orderData),
  });

  const json = await res.json();

  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(`placeOrder failed: ${msg}`);
  }

  return json.data; // { order_ids: [...] }
}

async function getOrderDetails(accessToken, orderId) {
  try {
    const res = await fetch(
      `${UPSTOX_V2_BASE}/order/details?order_id=${encodeURIComponent(orderId)}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.data; // { status, average_price, filled_quantity, ... }
  } catch {
    return null;
  }
}

// ------------------ Core trade logic ------------------

/**
 * Called when an EMA cross signal fires.
 * Places a DAY LIMIT BUY at sig.high (entry) for the user.
 */
async function onSignal(userId, instrumentKey, sig) {
  const tradeKey = `${userId}:${instrumentKey}`;

  // Only one active trade per user × instrument
  if (activeTrades.has(tradeKey)) {
    console.log(`[AutoTrade] Already in trade for ${instrumentKey} (user ${userId}), skipping`);
    return;
  }

  try {
    const User = (await import('../models/User.js')).default;
    const user = await User.findById(userId).select('+upstoxAccessToken autoTrade watchlistLots');

    if (!user?.autoTrade?.enabled) return;
    if (!user.upstoxAccessToken) {
      console.warn(`[AutoTrade] No Upstox token for user ${userId}, cannot auto-trade ${instrumentKey}`);
      return;
    }

    // Compute quantity from per-instrument lots preference × exchange lot size
    const lots = user.watchlistLots?.get(instrumentKey) ?? 1;
    const { instrumentsSearchService } = await import('./instrumentsSearch.js');
    const instrument = instrumentsSearchService.getInstrument(instrumentKey);
    const lotSize = instrument?.lotSize ?? 1;
    const quantity = Math.max(1, lots * lotSize);
    const product = user.autoTrade.product || 'I';
    const entryPrice = sig.high;
    const initialSL = sig.prevCandleLow != null ? sig.prevCandleLow : sig.low;
    const slDistance = entryPrice - initialSL;

    if (slDistance <= 0) {
      console.warn(`[AutoTrade] Invalid SL for ${instrumentKey}: entry=${entryPrice}, SL=${initialSL}`);
      return;
    }

    const target1 = entryPrice + slDistance;

    const orderData = await placeOrder(user.upstoxAccessToken, {
      quantity,
      product,
      validity: 'DAY',
      price: entryPrice,
      instrument_token: instrumentKey,
      order_type: 'LIMIT',
      transaction_type: 'BUY',
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
      slice: false,
    });

    const orderId = orderData?.order_ids?.[0];
    if (!orderId) throw new Error('No order_id returned by Upstox');

    activeTrades.set(tradeKey, {
      userId,
      instrumentKey,
      orderId,
      status: 'pending_entry',
      entryPrice,
      initialSL,
      currentTrailSL: initialSL,
      target1,
      quantity,
      product,
      accessToken: user.upstoxAccessToken,
      signalTs: sig.ts,
      lastCandleTs: 0,
      createdAt: Date.now(),
    });

    console.log(
      `[AutoTrade] 📈 LIMIT BUY placed` +
      ` | ${instrumentKey} | qty=${quantity} | entry=${entryPrice}` +
      ` | SL=${initialSL} | T1=${target1} | orderId=${orderId}`
    );
  } catch (err) {
    console.error(`[AutoTrade] Failed to place order for ${instrumentKey}:`, err.message);
  }
}

/**
 * Called on every alertEngine tick with fresh candle data.
 * Manages pending entry checks and trailing SL ratchet.
 */
async function onCandleTick(instrumentKey, candles) {
  const timeframeMs = 15 * 60 * 1000;
  const now = Date.now();

  for (const [tradeKey, trade] of activeTrades) {
    if (trade.instrumentKey !== instrumentKey) continue;

    try {
      // Sort ascending by candle ts
      const sorted = [...candles].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));

      // ---- PENDING ENTRY: check if order filled ----
      if (trade.status === 'pending_entry') {
        const info = await getOrderDetails(trade.accessToken, trade.orderId);
        if (!info) return;

        if (info.status === 'complete') {
          activeTrades.set(tradeKey, { ...trade, status: 'in_trade' });
          console.log(`[AutoTrade] ✅ Entry filled for ${instrumentKey} @ ${info.average_price}`);
        } else if (info.status === 'rejected' || info.status === 'cancelled') {
          console.log(`[AutoTrade] ❌ Entry ${info.status} for ${instrumentKey}: ${info.status_message || ''}`);
          activeTrades.delete(tradeKey);
        }
        // still pending → wait
        return;
      }

      // ---- IN TRADE: trail SL on each newly closed candle ----
      if (trade.status === 'in_trade') {
        // Get candles that closed after the signal candle
        const closedAfterEntry = sorted.filter(c => {
          const start = Date.parse(c[0]);
          const end = start + timeframeMs;
          return now >= end && start > trade.signalTs;
        });

        if (closedAfterEntry.length === 0) return;

        const latestClosed = closedAfterEntry[closedAfterEntry.length - 1];
        const latestTs = Date.parse(latestClosed[0]);

        // Already processed this candle
        if (latestTs <= (trade.lastCandleTs || 0)) return;

        const candleHigh = Number(latestClosed[2]);
        const candleLow = Number(latestClosed[3]);

        // Ratchet trail SL upward only
        let newTrailSL = trade.currentTrailSL;
        if (candleHigh > newTrailSL) {
          newTrailSL = candleHigh;
          console.log(
            `[AutoTrade] ↑ Trail SL for ${instrumentKey}: ${trade.currentTrailSL} → ${newTrailSL}`
          );
        }

        const updatedTrade = { ...trade, currentTrailSL: newTrailSL, lastCandleTs: latestTs };
        activeTrades.set(tradeKey, updatedTrade);

        // Check SL hit: candle low penetrated trail SL
        if (candleLow <= newTrailSL) {
          console.log(
            `[AutoTrade] 🔴 Trail SL hit for ${instrumentKey}:` +
            ` candle_low=${candleLow} <= trailSL=${newTrailSL}`
          );
          await exitTrade(tradeKey, updatedTrade);
        }
      }
    } catch (err) {
      console.error(`[AutoTrade] Tick error for ${instrumentKey}:`, err.message);
    }
  }
}

/**
 * Place a MARKET SELL to exit the position.
 */
async function exitTrade(tradeKey, trade) {
  try {
    const orderData = await placeOrder(trade.accessToken, {
      quantity: trade.quantity,
      product: trade.product,
      validity: 'DAY',
      price: 0,
      instrument_token: trade.instrumentKey,
      order_type: 'MARKET',
      transaction_type: 'SELL',
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
      slice: false,
    });

    const exitOrderId = orderData?.order_ids?.[0];
    console.log(
      `[AutoTrade] ✅ Exit MARKET SELL placed for ${trade.instrumentKey}` +
      ` | orderId=${exitOrderId}`
    );
    activeTrades.delete(tradeKey);
  } catch (err) {
    console.error(`[AutoTrade] Failed to exit ${trade.instrumentKey}:`, err.message);
    // Leave in map — will retry on next tick
  }
}

/**
 * Cancel all pending entry orders at EOD / on demand.
 */
async function cancelAllPendingEntries() {
  for (const [tradeKey, trade] of activeTrades) {
    if (trade.status !== 'pending_entry') continue;
    try {
      const res = await fetch(
        `${UPSTOX_V3_BASE}/order/cancel?order_id=${encodeURIComponent(trade.orderId)}`,
        {
          method: 'DELETE',
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${trade.accessToken}`,
          },
        }
      );
      if (res.ok) {
        console.log(`[AutoTrade] Cancelled pending entry for ${trade.instrumentKey}`);
      }
    } catch (err) {
      console.error(`[AutoTrade] Cancel failed for ${trade.instrumentKey}:`, err.message);
    }
    activeTrades.delete(tradeKey);
  }
}

/**
 * Get a snapshot of all active trades (for admin/debug).
 */
function getActiveTrades() {
  const out = [];
  for (const [tradeKey, trade] of activeTrades) {
    out.push({
      tradeKey,
      instrumentKey: trade.instrumentKey,
      userId: trade.userId,
      status: trade.status,
      entryPrice: trade.entryPrice,
      initialSL: trade.initialSL,
      currentTrailSL: trade.currentTrailSL,
      target1: trade.target1,
      quantity: trade.quantity,
      product: trade.product,
      createdAt: trade.createdAt,
    });
  }
  return out;
}

export const autoTradeService = {
  onSignal,
  onCandleTick,
  cancelAllPendingEntries,
  getActiveTrades,
};
