const DEFAULT_API_BASE = "http://localhost:4000/api";
const DEFAULT_WS_URL = "ws://localhost:4000/ws/ticker";

export const APP_CONFIG = {
  apiBase: process.env.EXPO_PUBLIC_API_BASE || DEFAULT_API_BASE,
  wsUrl: process.env.EXPO_PUBLIC_WS_URL || DEFAULT_WS_URL,
};
