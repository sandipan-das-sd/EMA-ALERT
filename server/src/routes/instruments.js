import express from 'express';
import { protect } from '../middleware/auth.js';
import { instrumentsSearchService } from '../services/instrumentsSearch.js';
import { getCandles15m, calculateEMA } from '../services/instruments.js';

const router = express.Router();

const normalizeToken = (value = '') => String(value).trim().toUpperCase();

const getUnderlyingToken = (instrument) => {
  const symbolToken = normalizeToken(instrument?.tradingSymbol).split(/\s+/)[0] || '';
  const nameToken = normalizeToken(instrument?.name).split(/\s+/)[0] || '';
  return symbolToken || nameToken || '';
};

const parseExpiryParts = (rawExpiry) => {
  if (!rawExpiry) return null;

  const asNumber = Number(rawExpiry);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;

  // Upstox expiry can be in seconds or milliseconds.
  const ms = asNumber > 1e12 ? asNumber : asNumber * 1000;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;

  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    ts: ms,
  };
};

const inferOptionType = (instrument) => {
  const direct = normalizeToken(instrument?.optionType);
  if (direct === 'CE' || direct === 'PE') return direct;

  const symbol = normalizeToken(instrument?.tradingSymbol);
  if (/\bCE\b/.test(symbol)) return 'CE';
  if (/\bPE\b/.test(symbol)) return 'PE';
  return null;
};

const inferStrike = (instrument) => {
  const direct = Number(instrument?.strike);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const symbol = String(instrument?.tradingSymbol || '');
  const m = symbol.match(/\b(\d+(?:\.\d+)?)\s+(?:CE|PE)\b/i);
  if (m && m[1]) {
    const fromSymbol = Number(m[1]);
    if (Number.isFinite(fromSymbol) && fromSymbol > 0) return fromSymbol;
  }

  return null;
};

const enrichInstrument = (instrument) => {
  const optionType = inferOptionType(instrument);
  const strike = inferStrike(instrument);

  return {
    ...instrument,
    optionType: optionType || instrument?.optionType || null,
    strike: strike ?? instrument?.strike ?? null,
  };
};

const instrumentMatchesFilters = (instrument, filters) => {
  if (!instrument) return false;

  if (filters.segments?.length && !filters.segments.includes(instrument.segment)) {
    return false;
  }

  if (filters.underlying) {
    const underlyingToken = getUnderlyingToken(instrument);
    if (underlyingToken !== filters.underlying) return false;
  }

  if (filters.optionType && filters.optionType !== 'ALL') {
    const optType = normalizeToken(instrument.optionType);
    const symbol = normalizeToken(instrument.tradingSymbol);
    const inferred = /\bPE\b/.test(symbol) ? 'PE' : /\bCE\b/.test(symbol) ? 'CE' : '';
    const resolved = optType || inferred;
    if (resolved !== filters.optionType) return false;
  }

  const expiry = parseExpiryParts(instrument.expiry);
  if (filters.expiryYear && (!expiry || expiry.year !== filters.expiryYear)) return false;
  if (filters.expiryMonth && (!expiry || expiry.month !== filters.expiryMonth)) return false;
  if (filters.expiryDay && (!expiry || expiry.day !== filters.expiryDay)) return false;

  if (filters.queryLower) {
    const haystack = [instrument.tradingSymbol, instrument.name, instrument.shortName, instrument.isin]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!haystack.includes(filters.queryLower)) return false;
  }

  return true;
};

