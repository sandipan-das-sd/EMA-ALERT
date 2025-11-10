import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dns from 'dns';
import authRouter from './routes/auth.js';
import { createUpstoxFeed } from './services/upstoxFeed.js';
import fetch from 'node-fetch';
import { WebSocketServer } from 'ws';

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
    const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

    // WS server to stream Nifty price to frontend clients
  const wss = new WebSocketServer({ server, path: '/ws/ticker' });
  wss.clients.forEach = wss.clients.forEach.bind(wss.clients); // defensive in some node/ws combos
    const apiBase = process.env.UPSTOX_API_BASE || 'https://api.upstox.com/v3';
    const accessToken = process.env.UPSTOX_ACCESS_TOKEN;
    const instrumentKeys = (process.env.UPSTOX_INSTRUMENTS || 'NSE_INDEX|Nifty 50')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

  let feed;
  let lastTicks = {}; // instrumentKey -> tick
    let feedReady = false;
    if (accessToken) {
  const mode = process.env.UPSTOX_MODE || 'ltpc';
  feed = createUpstoxFeed({ apiBase, accessToken, instrumentKeys, mode });
      feed.on('ready', () => {
        feedReady = true;
        console.log('Upstox market feed connected');
      });
      feed.on('price', (tick) => {
        lastTicks[tick.instrumentKey] = tick;
        const payload = JSON.stringify({ type: 'tick', ...tick });
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
    } else {
      console.warn('UPSTOX_ACCESS_TOKEN missing. WS price feed disabled.');
    }

    wss.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'info', message: 'Connected to EMA-ALERT ticker' }));
      if (!accessToken) {
        socket.send(JSON.stringify({ type: 'error', message: 'Upstox access token not configured on server' }));
      }
    });

    // Simple REST fallback to read latest tick/status
    app.get('/api/market/nifty', (req, res) => {
      const key = instrumentKeys[0];
      res.json({ connected: Boolean(feedReady), tick: lastTicks[key] });
    });

    // Generic LTP REST fallback using Upstox market quote endpoint
    app.get('/api/market/ltp', async (req, res) => {
      const instrument = req.query.instrument || instrumentKeys[0];
      if (!accessToken) return res.status(400).json({ message: 'Access token missing' });
      try {
        const url = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(instrument)}`;
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (!r.ok) {
          const txt = await r.text();
          return res.status(r.status).json({ message: 'Upstox quote error', detail: txt });
        }
        const data = await r.json();
        // V3 LTP response: { status: 'success', data: { <instrument>: { last_price, instrument_token, ltq, volume, cp } } }
        const map = data?.data || {};
        // Instrument keys may be normalized by Upstox (e.g., replace '|' with ':'); try all keys
        const candKeys = [instrument, instrument.replace('|', ':'), instrument.replace(':', '|')];
        let quoteObj = null;
        for (const k of candKeys) {
          if (map[k]) { quoteObj = map[k]; break; }
        }
        const ltp = quoteObj?.last_price;
        if (typeof ltp !== 'number') {
          return res.status(404).json({ message: 'LTP not found in response', raw: data });
        }
        res.json({ instrument, ltp, rawTs: Date.now() });
      } catch (e) {
        res.status(500).json({ message: 'Server error fetching LTP', error: e.message });
      }
    });
  } catch (err) {
    console.error('Mongo connection error', err);
    process.exit(1);
  }
}

start();
