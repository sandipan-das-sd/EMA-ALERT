import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || `Request failed: ${response.status}`);
  }
  return data;
}

function StatCard({ label, value, hint }) {
  return (
    <article className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-hint">{hint}</div>
    </article>
  );
}

function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authUser, setAuthUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [tab, setTab] = useState('users');
  const [overview, setOverview] = useState(null);
  const [market, setMarket] = useState(null);

  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [alerts, setAlerts] = useState([]);

  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [watchlistDraft, setWatchlistDraft] = useState('');

  const banner = useMemo(() => {
    if (!error) return null;
    return <div className="banner error">{error}</div>;
  }, [error]);

  const refreshOverview = useCallback(async () => {
    const data = await api('/admin/overview');
    setOverview(data);
  }, []);

  const refreshUsers = useCallback(async () => {
    const data = await api(`/admin/users?search=${encodeURIComponent(search)}&limit=50`);
    setUsers(data.users || []);
    setUsersTotal(data.total || 0);
  }, [search]);

  const refreshAlerts = useCallback(async () => {
    const data = await api('/admin/alerts?limit=150');
    setAlerts(data.alerts || []);
  }, []);

  const refreshMarket = useCallback(async () => {
    const data = await api('/admin/market');
    setMarket(data.market || null);
  }, []);

  const loadUserDetails = useCallback(async (user) => {
    setSelectedUser(user);
    const [watchlistRes, notesRes] = await Promise.all([
      api(`/admin/users/${user.id}/watchlist`),
      api(`/admin/users/${user.id}/notes`),
    ]);
    const wl = watchlistRes.watchlist || [];
    setWatchlistDraft(wl.join('\n'));
    setSelectedNotes(notesRes.notes || []);
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([refreshOverview(), refreshUsers(), refreshAlerts(), refreshMarket()]);
  }, [refreshAlerts, refreshMarket, refreshOverview, refreshUsers]);

  const checkAdminSession = useCallback(async () => {
    try {
      const data = await api('/admin/me');
      setAuthUser(data.user || null);
      setError('');
      await loadAll();
    } catch {
      setAuthUser(null);
    }
  }, [loadAll]);

  useEffect(() => {
    checkAdminSession();
  }, [checkAdminSession]);

  useEffect(() => {
    if (!authUser) return;
    const t = setInterval(() => {
      refreshOverview();
      refreshMarket();
    }, 15000);
    return () => clearInterval(t);
  }, [authUser, refreshMarket, refreshOverview]);

  const login = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      await checkAdminSession();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      setAuthUser(null);
      setSelectedUser(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleUserActive = async (u) => {
    try {
      await api(`/admin/users/${u.id}/status`, { method: 'PATCH', body: { isActive: !u.isActive } });
      await refreshUsers();
      await refreshOverview();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleUserRole = async (u) => {
    try {
      await api(`/admin/users/${u.id}/role`, {
        method: 'PATCH',
        body: { role: u.role === 'admin' ? 'user' : 'admin' },
      });
      await refreshUsers();
      await refreshOverview();
    } catch (err) {
      setError(err.message);
    }
  };

  const setUserToken = async (u) => {
    const upstoxAccessToken = window.prompt(`Set Upstox token for ${u.email}`, '');
    if (upstoxAccessToken === null) return;
    try {
      await api(`/admin/users/${u.id}/upstox-token`, { method: 'PUT', body: { upstoxAccessToken } });
      await refreshUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveWatchlist = async () => {
    if (!selectedUser) return;
    const watchlist = watchlistDraft
      .split(/\n|,/)
      .map((x) => x.trim())
      .filter(Boolean);
    try {
      await api(`/admin/users/${selectedUser.id}/watchlist`, { method: 'PUT', body: { watchlist } });
      await loadUserDetails(selectedUser);
      await refreshUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteNote = async (noteId) => {
    if (!selectedUser) return;
    try {
      await api(`/admin/users/${selectedUser.id}/notes/${noteId}`, { method: 'DELETE' });
      await loadUserDetails(selectedUser);
      await refreshOverview();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteAlert = async (id) => {
    try {
      await api(`/admin/alerts/${id}`, { method: 'DELETE' });
      await refreshAlerts();
      await refreshOverview();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!authUser) {
    return (
      <main className="shell login-shell">
        <section className="login-card">
          <h1>EMA Admin Console</h1>
          <p className="sub">Manage users, tokens, watchlists, notes, alerts and live market diagnostics.</p>
          {banner}
          <form onSubmit={login} className="login-form">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" />
            <button disabled={busy} type="submit">{busy ? 'Signing in...' : 'Sign In as Admin'}</button>
          </form>
          <p className="hint">Tip: Set ADMIN_EMAILS in server env for admin access allowlist.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>EMA Admin Console</h1>
          <p className="sub">{authUser.name} · {authUser.email}</p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={loadAll}>Refresh</button>
          <button className="danger" onClick={logout}>Logout</button>
        </div>
      </header>

      {banner}

      <section className="stats-grid">
        <StatCard label="Total Users" value={overview?.totals?.totalUsers ?? '-'} hint="All registered users" />
        <StatCard label="Active Users" value={overview?.totals?.activeUsers ?? '-'} hint="Can login and receive alerts" />
        <StatCard label="Alerts Logged" value={overview?.totals?.alertsCount ?? '-'} hint="Global alert history" />
        <StatCard label="Watchlist Items" value={overview?.totals?.watchlistItemsCount ?? '-'} hint="Across all users" />
        <StatCard label="Notes" value={overview?.totals?.notesCount ?? '-'} hint="All user notes" />
        <StatCard label="Live Quotes" value={market?.totalQuotes ?? '-'} hint="Market cache diagnostics" />
      </section>

      <nav className="tabs">
        {['users', 'alerts', 'market'].map((t) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      {tab === 'users' && (
        <section className="panel">
          <div className="panel-head">
            <h2>User Management</h2>
            <div className="search-wrap">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email or phone"
              />
              <button className="ghost" onClick={refreshUsers}>Search</button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Token</th>
                  <th>Watchlist</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="cell-title">{u.name}</div>
                      <div className="cell-sub">{u.email}</div>
                    </td>
                    <td>{u.role}</td>
                    <td>{u.isActive ? 'Active' : 'Inactive'}</td>
                    <td>{u.hasUpstoxToken ? 'Set' : 'Missing'}</td>
                    <td>{u.watchlistCount}</td>
                    <td>{u.notesCount}</td>
                    <td>
                      <div className="row-actions">
                        <button className="ghost" onClick={() => loadUserDetails(u)}>View</button>
                        <button className="ghost" onClick={() => setUserToken(u)}>Token</button>
                        <button className="ghost" onClick={() => toggleUserRole(u)}>{u.role === 'admin' ? 'Make User' : 'Make Admin'}</button>
                        <button className={u.isActive ? 'warn' : 'ok'} onClick={() => toggleUserActive(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-foot">Showing {users.length} of {usersTotal} users</div>

          {selectedUser && (
            <div className="details-grid">
              <article className="card">
                <h3>{selectedUser.name} Watchlist</h3>
                <textarea
                  rows={10}
                  value={watchlistDraft}
                  onChange={(e) => setWatchlistDraft(e.target.value)}
                />
                <div className="hint">One key per line or comma-separated.</div>
                <button className="ok" onClick={saveWatchlist}>Save Watchlist</button>
              </article>

              <article className="card">
                <h3>{selectedUser.name} Notes ({selectedNotes.length})</h3>
                <ul className="notes-list">
                  {selectedNotes.map((n) => (
                    <li key={n._id}>
                      <div>
                        <div className="cell-title">{n.title}</div>
                        <div className="cell-sub">{new Date(n.updatedAt || n.createdAt).toLocaleString()}</div>
                      </div>
                      <button className="danger" onClick={() => deleteNote(n._id)}>Delete</button>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          )}
        </section>
      )}

      {tab === 'alerts' && (
        <section className="panel">
          <div className="panel-head">
            <h2>Alert Logs</h2>
            <button className="ghost" onClick={refreshAlerts}>Refresh Alerts</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Instrument</th>
                  <th>Strategy</th>
                  <th>Status</th>
                  <th>Time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="cell-title">{a.userName}</div>
                      <div className="cell-sub">{a.userEmail}</div>
                    </td>
                    <td>{a.tradingSymbol || a.instrumentKey}</td>
                    <td>{a.strategy}</td>
                    <td>{a.status}</td>
                    <td>{new Date(a.createdAt).toLocaleString()}</td>
                    <td><button className="danger" onClick={() => deleteAlert(a.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-foot">Total alerts loaded: {alerts.length}</div>
        </section>
      )}

      {tab === 'market' && (
        <section className="panel">
          <div className="panel-head">
            <h2>Market Diagnostics</h2>
            <button className="ghost" onClick={refreshMarket}>Refresh Market</button>
          </div>

          <div className="stats-grid compact">
            <StatCard label="Quote Keys" value={market?.totalQuotes ?? 0} hint="latestQuotes cache" />
            <StatCard label="Tick Keys" value={market?.totalTicks ?? 0} hint="lastTicks cache" />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Instrument Key</th>
                  <th>LTP</th>
                  <th>Change %</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {(market?.sampleQuotes || []).map((q) => (
                  <tr key={q.key}>
                    <td>{q.key}</td>
                    <td>{typeof q.ltp === 'number' ? q.ltp.toFixed(2) : '-'}</td>
                    <td>{typeof q.changePct === 'number' ? `${q.changePct.toFixed(2)}%` : '-'}</td>
                    <td>{q.ts ? new Date(q.ts).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
