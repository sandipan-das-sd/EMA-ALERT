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

export interface InstrumentSearchItem {
  key: string;
  tradingSymbol: string;
  name?: string;
  segment?: string;
  lotSize?: number;
  tickSize?: number;
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
