import fetch from "node-fetch";
import Alert from "../models/Alert.js";
import { sendWhatsAppAlert, sendVwapWhatsAppAlert, getWhatsAppPhoneNumbers } from "./whatsappNotification.js";
import { enqueueBufferedVoiceAlert } from "./voiceNotification.js";
import { sendPushAlertToUser } from "./pushNotification.js";
import { sendAlertEmailToUser } from "./emailNotification.js";
import { autoTradeService } from "./autoTradeService.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const toIstDateString = (timestamp) => {
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const d = new Date(timestamp + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

/**
 * Calculate EMA properly - starts with SMA of first 'length' periods
 */
function calculateEMA(values, length = 20) {
  if (!values || values.length < length) {
    return null;
  }

  const k = 2 / (length + 1);
  const emaValues = [];

  // Calculate initial SMA for first EMA value
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += values[i];
  }
  const initialSMA = sum / length;
  emaValues.push(initialSMA);

  // Calculate EMA for remaining values
  for (let i = length; i < values.length; i++) {
    const ema = values[i] * k + emaValues[emaValues.length - 1] * (1 - k);
    emaValues.push(ema);
  }

  return emaValues;
}

/**
 * Calculate VWAP for intraday candles (resets each day).
 * Upstox candle format: [timestamp, open, high, low, close, volume, oi]
 * Returns array of { ts, vwap } for each candle.
 */
function calculateVWAP(candles) {
  if (!candles || candles.length === 0) return [];

  const results = [];
  let cumTPV = 0; // cumulative (typical_price × volume)
  let cumVol = 0; // cumulative volume
  let currentDay = null;

  for (const c of candles) {
    const ts = Date.parse(c[0]);
    const high = Number(c[2]);
    const low = Number(c[3]);
    const close = Number(c[4]);
    const volume = Number(c[5]) || 0;

    // Detect day change — reset VWAP
    const day = toIstDateString(ts);
    if (day !== currentDay) {
      cumTPV = 0;
      cumVol = 0;
      currentDay = day;
    }

    const typicalPrice = (high + low + close) / 3;
    cumTPV += typicalPrice * volume;
    cumVol += volume;

    const vwap = cumVol > 0 ? cumTPV / cumVol : close;
    results.push({ ts, vwap });
  }

  return results;
}

