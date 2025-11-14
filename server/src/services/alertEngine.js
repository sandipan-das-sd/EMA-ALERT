import fetch from 'node-fetch';
import Alert from '../models/Alert.js';

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
}) {
  if (!accessToken) {
    console.warn('[AlertEngine] Disabled: missing UPSTOX_ACCESS_TOKEN');
    return { stop: () => {} };
  }

  console.log('[AlertEngine] Starting with interval:', intervalMs, 'ms');
  console.log('[AlertEngine] API Base URL:', apiBase);

  const headers = { 
    Authorization: `Bearer ${accessToken}`, 
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  
  const stopRef = { stopped: false };
  const workingKeyCache = new Map(); // originalKey -> working intraday key
  const failureCount = new Map(); // Track failures per key
  const permanentlyFailed = new Set(); // Keys that have failed too many times

  /**
   * Build correct Intraday API V3 URL
   * Format: /v3/historical-candle/intraday/{instrument_key}/minutes/15
   */
  const buildIntradayURL = (instrumentKey) => {
    // Remove trailing slash from apiBase
    const base = apiBase.replace(/\/$/, '');
    
    // Check if apiBase already ends with /v3
    const hasV3 = base.endsWith('/v3');
    const prefix = hasV3 ? base : `${base}/v3`;
    
    // Intraday endpoint - NO date range needed!
    return `${prefix}/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/minutes/15`;
  };

  /**
   * Try fetching intraday data with different instrument key variants
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
          console.log(`[AlertEngine] Failed for ${v}: ${r.status} - ${errorText.substring(0, 100)}`);
          continue;
        }
        
        const j = await r.json();
        if (j?.data?.candles?.length) {
          console.log(`[AlertEngine] ✓ Found ${j.data.candles.length} candles for: ${v}`);
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
    if (origKey.includes('|')) {
      variants.add(origKey.replace('|', ':'));
    } else if (origKey.includes(':')) {
      variants.add(origKey.replace(':', '|'));
    }
    
    // Get instrument details if available
    const inst = instrumentsSearchService?.getInstrument?.(origKey);
    if (!inst) {
      return Array.from(variants);
    }

    const parts = origKey.split(/[|:]/);
    const segment = parts[0];
    
    // For Equity: Add trading symbol variants
    if (segment.includes('_EQ')) {
      if (inst.tradingSymbol) {
        variants.add(`${segment}|${inst.tradingSymbol}`);
        variants.add(`${segment}:${inst.tradingSymbol}`);
      }
    }
    
    // For F&O: MUST use trading symbol (tokens don't work)
    if (segment.includes('_FO')) {
      if (inst.tradingSymbol) {
        const ts = inst.tradingSymbol;
        const cleanTS = ts.replace(/\s+/g, '');
        
        variants.add(`${segment}|${ts}`);
        variants.add(`${segment}:${ts}`);
        variants.add(`${segment}|${cleanTS}`);
        variants.add(`${segment}:${cleanTS}`);
      } else {
        // F&O without trading symbol will likely fail
        console.log(`[AlertEngine] Warning: ${origKey} is F&O without trading symbol`);
      }
    }
    
    // For INDEX
    if (segment.includes('_INDEX')) {
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
   */
  const evaluate = (candles, instrumentKey) => {
    // Upstox returns candles in REVERSE chronological order - MUST reverse!
    const sortedCandles = [...candles].reverse();
    
    // Need at least 20 candles for EMA-20 calculation
    if (sortedCandles.length < 20) {
      return null;
    }
    
    // Extract close prices: candle format = [timestamp, open, high, low, close, volume, oi]
    const closes = sortedCandles.map(c => Number(c[4]));
    
    // Calculate 20 EMA
    const emaValues = calculateEMA(closes, 20);
    if (!emaValues || emaValues.length === 0) {
      return null;
    }
    
    // Current EMA is the last value
    const currEma = emaValues[emaValues.length - 1];
    
    // Get last two candles
    const n = sortedCandles.length;
    const lastCandle = sortedCandles[n - 1];
    const prevCandle = sortedCandles[n - 2];
    
    if (!lastCandle || !prevCandle) return null;
    
    // Parse candle data
    const lc = Number(lastCandle[4]);    // last close
    const lo = Number(lastCandle[1]);    // last open
    const lhigh = Number(lastCandle[2]); // last high
    const llow = Number(lastCandle[3]);  // last low
    const pc = Number(prevCandle[4]);    // previous close
    
    // Check signal conditions
    const isGreen = lc > lo;
    const candleTouchesEMA = llow <= currEma && lhigh >= currEma;
    const crossedUpEMA = pc < currEma && lc >= currEma;
    
    // ALWAYS LOG EMA CALCULATION for every instrument
    console.log(`\n[AlertEngine] EMA Calculation for ${instrumentKey}:`, JSON.stringify({
      instrumentKey,
      timestamp: new Date(lastCandle[0]).toISOString(),
      candle: { 
        open: parseFloat(lo.toFixed(2)), 
        high: parseFloat(lhigh.toFixed(2)), 
        low: parseFloat(llow.toFixed(2)), 
        close: parseFloat(lc.toFixed(2)) 
      },
      prevClose: parseFloat(pc.toFixed(2)),
      ema20: parseFloat(currEma.toFixed(2)),
      conditions: { 
        isGreen, 
        candleTouchesEMA, 
        crossedUpEMA 
      },
      signalTriggered: isGreen && (candleTouchesEMA || crossedUpEMA),
      last10Closes: closes.slice(-10).map(c => parseFloat(c.toFixed(2))),
      last10EMAs: emaValues.slice(-10).map(e => parseFloat(e.toFixed(2))),
      totalCandles: sortedCandles.length
    }, null, 2));
    
    // Signal detected - return for alert creation
    if (isGreen && (candleTouchesEMA || crossedUpEMA)) {
      console.log(`[AlertEngine] 🎯 SIGNAL TRIGGERED for ${instrumentKey}`);
      
      return {
        ts: Number(lastCandle[0]) || Date.parse(lastCandle[0]),
        open: lo,
        high: lhigh,
        low: llow,
        close: lc,
        ema: currEma
      };
    }
    
    return null;
  };

  async function tick() {
    if (stopRef.stopped) return;
    
    try {
      // Collect all user watchlists
      const userMap = new Map();
      for (const [userId, wl] of dynamicSubscriptionManager.userWatchlists) {
        userMap.set(userId, Array.from(wl));
      }
      const allKeys = Array.from(new Set([].concat(...Array.from(userMap.values()))));
      
      // Filter out permanently failed keys
      const keysToProcess = allKeys.filter(k => !permanentlyFailed.has(k));
      
      console.log(`\n[AlertEngine] ===== TICK ${new Date().toISOString()} =====`);
      console.log(`[AlertEngine] Monitoring ${keysToProcess.length}/${allKeys.length} instruments for ${userMap.size} user(s)`);
      
      if (keysToProcess.length === 0) {
        return setTimeout(tick, intervalMs);
      }

      // Show sample of instruments being monitored
      if (keysToProcess.length > 0) {
        const sample = keysToProcess.slice(0, 3).join(', ');
        const more = keysToProcess.length > 3 ? ` ... +${keysToProcess.length - 3} more` : '';
        console.log(`[AlertEngine] Instruments: ${sample}${more}`);
      }

      // Fetch and evaluate - process in batches to avoid rate limits
      const keyToSignal = new Map();
      const successfulKeys = new Set();
      const failedKeys = new Map(); // key -> reason
      const batchSize = 10;
      
      for (let i = 0; i < keysToProcess.length; i += batchSize) {
        const batch = keysToProcess.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (origKey) => {
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
                
                if (data && data.length >= 20) {
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
                  console.log(`[AlertEngine] ✓ Working key found: ${origKey} → ${workingKey}`);
                }
              } else {
                // Track failures
                const failures = (failureCount.get(origKey) || 0) + 1;
                failureCount.set(origKey, failures);
                failedKeys.set(origKey, `No data after trying ${variants.length} variants (attempt ${failures}/5)`);
                
                if (failures >= 5) {
                  permanentlyFailed.add(origKey);
                  console.log(`[AlertEngine] ⛔ Permanently skipping ${origKey} after ${failures} failures`);
                }
              }
            }
            
            // Evaluate for signal
            if (data && data.length >= 20) {
              const signal = evaluate(data, origKey);
              if (signal) {
                keyToSignal.set(origKey, signal);
              }
              // Don't mark as failed if we successfully evaluated
              if (!signal && !successfulKeys.has(origKey)) {
                successfulKeys.add(origKey);
              }
            } else if (!failedKeys.has(origKey) && !successfulKeys.has(origKey)) {
              failedKeys.set(origKey, `Insufficient candles: ${data?.length || 0}/20`);
            }
          } catch (err) {
            console.error(`[AlertEngine] Error processing ${origKey}:`, err.message);
            failedKeys.set(origKey, `Exception: ${err.message}`);
          }
        }));
        
        // Small delay between batches
        if (i + batchSize < keysToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Log summary
      console.log(`\n[AlertEngine] Fetch Summary:`);
      console.log(`  ✓ Success: ${successfulKeys.size}/${keysToProcess.length}`);
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
            const sig = keyToSignal.get(k);
            if (!sig) continue;
            
            ops.push(
              Alert.updateOne(
                { 
                  userId, 
                  instrumentKey: k, 
                  'candle.ts': sig.ts, 
                  strategy: 'ema20_cross_up' 
                },
                {
                  $setOnInsert: {
                    userId,
                    instrumentKey: k,
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
                    status: 'active',
                    createdAt: new Date(),
                  },
                },
                { upsert: true }
              )
            );
          }
        }
        
        if (ops.length) {
          const results = await Promise.allSettled(ops);
          const successful = results.filter(r => r.status === 'fulfilled').length;
          console.log(`[AlertEngine] ✓ ${successful}/${ops.length} alerts created/updated`);
        }
      } else {
        console.log('[AlertEngine] No signals detected');
      }
      
      console.log(`[AlertEngine] ===== TICK END =====\n`);
      
    } catch (e) {
      console.error('[AlertEngine] Tick error:', e.message);
      console.error(e.stack);
    } finally {
      if (!stopRef.stopped) {
        setTimeout(tick, intervalMs);
      }
    }
  }

  // Start the engine
  console.log('[AlertEngine] Starting first tick...');
  tick();
  
  return { 
    stop: () => { 
      stopRef.stopped = true;
      console.log('[AlertEngine] Stopped');
    } 
  };
}