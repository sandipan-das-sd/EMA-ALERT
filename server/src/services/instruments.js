import fetch from 'node-fetch';
import zlib from 'zlib';

// Load Upstox instruments master using JSON BOD files (CSV deprecated)
// Returns { byTradingSymbol: Map<tradingsymbol, { instrument_key, tradingsymbol, segment, name }>, byInstrumentKey: Set<string> }
export async function loadInstrumentMaster({ apiBase, accessToken, segments = ['NSE_EQ'] }) {
  // CSV format is deprecated, redirect to JSON
  const exchanges = Array.from(new Set(segments.map(seg => seg.split('_')[0]))).filter(Boolean);
  return await loadInstrumentJsonMaster({ exchanges });
}

// New JSON gzip master loader (CSV deprecated)
// Uses asset path: https://assets.upstox.com/market-quote/instruments/exchange/<EXCHANGE>.json.gz
// We attempt exchanges derived from segments (e.g., 'NSE_EQ' -> 'NSE').
export async function loadInstrumentJsonMaster({ exchanges = ['NSE'] }) {
  const byTradingSymbol = new Map();
  const byInstrumentKey = new Set();
  for (const ex of exchanges) {
    const url = `https://assets.upstox.com/market-quote/instruments/exchange/${encodeURIComponent(ex)}.json.gz`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
      if (!res.ok) { continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const unzipped = zlib.gunzipSync(buf).toString('utf-8');
      const json = JSON.parse(unzipped);
      // Expect either array or object with 'data'
      const arr = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
      arr.forEach(row => {
        const instrument_key = row.instrument_key || row.instrumentKey || row.key;
        // Prefer tradingsymbol if present, else fallback to ISIN (then lookup symbol via another field if available)
        let tradingsymbol = row.tradingsymbol || row.trading_symbol || row.symbol;
        const name = row.name || '';
        const segment = row.segment || row.exchange || ex;
        if (!instrument_key || !tradingsymbol) return;
        const ik = String(instrument_key).trim();
        // Avoid mapping ISIN strings as trading symbols
        if (/^INE[A-Z0-9]{9}$/i.test(String(tradingsymbol))) return;
        const ts = String(tradingsymbol).trim();
        const seg = String(segment).trim();
        byInstrumentKey.add(ik);
        if (!byTradingSymbol.has(ts)) {
          byTradingSymbol.set(ts, { 
            instrument_key: ik, 
            tradingsymbol: ts, 
            segment: seg,
            name: name
          });
        }
        const tsu = ts.toUpperCase();
        if (!byTradingSymbol.has(tsu)) {
          byTradingSymbol.set(tsu, { 
            instrument_key: ik, 
            tradingsymbol: tsu, 
            segment: seg,
            name: name
          });
        }
      });
    } catch (e) {
      if (process.env.DEBUG_UPSTOX) console.warn('[Instruments] JSON master load failed for', ex, e.message);
    }
  }
  return { byTradingSymbol, byInstrumentKey };
}

// Resolve instrument key via Upstox search endpoint
export async function resolveInstrumentKey({ apiBase, accessToken, symbol, segment }) {
  try {
    const url = `${apiBase}/market/instruments/search?query=${encodeURIComponent(symbol)}${segment ? `&segment=${encodeURIComponent(segment)}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.data || [];
    // Prefer exact tradingsymbol match if available
    let hit = items.find((it) => String(it.tradingsymbol).toUpperCase() === String(symbol).toUpperCase() && (!segment || it.segment === segment));
    if (!hit) hit = items[0];
    return hit?.instrument_key || null;
  } catch {
    return null;
  }
}

// Convert FO instrument key format for market quote API
// BOD format: NSE_FO|TOKEN -> API format: NSE_FO:TRADING_SYMBOL
export async function resolveFOInstrumentKey({ apiBase, accessToken, instrumentKey, instrumentsSearchService }) {
  try {
    // Extract token from BOD format
    const parts = instrumentKey.split(/[\|:]/);
    if (parts.length !== 2) return instrumentKey;
    
    const [segment, token] = parts;
    if (!segment.includes('FO')) return instrumentKey;
    
    // Get instrument details from search service
    const instrument = instrumentsSearchService?.getInstrument?.(instrumentKey);
    if (!instrument || !instrument.tradingSymbol) {
      return instrumentKey; // Fallback to original
    }
    
    // For FO instruments, the market quote API expects segment:trading_symbol format
    return `${segment}:${instrument.tradingSymbol}`;
  } catch (e) {
    console.warn('[Instruments] FO key resolution failed:', e.message);
    return instrumentKey; // Fallback to original
  }
}

// Fetch last N 15m candles for an instrument (Upstox API v3 or mock)
export async function getCandles15m(instrumentKey, count = 30) {
  // Replace with actual Upstox API call if available
  // For demo, return mock candles
  const candles = [];
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    const ts = now - i * 15 * 60 * 1000;
    const open = 100 + Math.random() * 10;
    const close = open + (Math.random() - 0.5) * 2;
    const high = Math.max(open, close) + Math.random();
    const low = Math.min(open, close) - Math.random();
    candles.push({
      timestamp: ts,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume: Math.floor(1000 + Math.random() * 500)
    });
  }
  return candles;
}

// Calculate EMA for array of closes
export function calculateEMA(closes, length = 20) {
  const k = 2 / (length + 1);
  const emaArr = [];
  let ema = closes[0];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      emaArr.push(ema);
    } else {
      ema = closes[i] * k + ema * (1 - k);
      emaArr.push(parseFloat(ema.toFixed(2)));
    }
  }
  return emaArr;
}
