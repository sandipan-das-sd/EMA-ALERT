import express from 'express';
import User from '../models/User.js';
import { signToken } from '../utils/jwt.js';

const router = express.Router();

function setTokenCookie(res, userId) {
  const token = signToken({ id: userId });
  const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const secure = (() => {
    const v = process.env.COOKIE_SECURE;
    if (typeof v === 'string') {
      return v === 'true' || v === '1';
    }
    return process.env.NODE_ENV === 'production';
  })();
  res.cookie(process.env.COOKIE_NAME || 'auth_token', token, {
    httpOnly: true,
    secure,
    sameSite: sameSite === 'none' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email & password required' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already in use' });
    const user = await User.create({ name, email, password });
  setTokenCookie(res, user._id.toString());
  res.status(201).json({ user: { id: user._id, name: user.name, email: user.email, watchlist: user.watchlist || [] } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email & password required' });
    }
    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
  setTokenCookie(res, user._id.toString());
  res.json({ user: { id: user._id, name: user.name, email: user.email, watchlist: user.watchlist || [] } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(process.env.COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ message: 'Logged out' });
});

router.get('/me', async (req, res) => {
  const token = req.cookies[process.env.COOKIE_NAME];
  if (!token) return res.status(200).json({ user: null });
  // Decoded in middleware would be cleaner; kept simple here
  import('../utils/jwt.js').then(({ verifyToken }) => {
    const decoded = verifyToken(token);
    if (!decoded) return res.status(200).json({ user: null });
      User.findById(decoded.id).then((user) => {
        if (!user) return res.status(200).json({ user: null });
        res.json({ user: { id: user._id, name: user.name, email: user.email, watchlist: user.watchlist || [] } });
    });
  });
});

export default router;
