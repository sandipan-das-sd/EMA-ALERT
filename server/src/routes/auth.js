import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import User from '../models/User.js';
import { signToken } from '../utils/jwt.js';
import { sendExpoPushNotification } from '../services/pushNotification.js';

const router = express.Router();

const UPSTOX_AUTH_DIALOG_URL = process.env.UPSTOX_AUTH_DIALOG_URL || 'https://api.upstox.com/v2/login/authorization/dialog';
const UPSTOX_TOKEN_URL = process.env.UPSTOX_TOKEN_URL || 'https://api.upstox.com/v2/login/authorization/token';
const UPSTOX_LOGOUT_URL = process.env.UPSTOX_LOGOUT_URL || 'https://api.upstox.com/v2/logout';
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;
const OAUTH_RESULT_TTL_MS = 5 * 60 * 1000;

// In-memory state store for OAuth handoff between mobile app and redirect callback.
const upstoxOAuthStateStore = new Map();

function getCookieName() {
  return process.env.COOKIE_NAME || 'auth_token';
}

function pruneUpstoxOAuthStates() {
  const now = Date.now();
  for (const [state, payload] of upstoxOAuthStateStore.entries()) {
    if (!payload || payload.expiresAt <= now) {
      upstoxOAuthStateStore.delete(state);
    }
  }
}

function getUpstoxOAuthConfig() {
  const clientId = String(process.env.UPSTOX_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.UPSTOX_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.UPSTOX_REDIRECT_URI || '').trim();
  return { clientId, clientSecret, redirectUri };
}

async function getAuthenticatedUser(req, options = {}) {
  const includeToken = options.includeToken === true;
  const token = getRequestToken(req);
  if (!token) {
    return { user: null, status: 401, message: 'Not authenticated' };
  }

  const { verifyToken } = await import('../utils/jwt.js');
  const decoded = verifyToken(token);
  if (!decoded) {
    return { user: null, status: 401, message: 'Invalid token' };
  }

  const query = includeToken ? User.findById(decoded.id).select('+upstoxAccessToken') : User.findById(decoded.id);
  const user = await query;
  if (!user) {
    return { user: null, status: 404, message: 'User not found' };
  }
  return { user, status: 200 };
}

async function exchangeUpstoxAuthCode({ code, clientId, clientSecret, redirectUri }) {
  const form = new URLSearchParams();
  form.set('code', code);
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
  form.set('redirect_uri', redirectUri);
  form.set('grant_type', 'authorization_code');

  const response = await fetch(UPSTOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { message: raw || 'Non-JSON response from Upstox' };
  }

  if (!response.ok) {
    const upstoxCode = String(data?.errors?.[0]?.errorCode || data?.errors?.[0]?.error_code || '').trim();
    const baseMessage = data?.errors?.[0]?.message || data?.message || `Token exchange failed (${response.status})`;
    const message = upstoxCode === 'UDAPI100016'
      ? 'Invalid Credentials from Upstox. Check client_id/client_secret pair, ensure redirect_uri exactly matches Upstox app settings, and retry with a fresh authorization code.'
      : baseMessage;
    const err = new Error(message);
    err.statusCode = response.status;
    err.upstoxResponse = data;
    throw err;
  }

  const accessToken = String(data?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('Upstox token exchange succeeded but access_token is missing');
  }

  return data;
}

function getRequestToken(req) {
  const cookieToken = req.cookies[getCookieName()];
  if (cookieToken) return cookieToken;

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return '';
}

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
  res.clearCookie(getCookieName(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ message: 'Logged out' });
});

