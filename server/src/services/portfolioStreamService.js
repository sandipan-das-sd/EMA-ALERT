/**
 * Portfolio Stream Service
 * Opens one Upstox portfolio-stream-feed WebSocket per user and broadcasts
 * order/position/holding update messages to subscribed browser clients via
 * the shared raw wss (WebSocketServer) in index.js.
 *
 * Usage:
 *   portfolioStream.openForUser(userId, accessToken)
 *   portfolioStream.closeForUser(userId)
 *   portfolioStream.broadcast(userId, msg)   — called internally
 *
 * The browser client listens for: { type: 'portfolio_update', data: {...} }
 * where data is the raw Upstox portfolio stream message (order/position/holding).
 */

import WebSocket from 'ws';
import User from '../models/User.js';

const UPSTOX_PORTFOLIO_WSS = 'wss://api.upstox.com/v2/feed/portfolio-stream-feed';

// Map<userId, { ws, pingInterval }>
const connections = new Map();

// wss reference set by initPortfolioStream()
let _wss = null;
// Map<wsClientId, userId> — lets us route broadcasts to the right session
// We'll tag each wss client with a userId when they identify themselves
export const clientUserMap = new Map();

export function initPortfolioStream(wss) {
  _wss = wss;
}

// ------------------------------------------------------------------
// Open / refresh the upstream Upstox connection for a user
// ------------------------------------------------------------------
export async function openForUser(userId, accessToken) {
  if (!userId || !accessToken) return;

  // Close stale connection if exists
  if (connections.has(userId)) closeForUser(userId);

  const ws = new WebSocket(UPSTOX_PORTFOLIO_WSS, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: '*/*',
    },
    followRedirects: true,
  });

  let pingInterval = null;

  ws.on('open', () => {
    console.log(`[PortfolioStream] Upstream connected for user ${userId}`);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      broadcast(userId, msg);
    } catch {
      // binary frames / non-json — ignore
    }
  });

  ws.on('close', (code) => {
    console.log(`[PortfolioStream] Upstream closed for user ${userId}, code=${code}`);
    clearInterval(pingInterval);
    connections.delete(userId);
    // Auto-reconnect in 8s
    setTimeout(async () => {
      try {
        const user = await User.findById(userId).select('+upstoxAccessToken');
        if (user?.upstoxAccessToken) openForUser(userId, user.upstoxAccessToken);
      } catch {}
    }, 8000);
  });

  ws.on('error', (err) => {
    console.error(`[PortfolioStream] Error for user ${userId}:`, err.message);
    broadcast(userId, { type: 'portfolio_error', message: err.message });
  });

  connections.set(userId, { ws, get pingInterval() { return pingInterval; } });
}

export function closeForUser(userId) {
  const conn = connections.get(userId);
  if (!conn) return;
  try { conn.ws.terminate(); } catch {}
  connections.delete(userId);
}

// ------------------------------------------------------------------
// Broadcast a portfolio update to all browser clients for a userId
// ------------------------------------------------------------------
function broadcast(userId, data) {
  if (!_wss) return;
  const payload = JSON.stringify({ type: 'portfolio_update', userId, data });
  _wss.clients.forEach((client) => {
    if (client.readyState === 1 && clientUserMap.get(client) === userId) {
      client.send(payload);
    }
  });
}

export function getActivePortfolioConnections() {
  return connections.size;
}

