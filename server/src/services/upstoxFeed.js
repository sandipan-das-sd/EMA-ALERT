import fetch from 'node-fetch';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import protobuf from 'protobufjs';
import EventEmitter from 'events';

const PROTO_URL = 'https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto';

async function loadProto() {
  // Fetch remote .proto file manually (protobuf.load expects local path)
  const res = await fetch(PROTO_URL);
  if (!res.ok) throw new Error(`Failed to fetch proto: ${res.status}`);
  const protoText = await res.text();
  const parsed = protobuf.parse(protoText, { keepCase: true });
  const root = parsed.root;
  const FeedResponse = root.lookupType('com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse');
  return { root, FeedResponse };
}

async function authorizeSocket(apiBase, accessToken) {
  const url = `${apiBase}/feed/market-data-feed/authorize`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstox authorize failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const wss = data?.data?.authorized_redirect_uri;
  if (!wss) throw new Error('No authorized_redirect_uri in response');
  return wss;
}

export function createUpstoxFeed({
  apiBase,
  accessToken,
  instrumentKeys,
  mode = 'ltpc',
}) {
  const emitter = new EventEmitter();
  let ws;
  let closed = false;
  let proto;
  let ready = false;

  async function connect() {
    try {
      if (!proto) proto = await loadProto();
      const wssUrl = await authorizeSocket(apiBase, accessToken);
  ws = new WebSocket(wssUrl);

      ws.on('open', () => {
        const guid = uuidv4().replace(/-/g, '').slice(0, 20);
        const sub = { guid, method: 'sub', data: { mode, instrumentKeys } };
        const jsonPayload = JSON.stringify(sub);
        if (process.env.LOG_UPSTOX_DEBUG) console.log('[Upstox] Sending subscription JSON:', jsonPayload);
        try { ws.send(jsonPayload); } catch (e) {
          if (process.env.LOG_UPSTOX_DEBUG) console.log('[Upstox] JSON subscription send failed', e.message);
        }
        // Attempt a binary subscription (best-effort; request proto may differ)
        try {
          const possible = [
            'com.upstox.marketdatafeederv3udapi.rpc.proto.Request',
            'com.upstox.marketdatafeederv3udapi.rpc.proto.Subscribe',
          ];
          let reqType = null;
          for (const name of possible) {
            try { reqType = proto.root.lookupType(name); } catch {}
            if (reqType) break;
          }
          if (reqType) {
            const msgObj = reqType.create(sub);
            const bin = reqType.encode(msgObj).finish();
            ws.send(Buffer.from(bin));
            if (process.env.LOG_UPSTOX_DEBUG) console.log('[Upstox] Sent binary subscription frame (length)', bin.length);
          } else {
            if (process.env.LOG_UPSTOX_DEBUG) console.log('[Upstox] Request proto type not found; binary subscribe skipped');
          }
        } catch (e) {
          if (process.env.LOG_UPSTOX_DEBUG) console.log('[Upstox] Binary subscription attempt failed:', e.message);
        }
      });

      ws.on('message', (data, isBinary) => {
        if (!isBinary && typeof data === 'string') {
          const lower = data.toLowerCase();
          if (lower.includes('ping')) return; // heartbeat
          if (process.env.LOG_UPSTOX_DEBUG) console.log('[Upstox] Text frame received (len)', data.length);
        }
        try {
          const buf = isBinary ? data : Buffer.from(data);
          const msg = proto.FeedResponse.decode(new Uint8Array(buf));
          if (!ready) {
            ready = true;
            emitter.emit('ready');
            if (process.env.LOG_UPSTOX_DEBUG) console.log('[Upstox] First protobuf frame type:', msg.type);
          }
          if (msg?.feeds) {
            if (process.env.LOG_UPSTOX_DEBUG) {
              console.log('[Upstox] Feed keys received:', Object.keys(msg.feeds));
            }
            Object.entries(msg.feeds).forEach(([key, feedObj]) => {
              if (instrumentKeys.includes(key) && feedObj.ltpc && typeof feedObj.ltpc.ltp === 'number') {
                const ltp = feedObj.ltpc.ltp;
                const ts = Number(msg.currentTs || Date.now());
                emitter.emit('price', { instrumentKey: key, ltp, ts });
                if (process.env.LOG_UPSTOX_DEBUG) console.log('[Upstox] Tick', key, ltp);
              }
            });
          } else if (process.env.LOG_UPSTOX_DEBUG) {
            console.log('[Upstox] Frame decoded but no feeds field');
          }
        } catch (e) {
          if (process.env.LOG_UPSTOX_DEBUG) {
            const len = Buffer.isBuffer(data) ? data.length : (data?.byteLength || 0);
            console.log('[Upstox] Frame undecodable, length', len, e.message);
          }
        }
      });

      ws.on('error', (err) => {
        emitter.emit('error', err);
      });

      ws.on('close', () => {
        if (closed) return;
        setTimeout(connect, 1000);
      });
    } catch (e) {
      emitter.emit('error', e);
      setTimeout(connect, 2000);
    }
  }

  connect();

  emitter.close = () => {
    closed = true;
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  };

  return emitter;
}
