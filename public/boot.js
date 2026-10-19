// Boot + auth view + router start
(() => {
  let booted = false;

  function loginView(root) {
    let mode = 'login';
    const render = () => {
      root.innerHTML = `
        <div class="auth-wrap">
          <div class="auth-card">
            <div class="brand">Project<span>Flow</span></div>
            <div class="brand-sub" style="text-align:center">Project Management System</div>
            <div class="auth-tabs">
              <button data-mode="login" class="${mode === 'login' ? 'active' : ''}">Sign In</button>
              <button data-mode="register" class="${mode === 'register' ? 'active' : ''}">Register</button>
            </div>
            <form id="auth-form">
              ${mode === 'register' ? '<div class="field"><label>Full Name</label><input name="full_name" required placeholder="Your name" /></div>' : ''}
              <div class="field"><label>Email</label><input name="email" type="email" required placeholder="you@example.com" /></div>
              <div class="field"><label>Password</label><input name="password" type="password" required minlength="6" placeholder="min. 6 characters" /></div>
              <div class="form-err" id="auth-err" style="display:none"></div>
              <button class="btn primary" style="width:100%;margin-top:6px" type="submit">${mode === 'login' ? 'Sign In' : 'Create Account'}</button>
            </form>
            <p class="muted" style="margin-top:16px;font-size:12px;text-align:center">
              ${mode === 'login' ? 'Demo admin: admin@projectflow.test / admin123' : 'The very first account is granted Admin rights.'}
            </p>
          </div>
        </div>`;
      $$('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; render(); });
      $('#auth-form').onsubmit = async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        const errBox = $('#auth-err'); errBox.style.display = 'none';
        try {
          const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
          const { user } = await API.post(url, body);
          PF.ME = user;
          toast(mode === 'login' ? 'Welcome back!' : 'Account created', 'success');
          PF.enterApp();
        } catch (err) { errBox.textContent = err.message; errBox.style.display = 'block'; }
      };
    };
    render();
  }

  function enterApp() {
    renderLayout();
    booted = true;
    if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard';
    else navigate();
  }
  PF.enterApp = enterApp;

  window.addEventListener('hashchange', () => navigate());

  (async () => {
    try { const { user } = await API.get('/api/auth/me'); PF.ME = user; } catch (e) { PF.ME = null; }
    if (PF.ME) enterApp();
    else { document.getElementById('app').innerHTML = ''; loginView(document.getElementById('app')); }
  })();

  // Expose a logout helper the layout can use to return to login screen
  PF.showLogin = () => { booted = false; document.getElementById('app').innerHTML = ''; loginView(document.getElementById('app')); };
})();
