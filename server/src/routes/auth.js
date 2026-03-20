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
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email & password required' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already in use' });
    const user = await User.create({ name, email, password, phone: phone || '' });
  setTokenCookie(res, user._id.toString());
  res.status(201).json({ user: { id: user._id, name: user.name, email: user.email, phone: user.phone, watchlist: user.watchlist || [], hasUpstoxToken: false, role: user.role, isActive: user.isActive } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, upstoxAccessToken } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email & password required' });
    }
    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    if (user.isActive === false) return res.status(403).json({ message: 'Account is deactivated' });
    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
    user.lastLoginAt = new Date();
    
    // Update upstox access token if provided
    if (upstoxAccessToken !== undefined) {
      const nextToken = String(upstoxAccessToken || '').trim();
      const oldToken = String(user.upstoxAccessToken || '');
      const oldTokenLength = user.upstoxAccessToken?.length || 0;
      user.upstoxAccessToken = nextToken;
      await user.save();
      console.log(`[Login] User ${email} provided Upstox token (old: ${oldTokenLength} chars, new: ${nextToken?.length || 0} chars)`);
      
      // Emit event to trigger reconnection if token changed
      if (nextToken && nextToken !== oldToken) {
        try {
          const { serverEvents } = await import('../index.js');
          serverEvents.emit('upstox-token-updated', nextToken);
          console.log('[Login] Server reconnection event emitted');
        } catch (e) {
          console.warn('[Login] Could not emit reconnection event:', e.message);
        }
      }
    }
    
  setTokenCookie(res, user._id.toString());
  res.json({ user: { id: user._id, name: user.name, email: user.email, phone: user.phone || '', watchlist: user.watchlist || [], hasUpstoxToken: !!user.upstoxAccessToken, role: user.role, isActive: user.isActive } });
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

router.put('/upstox-token', async (req, res) => {
  try {
    const token = req.cookies[process.env.COOKIE_NAME];
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    
    const { verifyToken } = await import('../utils/jwt.js');
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    
    const { upstoxAccessToken } = req.body;
    const nextToken = String(upstoxAccessToken || '').trim();
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const oldToken = String(user.upstoxAccessToken || '');
    const oldTokenLength = user.upstoxAccessToken?.length || 0;
    user.upstoxAccessToken = nextToken;
    await user.save();
    
    console.log(`[Token Update] User ${user.email} updated Upstox token (old: ${oldTokenLength} chars, new: ${nextToken?.length || 0} chars)`);
    
    // Emit event to trigger reconnection
    if (nextToken && nextToken !== oldToken) {
      try {
        const { serverEvents } = await import('../index.js');
        serverEvents.emit('upstox-token-updated', nextToken);
        console.log('[Token Update] Server reconnection event emitted');
      } catch (e) {
        console.warn('[Token Update] Could not emit reconnection event:', e.message);
      }
    }
    
    res.json({ 
      message: 'Upstox token updated successfully. Server will reconnect with new token.', 
      hasUpstoxToken: !!user.upstoxAccessToken 
    });
  } catch (e) {
    console.error('[Token Update] Error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/phone', async (req, res) => {
  try {
    const token = req.cookies[process.env.COOKIE_NAME];
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    
    const { verifyToken } = await import('../utils/jwt.js');
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    
    const { phone } = req.body;
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ message: 'Phone number required' });
    }
    
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const oldPhone = user.phone;
    user.phone = String(phone).trim();
    await user.save();
    
    console.log(`[Phone Update] User ${user.email} updated phone (old: ${oldPhone || 'empty'}, new: ${user.phone})`);
    
    res.json({ 
      message: 'Phone number updated successfully',
      phone: user.phone
    });
  } catch (e) {
    console.error('[Phone Update] Error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/push-token', async (req, res) => {
  try {
    const token = req.cookies[process.env.COOKIE_NAME];
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    
    const { verifyToken } = await import('../utils/jwt.js');
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });
    
    const { pushToken } = req.body;
    if (!pushToken || !String(pushToken).trim()) {
      return res.status(400).json({ message: 'Push token required' });
    }
    
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const oldToken = user.pushToken ? user.pushToken.substring(0, 20) + '...' : 'none';
    user.pushToken = String(pushToken).trim();
    await user.save();
    
    console.log(`[Push Token] User ${user.email} registered push token (old: ${oldToken}, new: ${user.pushToken.substring(0, 20)}...)`);
    
    res.json({ 
      message: 'Push token registered successfully',
      pushToken: user.pushToken.substring(0, 20) + '...'
    });
  } catch (e) {
    console.error('[Push Token] Error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me', async (req, res) => {
  const token = req.cookies[process.env.COOKIE_NAME];
  if (!token) return res.status(200).json({ user: null });
  // Decoded in middleware would be cleaner; kept simple here
  import('../utils/jwt.js').then(({ verifyToken }) => {
    const decoded = verifyToken(token);
    if (!decoded) return res.status(200).json({ user: null });
      User.findById(decoded.id).select('+upstoxAccessToken').then((user) => {
        if (!user) return res.status(200).json({ user: null });
        if (user.isActive === false) return res.status(200).json({ user: null });
        res.json({ user: { id: user._id, name: user.name, email: user.email, phone: user.phone || '', watchlist: user.watchlist || [], hasUpstoxToken: !!user.upstoxAccessToken, role: user.role, isActive: user.isActive } });
    });
  });
});

export default router;
