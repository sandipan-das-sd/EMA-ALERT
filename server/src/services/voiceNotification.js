import axios from "axios";

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

function toLine(signal) {
  const instrument = signal.instrumentName || signal.instrumentKey || "Unknown";
  const close = Number.isFinite(signal.close) ? signal.close.toFixed(2) : "NA";
  const ema = Number.isFinite(signal.ema) ? signal.ema.toFixed(2) : "NA";
  return `${instrument} crossed EMA. Close ${close}, EMA ${ema}.`;
}

function buildCombinedMessage(signals) {
  if (!signals.length) return "EMA crossover alert.";

  const lines = signals.map((s) => toLine(s));
  let message = `EMA alert for ${signals.length} signal${signals.length > 1 ? "s" : ""}. ${lines.join(" ")}`;

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

export function enqueueBufferedVoiceAlert({
  instrumentKey,
  instrumentName,
  close,
  ema,
  ts,
  strategy = "ema20_cross_up",
  phoneNumber,
}) {
  const now = Date.now();
  cleanupSeenSignals(now);

  const signalKey = `${instrumentKey || "unknown"}::${ts || now}::${strategy}`;
  if (seenSignals.has(signalKey)) {
    return { enqueued: false, reason: "duplicate_signal" };
  }

  seenSignals.set(signalKey, now);
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
  const elapsedSinceLastCall = now - lastCallAt;

  if (lastCallAt && elapsedSinceLastCall < COOLDOWN_MS) {
    const remaining = COOLDOWN_MS - elapsedSinceLastCall;
    scheduleFlush(Math.max(remaining, 500));
    return { sent: false, reason: "cooldown", remainingMs: remaining };
  }

  const allSignals = Array.from(pendingSignals.values());
  pendingSignals.clear();

  const { defaultTo } = getExotelConfig();
  const targetNumber = allSignals.find((s) => s.phoneNumber)?.phoneNumber || defaultTo;

  const message = buildCombinedMessage(allSignals);
  const result = await triggerCall(message, targetNumber);

  if (result.success) {
    lastCallAt = Date.now();
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
