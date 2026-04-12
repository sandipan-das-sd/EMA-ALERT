import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, WS_URL } from '../lib/runtime-config';

async function api(path) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Request failed: ${response.status}`);
  return data;
}

function ist(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
}

function delay(from, to) {
  if (!from || !to) return '-';
  const s = Math.round((to - from) / 1000);
  if (s < 0) return '-';
  if (s <= 20) return `${s}s`;
  if (s <= 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function delayClass(from, to) {
  if (!from || !to) return '';
  const s = Math.round((to - from) / 1000);
  if (s <= 20) return 'delay-ok';
  if (s <= 60) return 'delay-warn';
  return 'delay-bad';
}

const LOG_LEVEL_COLORS = { info: '#38bdf8', warn: '#f59e0b', error: '#fb7185' };

export default function LogsPanel() {
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // Live logs
  const [liveLogs, setLiveLogs] = useState([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [logFilter, setLogFilter] = useState('');
  const wsRef = useRef(null);
  const logEndRef = useRef(null);
  const maxLogs = 500;

  // Alert filter
  const [alertFilter, setAlertFilter] = useState('all');

  // Load users for dropdown
  useEffect(() => {
    api('/admin/users?limit=200').then((d) => setUsers(d.users || [])).catch(() => {});
  }, []);

  // Load detailed logs for selected user
  const loadUserLogs = useCallback(async (userId) => {
    if (!userId) { setData(null); return; }
    setLoading(true);
    setError('');
    try {
      const d = await api(`/admin/users/${userId}/detailed-logs`);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUserLogs(selectedUserId);
  }, [selectedUserId, loadUserLogs]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!selectedUserId) return;
    const t = setInterval(() => loadUserLogs(selectedUserId), 15000);
    return () => clearInterval(t);
  }, [selectedUserId, loadUserLogs]);

  // WebSocket live logs
  useEffect(() => {
    if (!liveEnabled) {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      setLiveConnected(false);
      return;
    }

    let alive = true;
    let reconnectTimer = null;
    let attempt = 0;

    function connect() {
      if (!alive) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          attempt = 0;
          setLiveConnected(true);
          ws.send(JSON.stringify({ type: 'subscribe-logs' }));
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'server-log') {
              setLiveLogs((prev) => {
                const next = [...prev, msg];
                return next.length > maxLogs ? next.slice(-maxLogs) : next;
              });
            }
          } catch {}
        };

        ws.onerror = () => {};
        ws.onclose = () => {
          setLiveConnected(false);
          attempt++;
          const d = Math.min(1500 * Math.pow(1.5, attempt), 15000);
          reconnectTimer = setTimeout(connect, d);
        };
      } catch {
        setLiveConnected(false);
      }
    }

    connect();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    };
  }, [liveEnabled]);

  // Auto-scroll live logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveLogs]);

  const filteredLogs = logFilter
    ? liveLogs.filter((l) => l.message.toLowerCase().includes(logFilter.toLowerCase()))
    : liveLogs;

  const filteredAlerts = data?.alerts
    ? alertFilter === 'all'
      ? data.alerts
      : data.alerts.filter((a) => a.status === alertFilter)
    : [];

  return (
    <section className="panel logs-panel">
      {/* ─── USER SELECTOR ─── */}
      <div className="panel-head">
        <h2>Detailed User Logs</h2>
        <div className="search-wrap">
          <select
            className="user-picker"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">— Select User —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email}) {u.isActive ? '' : '[Inactive]'}
              </option>
            ))}
          </select>
          {selectedUserId && (
            <button className="ghost" onClick={() => loadUserLogs(selectedUserId)}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="hint">Loading user logs...</div>}

      {/* ─── USER PROFILE ─── */}
      {data?.user && (
        <div className="details-grid">
          <article className="card">
            <h3>User Profile</h3>
            <div className="log-kv-grid">
              <span className="kv-key">Name</span><span>{data.user.name}</span>
              <span className="kv-key">Email</span><span>{data.user.email}</span>
              <span className="kv-key">Phone</span><span>{data.user.phone || '-'}</span>
              <span className="kv-key">Role</span><span className={data.user.role === 'admin' ? 'tag-admin' : ''}>{data.user.role}</span>
              <span className="kv-key">Status</span><span className={data.user.isActive ? 'tag-active' : 'tag-inactive'}>{data.user.isActive ? 'Active' : 'Inactive'}</span>
              <span className="kv-key">Push Token</span><span className="cell-sub">{data.user.pushToken ? 'Set' : 'Missing'}</span>
              <span className="kv-key">Last Login</span><span>{ist(data.user.lastLoginAt)}</span>
              <span className="kv-key">Created</span><span>{ist(data.user.createdAt)}</span>
            </div>
          </article>

          <article className="card">
            <h3>Auto-Trade Config</h3>
            <div className="log-kv-grid">
              <span className="kv-key">Enabled</span>
              <span className={data.user.autoTrade?.enabled ? 'tag-active' : 'tag-inactive'}>
                {data.user.autoTrade?.enabled ? 'YES' : 'NO'}
              </span>
              <span className="kv-key">Default Qty</span><span>{data.user.autoTrade?.quantity ?? '-'}</span>
              <span className="kv-key">Default Product</span><span>{data.user.autoTrade?.product ?? '-'}</span>
            </div>
          </article>
        </div>
      )}

      {/* ─── WATCHLIST ─── */}
      {data?.watchlist?.length > 0 && (
        <>
          <h3 className="section-title">Watchlist ({data.watchlist.length} instruments)</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Instrument Key</th>
                  <th>Lots</th>
                  <th>Product</th>
                  <th>Direction</th>
                  <th>Target Pts</th>
                  <th>LTP</th>
                  <th>Change %</th>
                </tr>
              </thead>
              <tbody>
                {data.watchlist.map((w) => (
                  <tr key={w.key}>
                    <td className="cell-title mono">{w.key}</td>
                    <td>{w.lots}</td>
                    <td>{w.product}</td>
                    <td className={w.direction === 'BUY' ? 'tag-buy' : 'tag-sell'}>{w.direction}</td>
                    <td>{w.targetPoints || '1:1 R/R'}</td>
                    <td>{w.ltp != null ? w.ltp.toFixed(2) : '-'}</td>
                    <td className={w.changePct > 0 ? 'tag-buy' : w.changePct < 0 ? 'tag-sell' : ''}>
                      {w.changePct != null ? `${w.changePct.toFixed(2)}%` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── ACTIVE TRADES ─── */}
      {data?.activeTrades?.length > 0 && (
        <>
          <h3 className="section-title">
            Active Trades ({data.activeTrades.length})
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Status</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Initial SL</th>
                  <th>Trail SL</th>
                  <th>Target</th>
                  <th>Qty</th>
                  <th>Product</th>
                  <th>Order ID</th>
                  <th>Signal Time</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.activeTrades.map((t) => {
                  const riskPts = t.transactionType === 'BUY'
                    ? (t.entryPrice - t.initialSL).toFixed(2)
                    : (t.initialSL - t.entryPrice).toFixed(2);
                  const rewardPts = t.transactionType === 'BUY'
                    ? (t.target1 - t.entryPrice).toFixed(2)
                    : (t.entryPrice - t.target1).toFixed(2);
                  return (
                    <tr key={t.tradeKey}>
                      <td className="cell-title mono">{t.instrumentKey}</td>
                      <td>
                        <span className={t.status === 'in_trade' ? 'tag-active' : 'tag-pending'}>
                          {t.status}
                        </span>
                      </td>
                      <td className={t.transactionType === 'BUY' ? 'tag-buy' : 'tag-sell'}>
                        {t.transactionType}
                      </td>
                      <td>{t.entryPrice?.toFixed(2)}</td>
                      <td>{t.initialSL?.toFixed(2)}</td>
                      <td>{t.currentTrailSL?.toFixed(2)}</td>
                      <td>{t.target1?.toFixed(2)}</td>
                      <td>{t.quantity}</td>
                      <td>{t.product}</td>
                      <td className="cell-sub mono">{t.orderId}</td>
                      <td>{ist(t.signalTs)}</td>
                      <td>
                        {ist(t.createdAt)}
                        <div className="cell-sub">Risk: {riskPts} / Reward: {rewardPts}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── ALERT HISTORY ─── */}
      {data?.alerts && (
        <>
          <div className="section-head">
            <h3 className="section-title">
              EMA Crossover Alerts ({filteredAlerts.length})
            </h3>
            <div className="actions">
              {['all', 'active', 'dismissed'].map((f) => (
                <button
                  key={f}
                  className={alertFilter === f ? 'tab active' : 'tab'}
                  onClick={() => setAlertFilter(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Strategy</th>
                  <th>Candle Time</th>
                  <th>Open</th>
                  <th>High</th>
                  <th>Low</th>
                  <th>Close</th>
                  <th>EMA</th>
                  <th>Cross Detected</th>
                  <th>Notification Sent</th>
                  <th>Delay</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.map((a) => {
                  const candleTs = a.candle?.ts;
                  const candleEndTs = candleTs ? candleTs + 15 * 60 * 1000 : null;
                  const crossTs = a.crossDetectedAt ? new Date(a.crossDetectedAt).getTime() : null;
                  const notifTs = a.notificationSentAt ? new Date(a.notificationSentAt).getTime() : null;
                  const detectionDelay = candleEndTs && crossTs ? crossTs - candleEndTs : null;
                  const totalDelay = candleEndTs && notifTs ? notifTs - candleEndTs : null;
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="cell-title">{a.tradingSymbol || '-'}</div>
                        <div className="cell-sub mono">{a.instrumentKey}</div>
                      </td>
                      <td>{a.strategy}</td>
                      <td>{ist(candleTs)}</td>
                      <td>{a.candle?.open?.toFixed(2) ?? '-'}</td>
                      <td>{a.candle?.high?.toFixed(2) ?? '-'}</td>
                      <td>{a.candle?.low?.toFixed(2) ?? '-'}</td>
                      <td>{a.candle?.close?.toFixed(2) ?? '-'}</td>
                      <td>{a.ema?.toFixed(4) ?? '-'}</td>
                      <td>{ist(a.crossDetectedAt)}</td>
                      <td>{ist(a.notificationSentAt)}</td>
                      <td>
                        <span className={delayClass(0, detectionDelay)}>
                          {detectionDelay != null ? delay(0, detectionDelay) : '-'}
                        </span>
                        {totalDelay != null && totalDelay !== detectionDelay && (
                          <div className={`cell-sub ${delayClass(0, totalDelay)}`}>
                            total: {delay(0, totalDelay)}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={a.status === 'active' ? 'tag-active' : 'tag-dismissed'}>
                          {a.status}
                        </span>
                      </td>
                      <td>{ist(a.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.alerts.length === 0 && (
            <div className="hint">No alerts found for this user.</div>
          )}
        </>
      )}

      {/* ─── LIVE SERVER LOGS ─── */}
      <div className="live-logs-section">
        <div className="section-head">
          <h3 className="section-title">
            Live Server Logs
            <span className={liveConnected ? 'live-chip ok-chip' : 'live-chip err-chip'} style={{ marginLeft: 8, fontSize: 11 }}>
              {liveConnected ? 'LIVE' : 'OFFLINE'}
            </span>
          </h3>
          <div className="actions">
            <input
              className="log-filter"
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              placeholder="Filter logs (e.g. AlertEngine, AutoTrade)"
            />
            <button
              className={liveEnabled ? 'warn' : 'ok'}
              onClick={() => setLiveEnabled(!liveEnabled)}
            >
              {liveEnabled ? 'Pause' : 'Resume'}
            </button>
            <button className="ghost" onClick={() => setLiveLogs([])}>
              Clear
            </button>
          </div>
        </div>

        <div className="live-log-container">
          {filteredLogs.length === 0 && (
            <div className="hint" style={{ padding: 16 }}>
              {liveEnabled ? 'Waiting for server logs...' : 'Paused — click Resume to reconnect'}
            </div>
          )}
          {filteredLogs.map((log, i) => (
            <div key={i} className={`log-line log-${log.level}`}>
              <span className="log-ts">{new Date(log.ts).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}</span>
              <span className="log-level" style={{ color: LOG_LEVEL_COLORS[log.level] || '#999' }}>
                [{log.level?.toUpperCase()}]
              </span>
              <span className="log-msg">{log.message}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </section>
  );
}
