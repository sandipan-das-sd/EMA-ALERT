import fetch from 'node-fetch';
import EventEmitter from 'events';

export function startUpstoxPoller({
  accessToken,
  apiBase,
  instrumentKeys,
  intervalMs = 2000,
  batchSize = 50,
  universeMapping = {}
}) {
  const emitter = new EventEmitter();
  let stopped = false;

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function tick() {
    if (stopped) return;
    try {
      // Upstox LTP endpoint likely has subscription limits per request; fetch in batches
      const allKeys = instrumentKeys.filter(Boolean);
      console.log(`[Upstox Poller] Polling ${allKeys.length} instruments, batch size: ${batchSize}`);
      if (process.env.DEBUG_UPSTOX && allKeys.length > 0) {
        console.log('[Upstox Poller] Sample keys:', allKeys.slice(0, 3));
      }
      
      const batches = chunk(allKeys, batchSize);
      const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
      const results = await Promise.all(batches.map(async (group, batchIdx) => {
        const url = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(group.join(','))}`;
        if (process.env.DEBUG_UPSTOX && batchIdx === 0) {
          console.log('[Upstox Poller] First batch URL:', url);
        }
        const res = await fetch(url, { headers });
        if (!res.ok) {
          if (process.env.DEBUG_UPSTOX) {
            console.warn(`[Upstox Poller] Batch ${batchIdx} failed: ${res.status}`);
          }
          return { data: {} };
        }
        try { 
          const json = await res.json(); 
          if (process.env.DEBUG_UPSTOX && batchIdx === 0) {
            console.log('[Upstox Poller] First batch response keys:', Object.keys(json?.data || {}));
          }
          return json;
        } catch { return { data: {} }; }
      }));

      const merged = results.reduce((acc, r) => ({ ...acc, ...(r?.data || {}) }), {});
      const now = Date.now();
      const normalizeKeys = (key) => {
        const sep = key.includes('|') ? '|' : (key.includes(':') ? ':' : '|');
        const [seg, val] = key.split(sep);
        const variants = new Set();
        const seps = ['|', ':'];
        const vals = [val, val?.toUpperCase?.(), val?.toLowerCase?.()].filter(Boolean);
        const segs = [seg, seg?.toUpperCase?.(), seg?.toLowerCase?.()].filter(Boolean);
        for (const s of seps) {
          for (const sg of segs) {
            for (const v of vals) {
              variants.add(`${sg}${s}${v}`);
            }
          }
        }
        return Array.from(variants);
      };
      const quotes = instrumentKeys.map((key) => {
        // Enhanced key matching - try multiple variants
        const variants = [key, ...normalizeKeys(key)];
        let q;
        for (const v of variants) { if (merged[v]) { q = merged[v]; break; } }
        
        // If ISIN-based key didn't match, try symbol-based format
        if (!q && key.includes('INE')) {
          // Extract symbol from universe mapping and try NSE_EQ:SYMBOL format
          const symbol = universeMapping[key];
          if (symbol) {
            const symbolKey = `NSE_EQ:${symbol}`;
            q = merged[symbolKey];
            if (q && process.env.DEBUG_UPSTOX) {
              console.log(`[Poller] ISIN->Symbol mapping: ${key} -> ${symbolKey} = ₹${q.last_price}`);
            }
          }
        }
        
        if (!q) {
          if (process.env.DEBUG_UPSTOX && !key.includes('INDEX')) {
            console.log(`[Poller] No price found for ${key}, tried variants:`, variants.slice(0, 3));
          }
          return { key, missing: true };
        }
        return {
          key, // Keep original key for frontend consistency
          ltp: q.last_price,
          cp: q.cp,
          ltq: q.ltq,
          volume: q.volume,
          ts: now,
          changePct: q.cp && q.cp > 0 ? ((q.last_price - q.cp) / q.cp) * 100 : null,
          change: q.cp ? q.last_price - q.cp : null, // Absolute change in ₹
          matched: q ? 'found' : 'missing',
        };
      });
      emitter.emit('quotes', quotes);
      // Compute gainers/losers excluding missing
      const present = quotes.filter(q => !q.missing && typeof q.changePct === 'number');
      const sorted = [...present].sort((a,b)=>b.changePct - a.changePct);
      emitter.emit('gainersLosers', {
        gainers: sorted.slice(0,5),
        losers: [...sorted].reverse().slice(0,5),
        ts: now,
      });
    } catch (e) {
      emitter.emit('error', e);
    } finally {
      if (!stopped) setTimeout(tick, intervalMs);
    }
  }

  tick();

  emitter.stop = () => { stopped = true; };
  return emitter;
}
