import { verifyToken } from '../utils/jwt.js';
import User from '../models/User.js';

export async function protect(req, res, next) {
  // Prefer cookie, but allow Authorization: Bearer fallback for cross-domain clients
  let token = req.cookies[process.env.COOKIE_NAME];
  const auth = req.headers.authorization;
  if (!token && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    token = auth.slice(7);
  }
  
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ message: 'Invalid token' });

  try {
    const user = await User.findById(decoded.id).select('name email role isActive');
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (user.isActive === false) return res.status(403).json({ message: 'Account is deactivated' });

    req.user = decoded;
    req.authUser = user;
  } catch (e) {
    return res.status(500).json({ message: 'Auth validation failed' });
  }

  next();
}
