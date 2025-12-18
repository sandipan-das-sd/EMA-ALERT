export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    let msg = 'Request failed';
    try {
      const data = await res.json();
      msg = data.message || msg;
    } catch {}
    throw new Error(msg);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function signup(name, email, password) {
  const data = await request('/api/auth/signup', { method: 'POST', body: { name, email, password } });
  return data.user;
}

export async function login(email, password, upstoxAccessToken = '') {
  const data = await request('/api/auth/login', { method: 'POST', body: { email, password, upstoxAccessToken } });
  return data.user;
}

export async function getMe() {
  try {
    const data = await request('/api/auth/me');
    return data?.user || null;
  } catch {
    // If backend is down or auth missing, treat as logged out
    return null;
  }
}

export async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore logout errors
  }
}

export async function updateUpstoxToken(upstoxAccessToken) {
  const data = await request('/api/auth/upstox-token', { method: 'PUT', body: { upstoxAccessToken } });
  return data;
}

// Watchlist APIs
export async function getWatchlist() {
  const data = await request('/api/watchlist');
  return data.watchlist || [];
}

export async function addToWatchlist(instrumentKey) {
  const data = await request('/api/watchlist', { method: 'POST', body: { instrumentKey } });
  return data.watchlist || [];
}

export async function removeFromWatchlist(instrumentKey) {
  const data = await request(`/api/watchlist/${encodeURIComponent(instrumentKey)}`, { method: 'DELETE' });
  return data.watchlist || [];
}

// Market status API
export async function marketStatus(exchange = 'NSE') {
  const data = await request(`/api/market/status?exchange=${encodeURIComponent(exchange)}`);
  return data; // { exchange, isOpen, statusText, httpStatus, raw, ts }
}

// Notes APIs
export async function getNotes() {
  const data = await request('/api/notes');
  return data.notes || [];
}

export async function createNote(title, content, tags = []) {
  const data = await request('/api/notes', { 
    method: 'POST', 
    body: { title, content, tags } 
  });
  return data.note;
}

export async function updateNote(noteId, title, content, tags) {
  const data = await request(`/api/notes/${noteId}`, {
    method: 'PUT',
    body: { title, content, tags }
  });
  return data.note;
}

export async function deleteNote(noteId) {
  await request(`/api/notes/${noteId}`, { method: 'DELETE' });
}

export async function searchNotes(query) {
  const data = await request(`/api/notes/search?q=${encodeURIComponent(query)}`);
  return data.notes || [];
}

// Instruments search
export async function searchInstruments(query, options = {}) {
  const { segments, limit = 50 } = options;
  const params = new URLSearchParams({ q: query, limit: limit.toString() });
  
  if (segments && segments.length > 0) {
    params.set('segments', segments.join(','));
  }
  
  const data = await request(`/api/instruments/search?${params.toString()}`);
  return data.results || [];
}

export async function getInstrument(instrumentKey) {
  const data = await request(`/api/instruments/${encodeURIComponent(instrumentKey)}`);
  return data.instrument || null;
}

export async function getInstrumentsStats() {
  return await request('/api/instruments/stats');
}

// Alerts APIs
export async function listAlerts({ status = 'active', since, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (since) params.set('since', String(since));
  if (limit) params.set('limit', String(limit));
  const data = await request(`/api/alerts?${params.toString()}`);
  return data.alerts || [];
}

export async function dismissAlert(id) {
  const data = await request(`/api/alerts/${encodeURIComponent(id)}/dismiss`, { method: 'PATCH' });
  return data.alert || null;
}
