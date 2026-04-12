const DEFAULT_API_BASE = "http://localhost:4000/api";
const DEFAULT_WS_URL = "ws://localhost:4000/ws/ticker";

function normalizeApiBase(input?: string) {
  const raw = (input || DEFAULT_API_BASE).trim().replace(/\/$/, "");
  // Allow users to set either domain root (https://pratik.gyanoda.in)
  // or full api path (https://pratik.gyanoda.in/api).
  return raw.endsWith("/api") ? raw : `${raw}/api`;
}

function deriveWsUrlFromApi(apiBase: string) {
  const root = apiBase.replace(/\/api$/, "");
  if (root.startsWith("https://")) {
    return root.replace("https://", "wss://") + "/ws/ticker";
  }
  if (root.startsWith("http://")) {
    return root.replace("http://", "ws://") + "/ws/ticker";
  }
  return DEFAULT_WS_URL;
}

const apiBase = normalizeApiBase(process.env.EXPO_PUBLIC_API_BASE);
const wsUrl = (process.env.EXPO_PUBLIC_WS_URL || deriveWsUrlFromApi(apiBase)).trim();

export const APP_CONFIG = {
  apiBase,
  wsUrl,
};
