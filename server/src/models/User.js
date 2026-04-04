import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
    },
    upstoxAccessToken: {
      type: String,
      default: '',
      select: false,
    },
    // Array of instrument keys like "NSE_EQ|ABB"
    watchlist: {
      type: [String],
      default: [],
    },
    // Phone number for Exotel voice alerts (e.g., +919876543210)
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    // Expo push token for real-time notifications
    pushToken: {
      type: String,
      default: '',
      trim: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    // Per-instrument lots preference for watchlist (instrumentKey → lots count)
    watchlistLots: {
      type: Map,
      of: Number,
      default: {},
    },
    // Auto-trade configuration
    autoTrade: {
      enabled: { type: Boolean, default: false },
      quantity: { type: Number, default: 1, min: 1 },
      product: { type: String, enum: ['I', 'D'], default: 'I' },
    },
    notes: [{
      title: {
        type: String,
        required: true,
        trim: true,
      },
      content: {
        type: String,
        required: true,
      },
      tags: [String],
      createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    }],
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model('User', userSchema);
