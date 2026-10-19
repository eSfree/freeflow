// Core: state, helpers, UI primitives, router, layout
window.PF = { ME: null, NAV: [] };
(() => {
  const app = () => document.getElementById('app');
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function toast(msg, type) {
    const wrap = document.getElementById('toast-wrap');
    const t = el(`<div class="toast ${type || ''}">${esc(msg)}</div>`);
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200);
  }

  function modal(html, opts) {
    opts = opts || {};
    const root = document.getElementById('modal-root');
    const overlay = el(`<div class="modal-overlay"><div class="modal ${opts.wide ? 'wide' : ''}">${html}</div></div>`);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    root.appendChild(overlay);
    return { overlay, close, body: $('.modal', overlay) };
  }

  function confirmDialog(message, onYes, opts) {
    opts = opts || {};
    const m = modal(`
      <h2>${esc(opts.title || 'Confirm')}</h2>
      <p style="color:var(--muted);line-height:1.6">${esc(message)}</p>
      <div class="modal-foot">
        <button class="btn" data-x>Cancel</button>
        <button class="btn ${opts.danger ? 'danger' : 'primary'}" data-yes>${esc(opts.yes || 'Confirm')}</button>
      </div>`);
    $('[data-x]', m.body).onclick = m.close;
    $('[data-yes]', m.body).onclick = () => { m.close(); onYes(); };
  }

  // status/priority label maps
  const STATUS_LABEL = { not_started: 'Not Started', in_progress: 'In Progress', completed: 'Completed', on_hold: 'On Hold' };
  const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };
  const PROJ_STATUS = { planning: 'Planning', active: 'Active', completed: 'Completed', on_hold: 'On Hold', cancelled: 'Cancelled' };
  const statusBadge = (s) => `<span class="badge ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
  const prioBadge = (p) => `<span class="badge ${esc(p)}">${esc(PRIORITY_LABEL[p] || p)}</span>`;
  const projBadge = (s) => `<span class="badge ${esc(s)}">${esc(PROJ_STATUS[s] || s)}</span>`;
  const progressBar = (p) => `<div class="progress"><i style="width:${p}%"></i></div>`;
  const fmtDate = (d) => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // date helpers (calendar-independent; used for column math in Gantt/PERT)
  function parseISO(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  function toISO(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(s, n) { const dt = parseISO(s); dt.setUTCDate(dt.getUTCDate() + n); return toISO(dt); }
  function diffDays(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }

  // Router
  const routes = {};
  route('notfound', () => { view().innerHTML = '<div class="empty"><div class="big">🧭</div><h3>Page not found</h3><a href="#/dashboard">Back to dashboard</a></div>'; });
  route('login', () => {
    const root = app();
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="brand">Project<span>Flow</span></div>
          <div class="brand-sub" style="text-align:center">Sign in to continue</div>
          <form id="login-form">
            <div class="field"><label>Email</label><input name="email" type="email" required placeholder="you@example.com" /></div>
            <div class="field"><label>Password</label><input name="password" type="password" required placeholder="••••••••" /></div>
            <div class="form-err" id="login-err" style="display:none"></div>
            <button class="btn primary" style="width:100%;margin-top:6px" type="submit">Sign In</button>
          </form>
          <p class="muted" style="margin-top:14px;font-size:12px;text-align:center">Don't have an account? <a href="#/register">Register</a></p>
        </div>
      </div>`;
    $('#login-form', root).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      const errBox = $('#login-err', root); errBox.style.display = 'none';
      try {
        const { user } = await API.post('/api/auth/login', body);
        PF.ME = user;
        toast('Welcome back!', 'success');
        if (PF.enterApp) PF.enterApp(); else location.hash = '#/dashboard';
      } catch (err) { errBox.textContent = err.message; errBox.style.display = 'block'; }
    };
  });
  route('register', () => {
    const root = app();
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="brand">Project<span>Flow</span></div>
          <div class="brand-sub" style="text-align:center">Create your account</div>
          <form id="reg-form">
            <div class="field"><label>Full name</label><input name="full_name" required placeholder="Jane Doe" /></div>
            <div class="field"><label>Email</label><input name="email" type="email" required placeholder="you@example.com" /></div>
            <div class="field"><label>Password</label><input name="password" type="password" required minlength="6" placeholder="min 6 characters" /></div>
            <div class="form-err" id="reg-err" style="display:none"></div>
            <button class="btn primary" style="width:100%;margin-top:6px" type="submit">Create Account</button>
          </form>
          <p class="muted" style="margin-top:14px;font-size:12px;text-align:center">Already have an account? <a href="#/login">Sign in</a></p>
        </div>
      </div>`;
    $('#reg-form', root).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      const errBox = $('#reg-err', root); errBox.style.display = 'none';
      try {
        const { user } = await API.post('/api/auth/register', body);
        PF.ME = user;
        toast('Account created!', 'success');
        if (PF.enterApp) PF.enterApp(); else location.hash = '#/dashboard';
      } catch (err) { errBox.textContent = err.message; errBox.style.display = 'block'; }
    };
  });
  let current = null;
  function route(name, fn) { routes[name] = fn; }
  async function navigate(hash) {
    const name = (hash || location.hash || '#/dashboard').replace('#/', '') || 'dashboard';
    const [page, ...rest] = name.split('/');
    if (!PF.ME && page !== 'login' && page !== 'register') { location.hash = '#/login'; return; }
    if (PF.ME && (page === 'login' || page === 'register')) { location.hash = '#/dashboard'; return; }
    current = page;
    const c = document.getElementById('view') || app();
    c.innerHTML = '<div class="loading"><div class="spinner"></div><p style="margin-top:12px">Loading…</p></div>';
    try {
      const fn = routes[page] || routes.notfound;
      await fn(rest, c);
      highlightNav(page);
    } catch (e) {
      console.error(e);
      c.innerHTML = `<div class="empty"><div class="big">⚠️</div><h3>Something went wrong</h3><p>${esc(e.message)}</p></div>`;
    }
  }
  function refresh() { navigate(location.hash); }

  // Layout
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: '▦' },
    { id: 'projects', label: 'Projects', icon: '❏' },
    { id: 'tasks', label: 'Tasks', icon: '☑' },
    { id: 'deps', label: 'Dependencies', icon: '🔗' },
    { id: 'gantt', label: 'Gantt Chart', icon: '▤' },
    { id: 'pert', label: 'PERT Chart', icon: '◈' },
    { id: 'team', label: 'Team Members', icon: '👥' },
    { id: 'calendar', label: 'Calendar & Leave', icon: '📅' },
    { id: 'reports', label: 'Reports', icon: '📊' },
    { id: 'settings', label: 'Settings', icon: '⚙' }
  ];
  function highlightNav(page) {
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
    const sb = $('.sidebar'); if (sb) sb.classList.remove('open');
  }
  function renderLayout() {
    const me = PF.ME;
    app().innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="brand">Project<span>Flow</span></div>
          <div class="brand-sub">Project Management System</div>
          <nav class="nav">
            ${NAV_ITEMS.map((n) => `<a data-nav="${n.id}" href="#/${n.id}"><span class="ico">${n.icon}</span>${n.label}</a>`).join('')}
          </nav>
          <div class="sidebar-foot">
            <div>${esc(me.full_name)}</div>
            <div class="muted" style="font-size:11px;margin-top:2px">${esc(me.email)}</div>
            <button class="btn sm" id="logout" style="margin-top:10px;width:100%">Logout</button>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <div class="flex">
              <button class="btn sm menu-btn" id="menu-btn">☰</button>
              <h1 id="page-title">Dashboard</h1>
            </div>
            <div class="acct">
              <span class="role-badge ${me.role}">${me.role === 'admin' ? 'Admin / Manager' : 'Team Member'}</span>
              <span>${esc(me.full_name)}</span>
            </div>
          </header>
          <main class="content" id="view"></main>
        </div>
      </div>`;
    $('#logout').onclick = async () => { await API.post('/api/auth/logout'); PF.ME = null; if (PF.showLogin) PF.showLogin(); else location.hash = '#/login'; };
    $('#menu-btn').onclick = () => $('.sidebar').classList.toggle('open');
  }
  function setTitle(t) { const h = $('#page-title'); if (h) h.textContent = t; }

  // view helper: returns the #view container
  function view() { return document.getElementById('view'); }

  // expose
  Object.assign(window, {
    el, esc, $, $$, toast, modal, confirmDialog,
    STATUS_LABEL, PRIORITY_LABEL, PROJ_STATUS, statusBadge, prioBadge, projBadge, progressBar, fmtDate, todayISO,
    parseISO, toISO, addDays, diffDays,
    route, navigate, refresh, renderLayout, setTitle, view
  });
})();
