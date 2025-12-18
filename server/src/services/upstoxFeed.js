import fetch from "node-fetch";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import protobuf from "protobufjs";
import EventEmitter from "events";

const PROTO_URL =
  "https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto";

async function loadProto() {
  // Fetch remote .proto file manually (protobuf.load expects local path)
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

async function authorizeSocket(apiBase, accessToken) {
  const url = `${apiBase}/feed/market-data-feed/authorize`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstox authorize failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const wss = data?.data?.authorized_redirect_uri;
  if (!wss) throw new Error("No authorized_redirect_uri in response");
  return wss;
}

export function createUpstoxFeed({
  apiBase,
  accessToken,
  getAccessToken, // NEW: optional function to get current token dynamically
  instrumentKeys,
  mode = "ltpc",
  instrumentsSearchService = null,
  separator = "auto", // '|' or ':' or 'auto'
}) {
  const emitter = new EventEmitter();
  let ws;
  let closed = false;
  let proto;
  let ready = false;

  // Support both static token and dynamic getter
  const getToken = getAccessToken || (() => accessToken);

  // Decide preferred separator based on input keys when auto
  function decideSeparator(keys) {
    if (separator === "|" || separator === ":") return separator;
    // Auto-detect: prefer the most common separator in provided keys
    let pipe = 0,
      colon = 0;
    for (const k of keys) {
      if (k.includes("|")) pipe++;
      if (k.includes(":")) colon++;
    }
    if (pipe >= colon) return "|";
    return ":";
  }

  // Transform FO keys to the format expected by the WebSocket feed, preserving separator style
  function transformFOKeys(keys) {
    const sep = decideSeparator(keys);
    const transformed = [];
    const reverseMapping = new Map(); // transformed key -> original key

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
            // Build normalized FO symbol variants (spaces removed + date permutations)
            const buildFOSymbolVariants = (inst) => {
              // Build candidate underlyings from trading symbol first token and name/shortName
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
                "JAN",
                "FEB",
                "MAR",
                "APR",
                "MAY",
                "JUN",
                "JUL",
                "AUG",
                "SEP",
                "OCT",
                "NOV",
                "DEC",
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
            // Prefer weekly/day-inclusive for options, monthly for futures; else first variant
            let preferred =
              foVariants[0] || instrument.tradingSymbol.replace(/\s+/g, "");
            if (!/FUT/i.test(preferred)) {
              // Prefer ymd-like, then ym1d-like
              const ymd3 = foVariants.find((v) => /\d{2}[A-Z]{3}\d{2}/.test(v));
              const ymd1 = foVariants.find((v) => /\d{2}[A-Z]{1}\d{2}/.test(v));
              preferred = ymd3 || ymd1 || preferred;
            }
            transformedKey = `${segment}${sep}${preferred}`;
            // Map all variants back as well to be safe
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
      if (!proto) proto = await loadProto();
      const wssUrl = await authorizeSocket(apiBase, getToken());
      ws = new WebSocket(wssUrl);

      ws.on("open", () => {
        const guid = uuidv4().replace(/-/g, "").slice(0, 20);
        // Transform FO keys for proper subscription
        const { transformed: transformedKeys, reverseMapping } =
          transformFOKeys(instrumentKeys);
        // Store reverse mapping for later use
        ws._keyMapping = reverseMapping;

        // Upstox v3 expects snake_case: instrument_keys
        const sub = {
          guid,
          method: "sub",
          data: { mode, instrument_keys: transformedKeys },
        };
        const jsonPayload = JSON.stringify(sub);
        console.log("[Upstox] WebSocket opened, sending subscription...");
        console.log(
          `[Upstox] Subscribing to ${transformedKeys.length} keys in ${mode} mode`
        );
        if (process.env.LOG_UPSTOX_DEBUG) {
          console.log("[Upstox] Subscription payload:", jsonPayload);
          console.log(
            "[Upstox] First 5 instrument keys:",
            transformedKeys.slice(0, 5)
          );
          if (
            transformedKeys.length !== instrumentKeys.length ||
            Array.from(reverseMapping.values()).some((orig) =>
              transformedKeys.some((trans) => trans !== orig)
            )
          ) {
            console.log(
              "[Upstox] Key transformation applied for FO instruments"
            );
          }
        }
        try {
          ws.send(jsonPayload);
        } catch (e) {
          console.error("[Upstox] JSON subscription send failed:", e.message);
        }
        // Attempt a binary subscription (best-effort; request proto may differ)
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
            if (process.env.LOG_UPSTOX_DEBUG)
              console.log(
                "[Upstox] Sent binary subscription frame (length)",
                bin.length
              );
          } else {
            if (process.env.LOG_UPSTOX_DEBUG)
              console.log(
                "[Upstox] Request proto type not found; binary subscribe skipped"
              );
          }
        } catch (e) {
          if (process.env.LOG_UPSTOX_DEBUG)
            console.log(
              "[Upstox] Binary subscription attempt failed:",
              e.message
            );
        }
      });

      ws.on("message", (data, isBinary) => {
        if (!isBinary && typeof data === "string") {
          const lower = data.toLowerCase();
          if (lower.includes("ping")) return; // heartbeat
          if (process.env.LOG_UPSTOX_DEBUG)
            console.log("[Upstox] Text frame received (len)", data.length);
        }
        try {
          const buf = isBinary ? data : Buffer.from(data);
          const msg = proto.FeedResponse.decode(new Uint8Array(buf));
          if (!ready) {
            ready = true;
            emitter.emit("ready");
            if (process.env.LOG_UPSTOX_DEBUG)
              console.log("[Upstox] First protobuf frame type:", msg.type);
          }
          // Subscription status handling (success/errors)
          if (msg?.subscription) {
            const succ = Object.keys(msg.subscription.success || {});
            const errs = msg.subscription.errors || {};
            const errEntries = Object.entries(errs).map(([k, v]) => ({
              key: k,
              reason: String(v?.message || v || "unknown"),
            }));
            if (succ.length || errEntries.length) {
              if (process.env.LOG_UPSTOX_DEBUG) {
                console.log(
                  "[Upstox] Subscribed ok:",
                  succ.length,
                  "errors:",
                  errEntries.length
                );
                if (errEntries.length)
                  console.log(
                    "[Upstox] Subscription errors sample:",
                    errEntries.slice(0, 5)
                  );
              }
              emitter.emit("subStatus", { success: succ, errors: errEntries });
            }
          }
          if (msg?.feeds) {
            if (process.env.LOG_UPSTOX_DEBUG) {
              console.log(
                "[Upstox] Feed keys received:",
                Object.keys(msg.feeds)
              );
            }
            Object.entries(msg.feeds).forEach(([key, feedObj]) => {
              // Map the received key back to the original format for FO instruments
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
                  instrumentKey: originalKey, // Use original key for frontend consistency
                  ltp,
                  ts,
                  changePct: cp && cp > 0 ? ((ltp - cp) / cp) * 100 : null,
                  change: cp ? ltp - cp : null,
                };

                emitter.emit("price", tickData);
                if (process.env.LOG_UPSTOX_DEBUG)
                  console.log("[Upstox] Tick", key, "->", originalKey, ltp);
              } else if (process.env.LOG_UPSTOX_DEBUG && isSubscribed) {
                console.log(
                  "[Upstox] Feed received but no valid LTP for",
                  key,
                  ":",
                  JSON.stringify(feedObj).slice(0, 200)
                );
              }
            });
          } else if (process.env.LOG_UPSTOX_DEBUG) {
            console.log("[Upstox] Frame decoded but no feeds field");
          }
        } catch (e) {
          if (process.env.LOG_UPSTOX_DEBUG) {
            const len = Buffer.isBuffer(data)
              ? data.length
              : data?.byteLength || 0;
            console.log("[Upstox] Frame undecodable, length", len, e.message);
          }
        }
      });

      ws.on("error", (err) => {
        emitter.emit("error", err);
      });

      ws.on("close", () => {
        if (closed) return;
        setTimeout(connect, 1000);
      });
    } catch (e) {
      emitter.emit("error", e);
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
