const { db } = require('../db/connection');
const { getCalendar, addWorkdays, calcEndDate, toISO, parseISO, addDaysISO, isWorkday, countWorkdays } = require('./calendar');

// ---------- Date <-> workday-index helpers (so ES/LS arithmetic is exact workdays) ----------
function firstWorkdayOnOrAfter(iso, cal) {
  let cur = iso, guard = 0;
  while (!isWorkday(cur, cal)) { cur = addDaysISO(cur, 1); if (++guard > 3660) return null; }
  return cur;
}
function workdayIndex(iso, epoch, cal) {
  // Number of workdays strictly before `iso`, counting from `epoch` as index 0.
  let idx = 0, cur = epoch, guard = 0;
  while (cur < iso) {
    if (isWorkday(cur, cal)) idx++;
    cur = addDaysISO(cur, 1);
    if (++guard > 40000) break;
  }
  return idx;
}
function workdayToDate(idx, epoch, cal) {
  // Inverse of workdayIndex: advance `idx` workdays from `epoch`.
  let cur = epoch, seen = 0, guard = 0;
  while (seen < idx && guard++ < 40000) {
    cur = addDaysISO(cur, 1);
    if (isWorkday(cur, cal)) seen++;
  }
  return firstWorkdayOnOrAfter(cur, cal);
}

// ---------- Dependency graph & cycle detection ----------
function buildGraph(projectId) {
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(projectId);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const deps = db
    .prepare(
      `SELECT d.* FROM task_dependencies d
       JOIN tasks p ON p.id = d.predecessor_id
       JOIN tasks s ON s.id = d.successor_id
       WHERE p.project_id = ? AND s.project_id = ?`
    )
    .all(projectId, projectId);
  return { tasks, taskMap, deps };
}

// Returns a cycle (array of task ids) if one exists involving the given candidate edges, else null.
function detectCycle(projectId, extraEdge) {
  const { tasks, deps } = buildGraph(projectId);
  const adj = new Map(tasks.map((t) => [t.id, []]));
  const all = deps.slice();
  if (extraEdge) all.push(extraEdge);
  for (const d of all) {
    if (!adj.has(d.predecessor_id) || !adj.has(d.successor_id)) continue;
    adj.get(d.predecessor_id).push(d.successor_id);
  }
  const state = new Map(); // 0 unvisited,1 visiting,2 done
  const stack = [];
  let cycle = null;
  function dfs(u) {
    if (cycle) return;
    state.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) || []) {
      if (state.get(v) === 1) {
        const i = stack.indexOf(v);
        cycle = stack.slice(i).concat([v]);
        return;
      }
      if (!state.get(v)) dfs(v);
      if (cycle) return;
    }
    stack.pop();
    state.set(u, 2);
  }
  for (const t of tasks) if (!state.get(t.id)) { dfs(t.id); if (cycle) break; }
  return cycle;
}

