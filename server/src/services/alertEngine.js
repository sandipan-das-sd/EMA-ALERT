import fetch from "node-fetch";
import Alert from "../models/Alert.js";
import { sendWhatsAppAlert, getWhatsAppPhoneNumbers } from "./whatsappNotification.js";

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
  const permanentlyFailed = new Set();
  const historicalCache = new Map();
  const sentAlerts = new Set();
  
  // Track tick count for reduced logging
  let tickCount = 0;
  
  // Track last cleanup to prevent memory leak
  let lastCleanupDate = toIstDateString(Date.now());
  
  // Cleanup function to prevent memory leak
  const cleanupDailyData = () => {
    const today = toIstDateString(Date.now());
    if (today && today !== lastCleanupDate) {
      console.log(`[AlertEngine] Daily cleanup: clearing ${sentAlerts.size} sent alerts`);
      sentAlerts.clear();
      historicalCache.clear();
      lastCleanupDate = today;
    }
  };

  const buildHistoricalURL = (instrumentKey, date) => {
    const base = apiBase.replace(/\/$/, "");
    const hasV3 = base.endsWith("/v3");
    const prefix = hasV3 ? base : `${base}/v3`;
    const dateStr = date.toISOString().split("T")[0];
    return `${prefix}/historical-candle/${encodeURIComponent(
      instrumentKey
    )}/minutes/15/${dateStr}/${dateStr}`;
  };

  const buildIntradayURL = (instrumentKey) => {
    const base = apiBase.replace(/\/$/, "");
    const hasV3 = base.endsWith("/v3");
    const prefix = hasV3 ? base : `${base}/v3`;
    return `${prefix}/historical-candle/intraday/${encodeURIComponent(
      instrumentKey
    )}/minutes/15`;
  };

  const fetchHistoricalCandles = async (instrumentKey, minCandlesNeeded) => {
    if (!minCandlesNeeded || minCandlesNeeded <= 0) {
      return [];
    }

    const todayKey = toIstDateString(Date.now());
    const cacheKey = `${instrumentKey}::${todayKey}`;
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
        const url = buildHistoricalURL(instrumentKey, date);
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

  const tryIntraday = async (key, variants) => {
    for (const v of variants) {
      try {
        const url = buildIntradayURL(v);
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
    maxCandlesToCheck = 12
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
        ? await fetchHistoricalCandles(workingKey, desiredHistoryCount)
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
    const timeframeMs = 15 * 60 * 1000;
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

      // FIXED: Check if EMA intersects the candle body
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

      // FIXED: Check the correct variables
      if (candleClosed && isGreen && emaIntersectsCandle && closedAboveEma) {
        const alertId = `${instrumentKey}::${candleStartTs}`;
        if (sentAlerts.has(alertId)) {
          continue;
        }
        
        sentAlerts.add(alertId);
        const crossDetectedAt = Date.now(); // Track when we detected the cross
        console.log(
          `\n🎯 [AlertEngine] SIGNAL for ${instrumentKey} at ${startIstStr}\n` +
          `   Open: ${open.toFixed(2)} | Close: ${close.toFixed(2)} | EMA: ${emaOpenEffective.toFixed(5)}\n` +
          `   High: ${high.toFixed(2)} | Low: ${low.toFixed(2)}\n` +
          `   Cross detected at: ${new Date(crossDetectedAt).toISOString()}`
        );
        
        signals.push({
          ts: candleStartTs,
          open,
          high,
          low,
          close,
          ema: emaOpenEffective,
          crossDetectedAt, // Add detection timestamp
        });
      }
    }

    return signals;
  };

  async function tick() {
    if (stopRef.stopped) return;

    try {
      // Daily cleanup to prevent memory leak
      cleanupDailyData();
      
      const userMap = new Map();
      for (const [userId, wl] of dynamicSubscriptionManager.userWatchlists) {
        userMap.set(userId, Array.from(wl));
      }
      
      const allKeys = Array.from(
        new Set([].concat(...Array.from(userMap.values())))
      );

      const keysToProcess = allKeys.filter((k) => !permanentlyFailed.has(k));

      tickCount++;
      const shouldLog = tickCount % 10 === 1; // Only log every 10th tick
      
      if (shouldLog) {
        console.log(
          `[AlertEngine] Tick #${tickCount}: Monitoring ${keysToProcess.length}/${allKeys.length} instruments (${permanentlyFailed.size} failed)`
        );
      }

      if (keysToProcess.length === 0) {
        if (shouldLog) console.log('[AlertEngine] No instruments to monitor');
        return setTimeout(tick, intervalMs);
      }

      const keyToSignal = new Map();
      const successfulKeys = new Set();
      const failedKeys = new Map();
      const batchSize = 10;

      for (let i = 0; i < keysToProcess.length; i += batchSize) {
        const batch = keysToProcess.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (origKey) => {
            try {
              let workingKey = workingKeyCache.get(origKey);
              let data = null;

              if (workingKey) {
                const url = buildIntradayURL(workingKey);
                const r = await fetch(url, { headers: getHeaders() });

                if (r.ok) {
                  const j = await r.json();
                  data = j?.data?.candles || null;

                  if (data && data.length > 0) {
                    failureCount.delete(origKey);
                    permanentlyFailed.delete(origKey);
                    successfulKeys.add(origKey);
                  }
                } else {
                  workingKeyCache.delete(origKey);
                }
              }

              if (!data || data.length < 20) {
                const variants = buildVariants(origKey);
                const result = await tryIntraday(origKey, variants);

                if (result) {
                  workingKey = result.key;
                  data = result.data;
                  workingKeyCache.set(origKey, workingKey);
                  failureCount.delete(origKey);
                  permanentlyFailed.delete(origKey);
                  successfulKeys.add(origKey);

                  if (workingKey !== origKey) {
                    console.log(
                      `[AlertEngine] ✓ Working key: ${origKey} → ${workingKey}`
                    );
                  }
                } else {
                  const failures = (failureCount.get(origKey) || 0) + 1;
                  failureCount.set(origKey, failures);
                  failedKeys.set(
                    origKey,
                    `No data after ${variants.length} variants (attempt ${failures}/5)`
                  );

                  if (failures >= 5) {
                    permanentlyFailed.add(origKey);
                    console.log(
                      `[AlertEngine] ⛔ Skipping ${origKey} after ${failures} failures`
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
                  maxToCheck
                );
                
                if (signals && signals.length > 0) {
                  keyToSignal.set(origKey, signals);
                }
                
                successfulKeys.add(origKey);
              } else if (!failedKeys.has(origKey) && !successfulKeys.has(origKey)) {
                failedKeys.set(origKey, `No candles returned`);
              }
            } catch (err) {
              console.error(
                `[AlertEngine] Error processing ${origKey}:`,
                err.message
              );
              failedKeys.set(origKey, `Exception: ${err.message}`);
            }
          })
        );

        if (i + batchSize < keysToProcess.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      console.log(`\n[AlertEngine] Fetch Summary:`);
      console.log(`  ✓ Success: ${successfulKeys.size}/${keysToProcess.length}`);
      console.log(`  ✗ Failed: ${failedKeys.size}/${keysToProcess.length}`);

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
        
        if (typeof broadcastAlert === 'function') {
          for (const [instrumentKey, signals] of keyToSignal) {
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
                if (watchlistSet && watchlistSet.has(instrumentKey)) {
                  try {
                    const notificationSentAt = Date.now();
                    const delaySec = Math.round((notificationSentAt - sig.crossDetectedAt) / 1000);
                    console.log(`[AlertEngine] Notification sent for ${instrumentKey} - Delay: ${delaySec}s`);
                    broadcastAlert({
                      userId,
                      instrumentKey,
                      instrumentName,
                      timeframe: '15m',
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
                    
                    // Send WhatsApp notification IMMEDIATELY (don't wait)
                    if (whatsappNumbers.length > 0) {
                      console.log(`[AlertEngine] Sending immediate WhatsApp for ${instrumentName}`);
                      sendWhatsAppAlert({
                        instrumentName: instrumentName, // Full instrument name (e.g., NIFTY13SEP2020CE)
                        close: sig.close,
                        ema: sig.ema,
                        phoneNumbers: whatsappNumbers
                      }).then(result => {
                        if (result.success) {
                          console.log(`[AlertEngine] ✓ WhatsApp sent for ${instrumentName}`);
                        } else {
                          console.error(`[AlertEngine] ✗ WhatsApp failed for ${instrumentName}:`, result.message);
                        }
                      }).catch(err => {
                        console.error(`[AlertEngine] ✗ WhatsApp error for ${instrumentName}:`, err.message);
                      });
                    }
                  } catch (e) {
                    console.warn(`[AlertEngine] Broadcast failed:`, e?.message);
                  }
                }
              }
            }
          }
        }

        const ops = [];
        for (const [userId, keys] of userMap) {
          for (const k of keys) {
            const sigs = keyToSignal.get(k) || [];
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
                      timeframe: "15m",
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

        if (ops.length) {
          const results = await Promise.allSettled(ops);
          const successful = results.filter((r) => r.status === "fulfilled").length;
          if (shouldLog || successful > 0) {
            console.log(`[AlertEngine] ✓ ${successful}/${ops.length} alerts saved`);
          }
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
        // Add delay on error to prevent rapid crash loops
        const delay = intervalMs;
        setTimeout(tick, delay);
      }
    }
  }

  console.log("[AlertEngine] Starting first tick...");
  tick();

  return {
    stop: () => {
      stopRef.stopped = true;
      console.log("[AlertEngine] Stopped");
    },
  };
}