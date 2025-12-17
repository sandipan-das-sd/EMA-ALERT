import { verifyToken } from '../utils/jwt.js';

export function protect(req, res, next) {
  // Prefer cookie, but allow Authorization: Bearer fallback for cross-domain clients
  let token = req.cookies[process.env.COOKIE_NAME];
  const auth = req.headers.authorization;
  if (!token && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    token = auth.slice(7);
  }
  
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ message: 'Invalid token' });
  req.user = decoded;
  next();
}
