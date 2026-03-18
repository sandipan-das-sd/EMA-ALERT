import axios from "axios";
import { getRedisService } from "./redisService.js";

const BUFFER_WINDOW_MS = 5_000;
const COOLDOWN_MS = 5 * 60 * 1000;
const DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 450;

const pendingSignals = new Map();
const seenSignals = new Map();

let lastCallAt = 0;
let flushTimer = null;

function cleanupSeenSignals(now = Date.now()) {
  for (const [key, ts] of seenSignals.entries()) {
    if (now - ts > DEDUPE_TTL_MS) {
      seenSignals.delete(key);
    }
  }
}

function scheduleFlush(delayMs = BUFFER_WINDOW_MS) {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushBufferedCalls();
  }, delayMs);
}

function normalizePhoneNumber(input) {
  if (!input) return "";
  const trimmed = String(input).trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  return `+${trimmed}`;
}

/**
 * Extract strike price (first number) from instrument name
 * "23700 CE NIFTY 01082024" → "23700"
 * "RELIANCE" → "RELIANCE"
 */
function extractStrikePrice(instrumentName) {
  if (!instrumentName) return "Unknown";
  const match = String(instrumentName).match(/^\d+/);
  return match ? match[0] : instrumentName;
}

function toLine(signal) {
  const instrument = signal.instrumentName || signal.instrumentKey || "Unknown";
  const strikePrice = extractStrikePrice(instrument);
  const close = Number.isFinite(signal.close) ? signal.close.toFixed(2) : "NA";
  const ema = Number.isFinite(signal.ema) ? signal.ema.toFixed(2) : "NA";
  return `Alert: ${strikePrice} EMA crossover. Close ${close}, EMA ${ema}.`;
}

function buildCombinedMessage(signals) {
  if (!signals.length) return "Alert: EMA crossover detected.";

  const lines = signals.map((s) => toLine(s));
  let message = signals.length === 1 
    ? lines[0]
    : `${signals.length} alerts: ${lines.join(" ")}`;

  if (message.length > MAX_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
  }

  return message;
}

function getExotelConfig() {
  return {
    sid: process.env.EXOTEL_SID,
    token: process.env.EXOTEL_TOKEN,
    exotelNumber: process.env.EXOTEL_NUMBER,
    defaultTo: process.env.EXOTEL_TO,
    voiceBaseUrl: process.env.EXOTEL_VOICE_BASE_URL,
  };
}

export async function triggerCall(message, phoneNumber) {
  const { sid, token, exotelNumber, voiceBaseUrl } = getExotelConfig();

  if (!sid || !token || !exotelNumber || !voiceBaseUrl) {
    return {
      success: false,
      skipped: true,
      reason: "Missing EXOTEL_SID, EXOTEL_TOKEN, EXOTEL_NUMBER or EXOTEL_VOICE_BASE_URL",
    };
  }

  const to = normalizePhoneNumber(phoneNumber);
  if (!to) {
    return { success: false, skipped: true, reason: "Missing destination phone number" };
  }

  const encodedMessage = encodeURIComponent(message);
  const voiceUrl = `${voiceBaseUrl.replace(/\/$/, "")}/voice?message=${encodedMessage}`;

  const endpoint = `https://api.exotel.com/v1/Accounts/${sid}/Calls/connect`;
  const payload = new URLSearchParams({
    From: exotelNumber,
    To: to,
    CallerId: exotelNumber,
    Url: voiceUrl,
  });

  try {
    const response = await axios.post(endpoint, payload.toString(), {
      auth: { username: sid, password: token },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 15_000,
    });

    return {
      success: true,
      status: response.status,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      status: error?.response?.status,
      error: error?.response?.data || error.message,
    };
  }
}

