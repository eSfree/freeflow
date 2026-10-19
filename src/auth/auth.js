const express = require('express');
const session = require('express-session');
const { findUserByEmail, findUserById, createUser, verifyPassword, countUsers } = require('./users');

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, full_name: u.full_name, role: u.role };
}

function sessionMiddleware() {
  return session({
    secret: process.env.SESSION_SECRET || 'projectflow-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 }
  });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Authentication required' });
  const u = findUserById(req.session.userId);
  if (!u) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Session invalid' }); }
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

router.post('/register', (req, res) => {
  const { email, password, full_name, role } = req.body || {};
  if (!email || !password || !full_name) return res.status(400).json({ error: 'email, password, full_name required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password min 6 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ error: 'Invalid email' });
  if (findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });
  // Only allow role selection to admin if no admin exists yet; otherwise force member.
  const isFirst = countUsers() === 0;
  const finalRole = isFirst ? (role === 'admin' ? 'admin' : 'admin') : 'member';
  const user = createUser({ email, password, full_name, role: finalRole });
  req.session.userId = user.id;
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = findUserByEmail(email || '');
  if (!user || !verifyPassword(user, password || '')) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ user: null });
  res.json({ user: publicUser(findUserById(req.session.userId)) });
});

module.exports = { router, sessionMiddleware, requireAuth, requireAdmin, publicUser };
