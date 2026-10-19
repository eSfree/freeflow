// Reports (with CSV export) + Dependencies management page
route('reports', async (rest, root) => {
  setTitle('Reports');
  const projects = await loadProjects();
  if (!projects.length) {
    root.innerHTML = `<div class="panel"><div class="empty"><div class="big">📊</div><h3>No projects yet</h3><p>Create a project to generate reports.</p><a class="btn primary" href="#/projects" style="margin-top:12px">Go to Projects</a></div></div>`;
    return;
  }
  let pid = rest[0] ? +rest[0] : projects[0].id;
  const members = (await API.get('/api/members')).members;
  const state = { status: '', priority: '', member_id: '', from: '', to: '' };

  root.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Project Report</h2>
        <div class="flex wrap">
          <select id="r-proj" style="width:220px">${projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <button class="btn primary" id="export-csv">⬇ Export CSV</button>
        </div>
      </div>
      <div class="flex wrap mb">
        <select id="r-status"><option value="">All status</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="r-prio"><option value="">All priority</option>${Object.entries(PRIORITY_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="r-member"><option value="">All members</option>${members.map((m) => `<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}</select>
        <input type="date" id="r-from" style="width:160px" title="From" />
        <input type="date" id="r-to" style="width:160px" title="To" />
        <button class="btn sm" id="r-apply">Apply</button>
      </div>
      <div id="report-mount"></div>
    </div>`;

  async function render() {
    const mount = $('#report-mount');
    mount.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const params = new URLSearchParams(state);
    const { report } = await API.get(`/api/projects/${pid}/report?` + params);
    const p = report.project;
    mount.innerHTML = `
      <div class="cards c4 mb">
        <div class="card"><h3>Target End</h3><div class="stat" style="font-size:18px">${fmtDate(p.target_end_date)}</div></div>
        <div class="card"><h3>Estimated Finish</h3><div class="stat" style="font-size:18px">${fmtDate(report.estimated_finish)}</div></div>
        <div class="card"><h3>Duration</h3><div class="stat" style="font-size:18px">${report.project_duration_workdays} workdays</div></div>
        <div class="card"><h3>Critical Tasks</h3><div class="stat" style="font-size:18px;color:${report.critical.length ? 'var(--crit)' : 'inherit'}">${report.critical.length}</div></div>
      </div>
      ${report.critical_paths && report.critical_paths.length ? `<div class="mb"><strong class="muted">Critical path(s):</strong> ${report.critical_paths.map((cp) => cp.map((n) => esc(n.name)).join(' → ')).join(' | ')}</div>` : ''}
      ${report.overdue.length ? `<div class="mb"><strong class="muted">Overdue:</strong> ${report.overdue.map(esc).join(', ')}</div>` : ''}
      <div class="tbl-wrap"><table>
        <thead><tr><th>Task</th><th>Start</th><th>End</th><th>Dur</th><th>Status</th><th>Prog</th><th>Prio</th><th>Crit</th><th>Float</th><th>Members</th><th>Predecessors</th></tr></thead>
        <tbody>${report.tasks.map((t) => `<tr>
          <td>${esc(t.name)}</td><td>${fmtDate(t.start_date)}</td><td>${fmtDate(t.end_date)}</td><td>${t.duration}d</td>
          <td>${statusBadge(t.status)}</td><td>${t.progress}%</td><td>${prioBadge(t.priority)}</td>
          <td>${t.is_critical ? '<span class="badge critical">CRIT</span>' : '<span class="muted">—</span>'}</td>
          <td>${t.total_float != null ? t.total_float + 'd' : '—'}</td>
          <td class="muted">${t.members.map((m) => esc(m.full_name)).join(', ') || '—'}</td>
          <td class="muted">${t.dependencies.map((d) => esc(d.pred_name) + `(${d.type})`).join(', ') || '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${!report.tasks.length ? '<div class="empty"><p>No tasks match the filters.</p></div>' : ''}
      <h3 style="margin-top:22px;font-size:14px">Workload Summary</h3>
      <div class="tbl-wrap"><table><thead><tr><th>Member</th><th>Tasks</th></tr></thead>
      <tbody>${report.workload.map((w) => `<tr><td>${esc(w.full_name)}</td><td>${w.tasks}</td></tr>`).join('')}</tbody></table></div>`;
  }

  $('#r-apply').onclick = () => {
    state.status = $('#r-status').value; state.priority = $('#r-prio').value;
    state.member_id = $('#r-member').value; state.from = $('#r-from').value; state.to = $('#r-to').value;
    render();
  };
  $('#r-proj').onchange = (e) => { pid = +e.target.value; render(); };
  $('#export-csv').onclick = () => {
    const params = new URLSearchParams(state); params.set('format', 'csv');
    window.open(`/api/projects/${pid}/report?` + params, '_blank');
  };
  render();
});

// ---------- Dependencies management (separate route under tasks) ----------
route('deps', async (rest, root) => {
  setTitle('Task Dependencies');
  const projects = await loadProjects();
  if (!projects.length) { root.innerHTML = '<div class="panel"><div class="empty"><p>Create a project first.</p></div></div>'; return; }
  let pid = projects[0].id;

  root.innerHTML = `
    <div id="picker-mount"></div>
    <div class="panel mt">
      <div class="panel-head"><h2>Dependencies</h2><button class="btn primary" id="add-dep">+ Add Dependency</button></div>
      <div id="deps-mount"></div>
    </div>`;

  async function renderDeps() {
    const mount = $('#deps-mount');
    mount.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const { tasks, dependencies } = await API.get('/api/projects/' + pid + '/tasks');
    const deps = dependencies || tasks.flatMap((t) => (t.dependencies || []));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    if (!deps.length) { mount.innerHTML = '<div class="empty"><p>No dependencies defined for this project.</p></div>'; return; }
    mount.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>Predecessor</th><th>Type</th><th>Lag</th><th>Successor</th><th></th></tr></thead>
      <tbody>${deps.map((d) => `<tr>
        <td>${esc((byId.get(d.predecessor_id) || {}).name || '#' + d.predecessor_id)}</td>
        <td><span class="badge ${d.type === 'SS' ? 'medium' : 'active'}">${d.type}</span></td>
        <td>${d.lag || 0}d</td>
        <td>${esc((byId.get(d.successor_id) || {}).name || '#' + d.successor_id)}</td>
        <td><button class="btn sm danger" data-del="${d.id}">Remove</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    $$('[data-del]').forEach((b) => b.onclick = () => {
      confirmDialog('Remove this dependency?', async () => {
        try { await API.del('/api/dependencies/' + b.dataset.del); toast('Dependency removed', 'success'); renderDeps(); }
        catch (e) { toast(e.message, 'error'); }
      }, { danger: true, yes: 'Remove' });
    });
  }

  async function openDep() {
    const { tasks } = await API.get('/api/projects/' + pid + '/tasks');
    if (tasks.length < 2) { toast('Need at least two tasks to create a dependency', 'warn'); return; }
    const opts = tasks.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const m = modal(`
      <h2>Add Dependency</h2>
      <form id="dep-form">
        <div class="field"><label>Predecessor (comes first)</label><select name="predecessor_id" required>${opts}</select></div>
        <div class="field"><label>Successor (dependent task)</label><select name="successor_id" required>${opts}</select></div>
        <div class="form-row">
          <div class="field"><label>Type</label><select name="type"><option value="FS">Finish → Start (FS)</option><option value="SS">Start → Start (SS)</option></select></div>
          <div class="field"><label>Lag (workdays, ±)</label><input name="lag" type="number" value="0" /></div>
        </div>
        <div class="field"><label>Notes</label><input name="notes" /></div>
        <div class="form-err" id="dep-err" style="display:none"></div>
        <div class="modal-foot"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">Add</button></div>
      </form>`);
    $('[data-x]', m.body).onclick = m.close;
    $('#dep-form', m.body).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.lag = +body.lag; body.predecessor_id = +body.predecessor_id; body.successor_id = +body.successor_id;
      if (body.predecessor_id === body.successor_id) { const er = $('#dep-err'); er.textContent = 'A task cannot depend on itself.'; er.style.display = 'block'; return; }
      try { await API.post('/api/tasks/' + body.successor_id + '/dependencies', body); toast('Dependency added & rescheduled', 'success'); m.close(); renderDeps(); }
      catch (err) { const er = $('#dep-err'); er.textContent = err.message; er.style.display = 'block'; }
    };
  }

  $('#add-dep').onclick = openDep;
  renderPicker($('#picker-mount'), (id) => { pid = id; renderDeps(); });
});