export async function enqueueBufferedVoiceAlert({
  instrumentKey,
  instrumentName,
  close,
  ema,
  ts,
  strategy = "ema20_cross_up",
  phoneNumber,
}) {
  const now = Date.now();
  const redis = getRedisService();
  const signalKey = `${instrumentKey || "unknown"}::${ts || now}::${strategy}`;

  // Try Redis first, fallback to memory
  let isDuplicate = false;
  if (redis.isConnected()) {
    try {
      isDuplicate = await redis.exists(`voice:dedupe:${signalKey}`);
      if (!isDuplicate) {
        const dedupeSeconds = Math.ceil(DEDUPE_TTL_MS / 1000);
        await redis.setWithTTL(`voice:dedupe:${signalKey}`, '1', dedupeSeconds);
      }
    } catch (err) {
      console.warn('[Voice] Redis dedupe failed, falling back to memory:', err.message);
      isDuplicate = seenSignals.has(signalKey);
      if (!isDuplicate) {
        seenSignals.set(signalKey, now);
      }
    }
  } else {
    // Fallback to memory
    cleanupSeenSignals(now);
    isDuplicate = seenSignals.has(signalKey);
    if (!isDuplicate) {
      seenSignals.set(signalKey, now);
    }
  }

  if (isDuplicate) {
    return { enqueued: false, reason: "duplicate_signal" };
  }

  pendingSignals.set(signalKey, {
    instrumentKey,
    instrumentName,
    close,
    ema,
    ts,
    strategy,
    phoneNumber,
  });

  scheduleFlush(BUFFER_WINDOW_MS);
  return { enqueued: true, bufferedCount: pendingSignals.size };
}

export async function flushBufferedCalls() {
  if (!pendingSignals.size) return { sent: false, reason: "empty_buffer" };

  const now = Date.now();
  const redis = getRedisService();
  const COOLDOWN_KEY = 'voice:cooldown:global';

  let canCall = true;
  let remainingMs = 0;

  // Check cooldown via Redis first, fallback to memory
  if (redis.isConnected()) {
    try {
      const cooldownValue = await redis.get(COOLDOWN_KEY);
      if (cooldownValue) {
        const ttl = await redis.getTTL(COOLDOWN_KEY);
        canCall = false;
        remainingMs = ttl * 1000;
      }
    } catch (err) {
      console.warn('[Voice] Redis cooldown check failed, falling back to memory:', err.message);
      const elapsedSinceLastCall = now - lastCallAt;
      if (lastCallAt && elapsedSinceLastCall < COOLDOWN_MS) {
        canCall = false;
        remainingMs = COOLDOWN_MS - elapsedSinceLastCall;
      }
    }
  } else {
    // Fallback to memory
    const elapsedSinceLastCall = now - lastCallAt;
    if (lastCallAt && elapsedSinceLastCall < COOLDOWN_MS) {
      canCall = false;
      remainingMs = COOLDOWN_MS - elapsedSinceLastCall;
    }
  }

  if (!canCall) {
    scheduleFlush(Math.max(remainingMs, 500));
    return { sent: false, reason: "cooldown", remainingMs };
  }

  const allSignals = Array.from(pendingSignals.values());
  pendingSignals.clear();

  const { defaultTo } = getExotelConfig();
  const targetNumber = allSignals.find((s) => s.phoneNumber)?.phoneNumber || defaultTo;

  const message = buildCombinedMessage(allSignals);
  const result = await triggerCall(message, targetNumber);

  if (result.success) {
    lastCallAt = Date.now();

    // Set cooldown in Redis
    if (redis.isConnected()) {
      try {
        const cooldownSeconds = Math.ceil(COOLDOWN_MS / 1000);
        await redis.setWithTTL(COOLDOWN_KEY, '1', cooldownSeconds);
      } catch (err) {
        console.warn('[Voice] Redis cooldown set failed:', err.message);
      }
    }
  }

  return {
    sent: result.success,
    message,
    signalCount: allSignals.length,
    result,
  };
}

export function getVoiceXmlMessage(inputMessage) {
  const safeText = String(inputMessage || "EMA alert")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${safeText}</Say></Response>`;
}
