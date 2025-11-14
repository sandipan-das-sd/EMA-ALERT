import express from 'express';
import { protect } from '../middleware/auth.js';
import { instrumentsSearchService } from '../services/instrumentsSearch.js';
import { getCandles15m, calculateEMA } from '../services/instruments.js';

const router = express.Router();

// Search instruments
router.get('/search', protect, async (req, res) => {
  try {
    const { q: query, segments, limit } = req.query;
    
    if (!query || query.trim().length === 0) {
      return res.json({ results: [] });
    }

    // Parse segments parameter
    let segmentFilter = ['NSE_EQ', 'NSE_FO', 'NSE_INDEX', 'BSE_EQ', 'BSE_FO', 'BSE_INDEX'];
    if (segments) {
      const requestedSegments = segments.split(',').map(s => s.trim());
      segmentFilter = requestedSegments.filter(s => segmentFilter.includes(s));
    }

    const results = instrumentsSearchService.search(query.trim(), {
      segments: segmentFilter,
      limit: parseInt(limit) || 50
    });

    res.json({ results });
  } catch (error) {
    console.error('Instrument search error:', error);
    res.status(500).json({ message: 'Search failed' });
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