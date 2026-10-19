const express = require('express');
const { db } = require('../db/connection');
const { requireAuth } = require('../auth/auth');
const { reschedule } = require('../scheduling/cpm');

const router = express.Router();
router.use(requireAuth);

router.get('/dashboard', (req, res) => {
  const c = (sql, ...p) => db.prepare(sql).get(...p).c;
  const projects = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
  const active = db.prepare("SELECT COUNT(*) c FROM projects WHERE status='active'").get().c;
  const completed = db.prepare("SELECT COUNT(*) c FROM projects WHERE status='completed'").get().c;
  const total = db.prepare('SELECT COUNT(*) c FROM tasks').get().c;
  const notStarted = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='not_started'").get().c;
  const inProgress = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='in_progress'").get().c;
  const doneTasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='completed'").get().c;
  const onHold = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='on_hold'").get().c;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = c("SELECT COUNT(*) c FROM tasks WHERE status!='completed' AND end_date IS NOT NULL AND end_date < ?", today);
  const avgProgress = db.prepare('SELECT AVG(progress) a FROM tasks').get().a || 0;

  // per-project progress + est finish
  const projRows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  const projectsSummary = projRows.map((p) => {
    const t = db.prepare('SELECT COUNT(*) c, AVG(progress) avgp, MAX(end_date) last FROM tasks WHERE project_id=?').get(p.id);
    const sched = reschedule(p.id);
    const crit = sched.tasks ? sched.tasks.filter((x) => x.is_critical).length : 0;
    return { ...p, task_count: t.c, progress: Math.round(t.avgp || 0), estimated_finish: sched.projectFinish || p.target_end_date, critical_tasks: crit, overdue: db.prepare("SELECT COUNT(*) c FROM tasks WHERE project_id=? AND status!='completed' AND end_date < ?").get(p.id, today).c };
  });

  // workload per member
  const workload = db.prepare(
    `SELECT m.id, m.full_name, m.position,
       COUNT(a.id) AS open_tasks,
       COALESCE(SUM(CASE WHEN t.status!='completed' THEN a.allocation_pct ELSE 0 END),0) AS allocation
     FROM team_members m LEFT JOIN task_assignments a ON a.member_id=m.id
     LEFT JOIN tasks t ON t.id=a.task_id
     WHERE m.is_active=1 GROUP BY m.id ORDER BY allocation DESC`
  ).all();

  res.json({
    stats: { projects, active, completed, total_tasks: total, not_started: notStarted, in_progress: inProgress, completed_tasks: doneTasks, on_hold: onHold, overdue, avg_progress: Math.round(avgProgress) },
    projects: projectsSummary,
    workload
  });
});

// Reports with filters + CSV
router.get('/projects/:pid/report', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const { status = '', priority = '', member_id = '', from = '', to = '' } = req.query;
  let sql = 'SELECT * FROM tasks WHERE project_id = ?';
  const params = [p.id];
  if (status) { sql += ' AND status=?'; params.push(status); }
  if (priority) { sql += ' AND priority=?'; params.push(priority); }
  if (from) { sql += ' AND end_date >= ?'; params.push(from); }
  if (to) { sql += ' AND start_date <= ?'; params.push(to); }
  let tasks = db.prepare(sql).all(...params);
  if (member_id) {
    const ids = db.prepare('SELECT task_id FROM task_assignments WHERE member_id=?').all(member_id).map((r) => r.task_id);
    tasks = tasks.filter((t) => ids.includes(t.id));
  }
  const sched = reschedule(p.id);
  const schedById = new Map((sched.tasks || []).map((t) => [t.id, t]));
  const enriched = tasks.map((t) => {
    const s = schedById.get(t.id);
    const members = db.prepare('SELECT m.full_name, a.role, a.allocation_pct FROM task_assignments a JOIN team_members m ON m.id=a.member_id WHERE a.task_id=?').all(t.id);
    const deps = db.prepare('SELECT d.*, pt.name AS pred_name FROM task_dependencies d JOIN tasks pt ON pt.id=d.predecessor_id WHERE d.successor_id=?').all(t.id);
    return { ...t, total_float: s ? s.total_float : null, is_critical: s ? s.is_critical : false, members, dependencies: deps };
  });
  const report = {
    project: p,
    estimated_finish: sched.projectFinish,
    project_duration_workdays: sched.projectDurationWorkdays,
    tasks: enriched,
    critical: enriched.filter((t) => t.is_critical).map((t) => t.name),
    critical_paths: sched.criticalPaths,
    overdue: enriched.filter((t) => t.status !== 'completed' && t.end_date && t.end_date < new Date().toISOString().slice(0, 10)).map((t) => t.name),
    workload: db.prepare(`SELECT m.full_name, COUNT(a.id) tasks FROM team_members m LEFT JOIN task_assignments a ON a.member_id=m.id LEFT JOIN tasks t ON t.id=a.task_id AND t.project_id=? WHERE m.is_active=1 GROUP BY m.id`).all(p.id)
  };
  if (req.query.format === 'csv') {
    const header = ['Task', 'Parent', 'Start', 'End', 'Duration', 'Status', 'Progress', 'Priority', 'Critical', 'Float', 'Members', 'Predecessors'];
    const rows = enriched.map((t) => [t.name, t.parent_id || '', t.start_date || '', t.end_date || '', t.duration, t.status, t.progress, t.priority, t.is_critical ? 'YES' : 'no', t.total_float, t.members.map((m) => m.full_name).join('; '), t.dependencies.map((d) => `${d.pred_name}(${d.type}${d.lag ? ',' + d.lag : ''})`).join('; ')]);
    const csv = [header, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="project-${p.id}-report.csv"`);
    return res.send(csv);
  }
  res.json({ report });
});

module.exports = router;
