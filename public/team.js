// Team Members + Leaves + Assignments
route('team', async (rest, root) => {
  setTitle('Team Members');
  const isAdmin = PF.ME.role === 'admin';
  const state = { q: '', active: '' };

  root.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>Team Members</h2>
        <div class="flex wrap">
          <input id="mq" placeholder="Search name/email/position…" style="width:220px" />
          <select id="mactive" style="width:140px"><option value="">All</option><option value="true">Active</option><option value="false">Inactive</option></select>
          ${isAdmin ? '<button class="btn primary" id="new-member">+ Add Member</button>' : ''}
        </div>
      </div>
      ${isAdmin ? '' : '<p class="muted mb" style="font-size:12px">Salary information is hidden for your role.</p>'}
      <div id="members-mount"></div>
    </div>`;

  async function renderMembers() {
    const mount = $('#members-mount');
    mount.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const params = new URLSearchParams({ q: state.q, active: state.active });
    const { members } = await API.get('/api/members?' + params);
    if (!members.length) { mount.innerHTML = '<div class="empty"><div class="big">👥</div><h3>No team members found</h3><p>Add members to assign them to tasks.</p></div>'; return; }
    const rows = members.map((m) => `
      <tr>
        <td><strong>${esc(m.full_name)}</strong>${!m.is_active ? ' <span class="badge on_hold">Inactive</span>' : ''}</td>
        <td class="muted">${esc(m.email)}</td>
        <td>${esc(m.position || '—')}</td>
        <td>${esc(m.phone || '—')}</td>
        ${isAdmin ? `<td>${m.salary != null ? Number(m.salary).toLocaleString() : '—'}</td>` : ''}
        <td class="muted">${fmtDate(m.joined_at)}</td>
        <td><div class="row-actions">
          <button class="btn sm" data-view="${m.id}">Detail</button>
          ${isAdmin ? `<button class="btn sm" data-edit="${m.id}">Edit</button><button class="btn sm danger" data-del="${m.id}">Del</button>` : ''}
        </div></td>
      </tr>`).join('');
    mount.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Position</th><th>Phone</th>${isAdmin ? '<th>Salary</th>' : ''}<th>Joined</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    $$('[data-view]').forEach((b) => b.onclick = () => openDetail(+b.dataset.view));
    if (isAdmin) $$('[data-edit]').forEach((b) => b.onclick = () => openForm(+b.dataset.edit));
    if (isAdmin) $$('[data-del]').forEach((b) => b.onclick = () => deleteMember(+b.dataset.del));
  }

  async function openDetail(id) {
    const { member, assignments, leaves, workload } = await API.get('/api/members/' + id);
    const m = modal(`
      <h2>${esc(member.full_name)} ${!member.is_active ? '<span class="badge on_hold">Inactive</span>' : ''}</h2>
      <div class="cards c3 mb">
        <div class="card"><h3>Open Tasks</h3><div class="stat" style="font-size:22px">${workload.open_assignments}</div></div>
        <div class="card"><h3>Total Allocation</h3><div class="stat" style="font-size:22px">${workload.total_allocation_pct}%</div></div>
        ${isAdmin ? `<div class="card"><h3>Salary</h3><div class="stat" style="font-size:22px">${member.salary != null ? Number(member.salary).toLocaleString() : '—'}</div></div>` : ''}
      </div>
      <div class="form-row mb">
        <div><strong class="muted">Email</strong><div>${esc(member.email)}</div></div>
        <div><strong class="muted">Position</strong><div>${esc(member.position || '—')}</div></div>
        <div><strong class="muted">Phone</strong><div>${esc(member.phone || '—')}</div></div>
        <div><strong class="muted">Joined</strong><div>${fmtDate(member.joined_at)}</div></div>
      </div>
      <h3 style="font-size:13px;margin-bottom:8px">Assigned Tasks</h3>
      ${assignments.length ? `<div class="tbl-wrap" style="max-height:180px;overflow:auto"><table><tbody>${assignments.map((a) => `<tr><td>${esc(a.task_name)}</td><td>${statusBadge(a.status)}</td><td>${a.allocation_pct}%</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No assignments.</p>'}
      <h3 style="font-size:13px;margin:16px 0 8px">Leave History</h3>
      ${leaves.length ? leaves.map((l) => `<div class="leave-block">${fmtDate(l.start_date)} → ${fmtDate(l.end_date)} · ${esc(l.type)} <span class="badge ${l.status}">${l.status}</span></div>`).join('') : '<p class="muted">No leave records.</p>'}
      ${isAdmin ? `<div class="modal-foot"><button class="btn primary" data-leave="${member.id}">+ Add Leave</button><button class="btn" data-x>Close</button></div>` : `<div class="modal-foot"><button class="btn" data-x>Close</button></div>'}`}`);
    $('[data-x]', m.body).onclick = m.close;
    const lb = $('[data-leave]', m.body);
    if (lb) lb.onclick = () => { m.close(); openLeaveForm(member.id); };
  }

  async function openForm(id) {
    let m0 = { full_name: '', email: '', phone: '', position: '', salary: '', joined_at: todayISO(), is_active: 1 };
    if (id) m0 = (await API.get('/api/members/' + id)).member;
    const m = modal(`
      <h2>${id ? 'Edit Member' : 'Add Member'}</h2>
      <form id="mem-form">
        <div class="form-row">
          <div class="field"><label>Full Name *</label><input name="full_name" required value="${esc(m0.full_name)}" /></div>
          <div class="field"><label>Email *</label><input name="email" type="email" required value="${esc(m0.email)}" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Phone</label><input name="phone" value="${esc(m0.phone || '')}" /></div>
          <div class="field"><label>Position</label><input name="position" value="${esc(m0.position || '')}" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Salary (admin only)</label><input name="salary" type="number" min="0" value="${m0.salary != null ? m0.salary : ''}" /></div>
          <div class="field"><label>Joined Date</label><input name="joined_at" type="date" value="${m0.joined_at || ''}" /></div>
        </div>
        ${id ? `<div class="field"><label>Status</label><select name="is_active"><option value="1" ${m0.is_active ? 'selected' : ''}>Active</option><option value="0" ${!m0.is_active ? 'selected' : ''}>Inactive</option></select></div>` : ''}
        <div class="form-err" id="mem-err" style="display:none"></div>
        <div class="modal-foot"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">${id ? 'Save' : 'Add Member'}</button></div>
      </form>`);
    $('[data-x]', m.body).onclick = m.close;
    $('#mem-form', m.body).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.salary) body.salary = +body.salary;
      if (body.is_active != null) body.is_active = +body.is_active;
      try {
        if (id) await API.put('/api/members/' + id, body); else await API.post('/api/members', body);
        toast(id ? 'Member updated' : 'Member added', 'success'); m.close(); renderMembers();
      } catch (err) { const er = $('#mem-err'); er.textContent = err.message; er.style.display = 'block'; }
    };
  }

  function openLeaveForm(memberId) {
    const m = modal(`
      <h2>Add Leave</h2>
      <form id="leave-form">
        <div class="form-row">
          <div class="field"><label>Start Date *</label><input name="start_date" type="date" required value="${todayISO()}" /></div>
          <div class="field"><label>End Date *</label><input name="end_date" type="date" required value="${todayISO()}" /></div>
        </div>
        <div class="field"><label>Type</label><select name="type"><option value="annual">Annual</option><option value="sick">Sick</option><option value="unpaid">Unpaid</option><option value="other">Other</option></select></div>
        <div class="field"><label>Notes</label><textarea name="notes"></textarea></div>
        <div class="form-err" id="leave-err" style="display:none"></div>
        <div class="modal-foot"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">Save Leave</button></div>
      </form>`);
    $('[data-x]', m.body).onclick = m.close;
    $('#leave-form', m.body).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.end_date < body.start_date) { const er = $('#leave-err'); er.textContent = 'End date must be on or after start date.'; er.style.display = 'block'; return; }
      try {
        const r = await API.post('/api/members/' + memberId + '/leaves', body);
        if (r.conflicts && r.conflicts.length) toast(`Leave saved, but ${r.conflicts.length} assignment conflict(s) detected`, 'warn');
        else toast('Leave added', 'success');
        m.close();
      } catch (err) { const er = $('#leave-err'); er.textContent = err.message; er.style.display = 'block'; }
    };
  }

  async function deleteMember(id) {
    confirmDialog('Delete this member? This is permanent. Consider deactivating instead to preserve assignment history.', async () => {
      try { await API.del('/api/members/' + id); toast('Member deleted', 'success'); renderMembers(); }
      catch (err) {
        if (err.data && err.data.needs_confirmation) {
          confirmDialog(err.data.error + ' Continue?', async () => {
            try { await API.del('/api/members/' + id + '?force=1'); toast('Member deleted', 'success'); renderMembers(); }
            catch (e2) { toast(e2.message, 'error'); }
          }, { danger: true, yes: 'Force delete' });
        } else toast(err.message, 'error');
      }
    }, { danger: true, yes: 'Delete' });
  }

  $('#mq').oninput = (e) => { state.q = e.target.value; renderMembers(); };
  $('#mactive').onchange = (e) => { state.active = e.target.value; renderMembers(); };
  if (isAdmin) $('#new-member').onclick = () => openForm(null);
  renderMembers();
});
