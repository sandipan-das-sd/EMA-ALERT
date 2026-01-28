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
    let a = null;
    
    // Check if ID contains colons (synthetic ID format: mongoId:instrumentKey:timestamp)
    if (id.includes(':')) {
      const parts = id.split(':');
      const mongoId = parts[0]; // First part might be MongoDB _id
      const timestamp = parseInt(parts[parts.length - 1]);
      const instrumentKey = parts.slice(1, -1).join(':');
      
      // Try using the composite key (instrumentKey + timestamp)
      a = await Alert.findOneAndUpdate(
        { 
          userId: req.user.id,
          instrumentKey: instrumentKey,
          'candle.ts': timestamp
        }, 
        { $set: { status: 'dismissed' } }, 
        { new: true }
      );
      
      // If not found and first part looks like valid MongoDB ObjectId (24 hex chars)
      if (!a && /^[a-f0-9]{24}$/i.test(mongoId)) {
        a = await Alert.findOneAndUpdate(
          { _id: mongoId, userId: req.user.id }, 
          { $set: { status: 'dismissed' } }, 
          { new: true }
        );
      }
    } else if (/^[a-f0-9]{24}$/i.test(id)) {
      // Valid MongoDB ObjectId format
      a = await Alert.findOneAndUpdate(
        { _id: id, userId: req.user.id }, 
        { $set: { status: 'dismissed' } }, 
        { new: true }
      );
    }
    
    if (!a) return res.status(404).json({ message: 'Alert not found' });
    res.json({ alert: a });
  } catch (e) {
    console.error('[Alerts] Dismiss error:', e);
    res.status(500).json({ message: 'Failed to dismiss alert', error: e.message });
  }
});

export default router;
