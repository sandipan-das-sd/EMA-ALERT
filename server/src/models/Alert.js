import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    instrumentKey: { type: String, index: true, required: true },
    segment: { type: String },
    tradingSymbol: { type: String },
    timeframe: { type: String, default: '15m' },
    strategy: { type: String, default: 'ema20_cross_up' },
    candle: {
      ts: { type: Number, required: true },
      open: Number,
      high: Number,
      low: Number,
      close: Number,
    },
    ema: { type: Number },
    crossDetectedAt: { type: Date }, // When the alert engine detected the cross
    notificationSentAt: { type: Date }, // When the notification was sent
    status: { type: String, enum: ['active', 'dismissed'], default: 'active', index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Prevent duplicates for same user/key/candle ts
alertSchema.index({ userId: 1, instrumentKey: 1, 'candle.ts': 1, strategy: 1 }, { unique: true });

export default mongoose.model('Alert', alertSchema);
