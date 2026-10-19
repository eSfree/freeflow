const bcrypt = require('bcryptjs');
const { db } = require('../db/connection');

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
}
function findUserById(id) {
  return db.prepare('SELECT id, email, full_name, role, created_at FROM users WHERE id = ?').get(id);
}
function createUser({ email, password, full_name, role }) {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, full_name, role) VALUES (?,?,?,?)')
    .run(String(email).toLowerCase().trim(), hash, full_name, role || 'member');
  return findUserById(info.lastInsertRowid);
}
function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}
function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

module.exports = { findUserByEmail, findUserById, createUser, verifyPassword, countUsers };
