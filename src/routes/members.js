const express = require('express');
const { db } = require('../db/connection');
const { requireAuth, requireAdmin } = require('../auth/auth');

const router = express.Router();
router.use(requireAuth);

function isAdmin(req) { return req.user && req.user.role === 'admin'; }

// ---- Team members ----
router.get('/members', (req, res) => {
  const { q = '', active = '' } = req.query;
  let sql = 'SELECT * FROM team_members WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (full_name LIKE ? OR email LIKE ? OR position LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (active !== '') { sql += ' AND is_active = ?'; params.push(active === 'true' ? 1 : 0); }
  sql += ' ORDER BY full_name';
  const members = db.prepare(sql).all(...params);
  // hide salary from non-admins
  const safe = members.map((m) => {
    const { salary, ...rest } = m;
    return isAdmin(req) ? m : rest;
  });
  res.json({ members: safe });
});

router.get('/members/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  if (!isAdmin(req)) delete m.salary;
  const assignments = db.prepare(
    `SELECT a.*, t.name AS task_name, t.project_id, t.start_date, t.end_date, t.duration, t.status
     FROM task_assignments a JOIN tasks t ON t.id = a.task_id WHERE a.member_id = ?`
  ).all(m.id);
  const leaves = db.prepare('SELECT * FROM member_leaves WHERE member_id = ? ORDER BY start_date DESC').all(m.id);
  const totalAllocation = assignments.reduce((s, a) => s + (a.allocation_pct || 0), 0);
  res.json({ member: m, assignments, leaves, workload: { open_assignments: assignments.filter((a) => a.status !== 'completed').length, total_allocation_pct: totalAllocation } });
});

