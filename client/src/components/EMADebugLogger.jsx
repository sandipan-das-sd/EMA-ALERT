import { useEffect } from 'react';
import { getWatchlist } from '../lib/api';

/**
 * Component that logs EMA calculation data to browser console
 * Shows real-time data for all watchlist instruments
 */
export function EMADebugLogger() {
  useEffect(() => {
    let stop = false;
    
    const fetchEMAData = async () => {
      if (stop) return;
      
      try {
        // Fetch user's watchlist
        const watchlist = await getWatchlist();
        
        if (!watchlist || watchlist.length === 0) {
          console.log('[EMA Debug] No instruments in watchlist');
          return;
        }
        
        console.log(`\n[EMA Debug] ===== ${new Date().toISOString()} =====`);
        console.log(`[EMA Debug] Watchlist instruments: ${watchlist.length}`);
        
        // Fetch EMA data for each instrument
        for (const item of watchlist) {
          try {
            const response = await fetch(
              `http://localhost:4000/api/instruments/debug/ema/${encodeURIComponent(item.key)}`,
              { credentials: 'include' }
            );
            
            if (response.ok) {
              const data = await response.json();
              
              // Log detailed EMA calculation
              console.log(`\n[EMA Debug] ${item.key}:`);
              console.log('  Last Candle:', {
                timestamp: new Date(data.lastCandle.timestamp).toISOString(),
                open: data.lastCandle.open,
                high: data.lastCandle.high,
                low: data.lastCandle.low,
                close: data.lastCandle.close,
                volume: data.lastCandle.volume
              });
              console.log('  EMA-20:', data.lastEMA);
              console.log('  Total Candles:', data.candles.length);
              console.log('  Last 5 Closes:', data.candles.slice(-5).map(c => c.close));
              console.log('  Last 5 EMAs:', data.ema.slice(-5));
              
              // Check for signal conditions
              const lastCandle = data.lastCandle;
              const isGreen = lastCandle.close > lastCandle.open;
              const touchesEMA = lastCandle.low <= data.lastEMA && lastCandle.high >= data.lastEMA;
              const prevClose = data.candles[data.candles.length - 2]?.close;
              const crossedUp = prevClose < data.lastEMA && lastCandle.close >= data.lastEMA;
              
              if (isGreen && (touchesEMA || crossedUp)) {
                console.log('  🎯 SIGNAL: Green candle crossed/touched EMA!');
              }
            } else {
              console.warn(`[EMA Debug] Failed to fetch data for ${item.key}: ${response.status}`);
            }
          } catch (err) {
            console.error(`[EMA Debug] Error fetching ${item.key}:`, err.message);
          }
        }
        
        console.log(`[EMA Debug] ===== END =====\n`);
      } catch (err) {
        console.error('[EMA Debug] Error fetching watchlist:', err);
      }
    };

    // Fetch immediately, then every 2 minutes
    fetchEMAData();
    const interval = setInterval(fetchEMAData, 120_000);

    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, []);

  return null; // This is a headless component
}
