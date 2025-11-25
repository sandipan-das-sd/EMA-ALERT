import fetch from "node-fetch";
import Alert from "../models/Alert.js";
import wbm from 'wbm';

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
 * @param {number[]} values - Array of prices (must have at least 'length' values)
 * @param {number} length - EMA period (default 20)
 * @returns {number[]} Array of EMA values
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
  instrumentsSearchService,
  dynamicSubscriptionManager,
  intervalMs = 60_000,
  whatsappPhoneNumber,
}) {
  if (!accessToken) {
    console.warn("[AlertEngine] Disabled: missing UPSTOX_ACCESS_TOKEN");
    return { stop: () => {} };
  }

  console.log("[AlertEngine] Starting with interval:", intervalMs, "ms");
  console.log("[AlertEngine] API Base URL:", apiBase);

  // Initialize WhatsApp if phone number provided. Keep a ready-promise to await before sending.
  let _whatsappReady = Promise.resolve();
  if (whatsappPhoneNumber) {
    // Open the browser on first run so user can scan QR; session:true attempts to persist session.
    _whatsappReady = wbm
      .start({ showBrowser: true, qrCodeData: true, session: true })
      .then(() => {
        console.log('[AlertEngine] WhatsApp initialized');
      })
      .catch((err) => {
        console.error('[AlertEngine] WhatsApp init error:', err);
        // keep the promise rejected so sends will fail fast and be logged
        throw err;
      });
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const stopRef = { stopped: false };
  const workingKeyCache = new Map(); // originalKey -> working intraday key
  const failureCount = new Map(); // Track failures per key
  const permanentlyFailed = new Set(); // Keys that have failed too many times
  const historicalCache = new Map(); // Cache previous-day candles per instrument

  /**
   * Build historical API URL for a specific date
   * Format: /v3/historical-candle/{instrument_key}/minutes/15/{to_date}/{from_date}
   */
  const buildHistoricalURL = (instrumentKey, date) => {
    const base = apiBase.replace(/\/$/, "");
    const hasV3 = base.endsWith("/v3");
    const prefix = hasV3 ? base : `${base}/v3`;

    // Format: YYYY-MM-DD
    const dateStr = date.toISOString().split("T")[0];
    return `${prefix}/historical-candle/${encodeURIComponent(
      instrumentKey
    )}/minutes/15/${dateStr}/${dateStr}`;
  };

  /**
   * Build correct Intraday API V3 URL
   * Format: /v3/historical-candle/intraday/{instrument_key}/minutes/15
   */
  const buildIntradayURL = (instrumentKey) => {
    // Remove trailing slash from apiBase
    const base = apiBase.replace(/\/$/, "");

    // Check if apiBase already ends with /v3
    const hasV3 = base.endsWith("/v3");
    const prefix = hasV3 ? base : `${base}/v3`;

    // Intraday endpoint - NO date range needed!
    return `${prefix}/historical-candle/intraday/${encodeURIComponent(
      instrumentKey
    )}/minutes/15`;
  };

  /**
   * Fetch historical candles until we have the minimum required to seed EMA
   */
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
    const maxLookbackDays = 7; // Avoid excessive requests

    for (let dayOffset = 1; dayOffset <= maxLookbackDays; dayOffset++) {
      if (allCandles.length >= minCandlesNeeded) break;

      const date = new Date(today);
      date.setDate(date.getDate() - dayOffset);

      // Skip weekends
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        console.log(
          `[AlertEngine] Skipping weekend: ${date.toISOString().split("T")[0]}`
        );
        continue;
      }

      try {
        const url = buildHistoricalURL(instrumentKey, date);
        console.log(`[AlertEngine] Requesting historical: ${url}`);
        const r = await fetch(url, { headers });

        if (r.ok) {
          const j = await r.json();
          if (j?.data?.candles?.length) {
            allCandles.push(...j.data.candles); // reverse chronological order
            console.log(
              `[AlertEngine] Fetched ${
                j.data.candles.length
              } historical candles from ${date.toISOString().split("T")[0]}`
            );
          } else {
            console.log(
              `[AlertEngine] No candles in response for ${
                date.toISOString().split("T")[0]
              }`
            );
          }
        } else {
          const txt = await r.text();
          console.log(
            `[AlertEngine] Historical fetch failed (${r.status}) for ${
              date.toISOString().split("T")[0]
            }: ${txt.substring(0, 200)}`
          );
        }
      } catch (err) {
        console.log(
          `[AlertEngine] Error fetching historical data for ${
            date.toISOString().split("T")[0]
          }:`,
          err.message
        );
      }
    }

    if (allCandles.length < minCandlesNeeded) {
      console.log(
        `[AlertEngine] Only gathered ${allCandles.length}/${minCandlesNeeded} historical candles`
      );
    }

    if (allCandles.length > 0) {
      for (const key of historicalCache.keys()) {
        if (key.startsWith(`${instrumentKey}::`) && key !== cacheKey) {
          historicalCache.delete(key);
        }
      }
      historicalCache.set(cacheKey, [...allCandles]);
    }

    return allCandles;
  };

  /**
   * Try fetching intraday data with different instrument key variants
```
   */
  const tryIntraday = async (key, variants) => {
    for (const v of variants) {
      try {
        const url = buildIntradayURL(v);

        const r = await fetch(url, { headers });

        if (r.status === 404) {
          continue; // Try next variant
        }

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

  /**
   * Build instrument key variants
   * Try different separator formats and trading symbols
   */
  const buildVariants = (origKey) => {
    const variants = new Set([origKey]);

    // Try both | and : separators
    if (origKey.includes("|")) {
      variants.add(origKey.replace("|", ":"));
    } else if (origKey.includes(":")) {
      variants.add(origKey.replace(":", "|"));
    }

    // Get instrument details if available
    const inst = instrumentsSearchService?.getInstrument?.(origKey);
    if (!inst) {
      return Array.from(variants);
    }

    const parts = origKey.split(/[|:]/);
    const segment = parts[0];

    // For Equity: Add trading symbol variants
    if (segment.includes("_EQ")) {
      if (inst.tradingSymbol) {
        variants.add(`${segment}|${inst.tradingSymbol}`);
        variants.add(`${segment}:${inst.tradingSymbol}`);
      }
    }

    // For F&O: MUST use trading symbol (tokens don't work)
    if (segment.includes("_FO")) {
      if (inst.tradingSymbol) {
        const ts = inst.tradingSymbol;
        const cleanTS = ts.replace(/\s+/g, "");

        variants.add(`${segment}|${ts}`);
        variants.add(`${segment}:${ts}`);
        variants.add(`${segment}|${cleanTS}`);
        variants.add(`${segment}:${cleanTS}`);
      } else {
        // F&O without trading symbol will likely fail
        console.log(
          `[AlertEngine] Warning: ${origKey} is F&O without trading symbol`
        );
      }
    }

    // For INDEX
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

  /**
   * Evaluate candles for EMA crossover signal
   * Strategy: Green candle that crosses above or touches 20 EMA
   * If we have < 20 candles, fetch historical data to complete the set
   */
  const evaluate = async (
    candles,
    instrumentKey,
    workingKey,
    maxCandlesToCheck = 12
  ) => {
    // Upstox returns candles in REVERSE chronological order - MUST reverse!
    let sortedCandles = [...candles].reverse();

    const emaPeriod = 20;
    const requiredHistory = emaPeriod - 1; // Need 19 prior candles to seed EMA
    const todaysCount = sortedCandles.length;

    let existingHistory = 0;
    if (sortedCandles.length > 0) {
      const todayIst = toIstDateString(Date.now());
      for (const candle of sortedCandles) {
        const ts = Date.parse(candle[0]);
        if (!Number.isFinite(ts)) {
          continue;
        }
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
      `[AlertEngine] ${instrumentKey}: Today's candles available: ${todaysCount}`
    );

    const historicalCandles =
      desiredHistoryCount > 0
        ? await fetchHistoricalCandles(workingKey, desiredHistoryCount)
        : [];

    if (historicalCandles.length > 0) {
      // Historical candles are returned newest->oldest, so reverse to oldest->newest
      const sortedHistorical = [...historicalCandles].reverse();
      const historyToUse = Math.min(
        desiredHistoryCount,
        sortedHistorical.length
      );
      const trimmedHistorical =
        historyToUse > 0 ? sortedHistorical.slice(-historyToUse) : [];
      sortedCandles = [...trimmedHistorical, ...sortedCandles];
      console.log(
        `[AlertEngine] ${instrumentKey}: Using ${trimmedHistorical.length} historical + ${todaysCount} today = ${sortedCandles.length} total candles`
      );
      if (historyToUse < desiredHistoryCount) {
        console.log(
          `[AlertEngine] ${instrumentKey}: Historical shortage, needed ${desiredHistoryCount} but only using ${historyToUse}`
        );
      }
    } else {
      console.log(
        desiredHistoryCount > 0
          ? `[AlertEngine] ${instrumentKey}: No historical candles available, proceeding with ${todaysCount} candle(s)`
          : `[AlertEngine] ${instrumentKey}: Sufficient real-time candles (${todaysCount}), no historical fetch needed`
      );
    }

    if (sortedCandles.length < emaPeriod) {
      console.log(
        `[AlertEngine] ${instrumentKey}: Only ${sortedCandles.length} candles after combining, need ${emaPeriod} for EMA`
      );
      return [];
    }

    // Extract close prices: candle format = [timestamp, open, high, low, close, volume, oi]
    const closes = sortedCandles.map((c) => Number(c[4]));

    // Calculate 20 EMA
    const emaValues = calculateEMA(closes, emaPeriod);
    if (!emaValues || emaValues.length === 0) {
      return [];
    }

    const n = sortedCandles.length;
    const timeframeMs = 15 * 60 * 1000; // 15 minutes
    const now = Date.now();

    // helper: map close index -> ema at that close
    const firstEmaCloseIndex = emaPeriod - 1; // EMA array index 0 corresponds to close index 19
    const emaAtCloseIndex = (closeIndex) => {
      const emaIndex = closeIndex - firstEmaCloseIndex;
      if (emaIndex < 0 || emaIndex >= emaValues.length) return null;
      return emaValues[emaIndex];
    };

    // Tolerance for 'intersects the opening' check (percentage of price)
    // Default tightened to 0.0005 (0.05%) to reduce false positives; can be overridden via env
    const tolPercent = (() => {
      const v = parseFloat(process.env.EMA_OPEN_TOL_PERCENT);
      return Number.isFinite(v) && v >= 0 ? v : 0.0005;
    })();

    // Which candle indices to check (last N closed candles that have EMA)
    // Only check candles with valid EMA (starting from index 19)
    const toCheck = [];
    const firstValidEmaIndex = firstEmaCloseIndex; // 19
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

      // market hours check (IST 09:15 - 15:15 start)
      const candleStartIst = new Date(candleStartTs + IST_OFFSET_MS);
      const istHour = candleStartIst.getUTCHours();
      const istMin = candleStartIst.getUTCMinutes();
      const afterMarketOpen = istHour > 9 || (istHour === 9 && istMin >= 15);
      const beforeMarketLastStart =
        istHour < 15 || (istHour === 15 && istMin <= 15);
      const inMarketHours = afterMarketOpen && beforeMarketLastStart;
      if (!inMarketHours) continue;

      const candleClosed = now >= candleEndTs;
      const isGreen = close > open;

      // ema at open is ema at previous close, fall back to ema at this close when missing
      const emaPrev = emaAtCloseIndex(idx - 1);
      const emaCurr = emaAtCloseIndex(idx);

      // EXACTLY like validator: use emaOpenEffective for all checks
      const emaOpenEffective = emaPrev !== null ? emaPrev : emaCurr;
      const usedEmaFallback = emaPrev === null && emaCurr !== null;

      if (emaOpenEffective === null) continue; // cannot evaluate

      const tol = Math.max(0.0001, open * tolPercent);
      const prevEmaCloseToOpen = Math.abs(emaOpenEffective - open) <= tol;
      const stayedAboveEma = low >= emaOpenEffective;
      const closedAboveEma = close > emaOpenEffective;

      // Format IST timestamp
      const startIstDate = new Date(candleStartTs + IST_OFFSET_MS);
      const startIstStr = `${startIstDate.getUTCFullYear()}-${String(
        startIstDate.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(startIstDate.getUTCDate()).padStart(
        2,
        "0"
      )}T${String(startIstDate.getUTCHours()).padStart(2, "0")}:${String(
        startIstDate.getUTCMinutes()
      ).padStart(2, "0")}:00 IST`;

      // Diagnostic: if candle is closed and green but no signal, log why
      if (candleClosed && isGreen) {
        const reasons = [];
        if (!prevEmaCloseToOpen) reasons.push("open_not_within_tolerance");
        if (!(close > emaCurr)) reasons.push("close_not_above_emaAtClose");
        if (!inMarketHours) reasons.push("out_of_market_hours");
        if (reasons.length) {
          console.log(
            `[AlertEngine] INFO ${instrumentKey} ${startIstStr} - no signal: ${reasons.join(", ")} | open=${open.toFixed(2)} emaOpenEff=${emaOpenEffective.toFixed(5)} emaClose=${(emaCurr!==null?emaCurr.toFixed(5):'null')} close=${close.toFixed(2)} tol=${tol.toFixed(6)}`
          );
        }
      }

      // Only log when signal triggers
      if (candleClosed && isGreen && prevEmaCloseToOpen && (close > emaCurr)) {
        console.log(
          `\n🎯 [AlertEngine] SIGNAL for ${instrumentKey} at ${startIstStr} | open=${open.toFixed(
            2
          )} close=${close.toFixed(2)} ema=${emaOpenEffective.toFixed(
            5
          )} fallback=${usedEmaFallback}`
        );
        signals.push({
          ts: candleStartTs,
          open,
          high,
          low,
          close,
          ema: emaOpenEffective,
        });

        // Send WhatsApp message if configured
        if (whatsappPhoneNumber) {
          const message = `EMA Alert: ${instrumentKey} crossed above EMA at ${close.toFixed(2)} (${startIstStr})`;
          try {
            // Wait for whatsapp initialization to complete (or fail)
            await _whatsappReady;
            await wbm.send([whatsappPhoneNumber], message);
            console.log(`[AlertEngine] WhatsApp message sent for ${instrumentKey}`);
          } catch (err) {
            console.error(`[AlertEngine] Failed to send WhatsApp message for ${instrumentKey}:`, err?.message || err);
          }
        }
      }
    }

    return signals;
  };

  async function tick() {
    if (stopRef.stopped) return;

    try {
      // Collect all user watchlists
      const userMap = new Map();
      for (const [userId, wl] of dynamicSubscriptionManager.userWatchlists) {
        userMap.set(userId, Array.from(wl));
      }
      const allKeys = Array.from(
        new Set([].concat(...Array.from(userMap.values())))
      );

      // Filter out permanently failed keys
      const keysToProcess = allKeys.filter((k) => !permanentlyFailed.has(k));

      console.log(
        `\n[AlertEngine] ===== TICK ${new Date().toISOString()} =====`
      );
      console.log(
        `[AlertEngine] Monitoring ${keysToProcess.length}/${allKeys.length} instruments for ${userMap.size} user(s)`
      );

      if (keysToProcess.length === 0) {
        return setTimeout(tick, intervalMs);
      }

      // Show sample of instruments being monitored
      if (keysToProcess.length > 0) {
        const sample = keysToProcess.slice(0, 3).join(", ");
        const more =
          keysToProcess.length > 3
            ? ` ... +${keysToProcess.length - 3} more`
            : "";
        console.log(`[AlertEngine] Instruments: ${sample}${more}`);
      }

      // Fetch and evaluate - process in batches to avoid rate limits
      const keyToSignal = new Map();
      const successfulKeys = new Set();
      const failedKeys = new Map(); // key -> reason
      const batchSize = 10;

      for (let i = 0; i < keysToProcess.length; i += batchSize) {
        const batch = keysToProcess.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (origKey) => {
            try {
              let workingKey = workingKeyCache.get(origKey);
              let data = null;

              // Try cached working key first
              if (workingKey) {
                const url = buildIntradayURL(workingKey);
                const r = await fetch(url, { headers });

                if (r.ok) {
                  const j = await r.json();
                  data = j?.data?.candles || null;

                  if (data && data.length > 0) {
                    // Reset failure count on success
                    failureCount.delete(origKey);
                    successfulKeys.add(origKey);
                  }
                } else {
                  // Cached key failed, clear it
                  workingKeyCache.delete(origKey);
                }
              }

              // If no data from cache, try variants
              if (!data || data.length < 20) {
                const variants = buildVariants(origKey);
                const result = await tryIntraday(origKey, variants);

                if (result) {
                  workingKey = result.key;
                  data = result.data;
                  workingKeyCache.set(origKey, workingKey);
                  failureCount.delete(origKey); // Reset on success
                  successfulKeys.add(origKey);

                  if (workingKey !== origKey) {
                    console.log(
                      `[AlertEngine] ✓ Working key found: ${origKey} → ${workingKey}`
                    );
                  }
                } else {
                  // Track failures
                  const failures = (failureCount.get(origKey) || 0) + 1;
                  failureCount.set(origKey, failures);
                  failedKeys.set(
                    origKey,
                    `No data after trying ${variants.length} variants (attempt ${failures}/5)`
                  );

                  if (failures >= 5) {
                    permanentlyFailed.add(origKey);
                    console.log(
                      `[AlertEngine] ⛔ Permanently skipping ${origKey} after ${failures} failures`
                    );
                  }
                }
              }

              // Evaluate for signals (check last N closed candles)
              if (data && data.length > 0) {
                const signals = await evaluate(
                  data,
                  origKey,
                  workingKey,
                  Number(process.env.EMA_SCAN_LAST_N_CANDLES) || 12
                );
                if (signals && signals.length > 0) {
                  keyToSignal.set(origKey, signals);
                }
                // Mark as successful even if no signal (we fetched data)
                successfulKeys.add(origKey);
              } else if (
                !failedKeys.has(origKey) &&
                !successfulKeys.has(origKey)
              ) {
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

        // Small delay between batches
        if (i + batchSize < keysToProcess.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Log summary
      console.log(`\n[AlertEngine] Fetch Summary:`);
      console.log(
        `  ✓ Success: ${successfulKeys.size}/${keysToProcess.length}`
      );
      console.log(`  ✗ Failed: ${failedKeys.size}/${keysToProcess.length}`);

      if (failedKeys.size > 0) {
        console.log(`\n[AlertEngine] Failed instruments:`);
        for (const [key, reason] of failedKeys) {
          console.log(`  ✗ ${key}: ${reason}`);
        }
      }

      // Create alerts for detected signals
      if (keyToSignal.size > 0) {
        console.log(`\n[AlertEngine] Creating ${keyToSignal.size} alert(s)...`);
        const ops = [];

        for (const [userId, keys] of userMap) {
          for (const k of keys) {
            const sigs = keyToSignal.get(k) || [];
            if (!sigs.length) continue;

            for (const sig of sigs) {
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
          const successful = results.filter(
            (r) => r.status === "fulfilled"
          ).length;
          console.log(
            `[AlertEngine] ✓ ${successful}/${ops.length} alerts created/updated`
          );
        }
      } else {
        console.log("[AlertEngine] No signals detected");
      }

      console.log(`[AlertEngine] ===== TICK END =====\n`);
    } catch (e) {
      console.error("[AlertEngine] Tick error:", e.message);
      console.error(e.stack);
    } finally {
      if (!stopRef.stopped) {
        setTimeout(tick, intervalMs);
      }
    }
  }

  // Start the engine
  console.log("[AlertEngine] Starting first tick...");
  tick();

  return {
    stop: () => {
      stopRef.stopped = true;
      console.log("[AlertEngine] Stopped");
    },
  };
}
