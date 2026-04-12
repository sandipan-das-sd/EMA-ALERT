function normalizeApiBase(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const withoutSlash = raw.replace(/\/$/, '');
  return withoutSlash.endsWith('/api') ? withoutSlash : `${withoutSlash}/api`;
}

function deriveWsUrlFromApi(apiBase) {
  const root = String(apiBase || '').replace(/\/api$/, '');
  if (root.startsWith('https://')) return `${root.replace('https://', 'wss://')}/ws/ticker`;
  if (root.startsWith('http://')) return `${root.replace('http://', 'ws://')}/ws/ticker`;
  return '';
}

function resolveApiBase() {
  const envBase = normalizeApiBase(import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE);
  if (envBase) return envBase;

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:4000/api';
    }
    return `${protocol}//${hostname}/api`;
  }

  return 'http://localhost:4000/api';
}

function resolveWsUrl(apiBase) {
  const envWs = String(import.meta.env.VITE_WS_URL || '').trim();
  if (envWs) return envWs;
  const derived = deriveWsUrlFromApi(apiBase);
  if (derived) return derived;
  return 'ws://localhost:4000/ws/ticker';
}

export const API_BASE = resolveApiBase();
export const WS_URL = resolveWsUrl(API_BASE);
