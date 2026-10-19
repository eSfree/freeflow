// CPM scheduling tests for ProjectFlow.
// Run with the server up:  node --test test/cpm.test.mjs
// Verifies the mandatory baseline case from the spec (Mon-Fri, no holidays, 13 workdays)
// plus holiday, SS, positive/negative lag, and cycle-detection behavior.
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.PF_BASE || 'http://localhost:3000';
const EMAIL = process.env.PF_ADMIN_EMAIL || 'admin@projectflow.test';
const PASS = process.env.PF_ADMIN_PASS || 'admin123';

let cookie;
let seq = 0;
const uniq = (p) => `${p}-${Date.now()}-${seq++}`;

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS })
  });
  assert.equal(r.status, 200, 'admin login should succeed');
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'login should set a session cookie');
}

// Creates a Mon-Fri project starting on a known Monday.
async function makeProject(name, { startDate = '2027-01-04' } = {}) {
  const r = await api('POST', '/api/projects', {
    name, start_date: startDate, target_end_date: '2027-03-31', status: 'active'
  });
  assert.equal(r.status, 201, `create project: ${JSON.stringify(r.data)}`);
  return r.data.project.id;
}

async function makeTask(pid, name, duration, extra = {}) {
  const r = await api('POST', `/api/projects/${pid}/tasks`, { name, duration, ...extra });
  assert.equal(r.status, 201, `create task ${name}: ${JSON.stringify(r.data)}`);
  return r.data.task.id;
}

async function addDep(successorId, body) {
  return api('POST', `/api/tasks/${successorId}/dependencies`, body);
}

async function schedule(pid) {
  const r = await api('GET', `/api/projects/${pid}/schedule`);
  assert.equal(r.status, 200, `schedule fetch: ${JSON.stringify(r.data)}`);
  return r.data.schedule;
}

const byName = (sched, name) => {
  const t = (sched.tasks || []).find((x) => x.name === name);
  assert.ok(t, `task ${name} present in schedule`);
  return t;
};

// Builds the spec's baseline network: T1->T2, T1->T3, T2->T4, T3->T4, T4->T5.
async function buildBaseline(pid) {
  const t1 = await makeTask(pid, 'T1', 3);
  const t2 = await makeTask(pid, 'T2', 2);
  const t3 = await makeTask(pid, 'T3', 3);
  const t4 = await makeTask(pid, 'T4', 5);
  const t5 = await makeTask(pid, 'T5', 2);
  for (const [succ, pred] of [[t2, t1], [t3, t1], [t4, t2], [t4, t3], [t5, t4]]) {
    const r = await addDep(succ, { predecessor_id: pred, type: 'FS', lag: 0 });
    assert.equal(r.status, 201, `add dependency: ${JSON.stringify(r.data)}`);
  }
  return { t1, t2, t3, t4, t5 };
}

test('baseline network: 13 workdays, critical path T1-T3-T4-T5, T2 float 1', async () => {
  await login();
  const pid = await makeProject(uniq('CPM Baseline'));
  await buildBaseline(pid);
  const s = await schedule(pid);

  assert.equal(s.projectDurationWorkdays, 13, 'project spans 13 workdays');
  assert.equal((s.criticalPaths || []).length, 1, 'exactly one critical path');
  assert.deepEqual(
    s.criticalPaths[0].map((n) => n.name),
    ['T1', 'T3', 'T4', 'T5'],
    'critical path is T1 -> T3 -> T4 -> T5'
  );

  const t1 = byName(s, 'T1'), t2 = byName(s, 'T2'), t3 = byName(s, 'T3');
  const t4 = byName(s, 'T4'), t5 = byName(s, 'T5');

  // Parallelism: T2 and T3 start together, after T1 finishes.
  assert.equal(t1.start_date, s.projectStart, 'T1 starts at project start');
  assert.ok(t2.start_date > t1.end_date, 'T2 starts after T1 finishes');
  assert.equal(t2.start_date, t3.start_date, 'T2 and T3 run in parallel');
  assert.ok(t4.start_date > t2.end_date, 'T4 starts after T2 finishes');
  assert.ok(t4.start_date > t3.end_date, 'T4 starts after T3 finishes');
  assert.ok(t5.start_date > t4.end_date, 'T5 starts after T4 finishes');

  // Floats: critical tasks 0, T2 has 1.
  for (const t of [t1, t3, t4, t5]) assert.equal(t.total_float, 0, `${t.name} has zero float`);
  assert.equal(t2.total_float, 1, 'T2 has exactly 1 workday of float');
  assert.equal(t2.is_critical, false, 'T2 is not critical');
});

