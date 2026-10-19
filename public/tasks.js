// Tasks + Dependencies management
route('tasks', async (rest, root) => {
  setTitle('Tasks');
  const isAdmin = PF.ME.role === 'admin';
  const state = { q: '', status: '', priority: '', sort: 'name' };
  let projects = [];
  let pid = null;

  projects = (await loadProjects());
  if (!projects.length) {
    root.innerHTML = `<div class="panel"><div class="empty"><div class="big">☑</div><h3>No projects yet</h3><p>Create a project first to add tasks.</p><a class="btn primary" href="#/projects" style="margin-top:12px">Go to Projects</a></div></div>`;
    return;
  }
  pid = CURRENT_PROJECT.id && projects.some((p) => p.id === CURRENT_PROJECT.id) ? CURRENT_PROJECT.id : projects[0].id;

  root.innerHTML = `
    <div class="panel">
      <div id="picker-mount"></div>
      <div class="panel-head" style="margin-top:16px">
        <h2>Tasks</h2>
        <div class="flex wrap">
          <input id="tq" placeholder="Search tasks…" style="width:180px" />
          <select id="tstatus" style="width:140px"><option value="">All status</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select id="tprio" style="width:130px"><option value="">All priority</option>${Object.entries(PRIORITY_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select id="tsort" style="width:140px">
            <option value="name">Sort: Name</option><option value="start">Start</option><option value="end">End</option>
            <option value="status">Status</option><option value="priority">Priority</option><option value="progress">Progress</option>
          </select>
          ${isAdmin ? '<button class="btn primary" id="new-task">+ New Task</button>' : ''}
        </div>
      </div>
      <div id="tasks-mount"></div>
    </div>`;

  async function renderTasks() {
    const mount = $('#tasks-mount');
    mount.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const params = new URLSearchParams({ project_id: pid, q: state.q, status: state.status, priority: state.priority, sort: state.sort });
    const { tasks, tree } = await API.get('/api/projects/' + pid + '/tasks?' + params);

    // flat table
    const rows = tasks.map((t) => `
      <tr>
        <td>${t.parent_id ? '<span class="muted">└ </span>' : ''}<strong>${esc(t.name)}</strong></td>
        <td>${statusBadge(t.status)}</td>
        <td>${prioBadge(t.priority)}</td>
        <td>${t.duration}d</td>
        <td>${fmtDate(t.start_date)}</td>
        <td>${fmtDate(t.end_date)}</td>
        <td><div class="flex">${progressBar(t.progress)}<span class="muted">${t.progress}%</span></div></td>
        <td class="muted">${(t.assignments || []).map((a) => esc(a.full_name)).join(', ') || '—'}</td>
        <td><div class="row-actions">
          <button class="btn sm" data-detail="${t.id}">Detail</button>
          ${isAdmin ? `<button class="btn sm" data-edit="${t.id}">Edit</button><button class="btn sm danger" data-del="${t.id}">Del</button>` : `<button class="btn sm" data-progress="${t.id}">Update</button>`}
        </div></td>
      </tr>`).join('');

    mount.innerHTML = `
      <div class="tbl-wrap"><table>
        <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Duration</th><th>Start</th><th>End</th><th>Progress</th><th>Assignees</th><th>Actions</th></tr></thead>
        <tbody>${rows || ''}</tbody></table></div>
      ${!tasks.length ? '<div class="empty"><p>No tasks match filters.</p></div>' : ''}
      <h3 style="margin-top:24px;font-size:14px">Task Hierarchy</h3>
      <div id="tree-mount" class="mt"></div>`;

    renderTree($('#tree-mount'), tree);
    $$('[data-detail]').forEach((b) => b.onclick = () => openDetail(+b.dataset.detail));
    if (isAdmin) $$('[data-edit]').forEach((b) => b.onclick = () => openForm(+b.dataset.edit));
    if (isAdmin) $$('[data-del]').forEach((b) => b.onclick = () => deleteTask(+b.dataset.del));
    else $$('[data-progress]').forEach((b) => b.onclick = () => openProgress(+b.dataset.progress));
  }

  function renderTree(mount, tree, depth) {
    depth = depth || 0;
    if (!tree.length) { mount.innerHTML += depth === 0 ? '<p class="muted">No tasks yet.</p>' : ''; return; }
    const html = tree.map((t) => `
      <div style="margin-left:${depth * 22}px;padding:5px 8px;border-left:2px solid ${t.is_critical ? 'var(--crit)' : 'var(--line)'};margin-bottom:2px">
        <strong>${esc(t.name)}</strong> <span class="muted mono">#${t.id}</span> ${statusBadge(t.status)} <span class="muted">${t.duration}d · ${t.progress}%</span>
      </div>`).join('');
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    mount.appendChild(wrap);
    tree.forEach((t) => { if (t.subtasks && t.subtasks.length) renderTree(mount, t.subtasks, depth + 1); });
  }

  async function openDetail(id) {
    const { task, assignments, dependencies } = await API.get('/api/tasks/' + id);
    const preds = dependencies.filter((d) => d.successor_id === id);
    const succs = dependencies.filter((d) => d.predecessor_id === id);
    const nameOf = async (tid) => { const t = await API.get('/api/tasks/' + tid); return t.task.name; };
    let predHtml = '—', succHtml = '—';
    if (preds.length) predHtml = (await Promise.all(preds.map(async (d) => `${esc(await nameOf(d.predecessor_id))} (${d.type}${d.lag ? ', lag ' + d.lag : ''})`))).join('<br>');
    if (succs.length) succHtml = (await Promise.all(succs.map(async (d) => `${esc(await nameOf(d.successor_id))} (${d.type})`))).join('<br>');

    const m = modal(`
      <h2>${esc(task.name)} <span class="mono muted">#${task.id}</span></h2>
      <div class="cards c2" style="margin-bottom:16px">
        <div class="card"><h3>Status</h3>${statusBadge(task.status)}</div>
        <div class="card"><h3>Priority</h3>${prioBadge(task.priority)}</div>
        <div class="card"><h3>Duration</h3><div class="stat" style="font-size:20px">${task.duration} workdays</div></div>
        <div class="card"><h3>Progress</h3><div class="stat" style="font-size:20px">${task.progress}%</div>${progressBar(task.progress)}</div>
      </div>
      <div class="form-row mb">
        <div><strong class="muted">Start</strong><div>${fmtDate(task.start_date)}</div></div>
        <div><strong class="muted">End (calculated)</strong><div>${fmtDate(task.end_date)}</div></div>
      </div>
      ${task.description ? `<p class="muted mb">${esc(task.description)}</p>` : ''}
      <div class="form-row mb">
        <div><strong class="muted">Predecessors</strong><div>${predHtml}</div></div>
        <div><strong class="muted">Successors</strong><div>${succHtml}</div></div>
      </div>
      ${assignments.length ? `<div><strong class="muted">Assigned To</strong><div>${assignments.map((a) => esc(a.full_name) + (a.role ? ` (${esc(a.role)})` : '')).join(', ')}</div></div>` : ''}
      ${task.notes ? `<div class="mt"><strong class="muted">Notes</strong><div>${esc(task.notes)}</div></div>` : ''}
      <div class="modal-foot"><button class="btn" data-x>Close</button></div>`);
    $('[data-x]', m.body).onclick = m.close;
  }

  async function openForm(id) {
    let t = { name: '', description: '', start_date: todayISO(), duration: 1, priority: 'medium', status: 'not_started', progress: 0, notes: '', parent_id: null };
    if (id) t = (await API.get('/api/tasks/' + id)).task;
    // parent options (same project, exclude self)
    const { tasks: all } = await API.get('/api/projects/' + pid + '/tasks');
    const parents = all.filter((x) => x.id !== id);

    const m = modal(`
      <h2>${id ? 'Edit Task' : 'New Task'}</h2>
      <form id="task-form">
        <div class="field"><label>Task Name *</label><input name="name" required value="${esc(t.name)}" /></div>
        <div class="form-row">
          <div class="field"><label>Start Date</label><input name="start_date" type="date" value="${t.start_date || ''}" /></div>
          <div class="field"><label>Duration (workdays) *</label><input name="duration" type="number" min="0" required value="${t.duration}" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Priority</label><select name="priority">${Object.entries(PRIORITY_LABEL).map(([k, v]) => `<option value="${k}" ${t.priority === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Status</label><select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Progress (%)</label><input name="progress" type="number" min="0" max="100" value="${t.progress}" /></div>
        <div class="field"><label>Parent Task (for subtask)</label><select name="parent_id"><option value="">— none (top-level) —</option>${parents.map((p) => `<option value="${p.id}" ${t.parent_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Description</label><textarea name="description">${esc(t.description || '')}</textarea></div>
        <div class="field"><label>Notes</label><textarea name="notes">${esc(t.notes || '')}</textarea></div>
        <div class="form-err" id="task-err" style="display:none"></div>
        <div class="modal-foot"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">${id ? 'Save' : 'Create Task'}</button></div>
      </form>`, { wide: true });
    $('[data-x]', m.body).onclick = m.close;
    $('#task-form', m.body).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.parent_id = body.parent_id ? +body.parent_id : null;
      body.duration = +body.duration; body.progress = +body.progress;
      try {
        if (id) await API.put('/api/tasks/' + id, body);
        else await API.post('/api/projects/' + pid + '/tasks', body);
        toast(id ? 'Task updated' : 'Task created', 'success'); m.close(); renderTasks();
      } catch (err) { const er = $('#task-err'); er.textContent = err.message; er.style.display = 'block'; }
    };
  }

  // Member-only progress/status update
  async function openProgress(id) {
    const { task } = await API.get('/api/tasks/' + id);
    const m = modal(`
      <h2>Update: ${esc(task.name)}</h2>
      <form id="prog-form">
        <div class="field"><label>Status</label><select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${task.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Progress (%)</label><input name="progress" type="number" min="0" max="100" value="${task.progress}" /></div>
        <div class="field"><label>Notes</label><textarea name="notes">${esc(task.notes || '')}</textarea></div>
        <div class="modal-foot"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">Save</button></div>
      </form>`);
    $('[data-x]', m.body).onclick = m.close;
    $('#prog-form', m.body).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries()); body.progress = +body.progress;
      try { await API.put('/api/tasks/' + id, body); toast('Updated', 'success'); m.close(); renderTasks(); }
      catch (err) { toast(err.message, 'error'); }
    };
  }

  async function deleteTask(id) {
    confirmDialog('Delete this task? Subtasks and dependencies will also be removed.', async () => {
      try { await API.del('/api/tasks/' + id); toast('Task deleted', 'success'); renderTasks(); }
      catch (err) {
        if (err.data && err.data.needs_confirmation) {
          confirmDialog(err.data.error + ' Continue?', async () => {
            try { await API.del('/api/tasks/' + id + '?force=1'); toast('Task and dependencies deleted', 'success'); renderTasks(); }
            catch (e2) { toast(e2.message, 'error'); }
          }, { danger: true, yes: 'Delete anyway' });
        } else toast(err.message, 'error');
      }
    }, { danger: true, yes: 'Delete' });
  }

  // wire up controls
  $('#tq').oninput = (e) => { state.q = e.target.value; renderTasks(); };
  $('#tstatus').onchange = (e) => { state.status = e.target.value; renderTasks(); };
  $('#tprio').onchange = (e) => { state.priority = e.target.value; renderTasks(); };
  $('#tsort').onchange = (e) => { state.sort = e.target.value; renderTasks(); };
  if (isAdmin) $('#new-task').onclick = () => openForm(null);

  renderPicker($('#picker-mount'), (id) => { pid = id; renderTasks(); });
});
