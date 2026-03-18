import { APP_CONFIG } from "@/lib/config";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  watchlist?: string[];
  hasUpstoxToken?: boolean;
}

export interface WatchlistItem {
  key: string;
  name?: string;
  tradingSymbol?: string;
  segment?: string;
  expiry?: string | null;
  price?: number | null;
  changePct?: number | null;
  change?: number | null;
  ts?: string | null;
}

export interface MarketIndexItem {
  key: string;
  ltp?: number | null;
  cp?: number | null;
  changePct?: number | null;
}

export interface MarketStatus {
  timezone: string;
  isOpen: boolean;
  isWeekday: boolean;
  nowIst: string;
  openTime: string;
  closeTime: string;
  hasFeedData?: boolean;
  hasQuoteData?: boolean;
}

export interface InstrumentSearchItem {
  key: string;
  tradingSymbol: string;
  name?: string;
  segment?: string;
  lotSize?: number;
  tickSize?: number;
  expiry?: string | number | null;
  strike?: number | null;
  optionType?: string | null;
}

export interface OptionFilterMeta {
  underlying: string;
  segment: string;
  matchCount: number;
  years: number[];
  monthsByYear: Record<string, number[]>;
  daysByYearMonth: Record<string, number[]>;
}

export interface OptionUnderlyingMeta {
  segment: string;
  underlyings: string[];
}

export interface OptionSearchFilters {
  query?: string;
  segments?: string[];
  limit?: number;
  underlying?: string;
  expiryYear?: number;
  expiryMonth?: number;
  expiryDay?: number;
  optionType?: 'ALL' | 'CE' | 'PE';
  debug?: boolean;
}

function inferOptionTypeFromSymbol(symbol?: string | null) {
  const s = String(symbol || '').toUpperCase();
  if (/\bCE\b/.test(s)) return 'CE';
  if (/\bPE\b/.test(s)) return 'PE';
  return null;
}

function inferStrikeFromSymbol(symbol?: string | null) {
  const s = String(symbol || '');
  const match = s.match(/\b(\d+(?:\.\d+)?)\s+(?:CE|PE)\b/i);
  if (!match?.[1]) return null;
  const strike = Number(match[1]);
  return Number.isFinite(strike) ? strike : null;
}

function normalizeInstrument(item: InstrumentSearchItem): InstrumentSearchItem {
  const resolvedOptionType = item.optionType || inferOptionTypeFromSymbol(item.tradingSymbol);
  const directStrike = Number(item.strike);
  const resolvedStrike = Number.isFinite(directStrike) && directStrike > 0
    ? directStrike
    : inferStrikeFromSymbol(item.tradingSymbol);

  return {
    ...item,
    optionType: resolvedOptionType,
    strike: resolvedStrike,
  };
}

async function request(path: string, options: { method?: string; body?: unknown } = {}) {
  let response: Response;
  try {
    response = await fetch(`${APP_CONFIG.apiBase}${path}`, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "include",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Network request failed";
    throw new Error(`Network request failed. Check API URL: ${APP_CONFIG.apiBase} (${reason})`);
  }

  if (!response.ok) {
    let message = "Request failed";
    try {
      const data = await response.json();
      message = data?.message || message;
    } catch {
      // ignore json parse failure
    }
    throw new Error(message);
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function getMe() {
  const data = await request("/auth/me");
  return (data?.user || null) as AppUser | null;
}

export async function login(email: string, password: string, upstoxAccessToken = "") {
  const data = await request("/auth/login", {
    method: "POST",
    body: { email, password, upstoxAccessToken },
  });
  return data?.user as AppUser;
}

export async function signup(name: string, email: string, password: string) {
  const data = await request("/auth/signup", {
    method: "POST",
    body: { name, email, password },
  });
  return data?.user as AppUser;
}

export async function logout() {
  await request("/auth/logout", { method: "POST" });
}

export async function updateUpstoxToken(upstoxAccessToken: string) {
  return request("/auth/upstox-token", {
    method: "PUT",
    body: { upstoxAccessToken },
  });
}

export async function getWatchlist() {
  const data = await request("/watchlist");
  return (data?.watchlist || []) as WatchlistItem[];
}

export async function getMarketSnapshot() {
  const data = await request('/market/snapshot');
  return (data?.indices || []) as MarketIndexItem[];
}

export async function getMarketStatus() {
  const data = await request('/market/status');
  return (data || null) as MarketStatus | null;
}

export async function getBatchLtp(keys: string[]) {
  if (!keys.length) return {} as Record<string, any>;
  const params = new URLSearchParams();
  params.set('keys', keys.join(','));
  const data = await request(`/market/ltp?${params.toString()}`);
  return (data?.data || {}) as Record<string, any>;
}

export async function addToWatchlist(instrumentKey: string) {
  const data = await request("/watchlist", {
    method: "POST",
    body: { instrumentKey },
  });
  return (data?.watchlist || []) as string[];
}

export async function removeFromWatchlist(instrumentKey: string) {
  const data = await request(`/watchlist/${encodeURIComponent(instrumentKey)}`, {
    method: "DELETE",
  });
  return (data?.watchlist || []) as string[];
}

export async function searchInstruments(query: string, options: { segments?: string[]; limit?: number } = {}) {
  const params = new URLSearchParams();
  params.set("q", query);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.segments?.length) {
    params.set("segments", options.segments.join(","));
  }
  const data = await request(`/instruments/search?${params.toString()}`);
  return (data?.results || []) as InstrumentSearchItem[];
}

export async function searchOptionContracts(filters: OptionSearchFilters = {}) {
  const params = new URLSearchParams();

  if (filters.query) params.set('q', filters.query);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.segments?.length) params.set('segments', filters.segments.join(','));
  if (filters.underlying) params.set('underlying', filters.underlying);
  if (filters.expiryYear) params.set('expiryYear', String(filters.expiryYear));
  if (filters.expiryMonth) params.set('expiryMonth', String(filters.expiryMonth));
  if (filters.expiryDay) params.set('expiryDay', String(filters.expiryDay));
  if (filters.optionType && filters.optionType !== 'ALL') params.set('optionType', filters.optionType);
  if (filters.debug) params.set('debug', '1');

  const data = await request(`/instruments/search?${params.toString()}`);
  return ((data?.results || []) as InstrumentSearchItem[]).map(normalizeInstrument);
}

export async function getOptionFilterMeta(
  underlying: string,
  options: { segment?: string; debug?: boolean } = {}
) {
  const params = new URLSearchParams();
  params.set('underlying', underlying);
  params.set('segment', options.segment || 'NSE_FO');
  if (options.debug) params.set('debug', '1');

  const data = await request(`/instruments/options/meta?${params.toString()}`);
  return data as OptionFilterMeta;
}

export async function getOptionUnderlyings(options: { segment?: string; debug?: boolean } = {}) {
  const params = new URLSearchParams();
  params.set('segment', options.segment || 'NSE_FO');
  if (options.debug) params.set('debug', '1');

  const data = await request(`/instruments/options/underlyings?${params.toString()}`);
  return data as OptionUnderlyingMeta;
}
