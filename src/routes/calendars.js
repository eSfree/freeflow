const express = require('express');
const { db } = require('../db/connection');
const { requireAuth, requireAdmin } = require('../auth/auth');
const { reschedule } = require('../scheduling/cpm');

const router = express.Router();
router.use(requireAuth);

function parseList(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number);
}

router.get('/projects/:id/calendar', (req, res) => {
  const cal = db.prepare('SELECT * FROM project_calendars WHERE project_id = ?').get(req.params.id);
  const holidays = db.prepare('SELECT * FROM holidays WHERE project_id = ? ORDER BY date').all(req.params.id);
  res.json({ calendar: cal || { project_id: +req.params.id, workweek: '1,2,3,4,5', weekend_days: '0,6' }, holidays });
});

router.put('/projects/:id/calendar', requireAdmin, (req, res) => {
  const { workweek, weekend_days } = req.body || {};
  const ww = parseList(workweek);
  const we = parseList(weekend_days);
  if (!Array.isArray(ww) || ww.some((d) => d < 0 || d > 6)) return res.status(400).json({ error: 'workweek must be day numbers 0-6' });
  const existing = db.prepare('SELECT * FROM project_calendars WHERE project_id = ?').get(req.params.id);
  if (existing) {
    db.prepare('UPDATE project_calendars SET workweek=?, weekend_days=?, updated_at=datetime(\'now\') WHERE project_id=?')
      .run(ww.join(','), we.join(','), req.params.id);
  } else {
    db.prepare('INSERT INTO project_calendars (project_id, workweek, weekend_days) VALUES (?,?,?)').run(req.params.id, ww.join(','), we.join(','));
  }
  reschedule(req.params.id);
  res.json({ calendar: db.prepare('SELECT * FROM project_calendars WHERE project_id = ?').get(req.params.id) });
});

router.post('/projects/:id/holidays', requireAdmin, (req, res) => {
  const { date, name, kind } = req.body || {};
  if (!date || !name) return res.status(400).json({ error: 'date and name required' });
  try {
    db.prepare('INSERT INTO holidays (project_id, date, name, kind) VALUES (?,?,?,?)').run(req.params.id, date, name, kind || 'national');
  } catch (e) {
    return res.status(409).json({ error: 'A holiday already exists on that date' });
  }
  reschedule(req.params.id);
  res.status(201).json({ holidays: db.prepare('SELECT * FROM holidays WHERE project_id = ? ORDER BY date').all(req.params.id) });
});

router.put('/holidays/:hid', requireAdmin, (req, res) => {
  const h = db.prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.hid);
  if (!h) return res.status(404).json({ error: 'Holiday not found' });
  const { date, name, kind } = { ...h, ...req.body };
  db.prepare('UPDATE holidays SET date=?, name=?, kind=? WHERE id=?').run(date, name, kind, h.id);
  reschedule(h.project_id);
  res.json({ ok: true });
});

router.delete('/holidays/:hid', requireAdmin, (req, res) => {
  const h = db.prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.hid);
  if (!h) return res.status(404).json({ error: 'Holiday not found' });
  db.prepare('DELETE FROM holidays WHERE id = ?').run(h.id);
  reschedule(h.project_id);
  res.json({ ok: true });
});

module.exports = router;
