/**
 * Portfolio Routes — proxies Upstox portfolio APIs for the authenticated user.
 * GET /api/portfolio/funds        → Upstox GET /v2/user/get-funds-and-margin
 * GET /api/portfolio/orders       → Upstox GET /v2/order/history
 * GET /api/portfolio/positions    → Upstox GET /v2/portfolio/short-term-positions
 * GET /api/portfolio/holdings     → Upstox GET /v2/portfolio/long-term-holdings
 * GET /api/portfolio/order        → Upstox GET /v2/order/details?order_id=X
 */

import express from 'express';
import fetch from 'node-fetch';
import { protect } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

const UPSTOX_V2_BASE = process.env.UPSTOX_SANDBOX === 'true'
  ? 'https://api-sandbox.upstox.com/v2'
  : 'https://api.upstox.com/v2';

// ------------------------------------------------------------------
// Helper: get the Upstox access token for the requesting user
// ------------------------------------------------------------------
async function getUserUpstoxToken(userId) {
  const user = await User.findById(userId).select('+upstoxAccessToken');
  if (!user || !user.upstoxAccessToken) {
    throw new Error('No Upstox access token found. Please connect your Upstox account in Settings.');
  }
  return user.upstoxAccessToken;
}

// ------------------------------------------------------------------
// Helper: forward a GET request to Upstox
// ------------------------------------------------------------------
async function upstoxGet(path, accessToken) {
  const url = `${UPSTOX_V2_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// ------------------------------------------------------------------
// GET /api/portfolio/funds
// ------------------------------------------------------------------
router.get('/funds', protect, async (req, res) => {
  try {
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet('/user/get-funds-and-margin', token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/portfolio/orders   (order history for today)
// ------------------------------------------------------------------
router.get('/orders', protect, async (req, res) => {
  try {
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet('/order/history', token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/portfolio/order?order_id=XXX  (single order details)
// ------------------------------------------------------------------
router.get('/order', protect, async (req, res) => {
  try {
    const { order_id } = req.query;
    if (!order_id) return res.status(400).json({ message: 'order_id required' });
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet(`/order/details?order_id=${encodeURIComponent(order_id)}`, token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/portfolio/positions
// ------------------------------------------------------------------
router.get('/positions', protect, async (req, res) => {
  try {
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet('/portfolio/short-term-positions', token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/portfolio/holdings
// ------------------------------------------------------------------
router.get('/holdings', protect, async (req, res) => {
  try {
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet('/portfolio/long-term-holdings', token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