router.post('/members', requireAdmin, (req, res) => {
  const { full_name, email, phone, position, salary, joined_at } = req.body || {};
  if (!full_name || !email) return res.status(400).json({ error: 'full_name and email required' });
  const info = db.prepare(
    'INSERT INTO team_members (full_name,email,phone,position,salary,joined_at) VALUES (?,?,?,?,?,?)'
  ).run(full_name, email, phone || '', position || '', salary != null ? Number(salary) : null, joined_at || null);
  res.status(201).json({ member: db.prepare('SELECT * FROM team_members WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/members/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  const merged = { ...m, ...req.body };
  db.prepare(
    `UPDATE team_members SET full_name=?,email=?,phone=?,position=?,salary=?,is_active=?,joined_at=?,updated_at=datetime('now') WHERE id=?`
  ).run(merged.full_name, merged.email, merged.phone || '', merged.position || '',
    merged.salary != null ? Number(merged.salary) : null, merged.is_active ? 1 : 0, merged.joined_at || null, m.id);
  res.json({ member: db.prepare('SELECT * FROM team_members WHERE id = ?').get(m.id) });
});

// Deactivate instead of hard delete when assignments exist
router.delete('/members/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  const assignments = db.prepare('SELECT COUNT(*) c FROM task_assignments WHERE member_id = ?').get(m.id).c;
  if (assignments > 0 && req.query.force !== '1') {
    return res.status(409).json({ error: `Member has ${assignments} assignment(s). Deactivate instead, or force delete.`, needs_confirmation: true });
  }
  db.prepare('DELETE FROM team_members WHERE id = ?').run(m.id);
  res.json({ ok: true });
});

// ---- Leaves ----
router.get('/members/:id/leaves', (req, res) => {
  res.json({ leaves: db.prepare('SELECT * FROM member_leaves WHERE member_id = ? ORDER BY start_date DESC').all(req.params.id) });
});

router.post('/members/:id/leaves', (req, res) => {
  const m = db.prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  if (!isAdmin(req)) {
    // members can only request leave for themselves if linked
    if (m.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
  }
  const { start_date, end_date, type, notes } = req.body || {};
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });
  if (end_date < start_date) return res.status(400).json({ error: 'end_date must be on/after start_date' });
  const status = isAdmin(req) ? 'approved' : 'pending';
  const info = db.prepare('INSERT INTO member_leaves (member_id,start_date,end_date,type,notes,status) VALUES (?,?,?,?,?,?)')
    .run(m.id, start_date, end_date, type || 'annual', notes || '', status);
  res.status(201).json({ leave: db.prepare('SELECT * FROM member_leaves WHERE id = ?').get(info.lastInsertRowid), conflicts: checkLeaveConflicts(m.id) });
});

router.put('/leaves/:lid', requireAdmin, (req, res) => {
  const l = db.prepare('SELECT * FROM member_leaves WHERE id = ?').get(req.params.lid);
  if (!l) return res.status(404).json({ error: 'Leave not found' });
  const merged = { ...l, ...req.body };
  if (merged.end_date < merged.start_date) return res.status(400).json({ error: 'end_date must be on/after start_date' });
  db.prepare(`UPDATE member_leaves SET start_date=?,end_date=?,type=?,notes=?,status=?,updated_at=datetime('now') WHERE id=?`)
    .run(merged.start_date, merged.end_date, merged.type, merged.notes || '', merged.status, l.id);
  res.json({ ok: true });
});

router.delete('/leaves/:lid', (req, res) => {
  const l = db.prepare('SELECT * FROM member_leaves WHERE id = ?').get(req.params.lid);
  if (!l) return res.status(404).json({ error: 'Leave not found' });
  if (!isAdmin(req)) {
    const m = db.prepare('SELECT * FROM team_members WHERE id = ?').get(l.member_id);
    if (!m || m.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
  }
  db.prepare('DELETE FROM member_leaves WHERE id = ?').run(l.id);
  res.json({ ok: true });
});

// Conflict between a member's assignments and leaves
function checkLeaveConflicts(memberId) {
  const assignments = db.prepare(
    `SELECT t.name AS task_name, t.start_date, t.end_date FROM task_assignments a JOIN tasks t ON t.id=a.task_id WHERE a.member_id=?`
  ).all(memberId);
  const leaves = db.prepare("SELECT * FROM member_leaves WHERE member_id=? AND status IN ('pending','approved')").all(memberId);
  const conflicts = [];
  for (const a of assignments) {
    for (const l of leaves) {
      if (a.start_date && a.end_date && l.start_date <= a.end_date && l.end_date >= a.start_date) {
        conflicts.push({ task_name: a.task_name, task_start: a.start_date, task_end: a.end_date, leave_start: l.start_date, leave_end: l.end_date });
      }
    }
  }
  return conflicts;
}

router.get('/members/:id/conflicts', (req, res) => {
  res.json({ conflicts: checkLeaveConflicts(req.params.id) });
});

// ---- Assignments ----
router.post('/tasks/:tid/assignments', requireAdmin, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.tid);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { member_id, role, allocation_pct, notes } = req.body || {};
  if (!member_id) return res.status(400).json({ error: 'member_id required' });
  const m = db.prepare('SELECT * FROM team_members WHERE id = ?').get(member_id);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  const alloc = allocation_pct != null ? Number(allocation_pct) : 100;
  if (alloc <= 0 || alloc > 100) return res.status(400).json({ error: 'allocation_pct must be 1-100' });
  try {
    db.prepare('INSERT INTO task_assignments (task_id,member_id,role,allocation_pct,notes) VALUES (?,?,?,?,?)')
      .run(task.id, m.id, role || '', alloc, notes || '');
  } catch (e) {
    return res.status(409).json({ error: 'Member already assigned to this task' });
  }
  res.status(201).json({ ok: true, conflicts: checkLeaveConflicts(m.id), member: m.full_name });
});

router.delete('/assignments/:aid', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM task_assignments WHERE id = ?').run(req.params.aid);
  res.json({ ok: true });
});

module.exports = router;
