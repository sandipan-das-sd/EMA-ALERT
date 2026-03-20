import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

dotenv.config();

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing in server environment');
  }

  const name = String(process.env.ADMIN_SEED_NAME || 'Admin User').trim();
  const email = String(process.env.ADMIN_SEED_EMAIL || 'admin@emaalert.local').trim().toLowerCase();
  const password = String(process.env.ADMIN_SEED_PASSWORD || 'Admin@12345');

  if (password.length < 8) {
    throw new Error('ADMIN_SEED_PASSWORD must be at least 8 characters');
  }

  await mongoose.connect(mongoUri);

  let user = await User.findOne({ email }).select('+password');
  if (!user) {
    user = new User({
      name,
      email,
      password,
      role: 'admin',
      isActive: true,
      phone: '',
      watchlist: [],
    });
  } else {
    user.name = name;
    user.password = password;
    user.role = 'admin';
    user.isActive = true;
  }

  await user.save();

  console.log('[Admin Seed] Admin user ready');
  console.log(`[Admin Seed] Email: ${email}`);
  console.log(`[Admin Seed] Password: ${password}`);

  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('[Admin Seed] Failed:', e.message);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  });