test('holiday removes a workday and pushes the schedule', async () => {
  await login();
  const pid = await makeProject(uniq('CPM Holiday'));
  await buildBaseline(pid);
  const before = await schedule(pid);

  // 2027-01-06 (Wednesday) is a working day in the baseline.
  const h = await api('POST', `/api/projects/${pid}/holidays`, { date: '2027-01-06', name: 'Test Holiday' });
  assert.equal(h.status, 201, `add holiday: ${JSON.stringify(h.data)}`);
  const created = (h.data.holidays || []).find((x) => x.date === '2027-01-06');
  assert.ok(created, 'created holiday is returned');

  const after = await schedule(pid);
  // Removing a mid-schedule workday shifts the trailing work forward, so the project
  // finishes later. The workday count stays the same when the shifted work fits into a
  // partially-used trailing day (here 13 workdays either way), so assert the real
  // CPM behavior: the finish moves later and nothing is scheduled onto the holiday.
  assert.ok(after.projectFinish > before.projectFinish, 'project finish moves later');
  const holidayTask = (after.tasks || []).find(
    (t) => t.start_date <= '2027-01-06' && t.end_date >= '2027-01-06'
  );
  if (holidayTask) {
    assert.ok(holidayTask.start_date !== '2027-01-06' && holidayTask.end_date !== '2027-01-06',
      'no task uses the holiday as a workday');
  }

  // Clean up the holiday so it does not leak into other assertions.
  const del = await api('DELETE', `/api/holidays/${created.id}`);
  assert.equal(del.status, 200, 'delete holiday');
});

test('Start-to-Start link aligns successor start with predecessor start', async () => {
  await login();
  const pid = await makeProject(uniq('CPM SS'));
  const a = await makeTask(pid, 'A', 4);
  const b = await makeTask(pid, 'B', 2);
  const r = await addDep(b, { predecessor_id: a, type: 'SS', lag: 0 });
  assert.equal(r.status, 201, `add SS dependency: ${JSON.stringify(r.data)}`);
  const s = await schedule(pid);
  assert.equal(byName(s, 'B').start_date, byName(s, 'A').start_date,
    'with SS lag 0 both tasks start on the same day');
});

test('positive lag delays the successor by the given workdays', async () => {
  await login();
  const pid = await makeProject(uniq('CPM PosLag'));
  const a = await makeTask(pid, 'A', 2);
  const b = await makeTask(pid, 'B', 1);
  await addDep(b, { predecessor_id: a, type: 'FS', lag: 2 });
  const s = await schedule(pid);
  const A = byName(s, 'A'), B = byName(s, 'B');
  assert.equal(B.start_date, addWorkdays(A.end_date, 2),
    'successor starts 2 workdays after predecessor finishes');
});

test('negative SS lag pulls the successor earlier than plain FS', async () => {
  await login();
  const pid = await makeProject(uniq('CPM NegLag'));
  // Pin A a few workdays into the project so the SS -2 pull stays on/after the project
  // start: the engine clamps every task to the project start, so an unpinned root would
  // mask the lag entirely.
  const a = await makeTask(pid, 'A', 4, { start_date: '2027-01-08' });
  const b = await makeTask(pid, 'B', 1);
  // SS with negative lag lets B start before A finishes (real overlap): ES(B) = ES(A) + lag.
  const r = await addDep(b, { predecessor_id: a, type: 'SS', lag: -2 });
  assert.equal(r.status, 201, `negative SS lag accepted: ${JSON.stringify(r.data)}`);
  const s = await schedule(pid);
  const A = byName(s, 'A'), B = byName(s, 'B');
  assert.equal(B.start_date, addWorkdays(A.start_date, -2),
    'successor starts 2 workdays before predecessor start (overlap)');
  // Overlap: B starts while A is still running, and never before the project start.
  assert.ok(B.start_date < A.end_date, 'B overlaps A (starts before A finishes)');
  assert.ok(B.start_date >= s.projectStart, 'B never starts before the project start');
});

test('a dependency cycle is rejected with an explanation', async () => {
  await login();
  const pid = await makeProject(uniq('CPM Cycle'));
  const a = await makeTask(pid, 'A', 1);
  const b = await makeTask(pid, 'B', 1);
  const first = await addDep(b, { predecessor_id: a, type: 'FS', lag: 0 });
  assert.equal(first.status, 201, 'first edge accepted');
  const back = await addDep(a, { predecessor_id: b, type: 'FS', lag: 0 });
  assert.equal(back.status, 400, `back edge rejected: ${JSON.stringify(back.data)}`);
  assert.match(String(back.data.error), /cycle/i, 'error message names the cycle');
});

test('a task cannot depend on itself', async () => {
  await login();
  const pid = await makeProject(uniq('CPM Self'));
  const a = await makeTask(pid, 'A', 1);
  const r = await addDep(a, { predecessor_id: a, type: 'FS', lag: 0 });
  assert.equal(r.status, 400, 'self-dependency rejected');
  assert.match(String(r.data.error), /itself/i, 'error explains self-dependency');
});

// --- workday helpers (Mon-Fri, matches the test calendars) ---
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function toISO(dt) { return dt.toISOString().slice(0, 10); }
function isWeekend(dt) { const g = dt.getUTCDay(); return g === 0 || g === 6; }
function addWorkdays(iso, n) {
  let dt = parseISO(iso);
  let step = n >= 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) {
    dt.setUTCDate(dt.getUTCDate() + step);
    if (!isWeekend(dt)) left--;
  }
  return toISO(dt);
}
