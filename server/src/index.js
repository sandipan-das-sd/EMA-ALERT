import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dns from 'dns';
import authRouter from './routes/auth.js';
import watchlistRouter from './routes/watchlist.js';
import notesRouter from './routes/notes.js';
import instrumentsRouter from './routes/instruments.js';
import { createUpstoxFeed } from './services/upstoxFeed.js';
import { startUpstoxPoller } from './services/upstoxPoller.js';
import { instrumentsSearchService } from './services/instrumentsSearch.js';
import { dynamicSubscriptionManager } from './services/dynamicSubscription.js';
import fetch from 'node-fetch';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marketState } from './services/marketState.js';
import { loadInstrumentMaster, loadInstrumentJsonMaster, resolveInstrumentKey } from './services/instruments.js';

dotenv.config();

const app = express();

// Middleware
app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/notes', notesRouter);
app.use('/api/instruments', instrumentsRouter);

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    // Prefer reliable public DNS resolvers within this process (does not change system DNS)
    dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

    // Mongoose options to mitigate DNS/SRV issues
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      retryWrites: true,
      socketTimeoutMS: 45000,
      family: 4, // Force IPv4 to reduce DNS resolution complexity
    });
    console.log('MongoDB connected');
    
    // Initialize instruments search service
    console.log('Initializing instruments search service...');
    await instrumentsSearchService.initialize();
    instrumentsSearchService.startAutoUpdate();
    console.log('Instruments search service ready');
    
    // Initialize dynamic subscription manager
    console.log('Initializing dynamic subscription manager...');
    await dynamicSubscriptionManager.initializeAllWatchlists();
    console.log('Dynamic subscription manager ready');
    
    const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

    // WS server to stream price ticks to frontend clients
  const wss = new WebSocketServer({ server, path: '/ws/ticker' });
  wss.clients.forEach = wss.clients.forEach.bind(wss.clients); // defensive in some node/ws combos
    const apiBase = process.env.UPSTOX_API_BASE || 'https://api.upstox.com/v3';
    const accessToken = process.env.UPSTOX_ACCESS_TOKEN;
    
    if (!accessToken) {
      console.warn('⚠️  UPSTOX_ACCESS_TOKEN not found in environment variables');
      console.warn('   Real-time price data will not be available');
      console.warn('   Please create a .env file with valid Upstox API credentials');
      console.warn('   See .env.example for required configuration');
    }
    
    const indexKeys = (process.env.UPSTOX_INDEX_KEYS || process.env.UPSTOX_INSTRUMENTS || 'NSE_INDEX|Nifty 50')
      .split(',').map(s=>s.trim()).filter(Boolean);
    // Load scalable universe of instruments (200+) from JSON file; fallback to env if absent
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Load instruments dynamically from Upstox BOD JSON (CSV deprecated)
    let master = { byTradingSymbol: new Map(), byInstrumentKey: new Set() };
    const segments = ['NSE_EQ']; // Focus on NSE equities
    const exchanges = ['NSE'];
    
    console.log('[Instruments] Loading BOD master from Upstox...');
    try {
      const m = await loadInstrumentJsonMaster({ exchanges });
      if (m.byTradingSymbol.size) { 
        master = m; 
        console.log(`[Instruments] BOD master loaded: ${master.byTradingSymbol.size} symbols`);
      }
    } catch (e) { 
      console.error('[Instruments] BOD master load failed:', e.message); 
    }

    // Build universe from popular/liquid NSE stocks using BOD data
    const popularSymbols = [
      'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'HINDUNILVR', 'ITC', 'SBIN',
      'BHARTIARTL', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'AXISBANK', 'MARUTI', 'NESTLEIND',
      'ABB', 'ADANIPORTS', 'ADANIENT', 'BAJFINANCE', 'HCLTECH', 'WIPRO', 'ONGC',
      'POWERGRID', 'NTPC', 'COALINDIA', 'TATASTEEL', 'JSWSTEEL', 'ULTRACEMCO', 'GRASIM'
    ];
    
    let resolvedUniverse = [];
    for (const symbol of popularSymbols) {
      const hit = master.byTradingSymbol.get(symbol) || master.byTradingSymbol.get(symbol.toUpperCase());
      if (hit && hit.segment === 'NSE_EQ') {
        resolvedUniverse.push({
          underlying: hit.name || `${symbol} Limited`,
          symbol: symbol,
          segment: 'NSE_EQ',
          instrumentKey: hit.instrument_key
        });
      } else if (process.env.DEBUG_UPSTOX) {
        console.warn(`[Universe] Symbol ${symbol} not found in BOD data`);
      }
    }
    
    console.log(`[Universe] Built from BOD: ${resolvedUniverse.length} instruments`);
    if (resolvedUniverse.length === 0) {
      console.warn('[Universe] No instruments found! Check BOD data loading.');
    }
    // Map universe to official instrument_key when possible
    // Enhanced mapping: use exact instrument_key if already present, otherwise resolve
    const mappedUniverse = resolvedUniverse; // Already resolved from BOD

    // Subscribe to resolved universe keys
    const universeKeys = resolvedUniverse.map((u) => u.instrumentKey).filter(Boolean);
    const envWatchlist = (process.env.UPSTOX_WATCHLIST_KEYS || '').split(',').map(s=>s.trim()).filter(Boolean);
    // Set base subscription keys in dynamic subscription manager
    const baseKeys = Array.from(new Set([...universeKeys, ...envWatchlist, ...indexKeys]));
    dynamicSubscriptionManager.setBaseSubscription(baseKeys);
    
    // Get initial subscription keys (base + user watchlists)
    let currentSubscriptionKeys = dynamicSubscriptionManager.getAllSubscriptionKeys();
    console.log(`[Subscription] Initial subscription: ${currentSubscriptionKeys.length} instruments`);
    
    const pollIntervalMs = Number(process.env.UPSTOX_POLL_INTERVAL_MS) || 2000;

  let feed;
  // Use shared marketState singleton
  let { lastTicks, latestQuotes } = marketState;
    let feedReady = false;
    let lastSubStatus = null; // capture latest subscription status for diagnostics
    if (accessToken) {
  const mode = process.env.UPSTOX_MODE || 'ltpc';
      // Subscribe only to unique, non-empty instrument keys
      // Convert ISIN-based keys to symbol-based format for better API compatibility
      let uniqueKeys = Array.from(new Set(currentSubscriptionKeys.filter(Boolean)));
      
      // Convert ISIN keys to symbol format (NSE_EQ:SYMBOL) since API prefers this
      uniqueKeys = uniqueKeys.map(key => {
        if (key.includes('INE')) {
          const universeItem = resolvedUniverse.find(u => u.instrumentKey === key);
          if (universeItem?.symbol) {
            const symbolKey = `NSE_EQ:${universeItem.symbol}`;
            if (process.env.DEBUG_UPSTOX) {
              console.log(`[Subscription] Converting ISIN key: ${key} -> ${symbolKey}`);
            }
            return symbolKey;
          }
        }
        return key;
      });

      // Decide key format strategy
      const keyFormat = (process.env.UPSTOX_KEY_FORMAT || 'auto').toLowerCase();

      async function detectWorkingFormat(sampleKeys) {
        // Try a couple of equity keys to see which variant returns data
        const testKey = sampleKeys.find(k => k.startsWith('NSE_EQ')) || sampleKeys[0];
        if (!testKey) return 'pipe';
        const variants = [testKey.replace(/:/g,'|'), testKey.replace(/\|/g, ':')];
        for (const variant of variants) {
          try {
            const url = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(variant)}`;
            const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
            if (!resp.ok) continue;
            const j = await resp.json();
            if (j?.data && Object.keys(j.data).length) {
              const vHasPipe = variant.includes('|');
              return vHasPipe ? 'pipe' : 'colon';
            }
          } catch {}
        }
        return 'pipe'; // default fallback
      }

      let chosenFormat = 'pipe';
      if (keyFormat === 'colon') chosenFormat = 'colon';
      else if (keyFormat === 'pipe') chosenFormat = 'pipe';
      else { // auto
        chosenFormat = await detectWorkingFormat(uniqueKeys.slice(0, 10));
      }

      uniqueKeys = uniqueKeys.map(k => {
        if (chosenFormat === 'pipe') return k.replace(/:/g, '|');
        return k.replace(/\|/g, ':');
      });

      // De-duplicate and cap at 200
      uniqueKeys = Array.from(new Set(uniqueKeys)).slice(0, 200);
      if (!uniqueKeys.length) {
        console.warn('[Upstox] No instrument keys to subscribe. Check universe or access token entitlements.');
      }
      console.log(`[Upstox] Subscribing ${uniqueKeys.length} keys using ${chosenFormat} separator`);
      if (process.env.DEBUG_UPSTOX) {
        console.log('[Upstox] First 10 subscription keys:', uniqueKeys.slice(0,10));
        console.log('[Upstox] Sample key format check:', uniqueKeys[0]);
      }
        // Create mapping from symbol keys back to original keys for WebSocket events (EQ + FO)
        const symbolToOriginalKey = {};
        resolvedUniverse.forEach(item => {
          if (item.symbol) {
            symbolToOriginalKey[`NSE_EQ:${item.symbol}`] = item.instrumentKey;
            symbolToOriginalKey[`NSE_EQ|${item.symbol}`] = item.instrumentKey;
          }
        });
        try {
          const monNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
          const foVariants = (inst) => {
            const tsToken = (inst.tradingSymbol || '').split(' ')[0]?.toUpperCase?.() || '';
            const snToken = (inst.shortName || inst.name || '').split(' ')[0]?.toUpperCase?.() || '';
            const stripNonAlnum = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const underList = new Set([
              tsToken,
              stripNonAlnum(tsToken),
              snToken,
              stripNonAlnum(snToken),
              tsToken.replace(/[-.&]/g, '')
            ]);
            if (tsToken.includes('&')) {
              underList.add(tsToken.replace(/&/g, 'AND'));
              underList.add(stripNonAlnum(tsToken.replace(/&/g, 'AND')));
            }
            const isFut = /FUT/i.test(inst.tradingSymbol) || /FUT/.test(inst.instrumentType || inst.instrument_type || '');
            const opt = (inst.optionType || inst.option_type || (inst.tradingSymbol?.toUpperCase().includes('PE') ? 'PE' : 'CE')).toUpperCase();
            const strikeRaw = inst.strike ?? inst.strike_price ?? Number(inst.tradingSymbol?.match(/\b(\d+(?:\.\d+)?)\b/)?.[1] || 0);
            const strike = (typeof strikeRaw === 'number' ? strikeRaw : Number(strikeRaw || 0));
            let dt = null; try { dt = new Date(Number(inst.expiry) || 0); } catch {}
            const yy = dt ? String(dt.getFullYear()).slice(-2) : '';
            const mon = dt ? monNames[dt.getMonth()] : '';
            const dd = dt ? String(dt.getDate()).padStart(2,'0') : '';
            const mon1 = dt ? mon.charAt(0) : '';
            const noSpace = inst.tradingSymbol.replace(/\s+/g,'').toUpperCase();
            const set = new Set([noSpace]);
            for (const under of underList) {
              const ym = `${under}${yy}${mon}`;
              const ymd = `${under}${yy}${mon}${dd}`;
              const ym1 = `${under}${yy}${mon1}`;
              const ymd1 = `${under}${yy}${mon1}${dd}`;
              if (isFut) {
                set.add(`${ym}FUT`);
                set.add(`${ym1}FUT`);
              } else {
                const s = String(strike).replace(/\.0+$/,'');
                set.add(`${ym}${s}${opt}`);
                if (dd) set.add(`${ymd}${s}${opt}`);
                set.add(`${ym1}${s}${opt}`);
                if (dd) set.add(`${ymd1}${s}${opt}`);
              }
            }
            return Array.from(set);
          };
          for (const orig of currentSubscriptionKeys) {
            const inst = instrumentsSearchService.getInstrument(orig);
            if (inst && inst.tradingSymbol && inst.segment) {
              const variants = foVariants(inst);
              variants.forEach(v => {
                symbolToOriginalKey[`${inst.segment}:${v}`] = orig;
                symbolToOriginalKey[`${inst.segment}|${v}`] = orig;
              });
              // also raw
              symbolToOriginalKey[`${inst.segment}:${inst.tradingSymbol}`] = orig;
              symbolToOriginalKey[`${inst.segment}|${inst.tradingSymbol}`] = orig;
            }
          }
        } catch {}

  feed = createUpstoxFeed({ apiBase, accessToken, instrumentKeys: uniqueKeys, mode, instrumentsSearchService, separator: chosenFormat === 'pipe' ? '|' : ':' });
      feed.on('ready', () => {
        feedReady = true;
        console.log('Upstox market feed connected');
      });
      feed.on('price', (tick) => {
        // Map symbol-based key back to original ISIN key for frontend consistency
        const originalKey = symbolToOriginalKey[tick.instrumentKey] || tick.instrumentKey;
        const mappedTick = { ...tick, instrumentKey: originalKey };
        
        marketState.lastTicks[originalKey] = mappedTick;
        console.log(`[Feed] Price tick received: ${tick.instrumentKey} -> ${originalKey} = ${tick.ltp}`);
        const payload = JSON.stringify({ type: 'tick', ...mappedTick });
        wss.clients.forEach((client) => {
          if (client.readyState === 1) client.send(payload);
        });
      });
      feed.on('error', (err) => {
        const payload = JSON.stringify({ type: 'error', message: String(err.message || err) });
        wss.clients.forEach((client) => {
          if (client.readyState === 1) client.send(payload);
        });
        console.error('Upstox feed error:', err);
      });
      feed.on('subStatus', (st) => {
        console.log(`[Upstox] Subscription OK: ${st.success.length}, errors: ${st.errors.length}`);
        if (st.errors.length) {
          const sample = st.errors.slice(0, 5).map(e => `${e.key}: ${e.reason}`).join('; ');
          console.warn('[Upstox] Sample subscription errors:', sample);
        }
        lastSubStatus = st;
        const payload = JSON.stringify({ type: 'subStatus', data: st });
        wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });
      });

      // Start poller for reliable quotes & gainers/losers
      // Build a more complete universeMapping: include resolvedUniverse and instrumentsSearchService entries
      const buildUniverseMapping = () => {
        const map = resolvedUniverse.reduce((acc, u) => { if (u.instrumentKey && u.symbol) acc[u.instrumentKey] = u.symbol; return acc; }, {});
        try {
          // instrumentsSearchService.instruments is a Map(instrument_key -> instrument)
          for (const [ik, inst] of instrumentsSearchService.instruments) {
            if (inst && inst.tradingSymbol) {
              map[ik] = inst.tradingSymbol;
            }
          }
        } catch (e) {
          if (process.env.DEBUG_UPSTOX) console.warn('[UniverseMapping] Could not extend mapping from instrumentsSearchService:', e.message);
        }
        return map;
      };

      let poller = startUpstoxPoller({
        accessToken,
        apiBase,
        instrumentKeys: currentSubscriptionKeys,
        intervalMs: pollIntervalMs,
        batchSize: Number(process.env.UPSTOX_LTP_BATCH) || 50,
        universeMapping: buildUniverseMapping(),
        instrumentsSearchService
      });
      poller.on('quotes', (quotes) => {
        console.log(`[Poller] Received ${quotes.length} quotes, ${quotes.filter(q => !q.missing).length} with prices`);
        if (process.env.DEBUG_UPSTOX) {
          const sampleWithPrice = quotes.find(q => !q.missing && typeof q.ltp === 'number');
          if (sampleWithPrice) {
            console.log(`[Poller] Sample price: ${sampleWithPrice.key} = ${sampleWithPrice.ltp}`);
          } else {
            console.log('[Poller] No instruments with valid prices found');
          }
        }
        quotes.forEach(q => { if(!q.missing && typeof q.ltp === 'number') marketState.latestQuotes[q.key] = q; });
        const indicesSnapshot = indexKeys.map(key => ({
          key,
          ltp: marketState.latestQuotes[key]?.ltp ?? null,
          cp: marketState.latestQuotes[key]?.cp ?? null,
          changePct: marketState.latestQuotes[key]?.changePct ?? null,
        }));
        const payload = JSON.stringify({ type: 'indices', data: indicesSnapshot });
        wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });

        // Broadcast full quotes for clients to render universe prices
        const qPayload = JSON.stringify({ type: 'quotes', data: quotes });
        wss.clients.forEach(c => { if (c.readyState === 1) c.send(qPayload); });
      });
      // Removed gainers/losers broadcast per user request
      poller.on('error', (e) => console.error('Upstox poller error:', e.message));
      
      // Set up dynamic subscription change handler
      dynamicSubscriptionManager.onSubscriptionChange(async (_newKeys) => {
        try {
          // Recompute full set of subscription keys from manager to avoid stale/new-key mismatch
          const allKeys = dynamicSubscriptionManager.getAllSubscriptionKeys();
          console.log(`[DynamicSub] Subscription updated: ${allKeys.length} instruments`);
          // Convert incoming keys (which may be ISINs) to Upstox-friendly subscription keys

          // Map ISIN -> symbol using instrumentsSearchService when available, fallback to original key
          const mappedForSub = await Promise.all(allKeys.map(async (k) => {
            try {
              if (String(k).includes('INE')) {
                const inst = instrumentsSearchService.getInstrument(k);
                if (inst && inst.tradingSymbol) {
                  return `${inst.segment}:${inst.tradingSymbol}`;
                }
              }
            } catch (e) {
              // ignore and fallthrough to original
            }
            // If we couldn't map via local instruments index, fall back to the original key
            return k;
          }));

          // Format keys according to chosenFormat (pipe/colon) used by the running feed
          const formatted = mappedForSub.map(k => (chosenFormat === 'pipe' ? String(k).replace(/:/g, '|') : String(k).replace(/\|/g, ':')));
          const unique = Array.from(new Set(formatted));
          // Warn if we exceed cap and will trim keys
          const capped = unique.slice(0, 200);
          if (unique.length > 200) console.warn(`[DynamicSub] Subscription count ${unique.length} exceeds cap 200 - trimming to 200 keys`);
          const finalKeys = capped;

          console.log(`[DynamicSub] Re-subscribing ${finalKeys.length} keys (from ${unique.length} candidates)`);

          // Recreate symbol -> original mapping for incoming keys
          const symbolToOriginalKeyNew = {};
          resolvedUniverse.forEach(item => {
            if (item.symbol) symbolToOriginalKeyNew[`NSE_EQ:${item.symbol}`] = item.instrumentKey;
          });
          // Also add mappings from instrumentsSearchService for user keys
          for (const orig of allKeys) {
            try {
              const inst = instrumentsSearchService.getInstrument(orig);
              if (inst && inst.tradingSymbol) symbolToOriginalKeyNew[`${inst.segment}:${inst.tradingSymbol}`] = orig;
            } catch {}
          }

          // Restart feed with new keys
          try {
            if (feed && typeof feed.close === 'function') {
              feed.close();
            }
          } catch (e) { console.warn('[DynamicSub] Error closing old feed:', e.message); }

          feed = createUpstoxFeed({ apiBase, accessToken, instrumentKeys: finalKeys, mode, instrumentsSearchService, separator: chosenFormat === 'pipe' ? '|' : ':' });
          feed.on('ready', () => {
            feedReady = true;
            console.log('Upstox market feed connected (dynamic update)');
          });
          feed.on('price', (tick) => {
            const originalKey = symbolToOriginalKeyNew[tick.instrumentKey] || tick.instrumentKey;
            const mappedTick = { ...tick, instrumentKey: originalKey };
            marketState.lastTicks[originalKey] = mappedTick;
            console.log(`[Feed] Price tick received: ${tick.instrumentKey} -> ${originalKey} = ${tick.ltp}`);
            const payload = JSON.stringify({ type: 'tick', ...mappedTick });
            wss.clients.forEach((client) => { if (client.readyState === 1) client.send(payload); });
          });
          feed.on('error', (err) => {
            const payload = JSON.stringify({ type: 'error', message: String(err.message || err) });
            wss.clients.forEach((client) => { if (client.readyState === 1) client.send(payload); });
            console.error('Upstox feed error (dynamic):', err);
          });
          feed.on('subStatus', (st) => {
            console.log(`[Upstox] Subscription OK (dynamic): ${st.success.length}, errors: ${st.errors.length}`);
            if (st.errors.length) {
              const sample = st.errors.slice(0, 5).map(e => `${e.key}: ${e.reason}`).join('; ');
              console.warn('[Upstox] Sample subscription errors (dynamic):', sample);
            }
            lastSubStatus = st;
            const payload = JSON.stringify({ type: 'subStatus', data: st });
            wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });
          });

          // Restart poller with updated keys
          try { if (poller && typeof poller.stop === 'function') poller.stop(); } catch (e) { console.warn('[DynamicSub] Error stopping old poller:', e.message); }
          // Restart poller with the full set of subscription keys (untrimmed) so it can try mappings
          poller = startUpstoxPoller({
            accessToken,
            apiBase,
            instrumentKeys: allKeys,
            intervalMs: pollIntervalMs,
            batchSize: Number(process.env.UPSTOX_LTP_BATCH) || 50,
            universeMapping: buildUniverseMapping(),
            instrumentsSearchService
          });
          poller.on('quotes', (quotes) => {
            console.log(`[Poller] (dynamic) Received ${quotes.length} quotes, ${quotes.filter(q => !q.missing).length} with prices`);
            quotes.forEach(q => { if(!q.missing && typeof q.ltp === 'number') marketState.latestQuotes[q.key] = q; });
            const indicesSnapshot = indexKeys.map(key => ({
              key,
              ltp: marketState.latestQuotes[key]?.ltp ?? null,
              cp: marketState.latestQuotes[key]?.cp ?? null,
              changePct: marketState.latestQuotes[key]?.changePct ?? null,
            }));
            const payload = JSON.stringify({ type: 'indices', data: indicesSnapshot });
            wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });
            const qPayload = JSON.stringify({ type: 'quotes', data: quotes });
            wss.clients.forEach(c => { if (c.readyState === 1) c.send(qPayload); });
          });
          poller.on('error', (e) => console.error('Upstox poller error (dynamic):', e.message));

        } catch (e) {
          console.error('[DynamicSub] Failed to update subscriptions dynamically:', e);
        }
      });
    } else {
      console.warn('UPSTOX_ACCESS_TOKEN missing. WS price feed disabled.');
    }

    wss.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'info', message: 'Connected to EMA-ALERT ticker' }));
      if (!accessToken) {
        socket.send(JSON.stringify({ type: 'error', message: 'Upstox access token not configured on server' }));
      }
      // Send initial snapshot of universe prices
      const initialQuotes = universeKeys.map(k => ({
        key: k,
        ltp: marketState.latestQuotes[k]?.ltp ?? marketState.lastTicks[k]?.ltp ?? null,
        ts: marketState.latestQuotes[k]?.ts ?? marketState.lastTicks[k]?.ts ?? null,
      }));
      socket.send(JSON.stringify({ type: 'quotes', data: initialQuotes }));
    });

    // Simple REST fallback to read latest tick/status
    app.get('/api/market/nifty', (req, res) => {
      const key = indexKeys[0];
      res.json({ connected: Boolean(feedReady), tick: latestQuotes[key] || lastTicks[key] });
    });

    // Generic LTP REST fallback using Upstox market quote endpoint
    app.get('/api/market/ltp', async (req, res) => {
      // Support batch mode: /api/market/ltp?keys=a,b,c
      const batchKeysParam = req.query.keys;
      const instrument = req.query.instrument || indexKeys[0];
      if (!accessToken) return res.status(400).json({ message: 'Access token missing' });
      try {
        // Batch mode handler for client fallback
        if (batchKeysParam) {
          const keys = String(batchKeysParam).split(',').map(s => s.trim()).filter(Boolean);
          if (!keys.length) return res.json({ data: {} });
          // Fetch in manageable batches
          const chunk = (arr, size) => arr.reduce((acc, _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), []);
          const batches = chunk(keys, Number(process.env.UPSTOX_LTP_BATCH) || 50);
          const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
          const responses = await Promise.all(batches.map(async group => {
            const url = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(group.join(','))}`;
            const r = await fetch(url, { headers });
            if (!r.ok) return { data: {} };
            try { return await r.json(); } catch { return { data: {} }; }
          }));
          const merged = responses.reduce((acc, r) => ({ ...acc, ...(r?.data || {}) }), {});
          return res.json({ data: merged, ts: Date.now() });
        }

        // If a plain symbol was passed, attempt to map via master
        const isPlainSymbol = instrument && !String(instrument).includes('|') && !String(instrument).includes(':');
        let candidate = instrument;
        if (isPlainSymbol && master?.byTradingSymbol) {
          const keyU = String(instrument).toUpperCase();
          const hit = master.byTradingSymbol.get(keyU) || master.byTradingSymbol.get(String(instrument));
          if (hit?.instrument_key) {
            // Avoid ISIN-based instrument keys
            if (/\bINE[A-Z0-9]{9}\b/i.test(hit.instrument_key)) {
              candidate = `NSE_EQ|${keyU}`;
            } else {
              candidate = hit.instrument_key;
            }
          } else {
            candidate = `NSE_EQ|${keyU}`;
          }
        }
        const url = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(candidate)}`;
        if (process.env.DEBUG_UPSTOX) console.log('[LTP] Request', url);
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (process.env.DEBUG_UPSTOX) console.log('[LTP] Status', r.status);
        if (!r.ok) {
          const txt = await r.text();
          return res.status(r.status).json({ message: 'Upstox quote error', detail: txt });
        }
        const data = await r.json();
        // V3 LTP response: { status: 'success', data: { <instrument>: { last_price, instrument_token, ltq, volume, cp } } }
        const map = data?.data || {};
        // Instrument keys may be normalized by Upstox (e.g., replace '|' with ':'); try all keys
        const candKeys = [candidate, candidate.replace('|', ':'), candidate.replace(':', '|')];
        let quoteObj = null;
        for (const k of candKeys) {
          if (map[k]) { quoteObj = map[k]; break; }
        }
        // If still not found and we had a plain symbol, attempt dynamic resolve and retry once
        if (!quoteObj && isPlainSymbol) {
          const dynamicKey = await resolveInstrumentKey({ apiBase, accessToken, symbol: instrument });
          if (dynamicKey && dynamicKey !== candidate) {
            const retryUrl = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(dynamicKey)}`;
            if (process.env.DEBUG_UPSTOX) console.log('[LTP] Retry', retryUrl);
            const rr = await fetch(retryUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
            if (rr.ok) {
              const retryData = await rr.json();
              const retryMap = retryData?.data || {};
              quoteObj = retryMap[dynamicKey] || retryMap[dynamicKey.replace('|', ':')] || null;
              if (quoteObj) candKeys.push(dynamicKey);
              candidate = dynamicKey; // Update candidate to resolved key for response & fallback lookup
            }
          }
        }
        let ltp = quoteObj?.last_price;
        // Fallback: if network response empty, use in-memory latest quote or tick
        if (typeof ltp !== 'number') {
          const mem = marketState.latestQuotes[candidate] || marketState.lastTicks[candidate];
          if (mem && typeof mem.ltp === 'number') {
            ltp = mem.ltp;
            return res.json({ instrument: candidate, ltp, source: 'memory', rawTs: Date.now(), entitlement: false });
          }
          return res.status(404).json({ message: 'LTP not found in response', tried: candKeys, raw: data, entitlement: false });
        }
        res.json({ instrument: candidate, ltp, rawTs: Date.now(), entitlement: true });
      } catch (e) {
        res.status(500).json({ message: 'Server error fetching LTP', error: e.message });
      }
    });

    app.get('/api/market/snapshot', (req, res) => {
      const indices = indexKeys.map(key => ({
        key,
        ltp: marketState.latestQuotes[key]?.ltp ?? null,
        cp: marketState.latestQuotes[key]?.cp ?? null,
        changePct: marketState.latestQuotes[key]?.changePct ?? null,
      }));
      res.json({ indices, ts: Date.now() });
    });

    // Serve the instrument universe to clients
    app.get('/api/market/universe', (req, res) => {
      res.json({ data: resolvedUniverse });
    });

    // Dynamic universe builder from Upstox BOD data
    app.get('/api/market/instruments/popular', async (req, res) => {
      if (!accessToken) {
        return res.status(401).json({ message: 'Access token required' });
      }
      try {
        const exchange = req.query.exchange || 'NSE';
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        
        const master = await loadInstrumentJsonMaster({ exchanges: [exchange] });
        const popularSymbols = [
          'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'HINDUNILVR', 'ITC', 'SBIN',
          'BHARTIARTL', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'AXISBANK', 'MARUTI', 'NESTLEIND',
          'DMART', 'ADANIPORTS', 'ADANIENT', 'BAJFINANCE', 'HCLTECH', 'WIPRO', 'ONGC',
          'POWERGRID', 'NTPC', 'COALINDIA', 'TATASTEEL', 'JSWSTEEL', 'ULTRACEMCO', 'GRASIM',
          'BPCL', 'EICHERMOT', 'HEROMOTOCO', 'BAJAJFINSV', 'BAJAJ-AUTO', 'M&M', 'TITAN',
          'SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'BRITANNIA', 'DABUR', 'GODREJCP',
          'MARICO', 'COLPAL', 'PIDILITIND', 'BERGEPAINT', 'TECHM', 'MINDTREE', 'MPHASIS'
        ];
        
        const instruments = [];
        for (const symbol of popularSymbols.slice(0, limit)) {
          const hit = master.byTradingSymbol.get(symbol) || master.byTradingSymbol.get(symbol.toUpperCase());
          if (hit && hit.segment === `${exchange}_EQ`) {
            instruments.push({
              underlying: hit.name || `${symbol} Limited`,
              symbol: symbol,
              segment: `${exchange}_EQ`,
              instrumentKey: hit.instrument_key
            });
          }
        }
        
        res.json({ 
          data: instruments, 
          count: instruments.length,
          exchange,
          source: 'upstox_bod'
        });
      } catch (e) {
        res.status(500).json({ message: 'Failed to load instruments', error: e.message });
      }
    });

    // Direct LTP test for debugging
    app.get('/api/market/test-ltp', async (req, res) => {
      if (!accessToken) {
        return res.status(401).json({ message: 'Access token required' });
      }
      try {
        // Test with a few sample instrument keys from our universe
        const testKeys = universeKeys.slice(0, 3);
        console.log('[Test LTP] Testing keys:', testKeys);
        
        const results = [];
        for (const key of testKeys) {
          const url = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(key)}`;
          console.log('[Test LTP] URL:', url);
          
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
          });
          
          const data = await response.json();
          console.log('[Test LTP] Response for', key, ':', JSON.stringify(data, null, 2));
          
          results.push({
            key,
            status: response.status,
            data: data
          });
        }
        
        res.json({ results, accessTokenPresent: !!accessToken, apiBase });
      } catch (e) {
        res.status(500).json({ message: 'LTP test failed', error: e.message });
      }
    });

    // Diagnostics: entitlement & subscription status probe
    app.get('/api/market/debug/entitlements', async (req, res) => {
      if (!accessToken) {
        return res.json({ accessToken: false, message: 'No access token configured' });
      }
      const sampleEquity = req.query.sample || 'ABB';
      const equityPipe = `NSE_EQ|${sampleEquity}`;
      const equityColon = `NSE_EQ:${sampleEquity}`;
      // Prefer first index key as control
      const indexKey = indexKeys[0];
      const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
      async function hitLtp(key) {
        try {
          const u = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(key)}`;
          const r = await fetch(u, { headers });
          const json = await r.json().catch(()=>({}));
          const dataMap = json?.data || {};
          return { key, status: r.status, count: Object.keys(dataMap).length, hasPrice: Object.values(dataMap).some(o => typeof o?.last_price === 'number'), rawKeys: Object.keys(dataMap) };
        } catch (e) {
          return { key, error: e.message };
        }
      }
      const [indexProbe, equityPipeProbe, equityColonProbe] = await Promise.all([
        hitLtp(indexKey),
        hitLtp(equityPipe),
        hitLtp(equityColon)
      ]);
      // Determine equity entitlement (price appears for at least one equity variant)
      const equityEntitled = (equityPipeProbe.hasPrice || equityColonProbe.hasPrice);
      const indexEntitled = indexProbe.hasPrice;
      const conclusion = equityEntitled ? 'equity_entitled' : (indexEntitled ? 'missing_equity_entitlement' : 'no_marketdata');
      res.json({
        indexProbe,
        equityPipeProbe,
        equityColonProbe,
        equityEntitled,
        indexEntitled,
        conclusion,
        subscriptionStatus: lastSubStatus || null,
        ts: Date.now()
      });
    });

    // Market status proxy (v2)
    const statusCache = new Map(); // key: exchange -> { ts, data }
    app.get('/api/market/status', async (req, res) => {
      const exchange = (req.query.exchange || 'NSE').toUpperCase();
      const now = Date.now();
      const cached = statusCache.get(exchange);
      if (cached && now - cached.ts < 30_000) {
        return res.json(cached.data);
      }
      const apiV2Base = process.env.UPSTOX_API_V2_BASE || 'https://api.upstox.com/v2';
      const url = `${apiV2Base}/market/status/${encodeURIComponent(exchange)}`;
      const headers = { Accept: 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      let json = null;
      let status = 500;
      try {
        const r = await fetch(url, { headers });
        status = r.status;
        json = await r.json().catch(() => null);
      } catch (e) {
        return res.status(502).json({ exchange, isOpen: null, statusText: 'Unavailable', error: e.message, ts: now });
      }
      // Normalize response into isOpen + statusText
      const raw = json || {};
      let isOpen = null;
      let statusText = '';
      // Try common shapes
      const d = raw?.data || raw;
      if (typeof d?.is_open === 'boolean') isOpen = d.is_open;
      if (typeof d?.isOpen === 'boolean') isOpen = d.isOpen;
      if (typeof d?.marketStatus?.is_open === 'boolean') isOpen = d.marketStatus.is_open;
      if (typeof d?.market_status?.is_open === 'boolean') isOpen = d.market_status.is_open;
      statusText = d?.status || d?.market_status?.status || d?.marketStatus?.status || (isOpen === true ? 'Open' : isOpen === false ? 'Closed' : 'Unknown');
      const normalized = { exchange, isOpen, statusText, httpStatus: status, raw, ts: now };
      statusCache.set(exchange, { ts: now, data: normalized });
      res.json(normalized);
    });

    // Debug route to inspect current state
    app.get('/api/debug/status', (req, res) => {
      const status = {
        accessTokenPresent: !!accessToken,
        apiBase,
        universeCount: resolvedUniverse.length,
        universeKeys: universeKeys.slice(0, 5),
        feedReady,
        lastTicksCount: Object.keys(marketState.lastTicks).length,
        latestQuotesCount: Object.keys(marketState.latestQuotes).length,
        sampleTicks: Object.keys(marketState.lastTicks).slice(0, 3).map(k => ({
          key: k,
          ltp: marketState.lastTicks[k]?.ltp,
          ts: marketState.lastTicks[k]?.ts
        })),
        sampleQuotes: Object.keys(marketState.latestQuotes).slice(0, 3).map(k => ({
          key: k,
          ltp: marketState.latestQuotes[k]?.ltp,
          ts: marketState.latestQuotes[k]?.ts
        })),
        dynamicSubscriptionStats: dynamicSubscriptionManager.getStats()
      };
      res.json(status);
    });

    // Debug route to test ISIN resolution
    app.get('/api/debug/resolve-isin', async (req, res) => {
      const { isin } = req.query;
      if (!isin) return res.status(400).json({ error: 'isin parameter required' });
      
      const instrument = instrumentsSearchService.getInstrument(isin);
      let resolvedKey = null;
      
      if (instrument && instrument.tradingSymbol) {
        resolvedKey = `${instrument.segment}:${instrument.tradingSymbol}`;
      }
      
      const allSubscriptionKeys = dynamicSubscriptionManager.getAllSubscriptionKeys();
      const isSubscribed = allSubscriptionKeys.includes(isin);
      
      res.json({
        isin,
        instrument,
        resolvedKey,
        isSubscribed,
        currentPrice: marketState.latestQuotes[isin]?.ltp || marketState.lastTicks[isin]?.ltp || null
      });
    });

    // Debug route to check FO instruments
    app.get('/api/debug/fo-instruments', (req, res) => {
      const foInstruments = [];
      for (const [key, instrument] of instrumentsSearchService.instruments) {
        if (instrument.segment === 'NSE_FO' || instrument.segment === 'BSE_FO') {
          foInstruments.push({
            key,
            tradingSymbol: instrument.tradingSymbol,
            segment: instrument.segment,
            name: instrument.name,
            expiry: instrument.expiry,
            strike: instrument.strike,
            optionType: instrument.optionType
          });
        }
        if (foInstruments.length >= 20) break; // Limit to first 20 for debugging
      }
      
      res.json({
        count: foInstruments.length,
        sample: foInstruments,
        totalInstruments: instrumentsSearchService.instruments.size
      });
    });

    // Debug route to test FO LTP directly
    app.get('/api/debug/test-fo-ltp', async (req, res) => {
      if (!accessToken) {
        return res.status(401).json({ message: 'Access token required' });
      }
      
      let { instrumentKey } = req.query;
      if (!instrumentKey) {
        // If no key provided, try to get a sample FO instrument from the search service
        for (const [key, instrument] of instrumentsSearchService.instruments) {
          if (instrument.segment === 'BSE_FO' || instrument.segment === 'NSE_FO') {
            instrumentKey = key;
            break;
          }
        }
      }
      
      if (!instrumentKey) {
        return res.status(400).json({ error: 'No FO instruments found and no instrumentKey provided' });
      }
      
      try {
        // Try multiple format variations for FO instruments
        const variants = [
          instrumentKey,
          instrumentKey.replace(/\|/g, ':'),
          instrumentKey.replace(/:/g, '|'),
          instrumentKey.split(/[\|:]/)[1], // Just the numeric token
          instrumentKey.split(/[\|:]/)[0] // Just the segment part
        ].filter(Boolean);
        
        const results = [];
        
        for (const variant of variants) {
          try {
            const url = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(variant)}`;
            console.log(`[Debug FO] Testing URL: ${url}`);
            
            const response = await fetch(url, {
              headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
            });
            
            const data = await response.json();
            results.push({
              variant,
              status: response.status,
              hasData: !!(data?.data && Object.keys(data.data).length > 0),
              responseKeys: data?.data ? Object.keys(data.data) : [],
              data: data
            });
            
            // If we found data, break early
            if (data?.data && Object.keys(data.data).length > 0) {
              break;
            }
          } catch (e) {
            results.push({
              variant,
              error: e.message
            });
          }
        }
        
        // Also get sample instruments from search service
        const sampleFOInstruments = [];
        for (const [key, instrument] of instrumentsSearchService.instruments) {
          if ((instrument.segment === 'BSE_FO' || instrument.segment === 'NSE_FO') && sampleFOInstruments.length < 5) {
            sampleFOInstruments.push({
              key,
              tradingSymbol: instrument.tradingSymbol,
              segment: instrument.segment,
              name: instrument.name
            });
          }
        }
        
        res.json({
          originalKey: instrumentKey,
          results,
          sampleFOInstruments,
          recommendation: results.find(r => r.hasData) ? 'Found working variant' : 'No working variant found'
        });
      } catch (e) {
        res.status(500).json({ message: 'Test failed', error: e.message });
      }
    });

    // Debug route: show normalized FO symbol variants for a given instrumentKey
    app.get('/api/debug/fo-variants', (req, res) => {
      const { instrumentKey } = req.query;
      if (!instrumentKey) return res.status(400).json({ error: 'instrumentKey is required' });
      const inst = instrumentsSearchService.getInstrument(instrumentKey);
      if (!inst) return res.status(404).json({ error: 'Instrument not found in local index' });
      const monNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const under = (inst.name?.split(' ')[0] || inst.tradingSymbol?.split(' ')[0] || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const isFut = /FUT/i.test(inst.tradingSymbol) || /FUT/.test(inst.instrumentType || inst.instrument_type || '');
      const opt = (inst.optionType || inst.option_type || (inst.tradingSymbol?.toUpperCase().includes('PE') ? 'PE' : 'CE')).toUpperCase();
      const strikeRaw = inst.strike ?? inst.strike_price ?? Number(inst.tradingSymbol?.match(/\b(\d+(?:\.\d+)?)\b/)?.[1] || 0);
      const strike = (typeof strikeRaw === 'number' ? strikeRaw : Number(strikeRaw || 0));
      let dt = null; try { dt = new Date(Number(inst.expiry) || 0); } catch {}
      const yy = dt ? String(dt.getFullYear()).slice(-2) : '';
      const mon = dt ? monNames[dt.getMonth()] : '';
      const dd = dt ? String(dt.getDate()).padStart(2,'0') : '';
      const mon1 = dt ? mon.charAt(0) : '';
      const noSpace = inst.tradingSymbol.replace(/\s+/g,'').toUpperCase();
      const ym = `${under}${yy}${mon}`;
      const ymd = `${under}${yy}${mon}${dd}`;
      const ym1 = `${under}${yy}${mon1}`;
      const ymd1 = `${under}${yy}${mon1}${dd}`;
      const s = String(strike).replace(/\.0+$/,'');
      const variants = new Set([noSpace]);
      if (isFut) {
        variants.add(`${ym}FUT`);
        variants.add(`${ym1}FUT`);
      } else {
        variants.add(`${ym}${s}${opt}`);
        if (dd) variants.add(`${ymd}${s}${opt}`);
        variants.add(`${ym1}${s}${opt}`);
        if (dd) variants.add(`${ymd1}${s}${opt}`);
      }
      res.json({ instrumentKey, segment: inst.segment, name: inst.name, tradingSymbol: inst.tradingSymbol, expiry: inst.expiry, strike: inst.strike, optionType: inst.optionType, variants: Array.from(variants) });
    });
  } catch (err) {
    console.error('Mongo connection error', err);
    process.exit(1);
  }
}

start();
