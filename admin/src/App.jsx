import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import { API_BASE } from './lib/runtime-config';
import { useWsContext } from './contexts/ws-context.jsx';
import LogsPanel from './components/LogsPanel.jsx';

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    });
  } catch {
    throw new Error(`Failed to fetch API at ${API_BASE}`);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || `Request failed: ${response.status}`);
  }
  return data;
}

async function downloadCsv(path, filename) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.status}`);
  }
  const text = await response.text();
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

function humanizeInstrumentKey(key) {
  const raw = String(key || '').trim();
  if (!raw) return '';
  const parts = raw.split('|');
  if (parts.length >= 2) {
    return parts.slice(1).join(' | ').replace(/_/g, ' ').trim();
  }
  return raw.replace(/_/g, ' ').replace(/\|/g, ' ').trim();
}

function readableInstrumentName(input = {}) {
  const tradingSymbol = String(input.tradingSymbol || '').trim();
  if (tradingSymbol) return tradingSymbol;
  const name = String(input.name || '').trim();
  if (name) return name;
  const fromKey = humanizeInstrumentKey(input.instrumentKey || input.key);
  return fromKey || '-';
}

function App() {
  const ws = useWsContext();
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
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [bulkTokenCsv, setBulkTokenCsv] = useState('');

  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserRole, setNewUserRole] = useState('admin');

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
    setSelectedUserIds((prev) => prev.filter((id) => (data.users || []).some((u) => String(u.id) === String(id))));
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

  const toggleSelectedUser = (id, checked) => {
    setSelectedUserIds((prev) => {
      if (checked) return Array.from(new Set([...prev, id]));
      return prev.filter((x) => String(x) !== String(id));
    });
  };

  const toggleSelectAllVisible = (checked) => {
    if (!checked) {
      setSelectedUserIds([]);
      return;
    }
    setSelectedUserIds(users.map((u) => u.id));
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

  const bulkUpdateStatus = async (isActive) => {
    if (!selectedUserIds.length) {
      setError('Select at least one user for bulk status update');
      return;
    }
    try {
      await api('/admin/users/bulk-status', {
        method: 'PATCH',
        body: { userIds: selectedUserIds, isActive },
      });
      await refreshUsers();
      await refreshOverview();
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const bulkUpdateTokens = async () => {
    const lines = bulkTokenCsv
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      setError('Paste CSV lines in format: email,token');
      return;
    }

    const pairs = lines
      .map((line) => {
        const [left, ...rest] = line.split(',');
        const emailValue = String(left || '').trim().toLowerCase();
        const tokenValue = rest.join(',').trim();
        if (!emailValue) return null;
        return { email: emailValue, token: tokenValue };
      })
      .filter(Boolean);

    if (!pairs.length) {
      setError('No valid email,token lines found');
      return;
    }

    try {
      await api('/admin/users/bulk-tokens', {
        method: 'POST',
        body: { pairs },
      });
      await refreshUsers();
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const createUser = async (e) => {
    e.preventDefault();
    try {
      await api('/admin/users', {
        method: 'POST',
        body: {
          name: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          phone: newUserPhone,
          role: newUserRole,
        },
      });
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserPhone('');
      setNewUserRole('admin');
      await refreshUsers();
      await refreshOverview();
      setError('');
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
          <p className="hint">API: {API_BASE}</p>
        </div>
        <div className="actions">
          <span className={ws.connected ? 'live-chip ok-chip' : 'live-chip err-chip'}>
            {ws.connected ? 'WS Live' : 'WS Offline'}
          </span>
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
        <StatCard label="WS Alerts" value={ws.alertsReceived} hint="Live alerts from stream" />
        <StatCard label="WS Last Type" value={ws.latestType || '-'} hint="Latest stream event" />
        <StatCard
          label="WS Last Message"
          value={ws.lastMessageAt ? new Date(ws.lastMessageAt).toLocaleTimeString() : '-'}
          hint={ws.lastError ? `Err: ${ws.lastError}` : 'Stream heartbeat'}
        />
      </section>

      <nav className="tabs">
        {['users', 'alerts', 'logs', 'market'].map((t) => (
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
              <button className="ghost" onClick={() => downloadCsv('/admin/export/users.csv', 'admin-users.csv')}>Export Users CSV</button>
            </div>
          </div>

          <div className="bulk-toolbar">
            <label className="select-all">
              <input
                type="checkbox"
                checked={users.length > 0 && selectedUserIds.length === users.length}
                onChange={(e) => toggleSelectAllVisible(e.target.checked)}
              />
              Select all visible
            </label>
            <button className="ok" onClick={() => bulkUpdateStatus(true)}>Bulk Activate</button>
            <button className="warn" onClick={() => bulkUpdateStatus(false)}>Bulk Deactivate</button>
            <span className="panel-foot">Selected: {selectedUserIds.length}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
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
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(u.id)}
                        onChange={(e) => toggleSelectedUser(u.id, e.target.checked)}
                      />
                    </td>
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

          <div className="details-grid">
            <article className="card">
              <h3>Create User / Admin</h3>
              <form className="login-form" onSubmit={createUser}>
                <label>Name</label>
                <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Full name" />
                <label>Email</label>
                <input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="name@example.com" />
                <label>Password</label>
                <input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="Minimum 8 characters" />
                <label>Phone</label>
                <input value={newUserPhone} onChange={(e) => setNewUserPhone(e.target.value)} placeholder="Optional" />
                <label>Role</label>
                <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value)}>
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                </select>
                <button className="ok" type="submit">Create User</button>
              </form>
            </article>

            <article className="card">
              <h3>Bulk Upstox Token Update (CSV)</h3>
              <textarea
                rows={10}
                value={bulkTokenCsv}
                onChange={(e) => setBulkTokenCsv(e.target.value)}
                placeholder={'email,token\nuser1@mail.com,token1\nuser2@mail.com,token2'}
              />
              <div className="hint">Paste one email,token pair per line. Empty token clears token.</div>
              <button className="ok" onClick={bulkUpdateTokens}>Run Bulk Token Update</button>
            </article>
          </div>

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
            <div className="actions">
              <button className="ghost" onClick={refreshAlerts}>Refresh Alerts</button>
              <button className="ghost" onClick={() => downloadCsv('/admin/export/alerts.csv', 'admin-alerts.csv')}>Export Alerts CSV</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Instrument</th>
                  <th>Key</th>
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
                    <td>{readableInstrumentName(a)}</td>
                    <td className="cell-sub">{a.instrumentKey || '-'}</td>
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

      {tab === 'logs' && <LogsPanel />}

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
                  <th>Instrument</th>
                  <th>Key</th>
                  <th>LTP</th>
                  <th>Change %</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {(market?.sampleQuotes || []).map((q) => (
                  <tr key={q.key}>
                    <td>{readableInstrumentName(q)}</td>
                    <td className="cell-sub">{q.key || '-'}</td>
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
