// Auth view + app boot
(() => {
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
              <div class="field"><label>Password</label><input name="password" type="password" required minlength="6" placeholder="••••••••" /></div>
              <div class="form-err" id="auth-err" style="display:none"></div>
              <button class="btn primary" style="width:100%;margin-top:6px" type="submit">${mode === 'login' ? 'Sign In' : 'Create Account'}</button>
            </form>
            <p class="muted" style="margin-top:16px;font-size:12px;text-align:center">
              ${mode === 'login' ? 'First user registered becomes Admin.' : 'The very first account is granted Admin rights.'}
            </p>
          </div>
        </div>`;
      $$('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; render(); });
      $('#auth-form').onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const body = Object.fromEntries(f.entries());
        const errBox = $('#auth-err'); errBox.style.display = 'none';
        try {
          const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
          const { user } = await API.post(url, body);
          PF.ME = user;
          toast(mode === 'login' ? 'Welcome back!' : 'Account created', 'success');
          location.hash = '#/dashboard';
        } catch (err) {
          errBox.textContent = err.message; errBox.style.display = 'block';
        }
      };
    };
    render();
  }

  route('login', (rest, root) => { root.innerHTML = ''; loginView(root); });
  route('notfound', () => { view().innerHTML = '<div class="empty"><div class="big">🧭</div><h3>Page not found</h3><a href="#/dashboard">Back to dashboard</a></div>'; });

  // Boot
  window.addEventListener('hashchange', () => navigate());
  (async () => {
    try {
      const { user } = await API.get('/api/auth/me');
      PF.ME = user;
    } catch (e) { PF.ME = null; }
    if (PF.ME) {
      renderLayout();
      if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard';
    } else {
      location.hash = '#/login';
    }
    navigate();
  })();
})();
