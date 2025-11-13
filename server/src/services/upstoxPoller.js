import fetch from 'node-fetch';
import EventEmitter from 'events';
import { resolveFOInstrumentKey } from './instruments.js';

export function startUpstoxPoller({
  accessToken,
  apiBase,
  instrumentKeys,
  intervalMs = 2000,
  batchSize = 50,
  universeMapping = {},
  instrumentsSearchService
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
        
        // For FO instruments, also try without segment prefix (just the token)
        if (seg && (seg.includes('FO') || seg.includes('_FO'))) {
          variants.add(val); // Just the numeric token
        }
        
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
          // Extract symbol from universe mapping and try different segment formats
          const symbol = universeMapping[key];
          if (symbol) {
            // Try multiple segment formats for EQ instruments
            const segmentVariants = [`NSE_EQ:${symbol}`, `BSE_EQ:${symbol}`];
            for (const variant of segmentVariants) {
              q = merged[variant] || merged[variant.replace(':', '|')];
              if (q) {
                if (process.env.DEBUG_UPSTOX) {
                  console.log(`[Poller] ISIN->Symbol mapping: ${key} -> ${variant} = ₹${q.last_price}`);
                }
                break;
              }
            }
          }
        }
        
        // Handle FO instruments with enhanced key resolution
        if (!q && (key.includes('NSE_FO') || key.includes('BSE_FO'))) {
          try {
            const parts = key.split(/[\|:]/);
            if (parts.length >= 2) {
              const segment = parts[0];
              const token = parts[1];
              
              // Get instrument details from search service for better matching
              const instrument = instrumentsSearchService?.getInstrument?.(key);
              
              if (instrument && instrument.tradingSymbol) {
                const tradingSymbol = instrument.tradingSymbol;
                // Build normalized FO symbol variants expected by Upstox response map
                const buildFOSymbolVariants = (inst) => {
                  // Collect multiple possible underlying codes (handle hyphens, ampersands, dots)
                  const tsToken = (inst.tradingSymbol || '').split(' ')[0]?.toUpperCase?.() || '';
                  const snToken = (inst.shortName || inst.name || '').split(' ')[0]?.toUpperCase?.() || '';
                  const normalize = (s) => (s || '').toUpperCase();
                  const stripNonAlnum = (s) => normalize(s).replace(/[^A-Z0-9]/g, '');
                  const candidates = new Set([
                    tsToken,
                    stripNonAlnum(tsToken),
                    snToken,
                    stripNonAlnum(snToken)
                  ]);
                  // Special case: replace '&' with 'AND' (e.g., M&M -> MM, also try MANDM)
                  if (tsToken.includes('&')) {
                    candidates.add(tsToken.replace(/&/g, 'AND'));
                    candidates.add(stripNonAlnum(tsToken.replace(/&/g, 'AND')));
                  }
                  // Also try removing common punctuation
                  candidates.add(tsToken.replace(/[-.&]/g, ''));
                  const underList = Array.from(candidates).filter(Boolean);
                  const isFut = /FUT/i.test(inst.tradingSymbol) || /FUT/.test(inst.instrumentType || inst.instrument_type || '');
                  const opt = (inst.optionType || inst.option_type || (inst.tradingSymbol?.toUpperCase().includes('PE') ? 'PE' : 'CE')).toUpperCase();
                  const strikeRaw = inst.strike ?? inst.strike_price ?? Number(inst.tradingSymbol?.match(/\b(\d+(?:\.\d+)?)\b/)?.[1] || 0);
                  const strike = (typeof strikeRaw === 'number' ? strikeRaw : Number(strikeRaw || 0));
                  const monNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                  let dt = null; try { dt = new Date(Number(inst.expiry) || 0); } catch {}
                  const yy = dt ? String(dt.getFullYear()).slice(-2) : '';
                  const mon = dt ? monNames[dt.getMonth()] : '';
                  const dd = dt ? String(dt.getDate()).padStart(2, '0') : '';
                  const mon1 = dt ? mon.charAt(0) : '';
                  const noSpaceTS = inst.tradingSymbol.replace(/\s+/g,'').toUpperCase();
                  const variants = new Set([noSpaceTS]);
                  for (const under of underList) {
                    const ym = `${under}${yy}${mon}`;            // e.g., NIFTY25NOV
                    const ymd = `${under}${yy}${mon}${dd}`;       // e.g., NIFTY25NOV18
                    const ym1 = `${under}${yy}${mon1}`;           // e.g., NIFTY25N
                    const ymd1 = `${under}${yy}${mon1}${dd}`;     // e.g., NIFTY25N18
                    if (isFut) {
                      variants.add(`${ym}FUT`);
                      variants.add(`${ym1}FUT`);
                    } else {
                      // Options: include with and without day
                      const s = String(strike).replace(/\.0+$/,'');
                      variants.add(`${ym}${s}${opt}`);
                      if (dd) variants.add(`${ymd}${s}${opt}`);
                      variants.add(`${ym1}${s}${opt}`);
                      if (dd) variants.add(`${ymd1}${s}${opt}`);
                    }
                  }
                  return Array.from(variants).filter(Boolean);
                };
                const foSymbols = buildFOSymbolVariants(instrument);
                
                // Try multiple variations of the key format
                // The API often returns data with segment:trading_symbol format for FO
                const allVariants = [
                  `${segment}:${tradingSymbol}`,
                  `${segment}|${tradingSymbol}`,
                  tradingSymbol,
                  `${segment}:${token}`,
                  `${segment}|${token}`,
                  token,
                  // Normalized symbol variants
                  ...foSymbols.map(sym => `${segment}:${sym}`),
                  ...foSymbols.map(sym => `${segment}|${sym}`),
                  ...foSymbols
                ];
                
                for (const variant of allVariants) {
                  q = merged[variant];
                  if (q) {
                    if (process.env.DEBUG_UPSTOX) {
                      console.log(`[Poller] FO variant match: ${key} -> ${variant} = ₹${q.last_price}`);
                    }
                    break;
                  }
                }
              } else {
                // Fallback to simpler matching when instrument details are unavailable
                const simpleVariants = [
                  `${segment}:${token}`,
                  `${segment}|${token}`,
                  token
                ];
                
                for (const variant of simpleVariants) {
                  q = merged[variant];
                  if (q) {
                    if (process.env.DEBUG_UPSTOX) {
                      console.log(`[Poller] FO simple match: ${key} -> ${variant} = ₹${q.last_price}`);
                    }
                    break;
                  }
                }
              }
            }
          } catch (e) {
            if (process.env.DEBUG_UPSTOX) {
              console.warn(`[Poller] FO key resolution error for ${key}:`, e.message);
            }
          }
        }
        
        if (!q) {
          if (process.env.DEBUG_UPSTOX && !key.includes('INDEX')) {
            console.log(`[Poller] No price found for ${key}, tried variants:`, variants.slice(0, 3));
            // Log if it's a FO instrument to help debug
            if (key.includes('FO') || key.includes('FUT') || key.includes('CE') || key.includes('PE')) {
              console.log(`[Poller] FO instrument ${key} not found. Available response keys:`, Object.keys(merged).filter(k => k.includes('FO') || /\d{6,}/.test(k)).slice(0, 10));
            }
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
