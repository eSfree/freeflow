// Settings (account + system info)
route('settings', async (rest, root) => {
  setTitle('Settings');
  const me = PF.ME;
  root.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>My Account</h2></div>
      <form id="acct-form" style="max-width:480px">
        <div class="field"><label>Full Name</label><input name="full_name" value="${esc(me.full_name)}" required /></div>
        <div class="field"><label>Email</label><input name="email" type="email" value="${esc(me.email)}" required /></div>
        <div class="field"><label>Role</label><input value="${me.role === 'admin' ? 'Admin / Manager' : 'Team Member'}" disabled /></div>
        <button class="btn primary" type="submit">Save Profile</button>
      </form>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>System Information</h2></div>
      <div id="sysinfo" class="muted">Loading…</div>
    </div>`;

  $('#acct-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      // reuse members update if linked, else auth endpoint not available; show note
      toast('Profile editing is limited in this build (name/email shown read-only for demo accounts)', 'warn');
    } catch (err) { toast(err.message, 'error'); }
  };

  try {
    const d = await API.get('/api/dashboard');
    $('#sysinfo').innerHTML = `
      <div class="cards c3">
        <div class="card"><h3>Projects</h3><div class="stat" style="font-size:22px">${d.stats.projects}</div></div>
        <div class="card"><h3>Tasks</h3><div class="stat" style="font-size:22px">${d.stats.total_tasks}</div></div>
        <div class="card"><h3>Team Members</h3><div class="stat" style="font-size:22px">${d.workload.length}</div></div>
      </div>
      <p class="mt" style="font-size:12px">Data is stored in a persistent SQLite database (see <code>data/projectflow.db</code>). Passwords are stored as bcrypt hashes. Scheduling uses a working-calendar + CPM engine.</p>`;
  } catch (e) { $('#sysinfo').textContent = 'Could not load stats'; }
});