export function startAlertEngine({
  apiBase,
  accessToken,
  getAccessToken,
  instrumentsSearchService,
  dynamicSubscriptionManager,
  intervalMs = 60_000,
  broadcastAlert,
}) {
  const getToken = getAccessToken || (() => accessToken);
  
  if (!getToken()) {
    console.warn("[AlertEngine] Disabled: missing UPSTOX_ACCESS_TOKEN");
    return { stop: () => {} };
  }

  console.log("[AlertEngine] Starting with interval:", intervalMs, "ms");

  const getHeaders = () => ({
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/json",
  });

  const stopRef = { stopped: false };
  const workingKeyCache = new Map();
  const failureCount = new Map();
  const permanentlyFailedUntil = new Map();
  const historicalCache = new Map();
  const sentAlerts = new Map();
  const sentVwapAlerts = new Map(); // Separate dedup for VWAP alerts

  const SENT_ALERT_TTL_MS = (() => {
    const v = parseInt(process.env.ALERT_SENT_TTL_MS, 10);
    return Number.isFinite(v) && v > 0 ? v : 72 * 60 * 60 * 1000;
  })();

  const preloadSentAlerts = async () => {
  try {
    const cutoff = Date.now() - SENT_ALERT_TTL_MS;
    const recentAlerts = await Alert.find({
      createdAt: { $gte: new Date(cutoff) }
    }).select('instrumentKey candle').lean();

    let count = 0;
    for (const a of recentAlerts) {
      if (!a?.candle?.ts) continue;
      const alertId = `${a.instrumentKey}::${a.candle.ts}`;
      sentAlerts.set(alertId, Date.now());
      count++;
    }
    if (count > 0) {
      console.log(`[AlertEngine] ✅ Pre-loaded ${count} sent alerts from DB (prevents restart re-fires)`);
    }
  } catch (err) {
    console.error('[AlertEngine] Failed to preload sentAlerts from DB:', err.message);
  }
};

  const MAX_SENT_ALERTS = (() => {
    const v = parseInt(process.env.ALERT_SENT_MAX, 10);
    return Number.isFinite(v) && v > 0 ? v : 50_000;
  })();
  const MAX_CACHE_KEYS = (() => {
    const v = parseInt(process.env.ALERT_CACHE_MAX_KEYS, 10);
    return Number.isFinite(v) && v > 0 ? v : 5_000;
  })();
  const FAILED_RETRY_MS = (() => {
    const v = parseInt(process.env.ALERT_FAILED_RETRY_MS, 10);
    return Number.isFinite(v) && v > 0 ? v : 30 * 60 * 1000;
  })();
  let lastNoInstrumentsWarnAt = 0;
  let lastCriticalWarnAt = 0;
  let lastPruneAt = 0;
  
  // Track tick count for reduced logging
  let tickCount = 0;
  
  // Track last cleanup to prevent memory leak
  let lastCleanupDate = toIstDateString(Date.now());

  const pruneMapToSize = (map, max) => {
    if (map.size <= max) return;
    const removeCount = map.size - max;
    let removed = 0;
    for (const key of map.keys()) {
      map.delete(key);
      removed += 1;
      if (removed >= removeCount) break;
    }
  };

  const pruneOldSentAlerts = (now = Date.now()) => {
    for (const [id, ts] of sentAlerts.entries()) {
      if (!Number.isFinite(ts) || now - ts > SENT_ALERT_TTL_MS) {
        sentAlerts.delete(id);
      }
    }
    pruneMapToSize(sentAlerts, MAX_SENT_ALERTS);
  };

  const pruneExpiredPermanentFailures = (now = Date.now()) => {
    for (const [key, retryAt] of permanentlyFailedUntil.entries()) {
      if (!Number.isFinite(retryAt) || now >= retryAt) {
        permanentlyFailedUntil.delete(key);
      }
    }
    pruneMapToSize(permanentlyFailedUntil, MAX_CACHE_KEYS);
  };
  
  // Cleanup function to prevent memory leak
  const cleanupDailyData = () => {
    const now = Date.now();
    if (now - lastPruneAt > 10 * 60 * 1000) {
      pruneOldSentAlerts(now);
      pruneExpiredPermanentFailures(now);
      pruneMapToSize(workingKeyCache, MAX_CACHE_KEYS);
      pruneMapToSize(failureCount, MAX_CACHE_KEYS);
      pruneMapToSize(historicalCache, MAX_CACHE_KEYS);
      pruneMapToSize(sentVwapAlerts, MAX_SENT_ALERTS);
      lastPruneAt = now;
    }

    const today = toIstDateString(Date.now());
    if (today && today !== lastCleanupDate) {
      console.log(`[AlertEngine] Daily cleanup: clearing ${sentAlerts.size} EMA + ${sentVwapAlerts.size} VWAP sent alerts`);
      sentAlerts.clear();
      sentVwapAlerts.clear();
      historicalCache.clear();
      permanentlyFailedUntil.clear();
      lastCleanupDate = today;
    }
  };

  const buildHistoricalURL = (instrumentKey, date, intervalMinutes = 15) => {
    const base = apiBase.replace(/\/$/, "");
    const hasV3 = base.endsWith("/v3");
    const prefix = hasV3 ? base : `${base}/v3`;
    const dateStr = date.toISOString().split("T")[0];
    return `${prefix}/historical-candle/${encodeURIComponent(
      instrumentKey
    )}/minutes/${intervalMinutes}/${dateStr}/${dateStr}`;
  };

  const buildIntradayURL = (instrumentKey, intervalMinutes = 15) => {
    const base = apiBase.replace(/\/$/, "");
    const hasV3 = base.endsWith("/v3");
    const prefix = hasV3 ? base : `${base}/v3`;
    return `${prefix}/historical-candle/intraday/${encodeURIComponent(
      instrumentKey
    )}/minutes/${intervalMinutes}`;
  };

  const fetchHistoricalCandles = async (instrumentKey, minCandlesNeeded, intervalMinutes = 15) => {
    if (!minCandlesNeeded || minCandlesNeeded <= 0) {
      return [];
    }

    const todayKey = toIstDateString(Date.now());
    const cacheKey = `${instrumentKey}::${todayKey}::${intervalMinutes}m`;
    const cached = historicalCache.get(cacheKey);
    if (cached && cached.length >= minCandlesNeeded) {
      return [...cached];
    }

    const allCandles = [];
    const today = new Date();
    const maxLookbackDays = 7;

    for (let dayOffset = 1; dayOffset <= maxLookbackDays; dayOffset++) {
      if (allCandles.length >= minCandlesNeeded) break;

      const date = new Date(today);
      date.setDate(date.getDate() - dayOffset);

      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      try {
        const url = buildHistoricalURL(instrumentKey, date, intervalMinutes);
        const r = await fetch(url, { headers: getHeaders() });

        if (r.ok) {
          const j = await r.json();
          if (j?.data?.candles?.length) {
            allCandles.push(...j.data.candles);
            console.log(
              `[AlertEngine] Fetched ${j.data.candles.length} historical candles from ${
                date.toISOString().split("T")[0]
              }`
            );
          }
        }
      } catch (err) {
        console.log(
          `[AlertEngine] Error fetching historical data:`,
          err.message
        );
      }
    }

    if (allCandles.length > 0) {
      historicalCache.set(cacheKey, [...allCandles]);
    }

    return allCandles;
  };

  const tryIntraday = async (key, variants, intervalMinutes = 15) => {
    for (const v of variants) {
      try {
        const url = buildIntradayURL(v, intervalMinutes);
        const r = await fetch(url, { headers: getHeaders() });

        if (r.status === 404) continue;

        if (!r.ok) {
          const errorText = await r.text();
          console.log(
            `[AlertEngine] Failed for ${v}: ${r.status} - ${errorText.substring(
              0,
              100
            )}`
          );
          continue;
        }

        const j = await r.json();
        if (j?.data?.candles?.length) {
          console.log(
            `[AlertEngine] ✓ Found ${j.data.candles.length} candles for: ${v}`
          );
          return { key: v, data: j.data.candles };
        }
      } catch (err) {
        console.log(`[AlertEngine] Error trying ${v}:`, err.message);
      }
    }
    return null;
  };

  const buildVariants = (origKey) => {
    const variants = new Set([origKey]);

    if (origKey.includes("|")) {
      variants.add(origKey.replace("|", ":"));
    } else if (origKey.includes(":")) {
      variants.add(origKey.replace(":", "|"));
    }

    const inst = instrumentsSearchService?.getInstrument?.(origKey);
    if (!inst) {
      return Array.from(variants);
    }

    const parts = origKey.split(/[|:]/);
    const segment = parts[0];

    if (segment.includes("_EQ")) {
      if (inst.tradingSymbol) {
        variants.add(`${segment}|${inst.tradingSymbol}`);
        variants.add(`${segment}:${inst.tradingSymbol}`);
      }
    }

    if (segment.includes("_FO")) {
      if (inst.tradingSymbol) {
        const ts = inst.tradingSymbol;
        const cleanTS = ts.replace(/\s+/g, "");
        variants.add(`${segment}|${ts}`);
        variants.add(`${segment}:${ts}`);
        variants.add(`${segment}|${cleanTS}`);
        variants.add(`${segment}:${cleanTS}`);
      }
    }

    if (segment.includes("_INDEX")) {
      if (inst.tradingSymbol) {
        variants.add(`${segment}|${inst.tradingSymbol}`);
        variants.add(`${segment}:${inst.tradingSymbol}`);
      }
      if (inst.name) {
        variants.add(`${segment}|${inst.name}`);
        variants.add(`${segment}:${inst.name}`);
      }
    }

    return Array.from(variants);
  };

  const evaluate = async (
    candles,
    instrumentKey,
    workingKey,
    maxCandlesToCheck = 12,
    timeframeMinutes = 15
  ) => {
    let sortedCandles = [...candles].reverse();

    const emaPeriod = 20;
    const requiredHistory = emaPeriod - 1;
    const todaysCount = sortedCandles.length;

    let existingHistory = 0;
    if (sortedCandles.length > 0) {
      const todayIst = toIstDateString(Date.now());
      for (const candle of sortedCandles) {
        const ts = Date.parse(candle[0]);
        if (!Number.isFinite(ts)) continue;
        const candleDate = toIstDateString(ts);
        if (candleDate && todayIst && candleDate < todayIst) {
          existingHistory += 1;
        } else {
          break;
        }
      }
    }

    const desiredHistoryCount = Math.max(requiredHistory - existingHistory, 0);

    console.log(
      `[AlertEngine] ${instrumentKey}: Today's candles: ${todaysCount}`
    );

    const historicalCandles =
      desiredHistoryCount > 0
        ? await fetchHistoricalCandles(workingKey, desiredHistoryCount, timeframeMinutes)
        : [];

    if (historicalCandles.length > 0) {
      const sortedHistorical = [...historicalCandles].reverse();
      const historyToUse = Math.min(
        desiredHistoryCount,
        sortedHistorical.length
      );
      const trimmedHistorical =
        historyToUse > 0 ? sortedHistorical.slice(-historyToUse) : [];
      sortedCandles = [...trimmedHistorical, ...sortedCandles];
      console.log(
        `[AlertEngine] ${instrumentKey}: Using ${trimmedHistorical.length} historical + ${todaysCount} today = ${sortedCandles.length} total`
      );
    }

    if (sortedCandles.length < emaPeriod) {
      console.log(
        `[AlertEngine] ${instrumentKey}: Only ${sortedCandles.length} candles, need ${emaPeriod}`
      );
      return [];
    }

    const closes = sortedCandles.map((c) => Number(c[4]));
    const emaValues = calculateEMA(closes, emaPeriod);
    
    if (!emaValues || emaValues.length === 0) {
      console.log(`[AlertEngine] ${instrumentKey}: EMA calculation failed`);
      return [];
    }

    const n = sortedCandles.length;
    const timeframeMs = (timeframeMinutes || 15) * 60 * 1000;
    const now = Date.now();

    const firstEmaCloseIndex = emaPeriod - 1;
    const emaAtCloseIndex = (closeIndex) => {
      const emaIndex = closeIndex - firstEmaCloseIndex;
      if (emaIndex < 0 || emaIndex >= emaValues.length) return null;
      return emaValues[emaIndex];
    };

    // Tolerance configuration
    const baseTolPercent = (() => {
      const v = parseFloat(process.env.EMA_OPEN_TOL_PERCENT);
      return Number.isFinite(v) && v >= 0 ? v : 0.0005;
    })();
    
    const foTolPercent = (() => {
      const v = parseFloat(process.env.EMA_OPEN_TOL_PERCENT_FO);
      return Number.isFinite(v) && v >= 0 ? v : 0.025;
    })();
    
    const foTolAbs = (() => {
      const v = parseFloat(process.env.EMA_OPEN_TOL_ABS_FO);
      return Number.isFinite(v) && v >= 0 ? v : 5;
    })();

    const toCheck = [];
    const firstValidEmaIndex = firstEmaCloseIndex;
    for (
      let k = 0;
      k < Math.min(maxCandlesToCheck, n - firstValidEmaIndex);
      k++
    ) {
      const idx = n - 1 - k;
      if (idx >= firstValidEmaIndex) {
        toCheck.push(idx);
      }
    }

    const signals = [];

    for (const idx of toCheck) {
      const candle = sortedCandles[idx];
      const open = Number(candle[1]);
      const high = Number(candle[2]);
      const low = Number(candle[3]);
      const close = Number(candle[4]);
      const candleStartTs = Date.parse(candle[0]);
      
      if (isNaN(candleStartTs)) continue;
      
      const candleEndTs = candleStartTs + timeframeMs;

      // Market hours check (IST 09:15 - 15:15)
      const candleStartIst = new Date(candleStartTs + IST_OFFSET_MS);
      const istHour = candleStartIst.getUTCHours();
      const istMin = candleStartIst.getUTCMinutes();
      const afterMarketOpen = istHour > 9 || (istHour === 9 && istMin >= 15);
      const beforeMarketLastStart = istHour < 15 || (istHour === 15 && istMin <= 15);
      const inMarketHours = afterMarketOpen && beforeMarketLastStart;
      
      if (!inMarketHours) continue;

      const candleClosed = now >= candleEndTs;
      const isGreen = close > open;

      // Get EMA values
      const emaPrev = emaAtCloseIndex(idx - 1);
      const emaCurr = emaAtCloseIndex(idx);
      const emaOpenEffective = emaPrev !== null ? emaPrev : emaCurr;
      
      if (emaOpenEffective === null) continue;

      // Determine if instrument is F&O
      const keyForType = (workingKey || instrumentKey) || "";
      const isFO = typeof keyForType === "string" && keyForType.includes("_FO");

      // Get instrument details
      let inst = null;
      try {
        inst = instrumentsSearchService?.getInstrument?.(workingKey || instrumentKey) || null;
      } catch (e) {
        inst = null;
      }
      
      const tradingSymbol = inst?.tradingSymbol || "";
      const isOption = /\b(PE|CE)\b/i.test(tradingSymbol);

      // Calculate tolerance
      const tolPercentForIntersect = isFO
        ? (isOption ? Math.min(foTolPercent, 0.005) : foTolPercent)
        : baseTolPercent;

      const absTolForIntersect = isFO 
        ? (isOption ? Math.max(0.01, foTolAbs / 100) : foTolAbs) 
        : 0.0001;

      const tolIntersect = Math.max(
        0.0001, 
        open * tolPercentForIntersect, 
        absTolForIntersect
      );

      // Check if EMA intersects the candle's high-low range (classic crossover)
      const emaIntersectsCandle = 
        emaOpenEffective >= (low - tolIntersect) && 
        emaOpenEffective <= (high + tolIntersect);

      // Check if closed above EMA
      const closedAboveEma = emaCurr !== null 
        ? (close > emaCurr) 
        : (close > emaOpenEffective);

      // Format timestamp
      const startIstDate = new Date(candleStartTs + IST_OFFSET_MS);
      const startIstStr = `${startIstDate.getUTCFullYear()}-${String(
        startIstDate.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(startIstDate.getUTCDate()).padStart(
        2, "0"
      )}T${String(startIstDate.getUTCHours()).padStart(2, "0")}:${String(
        startIstDate.getUTCMinutes()
      ).padStart(2, "0")}:00 IST`;

      // Diagnostic logging for closed green candles
      if (candleClosed && isGreen && process.env.DEBUG_ALERTS) {
        const reasons = [];
        if (!emaIntersectsCandle) reasons.push("ema_not_in_candle_range");
        if (!closedAboveEma) reasons.push("close_not_above_ema");
        if (reasons.length) {
          console.log(
            `[AlertEngine] ${instrumentKey} ${startIstStr} - no signal: ${reasons.join(", ")} | ` +
            `open=${open.toFixed(2)} ema=${emaOpenEffective.toFixed(5)} close=${close.toFixed(2)} ` +
            `high=${high.toFixed(2)} low=${low.toFixed(2)} tol=${tolIntersect.toFixed(6)}`
          );
        }
      }

      // SIGNAL: candle crosses EMA, is green, closes above EMA
      // Alert fires IMMEDIATELY when this candle closes
      // Auto-trade places SL-BREAKOUT at HIGH — fills only when price breaks out
      if (candleClosed && isGreen && emaIntersectsCandle && closedAboveEma) {
        const alertId = `${instrumentKey}::${candleStartTs}`;
        const alreadySentAt = sentAlerts.get(alertId);
        if (alreadySentAt && Date.now() - alreadySentAt < SENT_ALERT_TTL_MS) {
          continue;
        }
        
        sentAlerts.set(alertId, Date.now());
        const crossDetectedAt = Date.now();
        const candleEndTime = candleEndTs;
        const delayFromCandleClose = Math.round((crossDetectedAt - candleEndTime) / 1000);
        console.log(
          `\n🎯 [AlertEngine] SIGNAL for ${instrumentKey} at ${startIstStr}\n` +
          `   Open: ${open.toFixed(2)} | Close: ${close.toFixed(2)} | EMA: ${emaOpenEffective.toFixed(5)}\n` +
          `   High: ${high.toFixed(2)} | Low: ${low.toFixed(2)}\n` +
          `   Candle closed: ${new Date(candleEndTime).toISOString()}\n` +
          `   Cross detected at: ${new Date(crossDetectedAt).toISOString()}\n` +
          `   ⏱️  Detection delay: ${delayFromCandleClose}s from candle close`
        );
        
        const prevCandleLow = idx > 0 ? Number(sortedCandles[idx - 1][3]) : low;
        const prevCandleHigh = idx > 0 ? Number(sortedCandles[idx - 1][2]) : high;

        signals.push({
          ts: candleStartTs,
          open,
          high,
          low,
          close,
          ema: emaOpenEffective,
          prevCandleLow,
          prevCandleHigh,
          crossDetectedAt,
          candleEndTime,
        });
      }
    }

    return signals;
  };

  /**
   * Evaluate VWAP crossover signals (alert + auto-trade).
   * Signal: closed green candle crosses above VWAP.
   */
  const evaluateVWAP = (candles, instrumentKey, timeframeMinutes = 15) => {
    // Sort ascending
    const sorted = [...candles].reverse();
    if (sorted.length < 2) return [];

    // VWAP is intraday only — use only today's candles
    const todayIst = toIstDateString(Date.now());
    const todayCandles = sorted.filter((c) => {
      const ts = Date.parse(c[0]);
      return Number.isFinite(ts) && toIstDateString(ts) === todayIst;
    });

    if (todayCandles.length < 2) return [];

    const vwapValues = calculateVWAP(todayCandles);
    if (vwapValues.length < 2) return [];

    const timeframeMs = (timeframeMinutes || 15) * 60 * 1000;
    const now = Date.now();
    const vwapSignals = [];

    // Check last few candles
    const maxCheck = Math.min(6, todayCandles.length);

    for (let k = 0; k < maxCheck; k++) {
      const idx = todayCandles.length - 1 - k;
      if (idx < 1) break;

      const candle = todayCandles[idx];
      const open = Number(candle[1]);
      const high = Number(candle[2]);
      const low = Number(candle[3]);
      const close = Number(candle[4]);
      const candleStartTs = Date.parse(candle[0]);
      if (isNaN(candleStartTs)) continue;
      const candleEndTs = candleStartTs + timeframeMs;

      // Market hours check
      const candleStartIst = new Date(candleStartTs + IST_OFFSET_MS);
      const istHour = candleStartIst.getUTCHours();
      const istMin = candleStartIst.getUTCMinutes();
      const afterMarketOpen = istHour > 9 || (istHour === 9 && istMin >= 15);
      const beforeMarketLastStart = istHour < 15 || (istHour === 15 && istMin <= 15);
      if (!afterMarketOpen || !beforeMarketLastStart) continue;

      const candleClosed = now >= candleEndTs;
      if (!candleClosed) continue;

      const isGreen = close > open;
      const vwap = vwapValues[idx]?.vwap;
      const prevVwap = vwapValues[idx - 1]?.vwap;
      if (vwap == null || prevVwap == null) continue;

      // Previous candle closed below VWAP, current candle closes above VWAP
      const prevClose = Number(todayCandles[idx - 1][4]);
      const prevWasBelow = prevClose < prevVwap;
      const nowAbove = close > vwap;

      // VWAP crosses through candle range (same logic as EMA)
      const vwapIntersects = vwap >= low && vwap <= high;

      if (isGreen && prevWasBelow && nowAbove && vwapIntersects) {
        const alertId = `vwap::${instrumentKey}::${candleStartTs}`;
        const alreadySentAt = sentVwapAlerts.get(alertId);
        if (alreadySentAt && Date.now() - alreadySentAt < SENT_ALERT_TTL_MS) {
          continue;
        }

        sentVwapAlerts.set(alertId, Date.now());

        const startIstDate = new Date(candleStartTs + IST_OFFSET_MS);
        const startIstStr = `${startIstDate.getUTCFullYear()}-${String(
          startIstDate.getUTCMonth() + 1
        ).padStart(2, "0")}-${String(startIstDate.getUTCDate()).padStart(
          2, "0"
        )}T${String(startIstDate.getUTCHours()).padStart(2, "0")}:${String(
          startIstDate.getUTCMinutes()
        ).padStart(2, "0")}:00 IST`;

        console.log(
          `\n📊 [AlertEngine] VWAP SIGNAL for ${instrumentKey} at ${startIstStr}\n` +
          `   Open: ${open.toFixed(2)} | Close: ${close.toFixed(2)} | VWAP: ${vwap.toFixed(2)}\n` +
          `   Entry: ${high.toFixed(2)} (HIGH) | SL: ${low.toFixed(2)} (LOW) | Target: ${(high + (high - low)).toFixed(2)} (1:1)\n` +
          `   Prev close: ${prevClose.toFixed(2)} (below VWAP ${prevVwap.toFixed(2)})`
        );

        const prevCandleLow = idx > 0 ? Number(todayCandles[idx - 1][3]) : low;
        const prevCandleHigh = idx > 0 ? Number(todayCandles[idx - 1][2]) : high;

        vwapSignals.push({
          ts: candleStartTs,
          open,
          high,
          low,
          close,
          vwap,
          entry: high,                          // Buy above candle HIGH
          stoploss: low,                        // SL at candle LOW
          target: high + (high - low),          // 1:1 R/R
          prevCandleLow,
          prevCandleHigh,
          candleEndTime: candleEndTs,
          crossDetectedAt: Date.now(),
        });
      }
    }

    return vwapSignals;
  };

  async function tick() {
    if (stopRef.stopped) return;

    let nextTickDelay = intervalMs;

    try {
      // Daily cleanup to prevent memory leak
      cleanupDailyData();
      
      const userMap = new Map();
      for (const [userId, wl] of dynamicSubscriptionManager.userWatchlists) {
        userMap.set(userId, Array.from(wl));
      }
      
      const allPairs = dynamicSubscriptionManager.getAllKeyTimeframePairs();

      const now = Date.now();
      const pairsToProcess = allPairs.filter(({ key, timeframe }) => {
        const pairId = `${key}::${timeframe}`;
        const retryAt = permanentlyFailedUntil.get(pairId);
        if (!retryAt) return true;
        if (now >= retryAt) {
          permanentlyFailedUntil.delete(pairId);
          return true;
        }
        return false;
      });

      tickCount++;
      const shouldLog = tickCount % 10 === 1; // Only log every 10th tick
      
      if (shouldLog) {
        console.log(
          `[AlertEngine] Tick #${tickCount}: Monitoring ${pairsToProcess.length}/${allPairs.length} instruments (${permanentlyFailedUntil.size} cooling down)`
        );
      }

      if (pairsToProcess.length === 0) {
        if (shouldLog) {
          if (allPairs.length > 0) {
            const now = Date.now();
            if (now - lastNoInstrumentsWarnAt > 10 * 60 * 1000) {
              console.warn(
                `[AlertEngine] ⚠️  All ${allPairs.length} instruments failed to load. Check Upstox token validity.`
              );
              console.warn('[AlertEngine] Upstox token may be expired. Please refresh at: http://pratik.gyanoda.in/login');
              lastNoInstrumentsWarnAt = now;
            }
          } else {
            console.log('[AlertEngine] No user watchlists yet. Waiting for subscriptions...');
          }
        }
        // Use longer interval when no instruments are available.
        // The actual scheduling happens once in finally to avoid duplicate timers.
        nextTickDelay = Math.max(intervalMs, 30_000);
        return;
      }

      const keyToSignal = new Map();
      const keyToVwapSignal = new Map();
      const successfulKeys = new Set();
      const failedKeys = new Map();
      const batchSize = 10;
      const tickedAutoTradeKeys = new Set(); // prevent duplicate onCandleTick per instrument

      for (let i = 0; i < pairsToProcess.length; i += batchSize) {
        const batch = pairsToProcess.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async ({ key: origKey, timeframe: tf }) => {
            const pairId = `${origKey}::${tf}`;
            const intervalMinutes = tf === '5m' ? 5 : 15;
            try {
              let workingKey = workingKeyCache.get(origKey);
              let data = null;

              if (workingKey) {
                const url = buildIntradayURL(workingKey, intervalMinutes);
                const r = await fetch(url, { headers: getHeaders() });

                if (r.ok) {
                  const j = await r.json();
                  data = j?.data?.candles || null;

                  if (data && data.length > 0) {
                    failureCount.delete(pairId);
                    permanentlyFailedUntil.delete(pairId);
                    successfulKeys.add(pairId);
                  }
                } else {
                  workingKeyCache.delete(origKey);
                }
              }

              if (!data || data.length < 20) {
                const variants = buildVariants(origKey);
                const result = await tryIntraday(origKey, variants, intervalMinutes);

                if (result) {
                  workingKey = result.key;
                  data = result.data;
                  workingKeyCache.set(origKey, workingKey);
                  failureCount.delete(pairId);
                  permanentlyFailedUntil.delete(pairId);
                  successfulKeys.add(pairId);

                  if (workingKey !== origKey) {
                    console.log(
                      `[AlertEngine] ✓ Working key: ${origKey} → ${workingKey}`
                    );
                  }
                } else {
                  const failures = (failureCount.get(pairId) || 0) + 1;
                  failureCount.set(pairId, failures);
                  failedKeys.set(
                    pairId,
                    `No data after ${variants.length} variants (attempt ${failures}/5)`
                  );

                  if (failures >= 5) {
                    permanentlyFailedUntil.set(pairId, Date.now() + FAILED_RETRY_MS);
                    console.log(
                      `[AlertEngine] ⛔ Cooling down ${origKey} (${tf}) after ${failures} failures (retry in ${Math.round(FAILED_RETRY_MS / 1000)}s)`
                    );
                  }
                }
              }

              if (data && data.length > 0) {
                const isFOKey = typeof origKey === 'string' && origKey.includes('_FO');
                const scanFO = parseInt(process.env.EMA_SCAN_LAST_N_CANDLES_FO, 10);
                const scanBase = parseInt(process.env.EMA_SCAN_LAST_N_CANDLES, 10);
                const maxToCheck = isFOKey
                  ? (Number.isFinite(scanFO) && scanFO > 0 ? scanFO : 24)
                  : (Number.isFinite(scanBase) && scanBase > 0 ? scanBase : 12);
                  
                const signals = await evaluate(
                  data,
                  origKey,
                  workingKey,
                  maxToCheck,
                  intervalMinutes
                );
                
                if (signals && signals.length > 0) {
                  keyToSignal.set(pairId, signals);
                }

                // VWAP evaluation (alert + auto-trade)
                try {
                  const vwapSigs = evaluateVWAP(data, origKey, intervalMinutes);
                  if (vwapSigs && vwapSigs.length > 0) {
                    keyToVwapSignal.set(pairId, vwapSigs);
                  }
                } catch (vwapErr) {
                  console.error(`[AlertEngine] VWAP error for ${origKey}:`, vwapErr.message);
                }

                // Auto-trade: monitor active trades on every candle tick (once per instrument)
                if (!tickedAutoTradeKeys.has(origKey)) {
                  tickedAutoTradeKeys.add(origKey);
                  autoTradeService.onCandleTick(origKey, data, intervalMinutes).catch((err) =>
                    console.error(`[AutoTrade] Tick error for ${origKey}:`, err.message)
                  );
                }

                successfulKeys.add(pairId);
              } else if (!failedKeys.has(pairId) && !successfulKeys.has(pairId)) {
                failedKeys.set(pairId, `No candles returned`);
              }
            } catch (err) {
              console.error(
                `[AlertEngine] Error processing ${origKey} (${tf}):`,
                err.message
              );
              failedKeys.set(pairId, `Exception: ${err.message}`);
            }
          })
        );

        if (i + batchSize < pairsToProcess.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      console.log(`\n[AlertEngine] Fetch Summary:`);
      console.log(`  ✓ Success: ${successfulKeys.size}/${pairsToProcess.length}`);
      console.log(`  ✗ Failed: ${failedKeys.size}/${pairsToProcess.length}`);

      // If ALL instruments failed, it's likely an Upstox auth issue
      if (successfulKeys.size === 0 && failedKeys.size > 0) {
        const now = Date.now();
        if (now - lastCriticalWarnAt > 10 * 60 * 1000) {
          console.warn(
            `\n[AlertEngine] ⚠️  CRITICAL: ALL ${failedKeys.size} instruments failed to fetch!`
          );
          console.warn(`[AlertEngine] Likely cause: Invalid/expired Upstox API token (401 error)`);
          console.warn(`[AlertEngine] Action: Please refresh your Upstox token at http://pratik.gyanoda.in/login`);
          console.warn(`[AlertEngine] Will retry with longer intervals to avoid spam.\n`);
          lastCriticalWarnAt = now;
        }
      }

      if (failedKeys.size > 0 && process.env.DEBUG_ALERTS) {
        console.log(`\n[AlertEngine] Failed instruments:`);
        for (const [key, reason] of failedKeys) {
          console.log(`  ✗ ${key}: ${reason}`);
        }
      }

      if (keyToSignal.size > 0) {
        console.log(`\n[AlertEngine] Creating ${keyToSignal.size} alert(s)...`);
        
        // Get WhatsApp phone numbers once
        const whatsappNumbers = getWhatsAppPhoneNumbers();
        
        // STEP 1: Send broadcasts and WhatsApp IMMEDIATELY
        if (typeof broadcastAlert === 'function') {
          for (const [pairId, signals] of keyToSignal) {
            const [instrumentKey, tf] = pairId.split('::');
            const tfLabel = tf || '15m';
            let instrumentName = instrumentKey;
            let instrument = null;
            
            try {
              instrument = instrumentsSearchService.getInstrument(instrumentKey);
              if (instrument) {
                instrumentName = instrument.tradingSymbol || instrument.name || instrumentKey;
              }
            } catch (e) {
              // Ignore
            }
            
            for (const sig of signals) {
              for (const [userId, watchlistSet] of dynamicSubscriptionManager.userWatchlists) {
                if (watchlistSet && watchlistSet.has(instrumentKey) && dynamicSubscriptionManager.getUserTimeframe(userId, instrumentKey) === tfLabel) {
                  try {
                    const notificationSentAt = Date.now();
                    const delayFromDetection = Math.round((notificationSentAt - sig.crossDetectedAt) / 1000);
                    const delayFromCandleClose = Math.round((notificationSentAt - sig.candleEndTime) / 1000);
                    console.log(
                      `[AlertEngine] 📤 Broadcasting ${instrumentKey} (${tfLabel})\n` +
                      `   Delay from detection: ${delayFromDetection}s\n` +
                      `   Delay from candle close: ${delayFromCandleClose}s`
                    );
                    
                    // Broadcast to WebSocket immediately
                    broadcastAlert({
                      userId,
                      instrumentKey,
                      instrumentName,
                      timeframe: tfLabel,
                      strategy: 'ema20_cross_up',
                      candle: { 
                        ts: sig.ts, 
                        open: sig.open, 
                        high: sig.high, 
                        low: sig.low, 
                        close: sig.close 
                      },
                      ema: sig.ema,
                      crossDetectedAt: sig.crossDetectedAt,
                      notificationSentAt,
                      createdAt: new Date().toISOString(),
                    });

                    // Auto-trade: place entry order (non-blocking)
                    autoTradeService.onSignal(userId, instrumentKey, sig).catch((err) =>
                      console.error(`[AutoTrade] Signal error for ${instrumentKey}:`, err.message)
                    );
                    
                    // Send WhatsApp notification IMMEDIATELY (non-blocking)
                    if (whatsappNumbers.length > 0) {
                      const whatsappStartTime = Date.now();
                      sendWhatsAppAlert({
                        instrumentName: instrumentName,
                        close: sig.close,
                        ema: sig.ema,
                        phoneNumbers: whatsappNumbers
                      }).then(result => {
                        const whatsappDuration = Date.now() - whatsappStartTime;
                        if (result.success) {
                          console.log(`[AlertEngine] ✓ WhatsApp sent for ${instrumentName} (${whatsappDuration}ms)`);
                        } else {
                          console.error(`[AlertEngine] ✗ WhatsApp failed for ${instrumentName}:`, result.message);
                        }
                      }).catch(err => {
                        const whatsappDuration = Date.now() - whatsappStartTime;
                        console.error(`[AlertEngine] ✗ WhatsApp error for ${instrumentName} (${whatsappDuration}ms):`, err.message);
                      });
                    }

                    // Queue voice call in buffered/cooldown mode (non-blocking)
                    // Fetch user's phone for per-user voice routing
                    let userPhone = '';
                    try {
                      const User = (await import('../models/User.js')).default;
                      const user = await User.findById(userId).select('phone');
                      userPhone = user?.phone || '';
                    } catch (err) {
                      console.warn(`[AlertEngine] Could not fetch user phone for ${userId}:`, err.message);
                    }

                    const voiceResult = enqueueBufferedVoiceAlert({
                      instrumentKey,
                      instrumentName,
                      close: sig.close,
                      ema: sig.ema,
                      ts: sig.ts,
                      strategy: 'ema20_cross_up',
                      phoneNumber: userPhone,
                    });
                    if (process.env.DEBUG_ALERTS && voiceResult?.reason) {
                      console.log(`[AlertEngine] Voice queue skipped for ${instrumentName}: ${voiceResult.reason}`);
                    }

                    // Send push notification (non-blocking, with fallback)
                    const pushStartTime = Date.now();
                    try {
                      const User = (await import('../models/User.js')).default;
                      const userForPush = await User.findById(userId).select('pushToken');
                      if (userForPush?.pushToken) {
                        const pushResult = await sendPushAlertToUser(userForPush, {
                          instrumentKey,
                          instrumentName,
                          close: sig.close,
                          ema: sig.ema,
                          strategy: 'ema20_cross_up',
                        }, { pushNotificationsEnabled: true });
                        
                        const pushDuration = Date.now() - pushStartTime;
                        if (pushResult.success) {
                          console.log(`[AlertEngine] ✓ Push sent for ${instrumentName} (${pushDuration}ms)`);
                        } else if (pushResult.sent === false) {
                          if (process.env.DEBUG_ALERTS) {
                            console.log(`[AlertEngine] Push skipped for ${instrumentName}: ${pushResult.reason} (${pushDuration}ms)`);
                          }
                        } else {
                          console.warn(`[AlertEngine] ✗ Push failed for ${instrumentName}:`, pushResult.error);
                        }
                      }
                    } catch (err) {
                      const pushDuration = Date.now() - pushStartTime;
                      console.warn(`[AlertEngine] Push notification error for ${instrumentName} (${pushDuration}ms):`, err?.message);
                    }

                    // Send email notification (non-blocking)
                    const emailStartTime = Date.now();
                    try {
                      const User = (await import('../models/User.js')).default;
                      const userForEmail = await User.findById(userId).select('email');
                      if (userForEmail?.email) {
                        const emailResult = await sendAlertEmailToUser(userForEmail, {
                          instrumentKey,
                          instrumentName,
                          close: sig.close,
                          ema: sig.ema,
                          strategy: 'ema20_cross_up',
                        }, { emailNotificationsEnabled: true });

                        const emailDuration = Date.now() - emailStartTime;
                        if (emailResult.sent) {
                          console.log(`[AlertEngine] ✓ Email sent for ${instrumentName} (${emailDuration}ms)`);
                        } else if (process.env.DEBUG_ALERTS) {
                          console.log(`[AlertEngine] Email skipped/failed for ${instrumentName}: ${emailResult.reason || emailResult.error || 'unknown'} (${emailDuration}ms)`);
                        }
                      }
                    } catch (err) {
                      const emailDuration = Date.now() - emailStartTime;
                      console.warn(`[AlertEngine] Email notification error for ${instrumentName} (${emailDuration}ms):`, err?.message);
                    }
                  } catch (e) {
                    console.warn(`[AlertEngine] Broadcast failed:`, e?.message);
                  }
                }
              }
            }
          }
        }

        // STEP 2: Save to database in background (non-blocking)
        const ops = [];
        for (const [userId, keys] of userMap) {
          for (const k of keys) {
            const userTf = dynamicSubscriptionManager.getUserTimeframe(userId, k);
            const pId = `${k}::${userTf}`;
            const sigs = keyToSignal.get(pId) || [];
            if (!sigs.length) continue;

            const currentSet = dynamicSubscriptionManager.userWatchlists.get(userId);
            const isStillMember = currentSet && currentSet.has(k);
            if (!isStillMember) continue;

            for (const sig of sigs) {
              const notificationSentAt = Date.now();
              ops.push(
                Alert.updateOne(
                  {
                    userId,
                    instrumentKey: k,
                    "candle.ts": sig.ts,
                    strategy: "ema20_cross_up",
                  },
                  {
                    $setOnInsert: {
                      userId,
                      instrumentKey: k,
                      timeframe: userTf,
                      strategy: "ema20_cross_up",
                      candle: {
                        ts: sig.ts,
                        open: sig.open,
                        high: sig.high,
                        low: sig.low,
                        close: sig.close,
                      },
                      ema: sig.ema,
                      crossDetectedAt: new Date(sig.crossDetectedAt),
                      notificationSentAt: new Date(notificationSentAt),
                      status: "active",
                      createdAt: new Date(),
                    },
                  },
                  { upsert: true }
                )
              );
            }
          }
        }

        // Save to database without blocking (fire and forget with error handling)
        if (ops.length) {
          const dbStartTime = Date.now();
          Promise.allSettled(ops).then(results => {
            const dbDuration = Date.now() - dbStartTime;
            const successful = results.filter((r) => r.status === "fulfilled").length;
            const failed = results.filter((r) => r.status === "rejected");
            console.log(`[AlertEngine] 💾 Database: ${successful}/${ops.length} alerts saved (${dbDuration}ms)`);
            if (failed.length > 0) {
              console.error(`[AlertEngine] ⚠️  ${failed.length} database saves failed`);
              failed.slice(0, 3).forEach((r, i) => {
                console.error(`[AlertEngine]   Error ${i + 1}:`, r.reason?.message || r.reason);
              });
            }
          }).catch(err => {
            const dbDuration = Date.now() - dbStartTime;
            console.error(`[AlertEngine] ❌ Database save error (${dbDuration}ms):`, err.message);
          });
        }
      }

      // ── VWAP Alerts (notification + auto-trade) ──
      if (keyToVwapSignal.size > 0) {
        console.log(`\n[AlertEngine] Processing ${keyToVwapSignal.size} VWAP alert(s)...`);

        const whatsappNumbers = getWhatsAppPhoneNumbers();

        for (const [pairId, signals] of keyToVwapSignal) {
          const [instrumentKey, tf] = pairId.split('::');
          const tfLabel = tf || '15m';
          let instrumentName = instrumentKey;
          let instrument = null;

          try {
            instrument = instrumentsSearchService.getInstrument(instrumentKey);
            if (instrument) {
              instrumentName = instrument.tradingSymbol || instrument.name || instrumentKey;
            }
          } catch (e) {
            // Ignore
          }

          for (const sig of signals) {
            let hasMatchingUser = false;

            // Broadcast to all subscribed users
            for (const [userId, watchlistSet] of dynamicSubscriptionManager.userWatchlists) {
              if (watchlistSet && watchlistSet.has(instrumentKey) && dynamicSubscriptionManager.getUserTimeframe(userId, instrumentKey) === tfLabel) {
                hasMatchingUser = true;
                try {
                  if (typeof broadcastAlert === 'function') {
                    broadcastAlert({
                      userId,
                      instrumentKey,
                      instrumentName,
                      timeframe: tfLabel,
                      strategy: 'vwap_cross_up',
                      candle: {
                        ts: sig.ts,
                        open: sig.open,
                        high: sig.high,
                        low: sig.low,
                        close: sig.close,
                      },
                      vwap: sig.vwap,
                      entry: sig.entry,
                      stoploss: sig.stoploss,
                      target: sig.target,
                      crossDetectedAt: sig.crossDetectedAt,
                      notificationSentAt: Date.now(),
                      createdAt: new Date().toISOString(),
                    });
                  }

                  // Auto-trade: place entry order for VWAP signal (non-blocking)
                  autoTradeService.onSignal(userId, instrumentKey, sig).catch((err) =>
                    console.error(`[AutoTrade] VWAP signal error for ${instrumentKey}:`, err.message)
                  );

                  // Push notification
                  try {
                    const User = (await import('../models/User.js')).default;
                    const userForPush = await User.findById(userId).select('pushToken');
                    if (userForPush?.pushToken) {
                      sendPushAlertToUser(userForPush, {
                        instrumentKey,
                        instrumentName,
                        entry: sig.entry,
                        stoploss: sig.stoploss,
                        target: sig.target,
                        strategy: 'vwap_cross_up',
                      }, { pushNotificationsEnabled: true }).catch(err => {
                        console.warn(`[AlertEngine] VWAP push error for ${instrumentName}:`, err?.message);
                      });
                    }
                  } catch (err) {
                    console.warn(`[AlertEngine] VWAP push lookup error:`, err?.message);
                  }
                } catch (e) {
                  console.warn(`[AlertEngine] VWAP broadcast failed:`, e?.message);
                }
              }
            }

            // WhatsApp VWAP alert — only if at least one user has this in their watchlist
            if (hasMatchingUser && whatsappNumbers.length > 0) {
              sendVwapWhatsAppAlert({
                instrumentName,
                entry: sig.entry,
                stoploss: sig.stoploss,
                target: sig.target,
                phoneNumbers: whatsappNumbers,
              }).then(result => {
                if (result.success) {
                  console.log(`[AlertEngine] ✓ VWAP WhatsApp sent for ${instrumentName}`);
                } else {
                  console.error(`[AlertEngine] ✗ VWAP WhatsApp failed for ${instrumentName}:`, result.message);
                }
              }).catch(err => {
                console.error(`[AlertEngine] ✗ VWAP WhatsApp error for ${instrumentName}:`, err.message);
              });
            }
          }
        }

        // Save VWAP alerts to database
        const vwapOps = [];
        for (const [userId, keys] of userMap) {
          for (const k of keys) {
            const userTf = dynamicSubscriptionManager.getUserTimeframe(userId, k);
            const pId = `${k}::${userTf}`;
            const sigs = keyToVwapSignal.get(pId) || [];
            if (!sigs.length) continue;

            const currentSet = dynamicSubscriptionManager.userWatchlists.get(userId);
            if (!currentSet || !currentSet.has(k)) continue;

            for (const sig of sigs) {
              vwapOps.push(
                Alert.updateOne(
                  {
                    userId,
                    instrumentKey: k,
                    "candle.ts": sig.ts,
                    strategy: "vwap_cross_up",
                  },
                  {
                    $setOnInsert: {
                      userId,
                      instrumentKey: k,
                      timeframe: userTf,
                      strategy: "vwap_cross_up",
                      candle: {
                        ts: sig.ts,
                        open: sig.open,
                        high: sig.high,
                        low: sig.low,
                        close: sig.close,
                      },
                      vwap: sig.vwap,
                      entry: sig.entry,
                      stoploss: sig.stoploss,
                      target: sig.target,
                      crossDetectedAt: new Date(sig.crossDetectedAt),
                      notificationSentAt: new Date(),
                      status: "active",
                      createdAt: new Date(),
                    },
                  },
                  { upsert: true }
                )
              );
            }
          }
        }

        if (vwapOps.length) {
          Promise.allSettled(vwapOps).then(results => {
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected');
            console.log(`[AlertEngine] 💾 VWAP DB: ${successful}/${vwapOps.length} saved`);
            if (failed.length > 0) {
              console.error(`[AlertEngine] ⚠️  ${failed.length} VWAP DB saves failed`);
            }
          }).catch(err => {
            console.error(`[AlertEngine] ❌ VWAP DB error:`, err.message);
          });
        }
      }
    } catch (e) {
      console.error("[AlertEngine] Tick error:", e.message);
      console.error(e.stack);
      // Clear temporary data on error to prevent corruption
      try {
        workingKeyCache.clear();
        failureCount.clear();
      } catch (cleanupErr) {
        console.error("[AlertEngine] Cleanup error:", cleanupErr.message);
      }
    } finally {
      if (!stopRef.stopped) {
        setTimeout(tick, nextTickDelay);
      }
    }
  }

  console.log("[AlertEngine] Starting first tick...");
  preloadSentAlerts().then(() => tick());

  return {
    stop: () => {
      stopRef.stopped = true;
      console.log("[AlertEngine] Stopped");
    },
  };
}