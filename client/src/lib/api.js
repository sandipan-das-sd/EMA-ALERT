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

export async function login(email, password) {
  const data = await request('/api/auth/login', { method: 'POST', body: { email, password } });
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
