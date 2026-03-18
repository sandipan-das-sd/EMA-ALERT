import { APP_CONFIG } from "@/lib/config";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  watchlist?: string[];
  hasUpstoxToken?: boolean;
}

async function request(path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${APP_CONFIG.apiBase}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

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
