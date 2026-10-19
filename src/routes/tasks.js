const express = require('express');
const { db } = require('../db/connection');
const { requireAuth, requireAdmin } = require('../auth/auth');
const { reschedule, detectCycle } = require('../scheduling/cpm');

const router = express.Router();
router.use(requireAuth);

function isAdmin(req) { return req.user && req.user.role === 'admin'; }

const TASK_STATUSES = ['not_started', 'in_progress', 'completed', 'on_hold'];
const PRIORITIES = ['low', 'medium', 'high'];

function buildTree(projectId) {
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY name').all(projectId);
  const byId = new Map(tasks.map((t) => [t.id, { ...t, subtasks: [] }]));
  const roots = [];
  for (const t of byId.values()) {
    if (t.parent_id && byId.has(t.parent_id)) byId.get(t.parent_id).subtasks.push(t);
    else roots.push(t);
  }
  return roots;
}

router.get('/projects/:pid/tasks', (req, res) => {
  const { q = '', status = '', priority = '', sort = 'name' } = req.query;
  let sql = 'SELECT * FROM tasks WHERE project_id = ?';
  const params = [req.params.pid];
  if (q) { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (priority) { sql += ' AND priority = ?'; params.push(priority); }
  const allowedSort = { name: 'name', start: 'start_date', end: 'end_date', status: 'status', priority: 'priority', progress: 'progress' };
  sql += ` ORDER BY ${allowedSort[sort] || 'name'}`;
  const tasks = db.prepare(sql).all(...params);
  const assignments = db.prepare(
    `SELECT a.task_id, m.id AS member_id, m.full_name, a.role, a.allocation_pct
     FROM task_assignments a JOIN team_members m ON m.id = a.member_id`
  ).all();
  const byTask = new Map();
  for (const a of assignments) {
    if (!byTask.has(a.task_id)) byTask.set(a.task_id, []);
    byTask.get(a.task_id).push(a);
  }
  // Project-scoped dependencies (incoming per task) so the deps page can list them.
  const depRows = db.prepare(
    `SELECT d.id, d.predecessor_id, d.successor_id, d.type, d.lag, pt.name AS pred_name, st.name AS succ_name
     FROM task_dependencies d
     JOIN tasks pt ON pt.id = d.predecessor_id
     JOIN tasks st ON st.id = d.successor_id
     WHERE pt.project_id = ? AND st.project_id = ?`
  ).all(req.params.pid, req.params.pid);
  const depsByTask = new Map();
  for (const d of depRows) {
    if (!depsByTask.has(d.successor_id)) depsByTask.set(d.successor_id, []);
    depsByTask.get(d.successor_id).push(d);
  }
  res.json({
    tasks: tasks.map((t) => ({ ...t, assignments: byTask.get(t.id) || [], dependencies: depsByTask.get(t.id) || [] })),
    dependencies: depRows,
    tree: buildTree(req.params.pid)
  });
});

router.get('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const assignments = db.prepare(
    `SELECT a.*, m.full_name FROM task_assignments a JOIN team_members m ON m.id = a.member_id WHERE a.task_id = ?`
  ).all(t.id);
  const deps = db.prepare('SELECT * FROM task_dependencies WHERE predecessor_id = ? OR successor_id = ?').all(t.id, t.id);
  res.json({ task: t, assignments, dependencies: deps });
});

function validateTask(body, projectId) {
  const { name, duration } = body;
  if (!name || !String(name).trim()) return 'Task name is required';
  if (duration == null || isNaN(duration) || Number(duration) < 0) return 'Duration must be a non-negative number';
  if (body.priority && !PRIORITIES.includes(body.priority)) return 'Invalid priority';
  if (body.status && !TASK_STATUSES.includes(body.status)) return 'Invalid status';
  if (body.progress != null && (body.progress < 0 || body.progress > 100)) return 'Progress must be 0-100';
  if (body.parent_id) {
    const parent = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(body.parent_id, projectId);
    if (!parent) return 'Parent task not found in this project';
  }
  return null;
}

