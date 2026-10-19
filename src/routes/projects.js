const express = require('express');
const { db } = require('../db/connection');
const { requireAuth, requireAdmin } = require('../auth/auth');
const { reschedule } = require('../scheduling/cpm');

const router = express.Router();
router.use(requireAuth);

function isAdmin(req) { return req.user && req.user.role === 'admin'; }

// List projects (members see all, but management is admin-only)
router.get('/projects', (req, res) => {
  const { q = '', status = '' } = req.query;
  let sql = `SELECT p.*, u.full_name AS creator_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
    FROM projects p LEFT JOIN users u ON u.id = p.created_by WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND (p.name LIKE ? OR p.organization LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  sql += ' ORDER BY p.created_at DESC';
  res.json({ projects: db.prepare(sql).all(...params) });
});

router.get('/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const cal = db.prepare('SELECT * FROM project_calendars WHERE project_id = ?').get(p.id);
  const taskCount = db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id = ?').get(p.id).c;
  res.json({ project: p, calendar: cal, task_count: taskCount });
});

function validateProject(body) {
  const { name, start_date, target_end_date } = body;
  if (!name || !String(name).trim()) return 'Name is required';
  if (!start_date || !target_end_date) return 'start_date and target_end_date are required';
  if (target_end_date < start_date) return 'target_end_date must be on or after start_date';
  return null;
}

router.post('/projects', requireAdmin, (req, res) => {
  const { name, organization, description, start_date, target_end_date, status } = req.body || {};
  const err = validateProject(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const info = db
    .prepare(`INSERT INTO projects (name,organization,description,start_date,target_end_date,status,created_by)
      VALUES (?,?,?,?,?,?,?)`)
    .run(name.trim(), organization || '', description || '', start_date, target_end_date, status || 'planning', req.user.id);
  const pid = info.lastInsertRowid;
  db.prepare('INSERT INTO project_calendars (project_id) VALUES (?)').run(pid);
  res.status(201).json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(pid) });
});

router.put('/projects/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const merged = { ...p, ...req.body };
  const err = validateProject(merged);
  if (err) return res.status(400).json({ error: err });
  db.prepare(`UPDATE projects SET name=?,organization=?,description=?,start_date=?,target_end_date=?,status=?,updated_at=datetime('now') WHERE id=?`)
    .run(merged.name.trim(), merged.organization || '', merged.description || '', merged.start_date, merged.target_end_date, merged.status, p.id);
  reschedule(p.id);
  res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id) });
});

router.delete('/projects/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

// Project schedule / CPM summary
router.get('/projects/:id/schedule', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json({ schedule: reschedule(p.id) });
});

router.post('/projects/:id/reschedule', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json({ schedule: reschedule(p.id) });
});

module.exports = router;
