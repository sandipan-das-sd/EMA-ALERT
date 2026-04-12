import fetch from "node-fetch";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import protobuf from "protobufjs";
import EventEmitter from "events";

const PROTO_URL =
  "https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto";

async function loadProto() {
  const res = await fetch(PROTO_URL);
  if (!res.ok) throw new Error(`Failed to fetch proto: ${res.status}`);
  const protoText = await res.text();
  const parsed = protobuf.parse(protoText, { keepCase: true });
  const root = parsed.root;
  const FeedResponse = root.lookupType(
    "com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse"
  );
  return { root, FeedResponse };
}

async function authorizeSocket(apiBase, getAccessToken) {
  const currentToken = typeof getAccessToken === 'function' ? getAccessToken() : getAccessToken;
  const url = `${apiBase}/feed/market-data-feed/authorize`;
  
  console.log('[Upstox Auth] Requesting WebSocket URL...');
  console.log('[Upstox Auth] API Base:', apiBase);
  console.log('[Upstox Auth] Token present:', !!currentToken);
  
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${currentToken}`,
      Accept: "application/json",
    },
  });
  
  if (!res.ok) {
    const text = await res.text();
    console.error(`[Upstox Auth] Failed: ${res.status}`, text);
    throw new Error(`Upstox authorize failed: ${res.status} ${text}`);
  }
  
  const data = await res.json();
  console.log('[Upstox Auth] Full response:', JSON.stringify(data, null, 2));
  
  const wss = data?.data?.authorized_redirect_uri;
  if (!wss) throw new Error("No authorized_redirect_uri in response");
  
  console.log('[Upstox Auth] WebSocket URL obtained:', wss);
  return wss;
}

export function createUpstoxFeed({
  apiBase,
  accessToken,
  getAccessToken,
  instrumentKeys,
  mode = "ltpc",
  instrumentsSearchService = null,
  separator = "auto",
}) {
  const emitter = new EventEmitter();
  let ws;
  let closed = false;
  let proto;
  let ready = false;
  let retryAttempt = 0;
  let lastAuthWarnAt = 0;

  const getToken = getAccessToken || (() => accessToken);

  function decideSeparator(keys) {
    if (separator === "|" || separator === ":") return separator;
    let pipe = 0, colon = 0;
    for (const k of keys) {
      if (k.includes("|")) pipe++;
      if (k.includes(":")) colon++;
    }
    return pipe >= colon ? "|" : ":";
  }

  function transformFOKeys(keys) {
    const sep = decideSeparator(keys);
    const transformed = [];
    const reverseMapping = new Map();

    keys.forEach((key) => {
      let transformedKey = key;
      if (
        (key.includes("NSE_FO") || key.includes("BSE_FO")) &&
        instrumentsSearchService
      ) {
        const instrument = instrumentsSearchService.getInstrument?.(key);
        if (instrument && instrument.tradingSymbol) {
          const parts = key.split(/[\|:]/);
          if (parts.length === 2) {
            const segment = parts[0];
            const buildFOSymbolVariants = (inst) => {
              const tsToken =
                (inst.tradingSymbol || "").split(" ")[0]?.toUpperCase?.() || "";
              const snToken =
                (inst.shortName || inst.name || "")
                  .split(" ")[0]
                  ?.toUpperCase?.() || "";
              const normalize = (s) => (s || "").toUpperCase();
              const stripNonAlnum = (s) =>
                normalize(s).replace(/[^A-Z0-9]/g, "");
              const candidates = new Set([
                tsToken,
                stripNonAlnum(tsToken),
                snToken,
                stripNonAlnum(snToken),
              ]);
              if (tsToken.includes("&")) {
                candidates.add(tsToken.replace(/&/g, "AND"));
                candidates.add(stripNonAlnum(tsToken.replace(/&/g, "AND")));
              }
              candidates.add(tsToken.replace(/[-.&]/g, ""));
              const underList = Array.from(candidates).filter(Boolean);
              const isFut =
                /FUT/i.test(inst.tradingSymbol) ||
                /FUT/.test(inst.instrumentType || inst.instrument_type || "");
              const opt = (
                inst.optionType ||
                inst.option_type ||
                (inst.tradingSymbol?.toUpperCase().includes("PE") ? "PE" : "CE")
              ).toUpperCase();
              const strikeRaw =
                inst.strike ??
                inst.strike_price ??
                Number(
                  inst.tradingSymbol?.match(/\b(\d+(?:\.\d+)?)\b/)?.[1] || 0
                );
              const strike =
                typeof strikeRaw === "number"
                  ? strikeRaw
                  : Number(strikeRaw || 0);
              const monNames = [
                "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
              ];
              let dt = null;
              try {
                dt = new Date(Number(inst.expiry) || 0);
              } catch {}
              const yy = dt ? String(dt.getFullYear()).slice(-2) : "";
              const mon = dt ? monNames[dt.getMonth()] : "";
              const dd = dt ? String(dt.getDate()).padStart(2, "0") : "";
              const mon1 = dt ? mon.charAt(0) : "";
              const noSpaceTS = inst.tradingSymbol
                .replace(/\s+/g, "")
                .toUpperCase();
              const variants = new Set([noSpaceTS]);
              for (const under of underList) {
                const ym = `${under}${yy}${mon}`;
                const ymd = `${under}${yy}${mon}${dd}`;
                const ym1 = `${under}${yy}${mon1}`;
                const ymd1 = `${under}${yy}${mon1}${dd}`;
                if (isFut) {
                  variants.add(`${ym}FUT`);
                  variants.add(`${ym1}FUT`);
                } else {
                  const s = String(strike).replace(/\.0+$/, "");
                  variants.add(`${ym}${s}${opt}`);
                  if (dd) variants.add(`${ymd}${s}${opt}`);
                  variants.add(`${ym1}${s}${opt}`);
                  if (dd) variants.add(`${ymd1}${s}${opt}`);
                }
              }
              return Array.from(variants).filter(Boolean);
            };
            const foVariants = buildFOSymbolVariants(instrument);
            let preferred =
              foVariants[0] || instrument.tradingSymbol.replace(/\s+/g, "");
            if (!/FUT/i.test(preferred)) {
              const ymd3 = foVariants.find((v) => /\d{2}[A-Z]{3}\d{2}/.test(v));
              const ymd1 = foVariants.find((v) => /\d{2}[A-Z]{1}\d{2}/.test(v));
              preferred = ymd3 || ymd1 || preferred;
            }
            transformedKey = `${segment}${sep}${preferred}`;
            reverseMapping.set(transformedKey, key);
            foVariants.forEach((v) =>
              reverseMapping.set(`${segment}${sep}${v}`, key)
            );
          }
        }
      }
      transformed.push(transformedKey);
      if (transformedKey === key) {
        reverseMapping.set(transformedKey, key);
      }
    });

    return { transformed, reverseMapping };
  }

  async function connect() {
    try {
      console.log('[Upstox Feed] Connecting...');
      if (!proto) proto = await loadProto();
      
      const wssUrl = await authorizeSocket(apiBase, getToken);
      console.log('[Upstox Feed] Creating WebSocket connection...');
      
      // CRITICAL FIX: Don't add Authorization header to WebSocket connection
      // The authorization is embedded in the URL itself
      ws = new WebSocket(wssUrl);

      ws.on("open", () => {
        retryAttempt = 0;
        console.log('[Upstox Feed] ✓ WebSocket connected successfully');
        const guid = uuidv4().replace(/-/g, "").slice(0, 20);
        const { transformed: transformedKeys, reverseMapping } =
          transformFOKeys(instrumentKeys);
        ws._keyMapping = reverseMapping;

        const sub = {
          guid,
          method: "sub",
          data: { mode, instrument_keys: transformedKeys },
        };
        const jsonPayload = JSON.stringify(sub);
        console.log(`[Upstox Feed] Subscribing to ${transformedKeys.length} instruments in ${mode} mode`);
        
        if (process.env.DEBUG_UPSTOX) {
          console.log("[Upstox Feed] First 5 keys:", transformedKeys.slice(0, 5));
        }
        
        try {
          ws.send(jsonPayload);
          console.log('[Upstox Feed] ✓ Subscription request sent');
        } catch (e) {
          console.error("[Upstox Feed] ✗ Subscription send failed:", e.message);
        }
        
        try {
          const possible = [
            "com.upstox.marketdatafeederv3udapi.rpc.proto.Request",
            "com.upstox.marketdatafeederv3udapi.rpc.proto.Subscribe",
          ];
          let reqType = null;
          for (const name of possible) {
            try {
              reqType = proto.root.lookupType(name);
            } catch {}
            if (reqType) break;
          }
          if (reqType) {
            const { transformed: transformedKeys } =
              transformFOKeys(instrumentKeys);
            const msgObj = reqType.create({
              ...sub,
              data: { mode, instrument_keys: transformedKeys },
            });
            const bin = reqType.encode(msgObj).finish();
            ws.send(Buffer.from(bin));
            if (process.env.DEBUG_UPSTOX)
              console.log("[Upstox Feed] ✓ Binary subscription sent (length)", bin.length);
          }
        } catch (e) {
          if (process.env.DEBUG_UPSTOX)
            console.log("[Upstox Feed] Binary subscription skipped:", e.message);
        }
      });

      ws.on("message", (data, isBinary) => {
        if (!isBinary && typeof data === "string") {
          const lower = data.toLowerCase();
          if (lower.includes("ping")) return;
          if (process.env.DEBUG_UPSTOX)
            console.log("[Upstox Feed] Text frame (len)", data.length);
        }
        try {
          const buf = isBinary ? data : Buffer.from(data);
          const msg = proto.FeedResponse.decode(new Uint8Array(buf));
          if (!ready) {
            ready = true;
            emitter.emit("ready");
            console.log('[Upstox Feed] ✓ Ready - receiving data');
          }
          
          if (msg?.subscription) {
            const succ = Object.keys(msg.subscription.success || {});
            const errs = msg.subscription.errors || {};
            const errEntries = Object.entries(errs).map(([k, v]) => ({
              key: k,
              reason: String(v?.message || v || "unknown"),
            }));
            if (succ.length || errEntries.length) {
              console.log(`[Upstox Feed] Subscribed: ${succ.length} ok, ${errEntries.length} errors`);
              if (errEntries.length && process.env.DEBUG_UPSTOX) {
                console.log("[Upstox Feed] Error sample:", errEntries.slice(0, 3));
              }
              emitter.emit("subStatus", { success: succ, errors: errEntries });
            }
          }
          
          if (msg?.feeds) {
            Object.entries(msg.feeds).forEach(([key, feedObj]) => {
              const originalKey = ws._keyMapping?.get(key) || key;
              const isSubscribed =
                instrumentKeys.includes(originalKey) ||
                instrumentKeys.includes(key);

              if (
                isSubscribed &&
                feedObj.ltpc &&
                typeof feedObj.ltpc.ltp === "number"
              ) {
                const ltp = feedObj.ltpc.ltp;
                const cp = feedObj.ltpc.cp || feedObj.ltpc.close_price || null;
                const ts = Number(msg.currentTs || Date.now());

                const tickData = {
                  instrumentKey: originalKey,
                  ltp,
                  ts,
                  changePct: cp && cp > 0 ? ((ltp - cp) / cp) * 100 : null,
                  change: cp ? ltp - cp : null,
                };

                emitter.emit("price", tickData);
              }
            });
          }
        } catch (e) {
          if (process.env.DEBUG_UPSTOX) {
            console.log("[Upstox Feed] Decode error:", e.message);
          }
        }
      });

      ws.on("error", (err) => {
        console.error('[Upstox Feed] ✗ WebSocket error:', err.message);
        
        // Check if it's a 403 - might be an entitlement issue
        if (err.message.includes('403')) {
          console.error('[Upstox Feed] ✗ 403 Forbidden - Possible causes:');
          console.error('  1. WebSocket streaming not enabled in your Upstox account');
          console.error('  2. Token lacks websocket permissions');
          console.error('  3. Account subscription level insufficient');
          console.error('  → Falling back to HTTP polling only');
          
          // Emit a special event so the server can handle it gracefully
          emitter.emit("websocket-disabled");
          closed = true; // Don't retry if it's a 403
        }
        
        emitter.emit("error", err);
      });

      ws.on("close", (code, reason) => {
        console.log(`[Upstox Feed] WebSocket closed: ${code} ${reason || ''}`);
        ready = false;
        if (closed) return;
        retryAttempt += 1;
        const delay = Math.min(2000 * Math.pow(1.6, retryAttempt), 60_000);
        console.log(`[Upstox Feed] Reconnecting in ${Math.round(delay / 1000)} seconds...`);
        setTimeout(connect, delay);
      });
    } catch (e) {
      console.error('[Upstox Feed] ✗ Connection error:', e.message);
      emitter.emit("error", e);
      if (!closed) {
        retryAttempt += 1;
        const msg = String(e?.message || '');
        const invalidToken = msg.includes('UDAPI100050') || msg.includes('authorize failed: 401') || msg.includes('Invalid token');

        let delay = Math.min(3000 * Math.pow(1.7, retryAttempt), 60_000);
        if (invalidToken) {
          delay = Math.max(delay, 60_000);
          const now = Date.now();
          if (now - lastAuthWarnAt > 60_000) {
            console.warn('[Upstox Feed] Invalid/expired Upstox token detected. Next retry in 60s. Update token from app settings/login.');
            lastAuthWarnAt = now;
          }
        }

        console.log(`[Upstox Feed] Retrying in ${Math.round(delay / 1000)} seconds...`);
        setTimeout(connect, delay);
      }
    }
  }

  connect();

  emitter.close = () => {
    console.log('[Upstox Feed] Closing connection...');
    closed = true;
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  };

  return emitter;
}