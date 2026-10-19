// Shared: current project selection + picker UI
window.CURRENT_PROJECT = { id: null, data: null };
(() => {
  // Load and cache list of projects
  async function loadProjects() {
    const { projects } = await API.get('/api/projects');
    return projects;
  }

  // Render a project <select> into `mount` element. Calls onChange(pid)
  async function renderPicker(mount, onChange, opts) {
    opts = opts || {};
    const projects = await loadProjects();
    if (!projects.length) {
      mount.innerHTML = `<div class="empty" style="padding:24px"><p>No projects yet.</p>${PF.ME.role === 'admin' ? '<a href="#/projects" class="btn primary" style="margin-top:12px">Create a project</a>' : ''}</div>`;
      return null;
    }
    // default: keep current if still valid
    let sel = CURRENT_PROJECT.id && projects.some((p) => p.id === CURRENT_PROJECT.id) ? CURRENT_PROJECT.id : projects[0].id;
    if (opts.defaultActive) {
      const act = projects.find((p) => p.status === 'active') || projects.find((p) => p.status === 'planning');
      if (act) sel = act.id;
    }
    mount.innerHTML = `
      <div class="flex wrap">
        <div class="field" style="margin:0;min-width:260px">
          <label>${esc(opts.label || 'Project')}</label>
          <select id="proj-select">
            ${projects.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${p.organization ? ' — ' + esc(p.organization) : ''}</option>`).join('')}
          </select>
        </div>
        ${opts.extra || ''}
      </div>`;
    const selEl = $('#proj-select', mount);
    const apply = async (id) => {
      CURRENT_PROJECT.id = +id;
      CURRENT_PROJECT.data = await API.get(`/api/projects/${id}`);
      if (onChange) onChange(+id, CURRENT_PROJECT.data);
    };
    selEl.onchange = () => apply(selEl.value);
    await apply(sel);
    return sel;
  }

  Object.assign(window, { loadProjects, renderPicker });
})();