// Search instruments
router.get('/search', protect, async (req, res) => {
  try {
    const {
      q: query,
      segments,
      limit,
      underlying,
      expiryYear,
      expiryMonth,
      expiryDay,
      optionType,
      debug,
    } = req.query;

    // Parse segments parameter
    let segmentFilter = ['NSE_EQ', 'NSE_FO', 'NSE_INDEX', 'BSE_EQ', 'BSE_FO', 'BSE_INDEX'];
    if (segments) {
      const requestedSegments = segments.split(',').map(s => s.trim());
      segmentFilter = requestedSegments.filter(s => segmentFilter.includes(s));
    }

    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 300));
    const normalizedUnderlying = normalizeToken(underlying);
    const normalizedOptionType = normalizeToken(optionType) || 'ALL';

    const filters = {
      segments: segmentFilter,
      underlying: normalizedUnderlying || null,
      expiryYear: Number.isFinite(parseInt(expiryYear, 10)) ? parseInt(expiryYear, 10) : null,
      expiryMonth: Number.isFinite(parseInt(expiryMonth, 10)) ? parseInt(expiryMonth, 10) : null,
      expiryDay: Number.isFinite(parseInt(expiryDay, 10)) ? parseInt(expiryDay, 10) : null,
      optionType: normalizedOptionType,
      queryLower: query && query.trim().length > 0 ? query.trim().toLowerCase() : null,
    };

    let sourceResults = [];

    if (filters.queryLower) {
      sourceResults = instrumentsSearchService.search(query.trim(), {
        segments: segmentFilter,
        limit: Math.max(safeLimit * 3, 100),
      });
    } else {
      sourceResults = Array.from(instrumentsSearchService.instruments.values());
    }

    const filtered = sourceResults
      .filter((instrument) => instrumentMatchesFilters(instrument, filters))
      .sort((a, b) => {
        const ae = parseExpiryParts(a.expiry)?.ts || 0;
        const be = parseExpiryParts(b.expiry)?.ts || 0;
        if (ae !== be) return ae - be;

        const as = Number(a.strike || 0);
        const bs = Number(b.strike || 0);
        if (Number.isFinite(as) && Number.isFinite(bs) && as !== bs) {
          return as - bs;
        }

        return String(a.tradingSymbol || '').localeCompare(String(b.tradingSymbol || ''));
      })
      .slice(0, safeLimit)
      .map((instrument) => enrichInstrument(instrument));

    if (String(debug) === '1') {
      console.log('[Instruments/search] Request:', {
        query,
        segments: segmentFilter,
        underlying: filters.underlying,
        expiryYear: filters.expiryYear,
        expiryMonth: filters.expiryMonth,
        expiryDay: filters.expiryDay,
        optionType: filters.optionType,
        limit: safeLimit,
      });
      console.log('[Instruments/search] Response sample:', filtered.slice(0, 5).map((i) => ({
        key: i.key,
        tradingSymbol: i.tradingSymbol,
        expiry: i.expiry,
        strike: i.strike,
        optionType: i.optionType,
      })));
    }

    res.json({
      results: filtered,
      totalFound: filtered.length,
      filters: {
        segments: segmentFilter,
        underlying: filters.underlying,
        expiryYear: filters.expiryYear,
        expiryMonth: filters.expiryMonth,
        expiryDay: filters.expiryDay,
        optionType: filters.optionType,
      },
    });
  } catch (error) {
    console.error('Instrument search error:', error);
    res.status(500).json({ message: 'Search failed' });
  }
});

// Get available underlying symbols for an F&O segment
router.get('/options/underlyings', protect, async (req, res) => {
  try {
    const { segment = 'NSE_FO', debug } = req.query;
    const normalizedSegment = String(segment).trim();

    const underlyings = new Set();
    for (const instrument of instrumentsSearchService.instruments.values()) {
      if (instrument.segment !== normalizedSegment) continue;
      const token = getUnderlyingToken(instrument);
      if (token) underlyings.add(token);
    }

    const results = Array.from(underlyings).sort((a, b) => a.localeCompare(b));

    if (String(debug) === '1') {
      console.log('[Instruments/options/underlyings] Response:', {
        segment: normalizedSegment,
        count: results.length,
        sample: results.slice(0, 20),
      });
    }

    res.json({
      segment: normalizedSegment,
      underlyings: results,
    });
  } catch (error) {
    console.error('Instrument underlyings error:', error);
    res.status(500).json({ message: 'Failed to load underlyings' });
  }
});

