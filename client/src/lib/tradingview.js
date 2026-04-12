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
 * - NSE_FO|NIFTY 26000 CE 02 DEC 25 -> NSE:NIFTY251202C26000
 */

export function convertToTradingViewSymbol(instrumentKey, tradingSymbol = '', underlying = '', expiry = '') {
  console.log('[TradingView] Converting:', { instrumentKey, tradingSymbol, underlying, expiry });
  
  if (!instrumentKey) return '';

  // Split by | or : to get exchange and symbol parts
  const parts = instrumentKey.split(/[\|:]/);
  if (parts.length < 2) return instrumentKey;

  let [segment, symbol] = parts;
  
  console.log('[TradingView] Parsed:', { segment, symbol });
  
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
    // Use tradingSymbol if available for better parsing, remove all spaces
    const tsUpper = (tradingSymbol || symbol).toUpperCase().replace(/\s+/g, '');
    
    console.log('[TradingView] F&O processing:', tsUpper);
    
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
    // Parse different formats:
    // Format 1: NIFTY25D0226000CE (new format) -> NSE:NIFTY251202C26000
    // Format 2: NIFTY24NOV19900CE (old format) -> NSE:NIFTY241128C19900
    // Format 3: NIFTY26000CE02DEC25 (alt format) -> NSE:NIFTY251202C26000
    
    // Handle variant: SYMBOL + STRIKE + CE/PE + DD + MON + YY
    // Example: NIFTY26000CE02DEC25 -> NSE:NIFTY251202C26000
    // Pattern: Letters, then digits (strike), then CE/PE, then 2 digits (day), then 3 letters (month), then 2 digits (year)
    const altFormatMatch = tsUpper.match(/^([A-Z]+?)(\d+)(CE|PE)(\d{2})([A-Z]{3})(\d{2})$/i);
    if (altFormatMatch) {
      const [, baseSymbol, strike, optionType, day, monthCode, year] = altFormatMatch;
      console.log('[TradingView] ALT format matched:', { baseSymbol, strike, optionType, day, monthCode, year });
      const monthMap = {
        JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
        JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
      };
      const mm = monthMap[monthCode.toUpperCase()] || '01';
      const optType = optionType === 'CE' ? 'C' : 'P';
      // Format: SYMBOL + YY + MM + DD + C/P + STRIKE
      const result = `${exchange}:${baseSymbol}${year}${mm}${day}${optType}${strike}`;
      console.log('[TradingView] ALT OPTION result:', result);
      return result;
    }

    // Try new format first: SYMBOL[YY]D[DD][STRIKE][CE/PE] (many instruments encode day only)
    const newFormatMatch = tsUpper.match(/^([A-Z]+?)(\d{2})D(\d{2})(\d+)(CE|PE)$/i);

    if (newFormatMatch) {
      const [, baseSymbol, year, dayOnly, strike, optionType] = newFormatMatch;

      // Convert CE/PE to C/P for TradingView
      const optType = optionType === 'CE' ? 'C' : 'P';

      // Prefer explicit expiry when available (from instrument.expiry)
      if (expiry) {
        const expDate = new Date(expiry);
        if (!isNaN(expDate.getTime())) {
          const yy = String(expDate.getFullYear()).slice(-2);
          const mm = String(expDate.getMonth() + 1).padStart(2, '0');
          const dd = String(expDate.getDate()).padStart(2, '0');
          return `${exchange}:${baseSymbol}${yy}${mm}${dd}${optType}${strike}`;
        }
      }

      // If expiry not available, we need to guess month — fall back to placing day in the middle
      // Format when expiry unknown: SYMBOL + YY + guessedMonth(01) + DD + C/P + STRIKE
      const guessedMonth = '01';
      return `${exchange}:${baseSymbol}${year}${guessedMonth}${dayOnly}${optType}${strike}`;
    }
    
    // Try old format: SYMBOL[YY][MONTH][STRIKE][CE/PE]
    const oldFormatMatch = tsUpper.match(/^([A-Z]+?)(\d{2})([A-Z]{3})(\d+)(CE|PE)$/i);
    
    if (oldFormatMatch) {
      const [, baseSymbol, year, monthCode, strike, optionType] = oldFormatMatch;
      
      // Convert month code to numeric month
      const monthMap = {
        JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
        JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
      };
      const month = monthMap[monthCode.toUpperCase()] || '01';
      
      // Calculate day (approximate - TradingView uses expiry day)
      const day = calculateExpiryDay(year, month);
      
      // Convert CE/PE to C/P for TradingView
      const optType = optionType === 'CE' ? 'C' : 'P';
      
      // Format: NSE:NIFTY241128C19900 (SYMBOL[YY][MM][DD][C/P][STRIKE])
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