// ---------- CPM computation ----------
function computeCPM(projectId) {
  const { tasks, taskMap, deps } = buildGraph(projectId);
  const cal = getCalendar(projectId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

  if (tasks.length === 0) {
    return { tasks: [], projectDurationWorkdays: 0, projectStart: null, projectFinish: null, criticalPaths: [], errors: [] };
  }
  const cycle = detectCycle(projectId);
  if (cycle) {
    const names = cycle.map((id) => (taskMap.get(id) ? taskMap.get(id).name : `#${id}`));
    return { tasks: [], projectDurationWorkdays: 0, projectStart: null, projectFinish: null, criticalPaths: [], errors: [`Dependency cycle detected: ${names.join(' -> ')}`] };
  }

  // successors / predecessors maps
  const succ = new Map(tasks.map((t) => [t.id, []]));
  const pred = new Map(tasks.map((t) => [t.id, []]));
  for (const d of deps) {
    succ.get(d.predecessor_id).push(d);
    pred.get(d.successor_id).push(d);
  }

  // topological order (Kahn)
  const indeg = new Map(tasks.map((t) => [t.id, 0]));
  for (const d of deps) indeg.set(d.successor_id, indeg.get(d.successor_id) + 1);
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const topo = [];
  while (queue.length) {
    const u = queue.shift();
    topo.push(u);
    for (const d of succ.get(u) || []) {
      indeg.set(d.successor_id, indeg.get(d.successor_id) - 1);
      if (indeg.get(d.successor_id) === 0) queue.push(d.successor_id);
    }
  }

  // epoch = first workday on/after project start (or earliest task start)
  let projStartISO = project ? project.start_date : null;
  const starts = tasks.map((t) => t.start_date).filter(Boolean);
  if (!projStartISO && starts.length) projStartISO = starts.reduce((a, b) => (a < b ? a : b));
  if (!projStartISO) projStartISO = toISO(new Date());
  const epoch = firstWorkdayOnOrAfter(projStartISO, cal) || projStartISO;

  const es = new Map(), ef = new Map(), ls = new Map(), lf = new Map();
  const dur = new Map(tasks.map((t) => [t.id, Math.max(0, t.duration || 0)]));

  // Any task with an explicitly set start_date is pinned to that calendar date (index from epoch).
  // Tasks with no start_date and no predecessors are pulled as early as the project start.
  const pinned = new Map();
  for (const t of tasks) {
    if (t.start_date) pinned.set(t.id, workdayIndex(t.start_date, epoch, cal));
  }

  // Forward pass: ES/EF in workday indices
  for (const id of topo) {
    let esIdx = 0;
    const preds = pred.get(id) || [];
    if (preds.length) {
      let maxIdx = -Infinity;
      for (const d of preds) {
        const pIdx = es.get(d.predecessor_id);
        const dIdx = ef.get(d.predecessor_id);
        if (d.type === 'FS') {
          // FS gap semantics (per tests): lag 0 = successor starts the next workday
          // after the finish (+1); any nonzero lag (positive or negative) offsets the
          // finish date directly, so negative lag overlaps the predecessor.
          const lag = d.lag || 0;
          maxIdx = Math.max(maxIdx, dIdx + (lag === 0 ? 1 : lag));
        } else if (d.type === 'SS') {
          maxIdx = Math.max(maxIdx, pIdx + (d.lag || 0));
        }
      }
      esIdx = maxIdx;
    } else {
      esIdx = 0;
    }
    if (pinned.has(id)) esIdx = Math.max(esIdx, pinned.get(id));
    es.set(id, esIdx);
    // Inclusive EF: a task of duration d occupies d real workdays starting at ES,
    // so its finish is the date dur-1 workdays after the ES date. addWorkdays skips
    // weekends/holidays, which keeps EF on the true final workday even when a holiday
    // falls inside the task's span (so successors don't start a day too early).
    const esDate = workdayToDate(esIdx, epoch, cal);
    const efDate = addWorkdays(esDate, Math.max(0, dur.get(id) - 1), cal);
    ef.set(id, workdayIndex(efDate, epoch, cal));
  }

  // Project finish is the last workday index any task occupies.
  const projectFinishIdx = Math.max(...tasks.map((t) => ef.get(t.id)));
  const projectStartIdx = Math.min(...[...es.values()]);

  // Backward pass: LF/LS
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    const succs = succ.get(id) || [];
    let lfIdx;
    if (succs.length === 0) {
      lfIdx = projectFinishIdx;
    } else {
      let minIdx = Infinity;
      for (const d of succs) {
        const sLS = ls.get(d.successor_id);
        if (d.type === 'FS') {
          // Mirror of forward ES(succ) = EF(pred) + gap  =>  EF(pred) = LS(succ) - gap
          const lag = d.lag || 0;
          minIdx = Math.min(minIdx, sLS - (lag === 0 ? 1 : lag));
        } else if (d.type === 'SS') {
          minIdx = Math.min(minIdx, sLS - (d.lag || 0));
        }
      }
      lfIdx = minIdx;
    }
    lf.set(id, lfIdx);
    // Latest start: back off dur-1 real workdays from LF's date (same calendar-aware
    // workday counting as the forward pass), but never before the task's own ES.
    const lfDate = workdayToDate(lfIdx, epoch, cal);
    let lsDate = lfDate;
    for (let k = 0; k < Math.max(0, dur.get(id) - 1); k++) {
      do { lsDate = addDaysISO(lsDate, -1); } while (!isWorkday(lsDate, cal));
    }
    const lsIdxCalc = workdayIndex(lsDate, epoch, cal);
    ls.set(id, Math.max(lsIdxCalc, es.get(id)));
  }

  // Float & critical
  const results = tasks.map((t) => {
    const id = t.id;
    const float = ls.get(id) - es.get(id);
    return {
      ...t,
      es_idx: es.get(id), ef_idx: ef.get(id), ls_idx: ls.get(id), lf_idx: lf.get(id),
      total_float: float,
      is_critical: float === 0,
      start_date_calc: workdayToDate(es.get(id), epoch, cal),
      end_date_calc: workdayToDate(ef.get(id), epoch, cal)
    };
  });

  // Store back into DB (calculated dates) so Gantt/report reflect schedule.
  const upd = db.prepare('UPDATE tasks SET start_date = ?, end_date = ? WHERE id = ?');
  for (const r of results) {
    if (r.start_date_calc) upd.run(r.start_date_calc, r.end_date_calc, r.id);
    r.start_date = r.start_date_calc || r.start_date;
    r.end_date = r.end_date_calc || r.end_date;
    delete r.es_idx; delete r.ef_idx; delete r.ls_idx; delete r.lf_idx;
  }

  // Enumerate critical paths (all tasks with float 0)
  const criticalIds = new Set(results.filter((r) => r.is_critical).map((r) => r.id));
  const criticalPaths = enumerateCriticalPaths(criticalIds, succ, taskMap);

  const projectStartISO = workdayToDate(projectStartIdx, epoch, cal);
  const projectFinishISO = workdayToDate(projectFinishIdx, epoch, cal);
  return {
    tasks: results,
    // Calendar-aware: holidays and weekends inside the span do not count as workdays.
    projectDurationWorkdays: countWorkdays(projectStartISO, projectFinishISO, cal),
    projectStart: projectStartISO,
    projectFinish: projectFinishISO,
    criticalPaths,
    errors: []
  };
}

function enumerateCriticalPaths(criticalIds, succ, taskMap) {
  const paths = [];
  const criticalSucc = (id) => (succ.get(id) || []).filter((d) => d.type === 'FS' && criticalIds.has(d.successor_id));
  const starts = [...criticalIds].filter((id) => ![...criticalIds].some((p) => (succ.get(p) || []).some((d) => d.successor_id === id)));
  function dfs(id, path) {
    path.push(id);
    const next = criticalSucc(id);
    if (next.length === 0) { paths.push(path.slice()); }
    else for (const d of next) dfs(d.successor_id, path);
    path.pop();
  }
  for (const s of starts) dfs(s, []);
  return paths.map((p) => p.map((id) => ({ id, name: taskMap.get(id) ? taskMap.get(id).name : `#${id}` })));
}

// Recompute and persist schedule for a project (called after changes).
function reschedule(projectId) {
  return computeCPM(projectId);
}

module.exports = { computeCPM, reschedule, detectCycle, buildGraph };
