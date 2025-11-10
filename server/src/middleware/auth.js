import { verifyToken } from '../utils/jwt.js';

export function protect(req, res, next) {
  const token = req.cookies[process.env.COOKIE_NAME];
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ message: 'Invalid token' });
  req.user = decoded;
  next();
}
