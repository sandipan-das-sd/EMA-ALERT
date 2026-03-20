import User from '../models/User.js';

function parseAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin(req, res, next) {
  try {
    const authed = req.authUser || (await User.findById(req.user?.id).select('email role isActive'));
    if (!authed) return res.status(401).json({ message: 'Not authenticated' });
    if (authed.isActive === false) return res.status(403).json({ message: 'Account is deactivated' });

    const adminEmails = parseAdminEmails();
    const byRole = authed.role === 'admin';
    const byEmailAllowlist = adminEmails.includes(String(authed.email || '').toLowerCase());

    if (!byRole && !byEmailAllowlist) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    req.adminUser = authed;
    return next();
  } catch (e) {
    return res.status(500).json({ message: 'Admin validation failed' });
  }
}
