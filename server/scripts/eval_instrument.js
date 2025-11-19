import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

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

function calculateEMA(values, length = 20) {
  if (!values || values.length < length) return null;
  const k = 2 / (length + 1);
  const emaValues = [];
  let sum = 0;
  for (let i = 0; i < length; i++) sum += values[i];
  emaValues.push(sum / length);
  for (let i = length; i < values.length; i++) {
    const ema = values[i] * k + emaValues[emaValues.length - 1] * (1 - k);
    emaValues.push(ema);
  }
  return emaValues;
}

const apiBase =
  process.env.UPSTOX_API_BASE ||
  process.env.API_BASE ||
  "https://api.upstox.com/v3";
const accessToken = process.env.UPSTOX_ACCESS_TOKEN || process.env.ACCESS_TOKEN;

if (!accessToken) {
  console.error("Missing UPSTOX_ACCESS_TOKEN in environment");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${accessToken}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

const buildIntradayURL = (instrumentKey) => {
  const base = apiBase.replace(/\/$/, "");
  const prefix = base.endsWith("/v3") ? base : `${base}/v3`;
  return `${prefix}/historical-candle/intraday/${encodeURIComponent(
    instrumentKey
  )}/minutes/15`;
};

const buildHistoricalURL = (instrumentKey, date) => {
  const base = apiBase.replace(/\/$/, "");
  const prefix = base.endsWith("/v3") ? base : `${base}/v3`;
  const dateStr = date.toISOString().split("T")[0];
  return `${prefix}/historical-candle/${encodeURIComponent(
    instrumentKey
  )}/minutes/15/${dateStr}/${dateStr}`;
};

const fetchHistoricalCandles = async (instrumentKey, minCandlesNeeded) => {
  if (!minCandlesNeeded || minCandlesNeeded <= 0) {
    return [];
  }

  const allCandles = [];
  const today = new Date();
  const maxLookbackDays = 7;

  for (let dayOffset = 1; dayOffset <= maxLookbackDays; dayOffset++) {
    if (allCandles.length >= minCandlesNeeded) break;

    const date = new Date(today);
    date.setDate(date.getDate() - dayOffset);

    // Skip weekends
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(
        `[Validator] Skipping weekend: ${date.toISOString().split("T")[0]}`
      );
      continue;
    }

    try {
      const url = buildHistoricalURL(instrumentKey, date);
      console.log(`[Validator] Requesting historical: ${url}`);
      const r = await fetch(url, { headers });

      if (r.ok) {
        const j = await r.json();
        if (j?.data?.candles?.length) {
          allCandles.push(...j.data.candles);
          console.log(
            `[Validator] Fetched ${
              j.data.candles.length
            } historical candles from ${date.toISOString().split("T")[0]}`
          );
        } else {
          console.log(
            `[Validator] No candles in response for ${
              date.toISOString().split("T")[0]
            }`
          );
        }
      } else {
        const txt = await r.text();
        console.log(
          `[Validator] Historical fetch failed (${r.status}) for ${
            date.toISOString().split("T")[0]
          }: ${txt.substring(0, 200)}`
        );
      }
    } catch (err) {
      console.log(
        `[Validator] Error fetching historical data for ${
          date.toISOString().split("T")[0]
        }:`,
        err.message
      );
    }
  }

  if (allCandles.length < minCandlesNeeded) {
    console.log(
      `[Validator] Only gathered ${allCandles.length}/${minCandlesNeeded} historical candles`
    );
  }

  return allCandles;
};

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('Usage: node scripts/eval_instrument.js "INSTRUMENT_KEY"');
    process.exit(1);
  }

  try {
    const url = buildIntradayURL(key);
    console.log("Requesting:", url);
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const txt = await r.text();
      console.error("Fetch failed:", r.status, txt);
      process.exit(1);
    }
    const j = await r.json();
    const candles = j?.data?.candles;
    if (!candles || candles.length === 0) {
      console.error("No candles returned");
      process.exit(1);
    }
    const emaPeriod = 20;
    const requiredHistory = emaPeriod - 1;
    let sorted = [...candles].reverse();
    const todaysCandleCount = sorted.length; // Track how many are from today
    console.log(`Today's candles available: ${todaysCandleCount}`);

    let existingHistory = 0;
    if (sorted.length > 0) {
      const todayIst = toIstDateString(Date.now());
      for (const candle of sorted) {
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

    const historicalCandles =
      desiredHistoryCount > 0
        ? await fetchHistoricalCandles(key, desiredHistoryCount)
        : [];

    if (historicalCandles.length > 0) {
      const sortedHistorical = [...historicalCandles].reverse();
      const historyToUse = Math.min(
        desiredHistoryCount,
        sortedHistorical.length
      );
      const trimmedHistorical =
        historyToUse > 0 ? sortedHistorical.slice(-historyToUse) : [];
      sorted = [...trimmedHistorical, ...sorted];
      console.log(
        `Now have ${sorted.length} total candles (${trimmedHistorical.length} historical + ${todaysCandleCount} today)`
      );
      if (historyToUse < desiredHistoryCount) {
        console.log(
          `Historical shortage: needed ${desiredHistoryCount} but only using ${historyToUse}`
        );
      }
    } else {
      console.log(
        desiredHistoryCount > 0
          ? `No historical candles fetched, proceeding with ${todaysCandleCount} candle(s)`
          : `Sufficient real-time candles (${todaysCandleCount}), no historical fetch needed`
      );
    }

    if (sorted.length < emaPeriod) {
      console.log(
        `Not enough candles for EMA-${emaPeriod} calculation (have ${sorted.length})`
      );
      process.exit(0);
    }

    console.log(`Total candles for analysis: ${sorted.length}`);

    const closes = sorted.map((c) => Number(c[4]));

    // Calculate EMA with available data (need at least 20 for EMA-20)
    const emaValues = calculateEMA(closes, emaPeriod);
    if (!emaValues || emaValues.length === 0) {
      console.log(
        `Not enough data for EMA-${emaPeriod} calculation (need at least ${emaPeriod} candles)`
      );
      console.log("Available candles:", sorted.length);
      process.exit(0);
    }
    console.log(`EMA values calculated: ${emaValues.length}`);
    const n = sorted.length;

    // Helper to get EMA at close index i (i is index into closes)
    const emaAtCloseIndex = (i) => {
      const firstEmaCloseIndex = emaPeriod - 1; // EMA starts after (length-1) closes
      const emaIndex = i - firstEmaCloseIndex;
      if (emaIndex < 0 || emaIndex >= emaValues.length) return null;
      return emaValues[emaIndex];
    };

    // Print all of today's candles (history is only used for seeding EMA)
    const rows = [];
    // Calculate the starting index for today's candles
    const todaysStartIdx = n - todaysCandleCount;
    // Show all of today's candles (history is excluded from output)
    const startIdx = Math.max(0, todaysStartIdx);

    for (let idx = startIdx; idx < n; idx++) {
      const c = sorted[idx];
      const startTs = Date.parse(c[0]);
      const open = Number(c[1]);
      const high = Number(c[2]);
      const low = Number(c[3]);
      const close = Number(c[4]);
      const emaAtClose = emaAtCloseIndex(idx);
      const emaAtOpen = idx - 1 >= 0 ? emaAtCloseIndex(idx - 1) : null;
      const startIst = new Date(startTs + IST_OFFSET_MS);
      const startIstStr = `${startIst.getUTCFullYear()}-${String(
        startIst.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(startIst.getUTCDate()).padStart(
        2,
        "0"
      )}T${String(startIst.getUTCHours()).padStart(2, "0")}:${String(
        startIst.getUTCMinutes()
      ).padStart(2, "0")}:00 IST`;

      rows.push({
        index: idx,
        start: new Date(startTs).toISOString(),
        startIst: startIstStr,
        open,
        high,
        low,
        close,
        emaAtOpen,
        emaAtClose,
      });
    }

    // Evaluate each of the last rows for the strict rule
    const timeframeMs = 15 * 60 * 1000;
    const now = Date.now();
    const tolPercent = (() => {
      const v = parseFloat(process.env.EMA_OPEN_TOL_PERCENT);
      return Number.isFinite(v) && v >= 0 ? v : 0.001;
    })();

    const evaluated = rows.map((r) => {
      const candleStartTs = Date.parse(r.start);
      const candleEndTs = candleStartTs + timeframeMs;
      // compute IST hour/min for market hours check
      const candleStartIst = new Date(candleStartTs + IST_OFFSET_MS);
      const istHour = candleStartIst.getUTCHours();
      const istMin = candleStartIst.getUTCMinutes();
      const afterMarketOpen = istHour > 9 || (istHour === 9 && istMin >= 15);
      const beforeMarketLastStart =
        istHour < 15 || (istHour === 15 && istMin <= 15);
      const inMarketHours = afterMarketOpen && beforeMarketLastStart;
      const candleClosed = now >= candleEndTs;
      const isGreen = r.close > r.open;
      const tol = Math.max(0.0001, r.open * tolPercent);
      // If emaAtOpen is missing (first EMA point), fall back to emaAtClose for evaluation
      const emaOpenEffective =
        r.emaAtOpen !== null ? r.emaAtOpen : r.emaAtClose;
      const usedEmaFallback = r.emaAtOpen === null && r.emaAtClose !== null;

      const prevEmaCloseToOpen =
        emaOpenEffective !== null
          ? Math.abs(emaOpenEffective - r.open) <= tol
          : false;
      const stayedAboveEma =
        emaOpenEffective !== null ? r.low >= emaOpenEffective : false;
      const closedAboveEma =
        emaOpenEffective !== null ? r.close > emaOpenEffective : false;
      const signal =
        candleClosed &&
        isGreen &&
        prevEmaCloseToOpen &&
        stayedAboveEma &&
        closedAboveEma &&
        inMarketHours;
      return {
        ...r,
        candleClosed,
        isGreen,
        prevEmaCloseToOpen,
        stayedAboveEma,
        closedAboveEma,
        usedEmaFallback,
        inMarketHours,
        signal,
      };
    });

    console.log(
      JSON.stringify(
        { instrumentKey: key, now: new Date(now).toISOString(), evaluated },
        null,
        2
      )
    );
  } catch (err) {
    console.error("Error:", err.message, err.stack);
    process.exit(1);
  }
}

main();
