import express from 'express';
import User from '../models/User.js';
import Alert from '../models/Alert.js';
import { protect } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { marketState } from '../services/marketState.js';

const router = express.Router();

router.use(protect, requireAdmin);

router.get('/me', (req, res) => {
  const u = req.adminUser;
  res.json({
    user: {
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
    },
  });
});

router.get('/overview', async (req, res) => {
  try {
    const [totalUsers, activeUsers, adminUsers, alertsCount] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'admin' }),
      Alert.countDocuments({}),
    ]);

    const notesAgg = await User.aggregate([
      { $project: { notesCount: { $size: { $ifNull: ['$notes', []] } }, watchlistCount: { $size: { $ifNull: ['$watchlist', []] } } } },
      { $group: { _id: null, totalNotes: { $sum: '$notesCount' }, totalWatchlistItems: { $sum: '$watchlistCount' } } },
    ]);

    const totals = notesAgg[0] || { totalNotes: 0, totalWatchlistItems: 0 };

    res.json({
      totals: {
        totalUsers,
        activeUsers,
        inactiveUsers: Math.max(totalUsers - activeUsers, 0),
        adminUsers,
        alertsCount,
        notesCount: totals.totalNotes || 0,
        watchlistItemsCount: totals.totalWatchlistItems || 0,
      },
      market: {
        lastTicksCount: Object.keys(marketState.lastTicks || {}).length,
        latestQuotesCount: Object.keys(marketState.latestQuotes || {}).length,
      },
      ts: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load admin overview', error: e.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      User.find(filter)
        .select('+upstoxAccessToken name email phone role isActive watchlist pushToken lastLoginAt createdAt notes')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const users = items.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      phone: u.phone || '',
      role: u.role || 'user',
      isActive: u.isActive !== false,
      watchlistCount: Array.isArray(u.watchlist) ? u.watchlist.length : 0,
      notesCount: Array.isArray(u.notes) ? u.notes.length : 0,
      hasUpstoxToken: Boolean(u.upstoxAccessToken),
      pushToken: u.pushToken || '',
      lastLoginAt: u.lastLoginAt || null,
      createdAt: u.createdAt,
    }));

    res.json({
      users,
      page,
      limit,
      total,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load users', error: e.message });
  }
});

router.patch('/users/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive boolean is required' });
    }

    const user = await User.findById(id).select('name email role isActive');
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (String(user._id) === String(req.adminUser._id) && !isActive) {
      return res.status(400).json({ message: 'You cannot deactivate your own admin account' });
    }

    user.isActive = isActive;
    await user.save();
    res.json({ message: `User ${isActive ? 'activated' : 'deactivated'} successfully`, user: { id: user._id, isActive: user.isActive } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to update user status', error: e.message });
  }
});

router.patch('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const role = String(req.body.role || '').trim();
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'role must be user or admin' });
    }

    const user = await User.findById(id).select('name email role');
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (String(user._id) === String(req.adminUser._id) && role !== 'admin') {
      return res.status(400).json({ message: 'You cannot remove your own admin role' });
    }

    user.role = role;
    await user.save();
    res.json({ message: 'User role updated successfully', user: { id: user._id, role: user.role } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to update user role', error: e.message });
  }
});

router.put('/users/:id/upstox-token', async (req, res) => {
  try {
    const { id } = req.params;
    const token = String(req.body.upstoxAccessToken || '').trim();
    const user = await User.findById(id).select('+upstoxAccessToken email');
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.upstoxAccessToken = token;
    await user.save();

    res.json({
      message: token ? 'Upstox token updated' : 'Upstox token cleared',
      user: { id: user._id, hasUpstoxToken: Boolean(user.upstoxAccessToken) },
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to update Upstox token', error: e.message });
  }
});

router.get('/users/:id/watchlist', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('watchlist name email');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ userId: user._id, name: user.name, email: user.email, watchlist: user.watchlist || [] });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load watchlist', error: e.message });
  }
});

router.put('/users/:id/watchlist', async (req, res) => {
  try {
    const watchlist = Array.isArray(req.body.watchlist) ? req.body.watchlist.filter(Boolean).map((x) => String(x).trim()) : null;
    if (!watchlist) return res.status(400).json({ message: 'watchlist array is required' });

    const user = await User.findById(req.params.id).select('watchlist');
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.watchlist = Array.from(new Set(watchlist));
    await user.save();

    res.json({ message: 'Watchlist updated', watchlist: user.watchlist });
  } catch (e) {
    res.status(500).json({ message: 'Failed to update watchlist', error: e.message });
  }
});

router.get('/users/:id/notes', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('name email notes');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const notes = (user.notes || []).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ userId: user._id, name: user.name, email: user.email, notes });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load user notes', error: e.message });
  }
});

router.delete('/users/:userId/notes/:noteId', async (req, res) => {
  try {
    const { userId, noteId } = req.params;
    const user = await User.findById(userId).select('notes');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const idx = user.notes.findIndex((n) => String(n._id) === String(noteId));
    if (idx === -1) return res.status(404).json({ message: 'Note not found' });

    user.notes.splice(idx, 1);
    await user.save();
    res.json({ message: 'Note deleted successfully' });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete note', error: e.message });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const q = {};
    if (req.query.userId) q.userId = req.query.userId;
    if (req.query.status) q.status = String(req.query.status);

    const alerts = await Alert.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'name email')
      .lean();

    const rows = alerts.map((a) => ({
      id: a._id,
      userId: a.userId?._id || a.userId,
      userName: a.userId?.name || 'Unknown',
      userEmail: a.userId?.email || '',
      instrumentKey: a.instrumentKey,
      tradingSymbol: a.tradingSymbol || '',
      timeframe: a.timeframe,
      strategy: a.strategy,
      status: a.status,
      close: a.candle?.close,
      ema: a.ema,
      createdAt: a.createdAt,
    }));

    res.json({ alerts: rows });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load alerts', error: e.message });
  }
});

router.delete('/alerts/:id', async (req, res) => {
  try {
    const deleted = await Alert.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Alert not found' });
    res.json({ message: 'Alert deleted successfully' });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete alert', error: e.message });
  }
});

router.get('/market', (req, res) => {
  try {
    const quoteKeys = Object.keys(marketState.latestQuotes || {});
    const tickKeys = Object.keys(marketState.lastTicks || {});

    const sampleQuotes = quoteKeys.slice(0, 25).map((k) => ({
      key: k,
      ltp: marketState.latestQuotes[k]?.ltp ?? null,
      changePct: marketState.latestQuotes[k]?.changePct ?? null,
      ts: marketState.latestQuotes[k]?.ts ?? null,
    }));

    res.json({
      market: {
        totalQuotes: quoteKeys.length,
        totalTicks: tickKeys.length,
        sampleQuotes,
      },
      ts: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load market details', error: e.message });
  }
});

export default router;
