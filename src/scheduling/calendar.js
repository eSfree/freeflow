const { db } = require('../db/connection');

function getCalendar(projectId) {
  const cal = db.prepare('SELECT * FROM project_calendars WHERE project_id = ?').get(projectId);
  const workweek = (cal ? cal.workweek : '1,2,3,4,5').split(',').map(Number);
  const weekend = (cal ? cal.weekend_days : '0,6').split(',').map(Number);
  const holidays = new Set(
    db.prepare('SELECT date FROM holidays WHERE project_id = ?').all(projectId).map((h) => h.date)
  );
  return { workweek, weekend, holidays };
}

function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toISO(dt) {
  return dt.toISOString().slice(0, 10);
}
function addDaysISO(iso, n) {
  const dt = parseISO(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISO(dt);
}
function dow(iso) {
  return parseISO(iso).getUTCDay(); // 0=Sun
}

function isWorkday(iso, cal) {
  if (cal.holidays.has(iso)) return false;
  return cal.workweek.includes(dow(iso));
}

// Returns the ISO date of the Nth workday on/after startDate (n can be 0 -> startDate itself if workday, else next workday).
// Uses working-day arithmetic. duration=0 returns startDate.
function addWorkdays(startDate, n, cal) {
  let cur = startDate;
  // If start is not a workday, advance to the first workday.
  let guard = 0;
  while (!isWorkday(cur, cal)) { cur = addDaysISO(cur, 1); if (++guard > 3660) return null; }
  if (n <= 0) return cur;
  let count = 0;
  while (count < n) {
    cur = addDaysISO(cur, 1);
    if (isWorkday(cur, cal)) count++;
    if (++guard > 3660) return null;
  }
  return cur;
}

// End date for a task starting on a workday with duration in workdays.
function calcEndDate(startDate, duration, cal) {
  if (!startDate) return null;
  if (duration <= 0) return addWorkdays(startDate, 0, cal);
  return addWorkdays(startDate, duration - 1, cal);
}

// Count workdays between two dates inclusive.
function countWorkdays(startISO, endISO, cal) {
  let cur = startISO, count = 0, guard = 0;
  while (cur <= endISO) {
    if (isWorkday(cur, cal)) count++;
    cur = addDaysISO(cur, 1);
    if (++guard > 3660) break;
  }
  return count;
}

module.exports = { getCalendar, parseISO, toISO, addDaysISO, dow, isWorkday, addWorkdays, calcEndDate, countWorkdays };
