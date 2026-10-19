// Dashboard + Projects
route('dashboard', async (rest, root) => {
  setTitle('Dashboard');
  root.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const data = await API.get('/api/dashboard');
  const s = data.stats;
  const cards = `
    <div class="cards c4 mb">
      <div class="card"><h3>Projects</h3><div class="stat">${s.projects}</div><div class="stat-sub">${s.active} active · ${s.completed} completed</div></div>
      <div class="card"><h3>Total Tasks</h3><div class="stat">${s.total_tasks}</div><div class="stat-sub">${s.in_progress} in progress</div></div>
      <div class="card"><h3>Overdue Tasks</h3><div class="stat" style="color:${s.overdue ? 'var(--bad)' : 'inherit'}">${s.overdue}</div><div class="stat-sub">${s.not_started} not started</div></div>
      <div class="card"><h3>Avg Progress</h3><div class="stat">${s.avg_progress}%</div>${progressBar(s.avg_progress)}</div>
    </div>`;

  const projRows = data.projects.map((p) => `
    <tr>
      <td><a href="#/gantt/${p.id}">${esc(p.name)}</a>${p.organization ? `<div class="muted" style="font-size:11px">${esc(p.organization)}</div>` : ''}</td>
      <td>${projBadge(p.status)}</td>
      <td>${fmtDate(p.start_date)}</td>
      <td>${fmtDate(p.target_end_date)}</td>
      <td>${fmtDate(p.estimated_finish)}</td>
      <td><div class="flex">${progressBar(p.progress)}<span class="muted">${p.progress}%</span></div></td>
      <td>${p.task_count}</td>
      <td>${p.critical_tasks ? `<span class="badge critical">${p.critical_tasks} critical</span>` : '<span class="muted">—</span>'}</td>
      <td>${p.overdue ? `<span class="badge high">${p.overdue} late</span>` : '<span class="muted">0</span>'}</td>
    </tr>`).join('');

  const workload = data.workload.map((w) => `
    <tr>
      <td>${esc(w.full_name)}</td>
      <td class="muted">${esc(w.position || '—')}</td>
      <td>${w.open_tasks}</td>
      <td><div class="flex">${progressBar(Math.min(100, w.allocation))}<span class="muted">${w.allocation}%</span></div></td>
    </tr>`).join('');

  root.innerHTML = cards + `
    <div class="panel">
      <div class="panel-head"><h2>Projects Overview</h2><a href="#/projects" class="btn sm">Manage projects →</a></div>
      ${data.projects.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Project</th><th>Status</th><th>Start</th><th>Target End</th><th>Est. Finish</th><th>Progress</th><th>Tasks</th><th>Critical</th><th>Late</th></tr></thead>
        <tbody>${projRows}</tbody></table></div>`
      : '<div class="empty"><div class="big">🗂</div><h3>No projects yet</h3><p>Create your first project to get started.</p></div>'}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Team Workload</h2><a href="#/team" class="btn sm">Team →</a></div>
      ${data.workload.length ? `<div class="tbl-wrap"><table>
        <thead><tr><th>Member</th><th>Position</th><th>Open Tasks</th><th>Allocation</th></tr></thead>
        <tbody>${workload}</tbody></table></div>`
      : '<div class="empty" style="padding:24px"><p>No active team members yet.</p></div>'}
    </div>`;
});

// ---------- Projects CRUD ----------
route('projects', async (rest, root) => {
  setTitle('Projects');
  const isAdmin = PF.ME.role === 'admin';
  const state = { q: '', status: '' };

  async function renderList() {
    const q = new URLSearchParams(state).toString();
    const { projects } = await API.get('/api/projects?' + q);
    const body = projects.map((p) => `
      <tr>
        <td><strong>${esc(p.name)}</strong>${p.organization ? `<div class="muted" style="font-size:11px">${esc(p.organization)}</div>` : ''}</td>
        <td>${projBadge(p.status)}</td>
        <td>${fmtDate(p.start_date)}</td>
        <td>${fmtDate(p.target_end_date)}</td>
        <td>${p.task_count}</td>
        <td class="muted">${esc(p.creator_name || '—')}</td>
        <td><div class="row-actions">
          <a class="btn sm" href="#/gantt/${p.id}">Gantt</a>
          <a class="btn sm" href="#/reports/${p.id}">Report</a>
          ${isAdmin ? `<button class="btn sm" data-edit="${p.id}">Edit</button>
          <button class="btn sm danger" data-del="${p.id}" data-name="${esc(p.name)}">Delete</button>` : ''}
        </div></td>
      </tr>`).join('');
    $('#proj-tbody').innerHTML = body || '';
    $('#proj-empty').style.display = projects.length ? 'none' : 'block';
    $('#proj-table').style.display = projects.length ? 'block' : 'none';
    if (isAdmin) $$('[data-edit]').forEach((b) => b.onclick = () => openForm(+b.dataset.edit));
    if (isAdmin) $$('[data-del]').forEach((b) => b.onclick = () => {
      confirmDialog(`Delete project "${b.dataset.name}"? All tasks, dependencies and calendars will be removed.`, async () => {
        try { await API.del('/api/projects/' + b.dataset.del); toast('Project deleted', 'success'); renderList(); }
        catch (e) { toast(e.message, 'error'); }
      }, { danger: true, yes: 'Delete' });
    });
  }

  async function openForm(id) {
    let p = { name: '', organization: '', description: '', start_date: todayISO(), target_end_date: addDays(todayISO(), 30), status: 'planning' };
    if (id) { p = (await API.get('/api/projects/' + id)).project; }
    const m = modal(`
      <h2>${id ? 'Edit Project' : 'New Project'}</h2>
      <form id="proj-form">
        <div class="field"><label>Project Name *</label><input name="name" required value="${esc(p.name)}" /></div>
        <div class="form-row">
          <div class="field"><label>Organization</label><input name="organization" value="${esc(p.organization || '')}" /></div>
          <div class="field"><label>Status</label><select name="status">
            ${Object.entries(PROJ_STATUS).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Start Date *</label><input name="start_date" type="date" required value="${p.start_date}" /></div>
          <div class="field"><label>Target End Date *</label><input name="target_end_date" type="date" required value="${p.target_end_date}" /></div>
        </div>
        <div class="field"><label>Description</label><textarea name="description">${esc(p.description || '')}</textarea></div>
        <div class="form-err" id="proj-err" style="display:none"></div>
        <div class="modal-foot"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">${id ? 'Save Changes' : 'Create Project'}</button></div>
      </form>`);
    $('[data-x]', m.body).onclick = m.close;
    $('#proj-form', m.body).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.target_end_date < body.start_date) { const er = $('#proj-err'); er.textContent = 'Target end date must be on or after start date.'; er.style.display = 'block'; return; }
      try {
        if (id) await API.put('/api/projects/' + id, body);
        else await API.post('/api/projects', body);
        toast(id ? 'Project updated' : 'Project created', 'success');
        m.close(); renderList();
      } catch (err) { const er = $('#proj-err'); er.textContent = err.message; er.style.display = 'block'; }
    };
  }

  root.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Projects</h2>
        <div class="flex wrap">
          <input id="pq" placeholder="Search name or organization…" style="width:220px" value="${esc(state.q)}" />
          <select id="pstatus" style="width:150px">
            <option value="">All statuses</option>
            ${Object.entries(PROJ_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
          ${isAdmin ? '<button class="btn primary" id="new-proj">+ New Project</button>' : ''}
        </div>
      </div>
      <div id="proj-table" class="tbl-wrap"><table>
        <thead><tr><th>Project</th><th>Status</th><th>Start</th><th>Target End</th><th>Tasks</th><th>Created By</th><th>Actions</th></tr></thead>
        <tbody id="proj-tbody"></tbody></table></div>
      <div id="proj-empty" class="empty" style="display:none"><div class="big">🗂</div><h3>No projects found</h3><p>${isAdmin ? 'Create a project to begin planning.' : 'No projects match your filters.'}</p></div>
    </div>`;

  $('#pq').oninput = (e) => { state.q = e.target.value; renderList(); };
  $('#pstatus').onchange = (e) => { state.status = e.target.value; renderList(); };
  if (isAdmin) $('#new-proj').onclick = () => openForm(null);
  renderList();
});