router.post('/projects/:pid/tasks', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
  const body = req.body || {};
  const err = validateTask(body, req.params.pid);
  if (err) return res.status(400).json({ error: err });
  const info = db.prepare(
    `INSERT INTO tasks (project_id,parent_id,name,description,start_date,duration,end_date,priority,status,progress,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(req.params.pid, body.parent_id || null, body.name.trim(), body.description || '', body.start_date || null,
    Number(body.duration), null, body.priority || 'medium', body.status || 'not_started', body.progress || 0, body.notes || '');
  const sched = reschedule(req.params.pid);
  res.status(201).json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid), schedule: sched });
});

router.put('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  if (!isAdmin(req)) {
    // member can update only status/progress/notes of own assigned task
    const assigned = db.prepare('SELECT 1 FROM task_assignments WHERE task_id = ? AND member_id IN (SELECT id FROM team_members WHERE user_id = ?)').get(t.id, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Not authorized' });
    const { status, progress, notes } = req.body || {};
    db.prepare('UPDATE tasks SET status=?, progress=?, notes=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(status || t.status, progress != null ? progress : t.progress, notes != null ? notes : t.notes, t.id);
    return res.json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id), schedule: reschedule(t.project_id) });
  }
  const merged = { ...t, ...req.body };
  const err = validateTask(merged, t.project_id);
  if (err) return res.status(400).json({ error: err });
  if (merged.parent_id === t.id) return res.status(400).json({ error: 'Task cannot be its own parent' });
  db.prepare(
    `UPDATE tasks SET parent_id=?,name=?,description=?,start_date=?,duration=?,priority=?,status=?,progress=?,notes=?,updated_at=datetime('now') WHERE id=?`
  ).run(merged.parent_id || null, merged.name.trim(), merged.description || '', merged.start_date || null,
    Number(merged.duration), merged.priority, merged.status, merged.progress, merged.notes || '', t.id);
  res.json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id), schedule: reschedule(t.project_id) });
});

router.delete('/tasks/:id', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const deps = db.prepare('SELECT COUNT(*) c FROM task_dependencies WHERE predecessor_id = ? OR successor_id = ?').get(t.id, t.id).c;
  const force = req.query.force === '1';
  if (deps > 0 && !force) {
    return res.status(409).json({ error: `Task has ${deps} dependency link(s). Confirm deletion to remove them.`, needs_confirmation: true });
  }
  const del = db.transaction(() => {
    db.prepare('DELETE FROM task_dependencies WHERE predecessor_id = ? OR successor_id = ?').run(t.id, t.id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  });
  del();
  res.json({ ok: true, schedule: reschedule(t.project_id) });
});

// ---- Dependencies ----
router.post('/tasks/:id/dependencies', requireAdmin, (req, res) => {
  const succ = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!succ) return res.status(404).json({ error: 'Successor task not found' });
  const { predecessor_id, type = 'FS', lag = 0, notes } = req.body || {};
  if (!predecessor_id) return res.status(400).json({ error: 'predecessor_id required' });
  const pred = db.prepare('SELECT * FROM tasks WHERE id = ?').get(predecessor_id);
  if (!pred) return res.status(404).json({ error: 'Predecessor task not found' });
  if (pred.project_id !== succ.project_id) return res.status(400).json({ error: 'Tasks must be in the same project' });
  if (pred.id === succ.id) return res.status(400).json({ error: 'A task cannot depend on itself' });
  if (!['FS', 'SS'].includes(type)) return res.status(400).json({ error: 'type must be FS or SS' });
  const lagNum = Number(lag) || 0;
  // cycle detection with candidate edge
  const cycle = detectCycle(succ.project_id, { predecessor_id: pred.id, successor_id: succ.id });
  if (cycle) {
    const names = cycle.map((id) => { const x = db.prepare('SELECT name FROM tasks WHERE id=?').get(id); return x ? x.name : `#${id}`; });
    return res.status(400).json({ error: `This dependency would create a cycle: ${names.join(' -> ')}` });
  }
  try {
    db.prepare('INSERT INTO task_dependencies (predecessor_id, successor_id, type, lag, notes) VALUES (?,?,?,?,?)')
      .run(pred.id, succ.id, type, lagNum, notes || '');
  } catch (e) {
    return res.status(409).json({ error: 'This dependency already exists' });
  }
  res.status(201).json({ schedule: reschedule(succ.project_id) });
});

router.delete('/dependencies/:id', requireAdmin, (req, res) => {
  const d = db.prepare('SELECT * FROM task_dependencies WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Dependency not found' });
  const succ = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(d.successor_id);
  db.prepare('DELETE FROM task_dependencies WHERE id = ?').run(d.id);
  res.json({ ok: true, schedule: succ ? reschedule(succ.project_id) : null });
});

module.exports = router;