// Get available option filter values for a given underlying/segment
router.get('/options/meta', protect, async (req, res) => {
  try {
    const { underlying, segment = 'NSE_FO', debug } = req.query;
    const normalizedUnderlying = normalizeToken(underlying);
    const normalizedSegment = String(segment).trim();

    if (!normalizedUnderlying) {
      return res.status(400).json({ message: 'underlying is required' });
    }

    const years = new Set();
    const monthMap = new Map();
    const dayMap = new Map();

    const matches = [];
    for (const instrument of instrumentsSearchService.instruments.values()) {
      if (instrument.segment !== normalizedSegment) continue;

      const underlyingToken = getUnderlyingToken(instrument);
      if (underlyingToken !== normalizedUnderlying) continue;

      const expiry = parseExpiryParts(instrument.expiry);
      if (!expiry) continue;

      matches.push(instrument);
      years.add(expiry.year);

      if (!monthMap.has(expiry.year)) monthMap.set(expiry.year, new Set());
      monthMap.get(expiry.year).add(expiry.month);

      const ym = `${expiry.year}-${String(expiry.month).padStart(2, '0')}`;
      if (!dayMap.has(ym)) dayMap.set(ym, new Set());
      dayMap.get(ym).add(expiry.day);
    }

    const yearsArr = Array.from(years).sort((a, b) => a - b);
    const monthsByYear = {};
    for (const [year, months] of monthMap.entries()) {
      monthsByYear[year] = Array.from(months).sort((a, b) => a - b);
    }

    const daysByYearMonth = {};
    for (const [ym, days] of dayMap.entries()) {
      daysByYearMonth[ym] = Array.from(days).sort((a, b) => a - b);
    }

    if (String(debug) === '1') {
      console.log('[Instruments/options/meta] Request:', {
        underlying: normalizedUnderlying,
        segment: normalizedSegment,
      });
      console.log('[Instruments/options/meta] Response:', {
        count: matches.length,
        years: yearsArr,
      });
    }

    res.json({
      underlying: normalizedUnderlying,
      segment: normalizedSegment,
      matchCount: matches.length,
      years: yearsArr,
      monthsByYear,
      daysByYearMonth,
    });
  } catch (error) {
    console.error('Instrument options meta error:', error);
    res.status(500).json({ message: 'Failed to load option filters' });
  }
});

// Debug endpoint for EMA/candle calculation
router.get('/debug/ema/:instrumentKey', async (req, res) => {
  try {
    const instrumentKey = req.params.instrumentKey;
    // Fetch last 30 candles (for EMA-20)
    const candles = await getCandles15m(instrumentKey, 30);
    if (!candles || candles.length < 20) {
      return res.status(400).json({ error: 'Not enough candle data' });
    }
    // Calculate EMA-20
    const emaArr = calculateEMA(candles.map(c => c.close), 20);
    // Return candles and EMA array
    res.json({
      instrumentKey,
      candles,
      ema: emaArr,
      lastCandle: candles[candles.length - 1],
      lastEMA: emaArr[emaArr.length - 1]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get instrument details by key
router.get('/:instrumentKey', protect, async (req, res) => {
  try {
    const { instrumentKey } = req.params;
    const instrument = instrumentsSearchService.getInstrument(instrumentKey);
    
    if (!instrument) {
      return res.status(404).json({ message: 'Instrument not found' });
    }

    res.json({ instrument });
  } catch (error) {
    console.error('Get instrument error:', error);
    res.status(500).json({ message: 'Failed to get instrument' });
  }
});

// Get search service stats (for debugging/monitoring)
router.get('/stats', protect, async (req, res) => {
  try {
    const stats = instrumentsSearchService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Failed to get stats' });
  }
});

// Force refresh instruments (admin endpoint)
router.post('/refresh', protect, async (req, res) => {
  try {
    await instrumentsSearchService.updateInstruments();
    const stats = instrumentsSearchService.getStats();
    res.json({ message: 'Instruments refreshed successfully', stats });
  } catch (error) {
    console.error('Refresh instruments error:', error);
    res.status(500).json({ message: 'Failed to refresh instruments' });
  }
});

export default router;