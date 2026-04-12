import React, { useState } from 'react';
import { API_URL } from '../lib/api.js';

export default function InstrumentDebug() {
  const [isOpen, setIsOpen] = useState(false);
  const [popularInstruments, setPopularInstruments] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadPopularInstruments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/market/instruments/popular?limit=20`);
      const data = await res.json();
      setPopularInstruments(data.data || []);
    } catch (e) {
      console.error('Failed to load popular instruments:', e);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => { setIsOpen(true); loadPopularInstruments(); }}
        className="fixed bottom-4 right-4 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 z-50"
      >
        Debug Instruments
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 max-h-96 overflow-auto bg-white border border-gray-300 rounded-lg shadow-lg z-50">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-semibold text-sm">Instrument Debug</h3>
        <button 
          onClick={() => setIsOpen(false)}
          className="text-gray-500 hover:text-gray-700"
        >
          ✕
        </button>
      </div>
      <div className="p-3 space-y-2 text-xs">
        <div className="mb-3">
          <button
            onClick={loadPopularInstruments}
            disabled={loading}
            className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load Popular from BOD'}
          </button>
        </div>
        {popularInstruments.length > 0 && (
          <div>
            <h4 className="font-medium mb-2">Popular Instruments (BOD):</h4>
            <div className="space-y-1 max-h-60 overflow-auto">
              {popularInstruments.map(inst => (
                <div key={inst.symbol} className="p-2 border rounded bg-gray-50">
                  <div className="font-medium">{inst.symbol}</div>
                  <div className="text-gray-600 truncate">{inst.underlying}</div>
                  <div className="text-gray-500 font-mono text-xs">{inst.instrumentKey}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
          <strong>Debug Tips:</strong>
          <ul className="mt-1 space-y-1">
            <li>• Check server console for instrument resolution logs</li>
            <li>• Set DEBUG_UPSTOX=1 for verbose logging</li>
            <li>• Use LOG_UPSTOX_DEBUG=1 for WebSocket feed logs</li>
            <li>• Set USE_DYNAMIC_UNIVERSE=true to auto-load BOD data</li>
          </ul>
        </div>
      </div>
    </div>
  );
}