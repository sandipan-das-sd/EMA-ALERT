/**
 * Portfolio Routes — proxies Upstox portfolio APIs for the authenticated user.
 * GET /api/portfolio/funds        → Upstox GET /v2/user/get-funds-and-margin
 * GET /api/portfolio/profile      → Upstox GET /v2/user/profile
 * GET /api/portfolio/orders       → Upstox GET /v2/order/retrieve-all
 * GET /api/portfolio/positions    → Upstox GET /v2/portfolio/short-term-positions
 * GET /api/portfolio/holdings     → Upstox GET /v2/portfolio/long-term-holdings
 * GET /api/portfolio/order        → Upstox GET /v2/order/details?order_id=X
 * GET /api/portfolio/pnl/meta     → Upstox GET /v2/trade/profit-loss/metadata
 * GET /api/portfolio/pnl/data     → Upstox GET /v2/trade/profit-loss/data
 * GET /api/portfolio/pnl/charges  → Upstox GET /v2/trade/profit-loss/charges
 * GET /api/portfolio/brokerage    → Upstox GET /v2/charges/brokerage
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
// GET /api/portfolio/profile
// ------------------------------------------------------------------
router.get('/profile', protect, async (req, res) => {
  try {
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet('/user/profile', token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/portfolio/orders   (all orders for today)
// Note: /v2/order/history requires order_id or tag; use retrieve-all instead
// ------------------------------------------------------------------
router.get('/orders', protect, async (req, res) => {
  try {
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet('/order/retrieve-all', token);
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

// ------------------------------------------------------------------
// GET /api/portfolio/pnl/meta?segment=EQ&financial_year=2526[&from_date=&to_date=]
// ------------------------------------------------------------------
router.get('/pnl/meta', protect, async (req, res) => {
  try {
    const { segment, financial_year, from_date, to_date } = req.query;
    if (!segment || !financial_year) {
      return res.status(400).json({ message: 'segment and financial_year required' });
    }
    const qs = new URLSearchParams({ segment, financial_year });
    if (from_date) qs.set('from_date', from_date);
    if (to_date) qs.set('to_date', to_date);
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet(`/trade/profit-loss/metadata?${qs}`, token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/portfolio/pnl/data?segment=EQ&financial_year=2526&page_number=1&page_size=100[&from_date=&to_date=]
// ------------------------------------------------------------------
router.get('/pnl/data', protect, async (req, res) => {
  try {
    const { segment, financial_year, page_number = '1', page_size = '100', from_date, to_date } = req.query;
    if (!segment || !financial_year) {
      return res.status(400).json({ message: 'segment and financial_year required' });
    }
    const qs = new URLSearchParams({ segment, financial_year, page_number, page_size });
    if (from_date) qs.set('from_date', from_date);
    if (to_date) qs.set('to_date', to_date);
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet(`/trade/profit-loss/data?${qs}`, token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/portfolio/pnl/charges?segment=EQ&financial_year=2526[&from_date=&to_date=]
// ------------------------------------------------------------------
router.get('/pnl/charges', protect, async (req, res) => {
  try {
    const { segment, financial_year, from_date, to_date } = req.query;
    if (!segment || !financial_year) {
      return res.status(400).json({ message: 'segment and financial_year required' });
    }
    const qs = new URLSearchParams({ segment, financial_year });
    if (from_date) qs.set('from_date', from_date);
    if (to_date) qs.set('to_date', to_date);
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet(`/trade/profit-loss/charges?${qs}`, token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/portfolio/brokerage?instrument_token=X&quantity=10&product=I&transaction_type=BUY&price=100
// ------------------------------------------------------------------
router.get('/brokerage', protect, async (req, res) => {
  try {
    const { instrument_token, quantity, product, transaction_type, price } = req.query;
    if (!instrument_token || !quantity || !product || !transaction_type || !price) {
      return res.status(400).json({ message: 'instrument_token, quantity, product, transaction_type, price all required' });
    }
    const qs = new URLSearchParams({ instrument_token, quantity, product, transaction_type, price });
    const token = await getUserUpstoxToken(req.user.id);
    const data = await upstoxGet(`/charges/brokerage?${qs}`, token);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
