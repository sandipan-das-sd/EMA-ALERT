import React, { useEffect, useState } from 'react';
import { getAutoTradeSettings, updateAutoTradeSettings, updateUpstoxToken } from '../lib/api.js';

export default function Settings() {
  const [upstoxAccessToken, setUpstoxAccessToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-trade settings
  const [autoTrade, setAutoTrade] = useState({ enabled: false, quantity: 1, product: 'I' });
  const [atLoading, setAtLoading] = useState(false);
  const [atMessage, setAtMessage] = useState('');
  const [atError, setAtError] = useState('');

  useEffect(() => {
    getAutoTradeSettings().then(setAutoTrade).catch(() => {});
  }, []);

  async function handleAutoTradeSubmit(e) {
    e.preventDefault();
    setAtLoading(true);
    setAtMessage('');
    setAtError('');
    try {
      const saved = await updateAutoTradeSettings(autoTrade);
      setAutoTrade(saved);
      setAtMessage('Auto-trade settings saved.');
    } catch (err) {
      setAtError(err.message || 'Failed to save settings');
    } finally {
      setAtLoading(false);
    }
  }

  async function handleUpdateToken(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    
    try {
      console.log('[Settings] Updating Upstox access token...');
      const result = await updateUpstoxToken(upstoxAccessToken);
      console.log('[Settings] Token update response:', result);
      setMessage(result.message || 'Token updated successfully! Server is reconnecting...');
      setUpstoxAccessToken('');
    } catch (err) {
      console.error('[Settings] Token update error:', err);
      setError(err.message || 'Failed to update token');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      {/* ---- Auto-Trade Settings ---- */}
      <div className="card max-w-2xl">
        <h2 className="text-xl font-semibold mb-1">Auto-Trade (EMA Signal)</h2>
        <p className="text-sm text-slate-500 mb-4">
          When an EMA 20 cross fires, automatically place a DAY LIMIT BUY at the signal candle's high.
          Stop-loss = previous candle's low. Trailing SL ratchets to each 15m candle's high and exits via MARKET SELL when price hits trail SL.
          Requires a valid Upstox token.
        </p>

        {atMessage && <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">{atMessage}</div>}
        {atError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{atError}</div>}

        <form onSubmit={handleAutoTradeSubmit} className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium">Enable Auto-Trade</label>
              <span className="text-xs text-slate-500">Place orders automatically on every EMA signal</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={autoTrade.enabled}
                onChange={(e) => setAutoTrade(p => ({ ...p, enabled: e.target.checked }))}
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Quantity per Trade</label>
            <input
              type="number"
              min="1"
              className="input w-32"
              value={autoTrade.quantity}
              onChange={(e) => setAutoTrade(p => ({ ...p, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Product Type</label>
            <div className="flex gap-2">
              {[{ value: 'I', label: 'MIS (Intraday)' }, { value: 'D', label: 'CNC (Delivery)' }].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAutoTrade(p => ({ ...p, product: value }))}
                  className={`px-4 py-2 rounded border text-sm font-medium transition-colors ${
                    autoTrade.product === value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={atLoading}>
            {atLoading ? 'Saving...' : 'Save Auto-Trade Settings'}
          </button>
        </form>
      </div>

      {/* ---- Upstox Token ---- */}
      <div className="card max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">Upstox Configuration</h2>
        <p className="text-sm text-slate-600 mb-4">
          Enter your Upstox access token to enable real-time market data and alerts.
          You can get your access token from the Upstox API dashboard.
        </p>
        
        {message && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
            {message}
          </div>
        )}
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}
        
        <form onSubmit={handleUpdateToken} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Upstox Access Token
            </label>
            <input
              type="text"
              className="input"
              value={upstoxAccessToken}
              onChange={(e) => setUpstoxAccessToken(e.target.value)}
              placeholder="Paste your Upstox access token here"
              required
            />
          </div>
          
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !upstoxAccessToken.trim()}
          >
            {loading ? 'Updating...' : 'Update Token'}
          </button>
        </form>
        
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <h3 className="font-medium text-blue-900 mb-2">How to get your Upstox Access Token:</h3>
          <ol className="list-decimal list-inside text-sm text-blue-800 space-y-1">
            <li>Log in to your Upstox Developer account</li>
            <li>Navigate to the API Apps section</li>
            <li>Create or select your app</li>
            <li>Generate an access token</li>
            <li>Copy and paste the token above</li>
          </ol>
          <p className="text-xs text-blue-700 mt-2">
            Note: Access tokens typically expire after 24 hours. You'll need to update it daily.
          </p>
        </div>
        
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded">
          <h3 className="font-medium text-amber-900 mb-2">📌 Important:</h3>
          <ul className="list-disc list-inside text-sm text-amber-800 space-y-1">
            <li>The server will automatically reconnect when you update the token</li>
            <li>You should see a success message when reconnection is complete</li>
            <li>Check the browser console (F12) for connection details</li>
            <li>If you still see errors, verify your token is valid and not expired</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
