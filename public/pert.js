// PERT / Network Diagram with layered layout, critical path highlighting, zoom
route('pert', async (rest, root) => {
  setTitle('PERT Chart');
  const state = { zoom: 1 };
  let projects = await loadProjects();
  if (!projects.length) {
    root.innerHTML = `<div class="panel"><div class="empty"><div class="big">◈</div><h3>No projects yet</h3><p>Create a project to view its network diagram.</p><a class="btn primary" href="#/projects" style="margin-top:12px">Go to Projects</a></div></div>`;
    return;
  }
  let pid = rest[0] ? +rest[0] : projects[0].id;

  root.innerHTML = `
    <div id="picker-mount"></div>
    <div class="panel mt">
      <div class="panel-head">
        <h2 id="pert-title">Network Diagram</h2>
        <div class="zoom-ctrl">
          <button class="btn sm" id="zoom-out">−</button>
          <span class="muted" id="zoom-val">100%</span>
          <button class="btn sm" id="zoom-in">+</button>
          <button class="btn sm" id="zoom-fit">Fit</button>
          <label class="tag"><input type="checkbox" id="pert-crit" checked style="width:auto" /> Critical path</label>
        </div>
      </div>
      <div class="gantt-toolbar mb">
        <input id="pert-project-input" type="hidden" />
        <span class="muted" style="font-size:12px">Project:</span>
        <select id="pert-proj" style="width:260px">${projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </div>
      <div id="pert-mount" class="pert-wrap"></div>
    </div>`;

  async function render() {
    const mount = $('#pert-mount');
    mount.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const { schedule } = await API.get('/api/projects/' + pid + '/schedule');
    const proj = (await API.get('/api/projects/' + pid)).project;
    $('#pert-title').textContent = proj.name + ' — Network Diagram';
    if (schedule.errors && schedule.errors.length) {
      mount.innerHTML = `<div class="empty"><div class="big">⚠️</div><h3>Scheduling error</h3><p>${esc(schedule.errors[0])}</p><p class="muted">The network cannot be laid out until the dependency cycle is resolved.</p></div>`;
      return;
    }
    const tasks = schedule.tasks || [];
    if (!tasks.length) { mount.innerHTML = '<div class="empty"><div class="big">◈</div><h3>No tasks yet</h3><p>Add tasks and dependencies to see the network.</p></div>'; return; }

    // fetch dependencies
    const full = await API.get('/api/projects/' + pid + '/tasks');
    const deps = (full.tasks || []).flatMap((t) => (t.dependencies || []));
    const byId = new Map(tasks.map((t) => [t.id, t]));

    // layered layout: level = longest path from a source
    const level = new Map(tasks.map((t) => [t.id, 0]));
    // topological-ish relaxation (tasks already have valid order from CPM; do few passes)
    for (let pass = 0; pass < tasks.length; pass++) {
      let changed = false;
      for (const d of deps) {
        const lv = level.get(d.predecessor_id) + 1;
        if (lv > level.get(d.successor_id)) { level.set(d.successor_id, lv); changed = true; }
      }
      if (!changed) break;
    }
    // group by level
    const maxLevel = Math.max(...level.values());
    const columns = Array.from({ length: maxLevel + 1 }, () => []);
    for (const t of tasks) columns[level.get(t.id)].push(t);

    const NODE_W = 168, NODE_H = 96, COL_GAP = 70, ROW_GAP = 24;
    let maxRows = Math.max(...columns.map((c) => c.length));
    const width = (maxLevel + 1) * (NODE_W + COL_GAP) + 40;
    const height = maxRows * (NODE_H + ROW_GAP) + 60;

    // position each node
    const pos = new Map();
    columns.forEach((col, li) => {
      const colH = col.length * (NODE_H + ROW_GAP) - ROW_GAP;
      const startY = (height - colH) / 2;
      col.forEach((t, ri) => {
        pos.set(t.id, { x: 20 + li * (NODE_W + COL_GAP), y: startY + ri * (NODE_H + ROW_GAP) });
      });
    });

    const critOn = $('#pert-crit').checked;
    // nodes
    let nodeHtml = '';
    for (const t of tasks) {
      const p = pos.get(t.id);
      const crit = critOn && t.is_critical ? 'crit' : '';
      nodeHtml += `<div class="pert-node ${crit}" data-task="${t.id}" style="left:${p.x}px;top:${p.y}px">
        <div class="nm">${esc(t.name)}</div>
        <div class="row"><span>Dur</span><span>${t.duration}d</span></div>
        <div class="row"><span>Start</span><span>${fmtDate(t.start_date)}</span></div>
        <div class="row"><span>End</span><span>${fmtDate(t.end_date)}</span></div>
        <div class="row"><span>Float</span><span style="color:${t.is_critical ? 'var(--crit)' : 'var(--ok)'}">${t.total_float}d</span></div>
        <div class="st">${statusBadge(t.status)}</div>
      </div>`;
    }

    // edges
    let edgeHtml = '';
    for (const d of deps) {
      const a = pos.get(d.predecessor_id), b = pos.get(d.successor_id);
      if (!a || !b) continue;
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
      const x2 = b.x, y2 = b.y + NODE_H / 2;
      const isCrit = critOn && byId.get(d.predecessor_id).is_critical && byId.get(d.successor_id).is_critical;
      const col = isCrit ? 'var(--crit)' : (d.type === 'SS' ? 'var(--med)' : 'var(--muted)');
      const midX = (x1 + x2) / 2;
      edgeHtml += `<path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="1.5" />
        <polygon points="${x2},${y2} ${x2 - 9},${y2 - 5} ${x2 - 9},${y2 + 5}" fill="${col}" />
        <text x="${midX}" y="${(y1 + y2) / 2 - 6}" fill="${col}" font-size="10" text-anchor="middle">${d.type}${d.lag ? ' ' + (d.lag > 0 ? '+' : '') + d.lag : ''}</text>`;
    }

    mount.innerHTML = `<div style="position:relative;width:${width}px;height:${height}px;transform:scale(${state.zoom});transform-origin:top left">
      <svg class="pert-svg" width="${width}" height="${height}">${edgeHtml}</svg>
      ${nodeHtml}
    </div>`;

    $$('.pert-node', mount).forEach((n) => n.onclick = () => {
      const t = byId.get(+n.dataset.task);
      modal(`<h2>${esc(t.name)}</h2>
        <div class="form-row mb">
          <div><strong class="muted">Duration</strong><div>${t.duration} workdays</div></div>
          <div><strong class="muted">Float</strong><div>${t.total_float} days</div></div>
          <div><strong class="muted">Start</strong><div>${fmtDate(t.start_date)}</div></div>
          <div><strong class="muted">End</strong><div>${fmtDate(t.end_date)}</div></div>
          <div><strong class="muted">Status</strong><div>${statusBadge(t.status)}</div></div>
          <div><strong class="muted">Critical</strong><div>${t.is_critical ? '<span class="badge critical">Yes</span>' : 'No'}</div></div>
        </div>`);
    });

    updateZoom();
  }

  function updateZoom() { $('#zoom-val').textContent = Math.round(state.zoom * 100) + '%'; }

  $('#zoom-in').onclick = () => { state.zoom = Math.min(2, state.zoom + 0.15); render(); };
  $('#zoom-out').onclick = () => { state.zoom = Math.max(0.4, state.zoom - 0.15); render(); };
  $('#zoom-fit').onclick = () => { state.zoom = 1; render(); };
  $('#pert-crit').onchange = render;
  $('#pert-proj').onchange = (e) => { pid = +e.target.value; render(); };

  render();
});
