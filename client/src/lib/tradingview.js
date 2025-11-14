/**
 * Converts internal instrument key format to TradingView symbol format
 * 
 * Examples:
 * - NSE_EQ|RELIANCE -> NSE:RELIANCE
 * - NSE_INDEX|Nifty 50 -> NSE:NIFTY
 * - NSE_FO|INFY24DECFUT -> NSE:INFY1!
 * - NSE_FO|NIFTY24NOV19900CE -> NSE:NIFTY241118C19900
 * - NSE_EQ|ASHOKLEY -> NSE:ASHOKLEY
 * - NSE_FO|ASHOKLEY24NOV70CE -> NSE:ASHOKLEY241125C70
 */

export function convertToTradingViewSymbol(instrumentKey, tradingSymbol = '', underlying = '') {
  console.log('[TradingView] Converting:', { instrumentKey, tradingSymbol, underlying });
  
  if (!instrumentKey) return '';

  // Split by | or : to get exchange and symbol parts
  const parts = instrumentKey.split(/[\|:]/);
  if (parts.length < 2) return instrumentKey;

  let [segment, symbol] = parts;
  
  // Check if symbol looks like an ISIN (INE followed by alphanumeric)
  // If so, prefer tradingSymbol or extract from underlying
  if (/^INE[A-Z0-9]{9}$/i.test(symbol)) {
    console.log('[TradingView] Detected ISIN, using tradingSymbol or underlying');
    if (tradingSymbol && tradingSymbol !== symbol) {
      symbol = tradingSymbol;
    } else if (underlying) {
      // Extract clean symbol from underlying (e.g., "RELIANCE INDUSTRIES LTD" -> "RELIANCE")
      const match = underlying.match(/^([A-Z0-9&]+)/);
      if (match) symbol = match[1];
    }
  }
  
  // If tradingSymbol is available and different from symbol, prefer it
  if (tradingSymbol && tradingSymbol !== symbol && !tradingSymbol.includes('INE')) {
    symbol = tradingSymbol;
  }
  
  // Extract exchange (NSE, BSE, etc.)
  const exchange = segment.split('_')[0];

  // Handle INDEX instruments
  if (segment.includes('INDEX')) {
    // Convert "Nifty 50" -> "NIFTY", "Nifty Bank" -> "NIFTYBANK"
    const indexName = symbol
      .replace(/\s+/g, '')
      .replace(/50$/i, '')
      .toUpperCase();
    const result = `${exchange}:${indexName}`;
    console.log('[TradingView] INDEX result:', result);
    return result;
  }

  // Handle EQUITY instruments
  if (segment.includes('EQ')) {
    // Clean up the symbol - remove any spaces, special chars
    let cleanSymbol = symbol.replace(/\s+/g, '').toUpperCase();
    
    // Remove common suffixes that might be in the symbol
    cleanSymbol = cleanSymbol.replace(/-EQ$/i, '').replace(/-BE$/i, '');
    
    // For NSE stocks, TradingView format is simply NSE:SYMBOL
    // But some stocks might need specific handling
    const result = `${exchange}:${cleanSymbol}`;
    console.log('[TradingView] EQUITY result:', result);
    return result;
  }

  // Handle FUTURES & OPTIONS (F&O)
  if (segment.includes('FO')) {
    // Use tradingSymbol if available for better parsing
    const tsUpper = (tradingSymbol || symbol).toUpperCase();
    
    // Check if it's a FUTURES contract
    if (tsUpper.includes('FUT')) {
      // Extract base symbol (everything before date or FUT)
      const baseSymbol = tsUpper
        .replace(/FUT.*$/i, '')
        .replace(/\d{2}[A-Z]{3}.*$/i, '')
        .trim();
      // For futures, TradingView uses "1!" suffix
      return `${exchange}:${baseSymbol}1!`;
    }

    // It's an OPTIONS contract
    // Parse: NIFTY24NOV19900CE or ASHOKLEY24NOV70CE
    const optionMatch = tsUpper.match(/^([A-Z]+?)(\d{2})([A-Z]{3})(\d+)(CE|PE)$/i);
    
    if (optionMatch) {
      const [, baseSymbol, year, monthCode, strike, optionType] = optionMatch;
      
      // Convert month code to numeric month
      const monthMap = {
        JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
        JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
      };
      const month = monthMap[monthCode.toUpperCase()] || '01';
      
      // Calculate day (approximate - TradingView uses expiry day)
      // For Nifty options, typically last Thursday
      // For stock options, typically last Thursday
      const day = calculateExpiryDay(year, month);
      
      // Convert CE/PE to C/P for TradingView
      const optType = optionType === 'CE' ? 'C' : 'P';
      
      // Format: NSE:NIFTY241118C19900
      return `${exchange}:${baseSymbol}${year}${month}${day}${optType}${strike}`;
    }

    // Fallback: if we can't parse, try to use as-is or simplify
    const cleanSymbol = tsUpper
      .replace(/\s+/g, '')
      .replace(/^NSE_FO[\|:]/, '');
    
    return `${exchange}:${cleanSymbol}`;
  }

  // Default fallback: NSE:SYMBOL
  const result = `${exchange}:${symbol}`;
  console.log('[TradingView] Final symbol:', result);
  return result;
}

/**
 * Calculate approximate expiry day for options
 * Most Indian options expire on last Thursday of the month
 */
function calculateExpiryDay(year, month) {
  const y = 2000 + parseInt(year);
  const m = parseInt(month);
  
  // Get last day of the month
  const lastDay = new Date(y, m, 0).getDate();
  
  // Find last Thursday
  let day = lastDay;
  const lastDate = new Date(y, m - 1, lastDay);
  const dayOfWeek = lastDate.getDay(); // 0 = Sunday, 4 = Thursday
  
  // If last day is not Thursday, go back to last Thursday
  if (dayOfWeek < 4) {
    day = lastDay - (dayOfWeek + 3);
  } else if (dayOfWeek > 4) {
    day = lastDay - (dayOfWeek - 4);
  }
  
  return String(day).padStart(2, '0');
}

/**
 * Get a display-friendly instrument name
 */
export function getInstrumentDisplayName(item) {
  if (item.underlying) {
    return item.underlying;
  }
  if (item.name && item.tradingSymbol !== item.name) {
    return item.name;
  }
  if (item.tradingSymbol) {
    return item.tradingSymbol;
  }
  if (item.symbol) {
    return item.symbol;
  }
  return 'Unknown Instrument';
}
