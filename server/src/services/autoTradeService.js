/**
 * Auto-Trade Service
 * Listens for EMA crossover signals and auto-places LIMIT orders (BUY or SELL short).
 * BUY trade: entry at sig.high, trail SL ratchets upward, exits via MARKET SELL.
 * SELL trade: entry at sig.low (short), trail SL ratchets downward, exits via MARKET BUY.
 */

const UPSTOX_V3_BASE = process.env.UPSTOX_SANDBOX === 'true'
  ? 'https://api-sandbox.upstox.com/v3'
  : 'https://api-hft.upstox.com/v3';
const UPSTOX_V2_BASE = process.env.UPSTOX_SANDBOX === 'true'
  ? 'https://api-sandbox.upstox.com/v2'
  : 'https://api.upstox.com/v2';

// Map: `${userId}:${instrumentKey}` -> TradeState
const activeTrades = new Map();

// ------------------ DB persistence helpers ------------------

async function saveTrade(tradeKey, trade) {
  try {
    const ActiveTradeState = (await import('../models/ActiveTradeState.js')).default;
    await ActiveTradeState.findOneAndUpdate(
      { tradeKey },
      {
        tradeKey,
        userId: String(trade.userId),
        instrumentKey: trade.instrumentKey,
        orderId: trade.orderId,
        status: trade.status,
        transactionType: trade.transactionType,
        entryPrice: trade.entryPrice,
        initialSL: trade.initialSL,
        currentTrailSL: trade.currentTrailSL,
        target1: trade.target1,
        quantity: trade.quantity,
        product: trade.product,
        signalTs: trade.signalTs,
        lastCandleTs: trade.lastCandleTs,
        createdAt: trade.createdAt,
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('[AutoTrade] DB saveTrade error:', err.message);
  }
}

async function deleteTrade(tradeKey) {
  try {
    const ActiveTradeState = (await import('../models/ActiveTradeState.js')).default;
    await ActiveTradeState.deleteOne({ tradeKey });
  } catch (err) {
    console.error('[AutoTrade] DB deleteTrade error:', err.message);
  }
}

async function loadFromDb() {
  try {
    const ActiveTradeState = (await import('../models/ActiveTradeState.js')).default;
    const User = (await import('../models/User.js')).default;
    const records = await ActiveTradeState.find({});
    let loaded = 0;
    for (const rec of records) {
      const user = await User.findById(rec.userId).select('+upstoxAccessToken');
      if (!user?.upstoxAccessToken) {
        await ActiveTradeState.deleteOne({ tradeKey: rec.tradeKey });
        continue;
      }
      activeTrades.set(rec.tradeKey, {
        userId: rec.userId,
        instrumentKey: rec.instrumentKey,
        orderId: rec.orderId,
        status: rec.status,
        transactionType: rec.transactionType,
        entryPrice: rec.entryPrice,
        initialSL: rec.initialSL,
        currentTrailSL: rec.currentTrailSL,
        target1: rec.target1,
        quantity: rec.quantity,
        product: rec.product,
        accessToken: user.upstoxAccessToken,
        signalTs: rec.signalTs,
        lastCandleTs: rec.lastCandleTs,
        createdAt: rec.createdAt,
      });
      loaded++;
    }
    if (loaded > 0) console.log(`[AutoTrade] ✅ Restored ${loaded} active trade(s) from DB`);
  } catch (err) {
    console.error('[AutoTrade] DB loadFromDb error:', err.message);
  }
}

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
 * Places a DAY LIMIT order (BUY or SELL short) based on per-instrument direction.
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
    const user = await User.findById(userId).select('+upstoxAccessToken autoTrade watchlistLots watchlistProduct watchlistDirection');

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
    // Per-instrument product overrides global setting
    const product = user.watchlistProduct?.get(instrumentKey) ?? user.autoTrade.product ?? 'I';
    // Per-instrument direction: BUY (long) or SELL (short — intraday only)
    const direction = (user.watchlistDirection?.get(instrumentKey) ?? 'BUY').toUpperCase();
    const transactionType = direction === 'SELL' ? 'SELL' : 'BUY';

    let entryPrice, initialSL, slDistance;
    if (transactionType === 'BUY') {
      // Long: enter above candle high, SL below prev candle low
      entryPrice = sig.high;
      initialSL = sig.prevCandleLow != null ? sig.prevCandleLow : sig.low;
      slDistance = entryPrice - initialSL;
    } else {
      // Short: enter below candle low, SL above prev candle high
      entryPrice = sig.low;
      initialSL = sig.prevCandleHigh != null ? sig.prevCandleHigh : sig.high;
      slDistance = initialSL - entryPrice;
    }

    if (slDistance <= 0) {
      console.warn(`[AutoTrade] Invalid SL for ${instrumentKey}: entry=${entryPrice}, SL=${initialSL}, direction=${transactionType}`);
      return;
    }

    const target1 = transactionType === 'BUY'
      ? entryPrice + slDistance
      : entryPrice - slDistance;

    const orderData = await placeOrder(user.upstoxAccessToken, {
      quantity,
      product,
      validity: 'DAY',
      price: entryPrice,
      instrument_token: instrumentKey,
      order_type: 'LIMIT',
      transaction_type: transactionType,
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
      slice: false,
    });

    const orderId = orderData?.order_ids?.[0];
    if (!orderId) throw new Error('No order_id returned by Upstox');

    const newTrade = {
      userId,
      instrumentKey,
      orderId,
      status: 'pending_entry',
      transactionType,
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
    };
    activeTrades.set(tradeKey, newTrade);
    await saveTrade(tradeKey, newTrade);

    console.log(
      `[AutoTrade] 📈 LIMIT ${transactionType} placed` +
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
          const filledTrade = { ...trade, status: 'in_trade' };
          activeTrades.set(tradeKey, filledTrade);
          await saveTrade(tradeKey, filledTrade);
          console.log(`[AutoTrade] ✅ Entry filled for ${instrumentKey} @ ${info.average_price}`);
        } else if (info.status === 'rejected' || info.status === 'cancelled') {
          console.log(`[AutoTrade] ❌ Entry ${info.status} for ${instrumentKey}: ${info.status_message || ''}`);
          activeTrades.delete(tradeKey);
          await deleteTrade(tradeKey);
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

        // Capture OLD trail SL before any update — exit check must use this
        const oldTrailSL = trade.currentTrailSL;
        let newTrailSL = oldTrailSL;

        if (trade.transactionType === 'SELL') {
          // Short trade: ratchet trail SL downward only
          if (candleLow < newTrailSL) {
            newTrailSL = candleLow;
            console.log(
              `[AutoTrade] ↓ Trail SL (SELL) for ${instrumentKey}: ${oldTrailSL} → ${newTrailSL}`
            );
          }

          const updatedTrade = { ...trade, currentTrailSL: newTrailSL, lastCandleTs: latestTs };
          activeTrades.set(tradeKey, updatedTrade);
          await saveTrade(tradeKey, updatedTrade);

          // Target1 hit: candle low touches or goes below target (short profits when price falls)
          if (candleLow <= trade.target1) {
            console.log(
              `[AutoTrade] 🎯 Target1 hit (SELL) for ${instrumentKey}:` +
              ` candle_low=${candleLow} <= target1=${trade.target1}`
            );
            await exitTrade(tradeKey, updatedTrade);
          }
          // Short SL hit: candle high touches or exceeds OLD trail SL
          else if (candleHigh >= oldTrailSL) {
            console.log(
              `[AutoTrade] 🔴 Trail SL hit (SELL) for ${instrumentKey}:` +
              ` candle_high=${candleHigh} >= trailSL=${oldTrailSL}`
            );
            await exitTrade(tradeKey, updatedTrade);
          }
        } else {
          // Long trade (BUY): ratchet trail SL upward only
          if (candleHigh > newTrailSL) {
            newTrailSL = candleHigh;
            console.log(
              `[AutoTrade] ↑ Trail SL (BUY) for ${instrumentKey}: ${oldTrailSL} → ${newTrailSL}`
            );
          }

          const updatedTrade = { ...trade, currentTrailSL: newTrailSL, lastCandleTs: latestTs };
          activeTrades.set(tradeKey, updatedTrade);
          await saveTrade(tradeKey, updatedTrade);

          // Target1 hit: candle high touches or exceeds target (long profits when price rises)
          if (candleHigh >= trade.target1) {
            console.log(
              `[AutoTrade] 🎯 Target1 hit (BUY) for ${instrumentKey}:` +
              ` candle_high=${candleHigh} >= target1=${trade.target1}`
            );
            await exitTrade(tradeKey, updatedTrade);
          }
          // Long SL hit: candle low touches or goes below OLD trail SL
          else if (candleLow <= oldTrailSL) {
            console.log(
              `[AutoTrade] 🔴 Trail SL hit (BUY) for ${instrumentKey}:` +
              ` candle_low=${candleLow} <= trailSL=${oldTrailSL}`
            );
            await exitTrade(tradeKey, updatedTrade);
          }
        }
      }
    } catch (err) {
      console.error(`[AutoTrade] Tick error for ${instrumentKey}:`, err.message);
    }
  }
}

