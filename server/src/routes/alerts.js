import express from 'express';
import { protect } from '../middleware/auth.js';
import Alert from '../models/Alert.js';

const router = express.Router();

router.use(protect);

// List alerts for the current user
router.get('/', async (req, res) => {
  try {
    const { status = 'active', since, limit = 50 } = req.query;
    const q = { userId: req.user.id };
    if (status) q.status = status;
    if (since) q.createdAt = { $gt: new Date(Number(since)) };
    const items = await Alert.find(q).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 50, 200));
    res.json({ alerts: items });
  } catch (e) {
    res.status(500).json({ message: 'Failed to list alerts' });
  }
});

// Dismiss an alert
router.patch('/:id/dismiss', async (req, res) => {
  try {
    const { id } = req.params;
    const a = await Alert.findOneAndUpdate({ _id: id, userId: req.user.id }, { $set: { status: 'dismissed' } }, { new: true });
    if (!a) return res.status(404).json({ message: 'Alert not found' });
    res.json({ alert: a });
  } catch (e) {
    res.status(500).json({ message: 'Failed to dismiss alert' });
  }
});

export default router;