router.get('/upstox/oauth/start', async (req, res) => {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth.user) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const { clientId, redirectUri } = getUpstoxOAuthConfig();
    if (!clientId || !redirectUri) {
      return res.status(500).json({
        message: 'Upstox OAuth is not configured on server',
        details: 'Missing UPSTOX_CLIENT_ID or UPSTOX_REDIRECT_URI',
      });
    }

    pruneUpstoxOAuthStates();

    const state = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + OAUTH_PENDING_TTL_MS;
    upstoxOAuthStateStore.set(state, {
      userId: String(auth.user._id),
      status: 'pending',
      expiresAt,
      createdAt: Date.now(),
      error: null,
    });

    const qs = new URLSearchParams();
    qs.set('response_type', 'code');
    qs.set('client_id', clientId);
    qs.set('redirect_uri', redirectUri);
    qs.set('state', state);

    res.json({
      authorizeUrl: `${UPSTOX_AUTH_DIALOG_URL}?${qs.toString()}`,
      state,
      expiresAt,
      redirectUri,
    });
  } catch (e) {
    console.error('[Upstox OAuth Start] Error:', e);
    res.status(500).json({ message: 'Failed to start Upstox OAuth', error: e.message });
  }
});

router.get('/upstox/oauth/callback', async (req, res) => {
  const state = String(req.query.state || '').trim();
  const code = String(req.query.code || '').trim();
  const error = String(req.query.error || '').trim();

  try {
    pruneUpstoxOAuthStates();

    if (!state || !upstoxOAuthStateStore.has(state)) {
      return res.status(400).send('<h2>Invalid or expired OAuth state.</h2><p>Please restart login from the app.</p>');
    }

    const statePayload = upstoxOAuthStateStore.get(state);
    if (!statePayload || statePayload.status !== 'pending') {
      return res.status(400).send('<h2>This OAuth request is already completed.</h2><p>Please return to the app.</p>');
    }

    if (error) {
      statePayload.status = 'error';
      statePayload.error = error;
      statePayload.expiresAt = Date.now() + OAUTH_RESULT_TTL_MS;
      upstoxOAuthStateStore.set(state, statePayload);
      return res.status(400).send(`<h2>Authorization denied</h2><p>${error}</p><p>Please return to the app.</p>`);
    }

    if (!code) {
      statePayload.status = 'error';
      statePayload.error = 'Missing authorization code';
      statePayload.expiresAt = Date.now() + OAUTH_RESULT_TTL_MS;
      upstoxOAuthStateStore.set(state, statePayload);
      return res.status(400).send('<h2>Missing authorization code.</h2><p>Please return to the app and retry.</p>');
    }

    const { clientId, clientSecret, redirectUri } = getUpstoxOAuthConfig();
    if (!clientId || !clientSecret || !redirectUri) {
      statePayload.status = 'error';
      statePayload.error = 'Server missing Upstox OAuth config';
      statePayload.expiresAt = Date.now() + OAUTH_RESULT_TTL_MS;
      upstoxOAuthStateStore.set(state, statePayload);
      return res.status(500).send('<h2>Server configuration error.</h2><p>Missing Upstox OAuth settings.</p>');
    }

    const tokenData = await exchangeUpstoxAuthCode({ code, clientId, clientSecret, redirectUri });
    const accessToken = String(tokenData?.access_token || '').trim();

    const user = await User.findById(statePayload.userId).select('+upstoxAccessToken email');
    if (!user) {
      statePayload.status = 'error';
      statePayload.error = 'User not found while saving Upstox token';
      statePayload.expiresAt = Date.now() + OAUTH_RESULT_TTL_MS;
      upstoxOAuthStateStore.set(state, statePayload);
      return res.status(404).send('<h2>User not found.</h2><p>Please login again and retry.</p>');
    }

    const previousToken = String(user.upstoxAccessToken || '').trim();
    user.upstoxAccessToken = accessToken;
    await user.save();

    if (accessToken && accessToken !== previousToken) {
      try {
        const { serverEvents } = await import('../index.js');
        serverEvents.emit('upstox-token-updated', accessToken);
      } catch (eventError) {
        console.warn('[Upstox OAuth Callback] Could not emit token update event:', eventError.message);
      }
    }

    statePayload.status = 'success';
    statePayload.error = null;
    statePayload.expiresAt = Date.now() + OAUTH_RESULT_TTL_MS;
    statePayload.completedAt = Date.now();
    upstoxOAuthStateStore.set(state, statePayload);

    return res.status(200).send('<h2>Upstox connected successfully.</h2><p>You can now return to the EMA Alert app.</p>');
  } catch (e) {
    const payload = upstoxOAuthStateStore.get(state);
    if (payload) {
      payload.status = 'error';
      payload.error = e.message || 'Token exchange failed';
      payload.expiresAt = Date.now() + OAUTH_RESULT_TTL_MS;
      upstoxOAuthStateStore.set(state, payload);
    }
    console.error('[Upstox OAuth Callback] Error:', e);
    return res.status(500).send(`<h2>OAuth failed.</h2><p>${e.message || 'Unknown error'}</p><p>Please return to the app and retry.</p>`);
  }
});