/**
 * Place a MARKET exit order to close the position.
 * BUY trades exit via MARKET SELL; SELL (short) trades exit via MARKET BUY.
 */
async function exitTrade(tradeKey, trade) {
  try {
    const exitTransactionType = trade.transactionType === 'SELL' ? 'BUY' : 'SELL';
    const orderData = await placeOrder(trade.accessToken, {
      quantity: trade.quantity,
      product: trade.product,
      validity: 'DAY',
      price: 0,
      instrument_token: trade.instrumentKey,
      order_type: 'MARKET',
      transaction_type: exitTransactionType,
      disclosed_quantity: 0,
      trigger_price: 0,
      is_amo: false,
      slice: false,
    });

    const exitOrderId = orderData?.order_ids?.[0];
    console.log(
      `[AutoTrade] ✅ Exit MARKET ${exitTransactionType} placed for ${trade.instrumentKey}` +
      ` | orderId=${exitOrderId}`
    );
    activeTrades.delete(tradeKey);
    await deleteTrade(tradeKey);
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

/**
 * Manual exit — called from user action (e.g. Exit button in app).
 * Finds the trade by instrumentKey for the given userId and places MARKET exit.
 */
async function manualExit(userId, instrumentKey) {
  const tradeKey = `${userId}:${instrumentKey}`;
  const trade = activeTrades.get(tradeKey);
  if (!trade) throw new Error('No active trade found for this instrument');
  await exitTrade(tradeKey, trade);
}

export const autoTradeService = {
  onSignal,
  onCandleTick,
  cancelAllPendingEntries,
  getActiveTrades,
  loadFromDb,
  manualExit,
};
