import express from 'express';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const UPSTOX_V2_BASE = process.env.UPSTOX_SANDBOX === 'true'
  ? 'https://api-sandbox.upstox.com/v2'
  : 'https://api.upstox.com/v2';

router.use(protect);

/**
 * POST /api/margin
 * Body: { instruments: [{ instrument_key, quantity, product, transaction_type, price? }] }
 * Returns: { required_margin, final_margin, margins: [...] }
 *
 * Proxies to Upstox POST /v2/charges/margin using the user's stored access token.
 * Max 20 instruments per request (Upstox limit).
 */
router.post('/', async (req, res) => {
  try {
    const { instruments } = req.body;
    if (!Array.isArray(instruments) || instruments.length === 0) {
      return res.status(400).json({ message: 'instruments array required' });
    }
    if (instruments.length > 20) {
      return res.status(400).json({ message: 'Max 20 instruments per request' });
    }

    // Validate each instrument entry
    for (const inst of instruments) {
      if (!inst.instrument_key || !inst.quantity || !inst.product || !inst.transaction_type) {
        return res.status(400).json({ message: 'Each instrument needs instrument_key, quantity, product, transaction_type' });
      }
      if (!['I', 'D', 'CO', 'MTF'].includes(inst.product)) {
        return res.status(400).json({ message: `Invalid product: ${inst.product}` });
      }
      if (!['BUY', 'SELL'].includes(inst.transaction_type)) {
        return res.status(400).json({ message: `Invalid transaction_type: ${inst.transaction_type}` });
      }
    }

    const user = await User.findById(req.user.id).select('+upstoxAccessToken');
    if (!user?.upstoxAccessToken) {
      return res.status(401).json({ message: 'Upstox token not configured' });
    }

    const upstoxRes = await fetch(`${UPSTOX_V2_BASE}/charges/margin`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user.upstoxAccessToken}`,
      },
      body: JSON.stringify({ instruments }),
    });

    const json = await upstoxRes.json();

    if (!upstoxRes.ok) {
      const msg = json?.errors?.[0]?.message || json?.message || `Upstox error ${upstoxRes.status}`;
      return res.status(upstoxRes.status).json({ message: msg });
    }

    // Return the data object directly
    res.json(json.data);
  } catch (e) {
    console.error('[Margin] Error:', e.message);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
