import mongoose from 'mongoose';

const activeTradeSchema = new mongoose.Schema({
  tradeKey:         { type: String, required: true, unique: true }, // `${userId}:${instrumentKey}`
  userId:           { type: String, required: true },
  instrumentKey:    { type: String, required: true },
  orderId:          { type: String, required: true },
  status:           { type: String, default: 'pending_entry' }, // pending_entry | in_trade
  transactionType:  { type: String, required: true },           // BUY | SELL
  entryPrice:       { type: Number, required: true },
  initialSL:        { type: Number, required: true },
  currentTrailSL:   { type: Number, required: true },
  target1:          { type: Number, required: true },
  quantity:         { type: Number, required: true },
  product:          { type: String, required: true },
  signalTs:         { type: Number, default: 0 },
  lastCandleTs:     { type: Number, default: 0 },
  createdAt:        { type: Number, default: Date.now },
}, { versionKey: false });

export default mongoose.model('ActiveTradeState', activeTradeSchema);
