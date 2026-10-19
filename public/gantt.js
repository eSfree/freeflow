// Gantt Chart
route('gantt', async (rest, root) => {
  setTitle('Gantt Chart');
  const isAdmin = PF.ME.role === 'admin';
  const state = { view: 'day', showDeps: true, showCrit: true };
  let projects = await loadProjects();
  if (!projects.length) {
    root.innerHTML = `<div class="panel"><div class="empty"><div class="big">▤</div><h3>No projects yet</h3><p>Create a project to view its Gantt chart.</p><a class="btn primary" href="#/projects" style="margin-top:12px">Go to Projects</a></div></div>`;
    return;
  }
  let pid = rest[0] ? +rest[0] : projects[0].id;
  if (rest[0]) CURRENT_PROJECT.id = +rest[0];

  root.innerHTML = `
    <div id="picker-mount"></div>
    <div class="panel mt">
      <div class="panel-head">
        <h2 id="gantt-title">Gantt</h2>
        <div class="gantt-toolbar">
          <div class="view-toggle">
            <button data-view="day" class="active">Day</button>
            <button data-view="week">Week</button>
            <button data-view="month">Month</button>
          </div>
          <label class="tag"><input type="checkbox" id="show-deps" checked style="width:auto" /> Dependencies</label>
          <label class="tag"><input type="checkbox" id="show-crit" checked style="width:auto" /> Critical path</label>
          <button class="btn sm" id="recalc">↻ Recalculate</button>
        </div>
      </div>
      <div id="gantt-mount"></div>
      <p class="muted mt" style="font-size:12px">Click a bar to view/edit the task. ${isAdmin ? 'Drag a bar horizontally to shift its start date (saves + reschedules automatically).' : ''}</p>
    </div>`;

  async function render() {
    const mount = $('#gantt-mount');
    mount.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const [{ schedule }, { tasks }] = await Promise.all([
      API.get('/api/projects/' + pid + '/schedule'),
      API.get('/api/projects/' + pid + '/tasks')
    ]);
    const proj = (await API.get('/api/projects/' + pid)).project;
    $('#gantt-title').textContent = proj.name + ' — Gantt';
    if (schedule.errors && schedule.errors.length) {
      mount.innerHTML = `<div class="empty"><div class="big">⚠️</div><h3>Scheduling error</h3><p>${esc(schedule.errors[0])}</p></div>`;
      return;
    }
    const schedTasks = schedule.tasks || [];
    if (!schedTasks.length) { mount.innerHTML = '<div class="empty"><div class="big">▤</div><h3>No tasks yet</h3><p>Add tasks to see them scheduled here.</p></div>'; return; }

    // calendar range
    const dates = schedTasks.flatMap((t) => [t.start_date, t.end_date]).filter(Boolean);
    let minD = dates.reduce((a, b) => (a < b ? a : b), proj.start_date);
    let maxD = dates.reduce((a, b) => (a > b ? a : b), proj.target_end_date);
    minD = addDays(minD, -2); maxD = addDays(maxD, 4);

    // build column list (workdays only) by view
    const cal = { /* approximate using weekends for column math */ };
    const columns = buildColumns(minD, maxD, state.view);

    const COL_W = { day: 34, week: 120, month: 300 }[state.view];
    const trackW = columns.length * COL_W;
    const today = todayISO();

    // left: task names; right: bars
    const leftRows = schedTasks.map((t) => `<div class="gantt-row ${t.parent_id ? 'sub' : ''}">${esc(t.name)}${t.is_critical ? ' <span class="badge critical">CRIT</span>' : ''}</div>`).join('');
    const headerCells = columns.map((c, i) => `<div class="gantt-hd-cell ${c.isWeekend ? 'weekend' : ''}" style="left:${i * COL_W}px;width:${COL_W}px">${c.label}</div>`).join('');

    const barRows = schedTasks.map((t) => {
      const sIdx = columnIndexOf(columns, t.start_date);
      const eIdx = columnIndexOf(columns, t.end_date);
      const left = Math.max(0, sIdx) * COL_W;
      const width = Math.max(COL_W * 0.5, (eIdx - Math.max(0, sIdx) + 1) * COL_W);
      const crit = state.showCrit && t.is_critical ? 'crit' : '';
      return `<div class="gantt-track">
        <div class="gbar ${t.status} ${crit}" data-task="${t.id}" style="left:${left}px;width:${width}px" title="${esc(t.name)} (${fmtDate(t.start_date)} → ${fmtDate(t.end_date)}, ${t.duration}d)">
          <div class="fill" style="width:${t.progress}%"></div>
          <span class="lbl">${t.progress}%</span>
        </div>
      </div>`;
    }).join('');

    // today marker
    const todayIdx = columnIndexOf(columns, today);
    const todayMarker = todayIdx >= 0 && todayIdx < columns.length ? `<div class="gantt-today" style="left:${todayIdx * COL_W + COL_W / 2}px"></div>` : '';

    // grid lines
    const grid = columns.map((c, i) => `<div class="gantt-grid" style="left:${i * COL_W}px;width:${COL_W}px"></div>`).join('');

    mount.innerHTML = `
      <div class="gantt">
        <div class="gantt-left">
          <div class="gantt-row hd">Task</div>
          ${leftRows}
        </div>
        <div class="gantt-right" id="gantt-scroll">
          <div style="position:relative;width:${trackW}px">
            <div class="gantt-track hd" style="position:relative">${headerCells}</div>
            ${grid}
            ${todayMarker}
            ${barRows}
            <svg class="dep-svg" width="${trackW}" height="${(schedTasks.length + 1) * 34}" id="dep-svg"></svg>
          </div>
        </div>
      </div>`;

    // dependency arrows
    if (state.showDeps) {
      const full = await API.get('/api/projects/' + pid + '/tasks');
      const deps = (full.tasks || []).flatMap((t) => (t.dependencies || []));
      drawDependencies(schedTasks, deps, columns, COL_W);
    }

    // interactions
    $$('.gbar', mount).forEach((bar) => {
      bar.onclick = () => openTask(+bar.dataset.task);
      if (isAdmin) attachDrag(bar, schedTasks, columns, COL_W, pid);
    });

    // scroll to today on load
    if (todayIdx >= 0) $('#gantt-scroll').scrollLeft = Math.max(0, todayIdx * COL_W - 200);
  }

  function buildColumns(start, end, view) {
    const cols = [];
    let cur = start;
    if (view === 'day') {
      while (cur <= end) { const d = parseISO(cur); const wd = d.getUTCDay(); cols.push({ date: cur, label: `${d.getUTCDate()}`, isWeekend: wd === 0 || wd === 6 }); cur = addDays(cur, 1); }
    } else if (view === 'week') {
      while (cur <= end) { const d = parseISO(cur); cols.push({ date: cur, label: `Wk ${d.getUTCDate()}/${d.getUTCMonth() + 1}`, isWeekend: false }); cur = addDays(cur, 7); }
    } else {
      // month view: one column per calendar month in range
      let y = parseISO(cur).getUTCFullYear(), m = parseISO(cur).getUTCMonth();
      const endY = parseISO(end).getUTCFullYear(), endM = parseISO(end).getUTCMonth();
      let guard = 0;
      while ((y < endY || (y === endY && m <= endM)) && guard++ < 600) {
        cols.push({ date: `${y}-${String(m + 1).padStart(2, '0')}`, label: new Date(y, m, 1).toLocaleString(undefined, { month: 'short', year: '2-digit' }), isWeekend: false });
        m++; if (m > 11) { m = 0; y++; }
      }
    }
    return cols;
  }

  function columnIndexOf(columns, date) {
    if (!date) return -1;
    // month view: find matching YYYY-MM
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      if (c.date.length === 7) { if (date.slice(0, 7) === c.date) return i; }
      else if (c.date === date) return i;
    }
    // nearest earlier
    let idx = -1;
    for (let i = 0; i < columns.length; i++) if (columns[i].date <= date) idx = i;
    return idx;
  }

  function drawDependencies(tasks, deps, columns, COL_W) {
    const svg = $('#dep-svg');
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const rows = new Map(tasks.map((t, i) => [t.id, i]));
    let paths = '';
    for (const d of deps) {
      const p = byId.get(d.predecessor_id), s = byId.get(d.successor_id);
      if (!p || !s) continue;
      const pi = rows.get(p.id), si = rows.get(s.id);
      const px = (columnIndexOf(columns, p.end_date) + 1) * COL_W;
      const py = pi * 34 + 17;
      const sx = columnIndexOf(columns, s.start_date) * COL_W;
      const sy = si * 34 + 17;
      const midX = Math.min(px + 8, sx - 4);
      const col = d.type === 'SS' ? 'var(--med)' : 'var(--muted)';
      paths += `<path d="M ${px} ${py} H ${midX} V ${sy} H ${sx}" fill="none" stroke="${col}" stroke-width="1.3" marker-end="url(#arrow)" />
        <polygon points="${sx},${sy} ${sx - 6},${sy - 3.5} ${sx - 6},${sy + 3.5}" fill="${col}" />`;
    }
    svg.innerHTML = `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--muted)" /></marker></defs>` + paths;
  }

  async function attachDrag(bar, tasks, columns, COL_W, projId) {
    let startX = 0, origLeft = 0, dragging = false, moved = false;
    const onDown = (e) => { dragging = true; moved = false; startX = e.clientX || e.touches[0].clientX; origLeft = parseFloat(bar.style.left); bar.style.opacity = '0.7'; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp); };
    const onMove = (e) => { if (!dragging) return; const x = e.clientX || (e.touches && e.touches[0].clientX); const dx = x - startX; if (Math.abs(dx) > 4) moved = true; bar.style.left = (origLeft + dx) + 'px'; };
    const onUp = async (e) => {
      if (!dragging) return; dragging = false; bar.style.opacity = '1';
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
      if (!moved) return;
      const newLeft = parseFloat(bar.style.left);
      const deltaCols = Math.round((newLeft - origLeft) / COL_W);
      if (deltaCols === 0) return;
      const tid = +bar.dataset.task;
      const task = tasks.find((t) => t.id === tid);
      let newStart = task.start_date;
      if (state.view === 'month') { toast('Drag rescheduling is most precise in Day/Week view', 'warn'); render(); return; }
      newStart = addDays(task.start_date, deltaCols * (state.view === 'week' ? 7 : 1));
      try { await API.put('/api/tasks/' + tid, { start_date: newStart }); toast('Start date updated & rescheduled', 'success'); render(); }
      catch (err) { toast(err.message, 'error'); render(); }
    };
    bar.addEventListener('mousedown', onDown);
    bar.addEventListener('touchstart', onDown, { passive: true });
  }

  async function openTask(id) {
    const { task, assignments, dependencies } = await API.get('/api/tasks/' + id);
    const m = modal(`
      <h2>${esc(task.name)} ${task.is_critical ? '<span class="badge critical">Critical</span>' : ''}</h2>
      <div class="form-row mb">
        <div><strong class="muted">Status</strong><div>${statusBadge(task.status)}</div></div>
        <div><strong class="muted">Priority</strong><div>${prioBadge(task.priority)}</div></div>
        <div><strong class="muted">Duration</strong><div>${task.duration} workdays</div></div>
        <div><strong class="muted">Progress</strong><div>${task.progress}%</div></div>
        <div><strong class="muted">Start</strong><div>${fmtDate(task.start_date)}</div></div>
        <div><strong class="muted">End</strong><div>${fmtDate(task.end_date)}</div></div>
      </div>
      ${task.description ? `<p class="muted mb">${esc(task.description)}</p>` : ''}
      ${assignments.length ? `<div><strong class="muted">Assignees</strong><div>${assignments.map((a) => esc(a.full_name)).join(', ')}</div></div>` : ''}
      <div class="modal-foot"><button class="btn" data-x>Close</button>${isAdmin ? `<a class="btn primary" href="#/tasks" onclick="document.querySelector('.modal-overlay').remove()">Edit in Tasks</a>` : ''}</div>`);
    $('[data-x]', m.body).onclick = m.close;
  }

  // wire controls
  $$('[data-view]').forEach((b) => b.onclick = () => { state.view = b.dataset.view; $$('[data-view]').forEach((x) => x.classList.toggle('active', x === b)); render(); });
  $('#show-deps').onchange = (e) => { state.showDeps = e.target.checked; render(); };
  $('#show-crit').onchange = (e) => { state.showCrit = e.target.checked; render(); };
  $('#recalc').onclick = async () => { try { await API.post('/api/projects/' + pid + '/reschedule'); toast('Schedule recalculated', 'success'); render(); } catch (e) { toast(e.message, 'error'); } };

  renderPicker($('#picker-mount'), (id) => { pid = id; render(); });
});
