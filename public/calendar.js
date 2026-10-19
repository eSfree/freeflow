// Calendar (workweek + holidays) + Leave calendar + conflict detection
route('calendar', async (rest, root) => {
  setTitle('Calendar & Leave');
  const isAdmin = PF.ME.role === 'admin';
  let projects = await loadProjects();
  if (!projects.length) {
    root.innerHTML = `<div class="panel"><div class="empty"><div class="big">📅</div><h3>No projects yet</h3><p>Create a project to configure its work calendar.</p><a class="btn primary" href="#/projects" style="margin-top:12px">Go to Projects</a></div></div>`;
    return;
  }
  let pid = projects[0].id;

  root.innerHTML = `
    <div id="picker-mount"></div>
    <div class="panel mt">
      <div class="panel-head"><h2>Work Calendar</h2></div>
      <div id="cal-mount"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Holidays</h2>${isAdmin ? '<button class="btn primary" id="add-holiday">+ Add Holiday</button>' : ''}</div>
      <div id="holiday-mount"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Leave & Availability</h2><button class="btn" id="check-conflicts">Check Conflicts</button></div>
      <div id="leave-mount"></div>
      <div id="conflict-mount" class="mt"></div>
    </div>`;

  async function renderCalendar() {
    const { calendar, holidays } = await API.get('/api/projects/' + pid + '/calendar');
    const workweek = (calendar.workweek || '1,2,3,4,5').split(',').map(Number);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    $('#cal-mount').innerHTML = `
      <form id="cal-form">
        <div class="field"><label>Working Days</label>
          <div class="flex wrap">${days.map((d, i) => `<label class="tag" style="cursor:pointer"><input type="checkbox" name="d${i}" ${workweek.includes(i) ? 'checked' : ''} style="width:auto;margin-right:4px" />${d}</label>`).join('')}</div>
        </div>
        ${isAdmin ? '<button class="btn primary" type="submit">Save Calendar</button>' : ''}
      </form>
      <p class="muted mt" style="font-size:12px">Working-day calculations for task duration and finish dates use this calendar. Changes trigger rescheduling of affected tasks.</p>`;
    if (isAdmin) $('#cal-form').onsubmit = async (e) => {
      e.preventDefault();
      const wk = [];
      for (let i = 0; i < 7; i++) if ($(`[name=d${i}]`).checked) wk.push(i);
      const weekend = [0, 1, 2, 3, 4, 5, 6].filter((i) => !wk.includes(i));
      try { await API.put('/api/projects/' + pid + '/calendar', { workweek: wk.join(','), weekend_days: weekend.join(',') }); toast('Calendar saved & schedule recalculated', 'success'); renderHolidays(); }
      catch (err) { toast(err.message, 'error'); }
    };
    renderHolidays(holidays);
  }

  async function renderHolidays(existing) {
    let holidays = existing;
    if (!holidays) holidays = (await API.get('/api/projects/' + pid + '/calendar')).holidays;
    const today = todayISO();
    $('#holiday-mount').innerHTML = holidays.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Date</th><th>Name</th><th>Kind</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
      <tbody>${holidays.map((h) => `<tr>
        <td>${fmtDate(h.date)}</td><td>${esc(h.name)}</td><td><span class="badge ${h.kind === 'national' ? 'high' : 'medium'}">${h.kind}</span></td>
        ${isAdmin ? `<td><div class="row-actions"><button class="btn sm" data-eh="${h.id}">Edit</button><button class="btn sm danger" data-dh="${h.id}">Del</button></div></td>` : ''}
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:20px"><p>No holidays configured for this project.</p></div>';
    if (isAdmin) {
      $$('[data-eh]').forEach((b) => b.onclick = () => openHoliday(+b.dataset.eh));
      $$('[data-dh]').forEach((b) => b.onclick = () => {
        confirmDialog('Delete this holiday?', async () => { try { await API.del('/api/holidays/' + b.dataset.dh); toast('Holiday deleted', 'success'); renderHolidays(); } catch (e) { toast(e.message, 'error'); } }, { danger: true, yes: 'Delete' });
      });
    }
  }

  function openHoliday(id) {
    let h = { date: todayISO(), name: '', kind: 'national' };
    const m = modal(`
      <h2>${id ? 'Edit Holiday' : 'Add Holiday'}</h2>
      <form id="hol-form">
        <div class="field"><label>Date *</label><input name="date" type="date" required value="${h.date}" /></div>
        <div class="field"><label>Name *</label><input name="name" required /></div>
        <div class="field"><label>Kind</label><select name="kind"><option value="national">National</option><option value="special">Special</option></select></div>
        <div class="form-err" id="hol-err" style="display:none"></div>
        <div class="modal-foot"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">${id ? 'Save' : 'Add'}</button></div>
      </form>`);
    $('[data-x]', m.body).onclick = m.close;
    $('#hol-form', m.body).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        if (id) await API.put('/api/holidays/' + id, body); else await API.post('/api/projects/' + pid + '/holidays', body);
        toast('Holiday saved & schedule recalculated', 'success'); m.close(); renderHolidays();
      } catch (err) { const er = $('#hol-err'); er.textContent = err.message; er.style.display = 'block'; }
    };
  }

  async function renderLeaves() {
    const { members } = await API.get('/api/members');
    const mount = $('#leave-mount');
    if (!members.length) { mount.innerHTML = '<p class="muted">No team members yet.</p>'; return; }
    const all = [];
    for (const m of members) {
      const { leaves } = await API.get('/api/members/' + m.id + '/leaves');
      leaves.forEach((l) => all.push({ ...l, member: m.full_name }));
    }
    all.sort((a, b) => a.start_date.localeCompare(b.start_date));
    mount.innerHTML = all.length ? all.map((l) => `<div class="leave-block">
      <strong>${esc(l.member)}</strong> · ${fmtDate(l.start_date)} → ${fmtDate(l.end_date)} · ${esc(l.type)} <span class="badge ${l.status}">${l.status}</span>${l.notes ? ` — <span class="muted">${esc(l.notes)}</span>` : ''}
    </div>`).join('') : '<p class="muted">No leave records.</p>';
  }

  async function checkConflicts() {
    const { members } = await API.get('/api/members');
    const mount = $('#conflict-mount');
    mount.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    let html = '';
    let count = 0;
    for (const m of members) {
      const { conflicts } = await API.get('/api/members/' + m.id + '/conflicts');
      if (conflicts.length) {
        count += conflicts.length;
        html += `<div class="leave-block" style="border-left-color:var(--bad);background:rgba(239,68,68,.1)">
          <strong>${esc(m.full_name)}</strong> — ${conflicts.length} conflict(s)
          <ul style="margin:6px 0 0 16px">${conflicts.map((c) => `<li>Assigned to <strong>${esc(c.task_name)}</strong> (${fmtDate(c.task_start)} → ${fmtDate(c.task_end)}) but on leave ${fmtDate(c.leave_start)} → ${fmtDate(c.leave_end)}</li>`).join('')}</ul>
        </div>`;
      }
    }
    mount.innerHTML = count ? `<h3 style="font-size:13px;margin-bottom:8px;color:var(--bad)">⚠ ${count} Availability Conflict(s)</h3>` + html : '<p class="muted">✓ No assignment/leave conflicts detected.</p>';
  }

  $('#add-holiday').onclick = () => openHoliday(null);
  $('#check-conflicts').onclick = checkConflicts;
  renderPicker($('#picker-mount'), (id) => { pid = id; renderCalendar(); renderLeaves(); $('#conflict-mount').innerHTML = ''; });
});
