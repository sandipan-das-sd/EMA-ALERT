import express from 'express';
import { protect } from '../middleware/auth.js';
import { autoTradeService } from '../services/autoTradeService.js';

const router = express.Router();
router.use(protect);

// GET /api/auto-trade/active  — returns active trades for the authenticated user
router.get('/active', (req, res) => {
  const userId = req.user.id;
  const all = autoTradeService.getActiveTrades();
  const mine = all.filter(t => String(t.userId) === String(userId));
  res.json({ data: mine });
});

// POST /api/auto-trade/exit  — manually exit a trade by instrumentKey
router.post('/exit', async (req, res) => {
  const userId = req.user.id;
  const { instrumentKey } = req.body;
  if (!instrumentKey) return res.status(400).json({ message: 'instrumentKey is required' });
  try {
    await autoTradeService.manualExit(userId, instrumentKey);
    res.json({ message: 'Exit order placed successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
