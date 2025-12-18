import React, { useState } from 'react';
import { updateUpstoxToken } from '../lib/api.js';

export default function Settings() {
  const [upstoxAccessToken, setUpstoxAccessToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>
      
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
