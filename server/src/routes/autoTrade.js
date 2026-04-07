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

export default router;