router.get('/upstox/oauth/status', async (req, res) => {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth.user) {
      return res.status(auth.status).json({ message: auth.message });
    }

    pruneUpstoxOAuthStates();
    const state = String(req.query.state || '').trim();
    if (!state) {
      return res.status(400).json({ message: 'State query parameter is required' });
    }

    const payload = upstoxOAuthStateStore.get(state);
    if (!payload) {
      return res.status(404).json({ status: 'expired', message: 'OAuth state not found or expired' });
    }

    if (payload.userId !== String(auth.user._id)) {
      return res.status(403).json({ message: 'OAuth state does not belong to this user' });
    }

    if (payload.status === 'pending') {
      return res.json({ status: 'pending', expiresAt: payload.expiresAt });
    }

    if (payload.status === 'success') {
      return res.json({ status: 'success', completedAt: payload.completedAt || Date.now() });
    }

    return res.status(400).json({ status: 'error', message: payload.error || 'OAuth failed' });
  } catch (e) {
    console.error('[Upstox OAuth Status] Error:', e);
    res.status(500).json({ message: 'Failed to fetch OAuth status', error: e.message });
  }
});

router.post('/upstox/logout', async (req, res) => {
  try {
    const auth = await getAuthenticatedUser(req, { includeToken: true });
    if (!auth.user) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const user = auth.user;
    const currentToken = String(user.upstoxAccessToken || '').trim();

    let upstoxStatus = null;
    if (currentToken) {
      try {
        const upstoxResponse = await fetch(UPSTOX_LOGOUT_URL, {
          method: 'DELETE',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${currentToken}`,
            'content-type': 'application/json',
          },
        });
        const raw = await upstoxResponse.text();
        upstoxStatus = {
          statusCode: upstoxResponse.status,
          ok: upstoxResponse.ok,
          body: raw || null,
        };
      } catch (logoutError) {
        upstoxStatus = {
          statusCode: 0,
          ok: false,
          body: logoutError.message || 'Failed to call Upstox logout',
        };
      }
    }

    user.upstoxAccessToken = '';
    await user.save();

    res.json({
      message: 'Upstox token cleared successfully',
      hasUpstoxToken: false,
      upstoxStatus,
    });
  } catch (e) {
    console.error('[Upstox Logout] Error:', e);
    res.status(500).json({ message: 'Failed to logout from Upstox', error: e.message });
  }
});

router.put('/upstox-token', async (req, res) => {
  try {
    const token = getRequestToken(req);
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
    const token = getRequestToken(req);
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
    const token = getRequestToken(req);
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

router.post('/push-test', async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) return res.status(401).json({ message: 'Not authenticated' });

    const { verifyToken } = await import('../utils/jwt.js');
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ message: 'Invalid token' });

    const user = await User.findById(decoded.id).select('email pushToken');
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.pushToken) return res.status(400).json({ message: 'No push token registered for this user' });

    const result = await sendExpoPushNotification(user.pushToken, {
      title: 'EMA Push Test',
      body: 'Test push delivered from server',
      data: {
        type: 'push_test',
        ts: new Date().toISOString(),
      },
    });

    if (result.success) {
      return res.json({ message: 'Test push sent', result });
    }

    return res.status(400).json({ message: 'Test push failed', result });
  } catch (e) {
    console.error('[Push Test] Error:', e);
    res.status(500).json({ message: 'Server error', error: e.message });
  }
});

router.get('/me', async (req, res) => {
  const token = getRequestToken(req);
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
