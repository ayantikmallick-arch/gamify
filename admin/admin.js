/* admin/admin.js – GamifyDeals Admin Panel SPA */

// ── STATE ─────────────────────────────────────────────────────
let adminUser   = null;
let currentSec  = 'dashboard';
let modalConfirm = null;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check if first-time setup needed
  fetch('/api/auth/setup-status').then(r => r.json()).then(d => {
    if (d.setup_required) { window.location.href = '/admin/setup'; return; }
    checkSession();
  }).catch(() => checkSession());
});

async function checkSession() {
  try {
    const r = await api('GET', '/api/auth/me');
    if (r.admin) {
      adminUser = r.admin;
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display     = 'flex';

  // Fill admin info
  document.getElementById('adminNameSidebar').textContent = adminUser.username;
  document.getElementById('adminRoleSidebar').textContent = adminUser.role;
  document.getElementById('adminAvatar').textContent      = adminUser.username[0].toUpperCase();
  if (adminUser.role === 'owner') {
    document.getElementById('teamNavItem').style.display = 'flex';
  }

  // Nav
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.section));
  });
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('modalBackdrop')) closeModal();
  });

  navigateTo('dashboard');
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display     = 'none';

  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('loginErr');
    const btn   = document.getElementById('loginBtn');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in…';

    try {
      const r = await api('POST', '/api/auth/login', {
        username: document.getElementById('loginUser').value,
        password: document.getElementById('loginPass').value
      });
      if (r.admin) { adminUser = r.admin; showApp(); }
      else { throw new Error(r.error || 'Login failed'); }
    } catch (err) {
      errEl.textContent   = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

async function logout() {
  await api('POST', '/api/auth/logout').catch(() => {});
  window.location.reload();
}

// ── NAVIGATION ────────────────────────────────────────────────
function navigateTo(section) {
  currentSec = section;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.section === section));
  const titles = {
    dashboard: 'Dashboard',  games: 'Games',
    inventory: 'Inventory',  orders: 'Orders',
    audit: 'Audit Log',      team: 'Team',  settings: 'Settings'
  };
  document.getElementById('topbarTitle').textContent = titles[section] || section;
  document.getElementById('topbarActions').innerHTML = '';
  document.getElementById('mainContent').innerHTML   = '<div class="empty-state"><div class="spinner" style="width:28px;height:28px;border-width:3px"></div></div>';

  const renders = {
    dashboard: renderDashboard,
    games:     renderGames,
    inventory: renderInventory,
    orders:    renderOrders,
    audit:     renderAudit,
    team:      renderTeam,
    settings:  renderSettings
  };
  renders[section]?.();
}

// ── DASHBOARD ─────────────────────────────────────────────────
async function renderDashboard() {
  const data = await api('GET', '/api/dashboard/stats').catch(() => null);
  if (!data) { setContent('<div class="empty-state"><p>Failed to load stats.</p></div>'); return; }

  const r = data.revenue, o = data.order_stats, i = data.inventory;

  setContent(`
  <div class="stats-grid">
    <div class="stat-card green">
      <div class="stat-icon">💰</div>
      <div class="stat-label">Total Revenue</div>
      <div class="stat-value">₹${fmt(r.total_revenue)}</div>
      <div class="stat-sub">₹${fmt(r.revenue_7d)} last 7 days</div>
    </div>
    <div class="stat-card blue">
      <div class="stat-icon">🛒</div>
      <div class="stat-label">Total Orders</div>
      <div class="stat-value">${r.total_orders}</div>
      <div class="stat-sub">${o.today} today · ${o.pending} pending</div>
    </div>
    <div class="stat-card gold">
      <div class="stat-icon">📦</div>
      <div class="stat-label">Available Stock</div>
      <div class="stat-value">${i.available}</div>
      <div class="stat-sub">${i.sold} sold · ${i.total} total</div>
    </div>
    <div class="stat-card red">
      <div class="stat-icon">📅</div>
      <div class="stat-label">Revenue (30d)</div>
      <div class="stat-value">₹${fmt(r.revenue_30d)}</div>
      <div class="stat-sub">Monthly earnings</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
    <!-- Recent Orders -->
    <div class="card">
      <div class="card-header"><div class="card-title">Recent Orders</div><a href="#" onclick="navigateTo('orders');return false;" style="font-size:12px;color:#e63946">View all →</a></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Customer</th><th>Game</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            ${data.recent_orders.length ? data.recent_orders.map(o => `
            <tr>
              <td class="td-name">${esc(o.buyer_email)}</td>
              <td class="muted">${esc(o.emoji || '🎮')} ${esc(o.game_name || '—')}</td>
              <td>₹${parseFloat(o.amount).toFixed(0)}</td>
              <td><span class="badge badge-${statusColor(o.status)}">${o.status}</span></td>
            </tr>`).join('') : '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No orders yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Top Games -->
    <div class="card">
      <div class="card-header"><div class="card-title">Top Games</div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Game</th><th>Orders</th><th>Revenue</th></tr></thead>
          <tbody>
            ${data.top_games.length ? data.top_games.map(g => `
            <tr>
              <td>${esc(g.emoji || '🎮')} <strong>${esc(g.name)}</strong></td>
              <td>${g.order_count}</td>
              <td>₹${fmt(g.revenue || 0)}</td>
            </tr>`).join('') : '<tr><td colspan="3" class="muted" style="text-align:center;padding:20px">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  `);
}

// ── GAMES ─────────────────────────────────────────────────────
let gamesSearch = '';
async function renderGames() {
  addTopbarBtn('+ Add Game', () => openGameModal(null));
  const url  = gamesSearch ? `/api/games/admin/list?search=${encodeURIComponent(gamesSearch)}` : '/api/games/admin/list';
  const rows = await api('GET', url).catch(() => []);

  setContent(`
  <div class="toolbar">
    <div class="search-box">
      <span>🔍</span>
      <input id="gamesSearchInput" placeholder="Search games…" value="${esc(gamesSearch)}"/>
    </div>
  </div>
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Game</th><th>Genre</th><th>Price</th><th>Stock</th><th>Sold</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody id="gamesBody">
          ${rows.length ? rows.map(g => `
          <tr>
            <td>
              ${g.steam_app_id
                ? `<img src="https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam_app_id}/capsule_sm_120.jpg"
                        style="height:28px;border-radius:4px;vertical-align:middle;margin-right:8px;"
                        onerror="this.style.display='none'">`
                : esc(g.emoji || '🎮') + ' '}
              <strong>${esc(g.name)}</strong>
            </td>
            <td class="muted">${esc(g.genre || '—')}</td>
            <td>₹${parseFloat(g.price).toFixed(0)}</td>
            <td><span class="badge ${g.available_count > 0 ? 'badge-green' : 'badge-red'}">${g.available_count} avail</span></td>
            <td class="muted">${g.sold_count}</td>
            <td><span class="badge ${g.active ? 'badge-green' : 'badge-gray'}">${g.active ? 'Active' : 'Hidden'}</span></td>
            <td>
              <button class="btn btn-ghost btn-xs" onclick="openGameModal(${g.id})">Edit</button>
              <button class="btn btn-danger btn-xs" onclick="deleteGame(${g.id})">Delete</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">No games. Add one →</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`);

  document.getElementById('gamesSearchInput').addEventListener('input', e => {
    gamesSearch = e.target.value;
    clearTimeout(window._gsTimer);
    window._gsTimer = setTimeout(renderGames, 350);
  });
}

async function openGameModal(id) {
  let g = null;
  if (id) g = (await api('GET', `/api/games/admin/list`).catch(() => [])).find(x => x.id === id);

  openModal(g ? 'Edit Game' : 'Add Game', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Game Name *</label>
        <input class="form-input" id="fg-name" value="${esc(g?.name||'')}" placeholder="e.g. Red Dead Redemption 2"/>
      </div>
      <div class="form-group">
        <label class="form-label">Steam App ID</label>
        <input class="form-input" id="fg-appid" type="number" value="${g?.steam_app_id||''}" placeholder="e.g. 1174180"/>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Genre</label>
        <input class="form-input" id="fg-genre" value="${esc(g?.genre||'')}" placeholder="Action"/>
      </div>
      <div class="form-group">
        <label class="form-label">Sub-Genre</label>
        <input class="form-input" id="fg-sub" value="${esc(g?.sub_genre||'')}" placeholder="Open World"/>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Sale Price (₹) *</label>
        <input class="form-input" id="fg-price" type="number" value="${g?.price||''}" placeholder="149"/>
      </div>
      <div class="form-group">
        <label class="form-label">Original Price (₹)</label>
        <input class="form-input" id="fg-orig" type="number" value="${g?.original_price||''}" placeholder="1999"/>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Badge</label>
        <select class="form-select" id="fg-badge">
          <option value="">None</option>
          <option value="hot" ${g?.badge==='hot'?'selected':''}>🔥 Hot</option>
          <option value="new" ${g?.badge==='new'?'selected':''}>✨ New</option>
          <option value="bestseller" ${g?.badge==='bestseller'?'selected':''}>⭐ Bestseller</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Emoji</label>
        <input class="form-input" id="fg-emoji" value="${g?.emoji||'🎮'}" style="font-size:20px;width:70px" maxlength="4"/>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea class="form-textarea" id="fg-desc">${esc(g?.description||'')}</textarea>
    </div>
    ${g ? `<div class="form-group"><label class="form-label"><input type="checkbox" id="fg-active" ${g.active?'checked':''}> Active (visible in store)</label></div>` : ''}
  `, [
    { label: g ? 'Save Changes' : 'Add Game', cls: 'btn-primary', action: async () => {
      const body = {
        name:           document.getElementById('fg-name').value.trim(),
        steam_app_id:   document.getElementById('fg-appid').value || null,
        genre:          document.getElementById('fg-genre').value.trim(),
        sub_genre:      document.getElementById('fg-sub').value.trim(),
        price:          document.getElementById('fg-price').value,
        original_price: document.getElementById('fg-orig').value || null,
        badge:          document.getElementById('fg-badge').value || null,
        emoji:          document.getElementById('fg-emoji').value || '🎮',
        description:    document.getElementById('fg-desc').value.trim(),
      };
      if (g) body.active = document.getElementById('fg-active').checked;
      if (!body.name || !body.price) { toast('Name and price required', 'error'); return; }
      const url = g ? `/api/games/${g.id}` : '/api/games';
      const r   = await api(g ? 'PUT' : 'POST', url, body).catch(() => null);
      if (!r?.id && !r?.name) { toast('Failed to save game', 'error'); return; }
      toast(g ? 'Game updated' : 'Game added ✅'); closeModal(); renderGames();
    }},
    { label: 'Cancel', cls: 'btn-secondary', action: closeModal }
  ]);
}

async function deleteGame(id) {
  if (!confirm('Delete this game? (It will be hidden if it has inventory)')) return;
  const r = await api('DELETE', `/api/games/${id}`).catch(() => null);
  if (!r?.success) { toast('Delete failed', 'error'); return; }
  toast(r.type === 'soft' ? 'Game hidden (has inventory)' : 'Game deleted');
  renderGames();
}

// ── INVENTORY ─────────────────────────────────────────────────
let invFilter = { game_id: '', status: '', page: 1 };
let allGames  = [];

async function renderInventory() {
  addTopbarBtn('+ Add Account', () => openAddInventoryModal());
  addTopbarBtn('📥 Import CSV', openImportModal, 'btn-secondary');
  addTopbarBtn('⬇ Template', () => window.location.href = '/api/inventory/template.csv', 'btn-ghost');

  if (!allGames.length) allGames = await api('GET', '/api/games').catch(() => []);

  const qs = new URLSearchParams({
    ...(invFilter.game_id && { game_id: invFilter.game_id }),
    ...(invFilter.status  && { status:  invFilter.status }),
    page: invFilter.page
  });
  const data = await api('GET', '/api/inventory?' + qs).catch(() => ({ items: [], total: 0 }));

  setContent(`
  <div class="toolbar">
    <select class="filter-select" id="invGameFilter">
      <option value="">All Games</option>
      ${allGames.map(g => `<option value="${g.id}" ${g.id == invFilter.game_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
    </select>
    <select class="filter-select" id="invStatusFilter">
      <option value="">All Status</option>
      <option value="available" ${invFilter.status==='available'?'selected':''}>Available</option>
      <option value="sold"      ${invFilter.status==='sold'?'selected':''}>Sold</option>
      <option value="replaced"  ${invFilter.status==='replaced'?'selected':''}>Replaced</option>
    </select>
    <span style="color:#6b7280;font-size:13px">${data.total} total</span>
  </div>
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Game</th><th>Steam Username</th><th>Status</th><th>Created</th><th>Sold At</th><th>Actions</th></tr></thead>
        <tbody>
          ${data.items.length ? data.items.map(i => `
          <tr>
            <td class="td-name">${esc(i.game_name||'—')}</td>
            <td class="td-mono">${esc(i.steam_username)}</td>
            <td><span class="badge badge-${invStatusColor(i.status)}">${i.status}</span></td>
            <td class="muted">${fmtDate(i.created_at)}</td>
            <td class="muted">${i.sold_at ? fmtDate(i.sold_at) : '—'}</td>
            <td>
              <button class="btn btn-ghost btn-xs" onclick="openInvLogsModal('${i.id}')">Logs</button>
              <button class="btn btn-ghost btn-xs" onclick="openReplaceModal('${i.id}')">Replace</button>
              ${i.status !== 'sold' ? `<button class="btn btn-danger btn-xs" onclick="deleteInv('${i.id}')">Del</button>` : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:30px">No inventory. Import via CSV or add manually.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="pagination">
      <span>${data.total} items</span>
      <div class="pagination-btns">
        ${invFilter.page > 1 ? `<button class="page-btn" onclick="invPage(${invFilter.page-1})">‹</button>` : ''}
        <span class="page-btn active">${invFilter.page}</span>
        ${data.total > invFilter.page * 50 ? `<button class="page-btn" onclick="invPage(${invFilter.page+1})">›</button>` : ''}
      </div>
    </div>
  </div>`);

  document.getElementById('invGameFilter')?.addEventListener('change', e => { invFilter.game_id = e.target.value; invFilter.page = 1; renderInventory(); });
  document.getElementById('invStatusFilter')?.addEventListener('change', e => { invFilter.status  = e.target.value; invFilter.page = 1; renderInventory(); });
}

function invPage(p) { invFilter.page = p; renderInventory(); }

async function openAddInventoryModal() {
  if (!allGames.length) allGames = await api('GET', '/api/games').catch(() => []);
  openModal('Add Steam Account', `
    <div class="form-group">
      <label class="form-label">Game *</label>
      <select class="form-select" id="fi-game">
        <option value="">Select game…</option>
        ${allGames.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Steam Username *</label>
      <input class="form-input" id="fi-user" placeholder="e.g. steamuser_abc"/>
    </div>
    <div class="form-group">
      <label class="form-label">Steam Password *</label>
      <input class="form-input" type="password" id="fi-pass" placeholder="••••••••"/>
      <div class="form-hint">Encrypted with AES-256 before storage.</div>
    </div>
  `, [
    { label: 'Add Account', cls: 'btn-primary', action: async () => {
      const game_id  = document.getElementById('fi-game').value;
      const username = document.getElementById('fi-user').value.trim();
      const password = document.getElementById('fi-pass').value.trim();
      if (!game_id || !username || !password) { toast('All fields required', 'error'); return; }
      const r = await api('POST', '/api/inventory', { game_id, steam_username: username, steam_password: password }).catch(() => null);
      if (!r?.id) { toast('Failed to add account', 'error'); return; }
      toast('Account added ✅'); closeModal(); renderInventory();
    }},
    { label: 'Cancel', cls: 'btn-secondary', action: closeModal }
  ]);
}

async function openReplaceModal(id) {
  openModal('Replace Steam Credentials', `
    <p style="color:#f4a261;font-size:13px;margin-bottom:16px">⚠️ This will replace the encrypted credentials stored for this inventory item and write a <code>replaced</code> audit log entry.</p>
    <div class="form-group">
      <label class="form-label">New Steam Username *</label>
      <input class="form-input" id="rep-user" placeholder="new_steam_username"/>
    </div>
    <div class="form-group">
      <label class="form-label">New Steam Password *</label>
      <input class="form-input" type="password" id="rep-pass" placeholder="new password"/>
    </div>
  `, [
    { label: 'Replace', cls: 'btn-primary', action: async () => {
      const r = await api('POST', `/api/inventory/${id}/replace`, {
        steam_username: document.getElementById('rep-user').value.trim(),
        steam_password: document.getElementById('rep-pass').value.trim()
      }).catch(() => null);
      if (!r?.success) { toast('Replace failed', 'error'); return; }
      toast('Credentials replaced ✅'); closeModal(); renderInventory();
    }},
    { label: 'Cancel', cls: 'btn-secondary', action: closeModal }
  ]);
}

async function openInvLogsModal(id) {
  const logs = await api('GET', `/api/inventory/${id}/logs`).catch(() => []);
  openModal(`Audit Log`, `
    <div style="max-height:360px;overflow-y:auto">
    ${logs.length ? logs.map(l => `
      <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #1f2333">
        <span class="badge badge-${actionColor(l.action)}" style="flex-shrink:0;align-self:flex-start">${l.action}</span>
        <div>
          <div style="font-size:12px;color:#e8eaf0"><strong>${esc(l.actor)}</strong></div>
          <div style="font-size:11px;color:#6b7280">${fmtDate(l.created_at)}</div>
          ${l.meta ? `<div style="font-size:11px;color:#4b5563;margin-top:4px;font-family:monospace">${JSON.stringify(l.meta)}</div>` : ''}
        </div>
      </div>`).join('') : '<div class="empty-state" style="padding:30px"><p>No logs for this item.</p></div>'}
    </div>
  `, [{ label: 'Close', cls: 'btn-secondary', action: closeModal }]);
}

async function deleteInv(id) {
  if (!confirm('Delete this inventory item? This cannot be undone.')) return;
  const r = await api('DELETE', `/api/inventory/${id}`).catch(() => null);
  if (!r?.success) { toast('Delete failed. Sold items cannot be deleted.', 'error'); return; }
  toast('Deleted ✅'); renderInventory();
}

function openImportModal() {
  openModal('Bulk CSV Import', `
    <p style="font-size:13px;color:#9ea3b5;margin-bottom:16px">Upload a CSV file with columns: <code style="background:#0d0f14;padding:2px 6px;border-radius:4px">game_id, steam_username, steam_password</code></p>
    <div class="upload-zone" id="uploadZone">
      <div class="upload-icon">📁</div>
      <p>Click to choose CSV file or drag & drop</p>
      <small>Max 5 MB · CSV only</small>
      <input type="file" id="csvFile" accept=".csv" style="display:none"/>
    </div>
    <div class="import-result" id="importResult" style="display:none"></div>
    <div class="upload-progress" id="uploadProgress" style="display:none">
      <div class="progress-bar-wrap"><div class="progress-bar" id="progressBar" style="width:0%"></div></div>
      <p style="font-size:12px;color:#6b7280;margin-top:6px" id="progressText">Uploading…</p>
    </div>
  `, [
    { label: 'Import', cls: 'btn-primary', id: 'importBtn', action: doImport },
    { label: 'Cancel', cls: 'btn-secondary', action: closeModal }
  ]);

  const zone = document.getElementById('uploadZone');
  const file = document.getElementById('csvFile');
  zone.addEventListener('click', () => file.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag');
    if (e.dataTransfer.files[0]) {
      file._file = e.dataTransfer.files[0];
      zone.querySelector('p').textContent = '✅ ' + e.dataTransfer.files[0].name;
    }
  });
  file.addEventListener('change', () => {
    if (file.files[0]) zone.querySelector('p').textContent = '✅ ' + file.files[0].name;
  });
}

async function doImport() {
  const fileEl  = document.getElementById('csvFile');
  const theFile = fileEl._file || fileEl.files[0];
  if (!theFile) { toast('Select a CSV file first', 'error'); return; }

  document.getElementById('uploadProgress').style.display = 'block';
  document.getElementById('progressBar').style.width = '40%';
  document.getElementById('progressText').textContent = 'Uploading…';

  const form = new FormData();
  form.append('file', theFile);
  try {
    const r = await fetch('/api/inventory/import-csv', {
      method: 'POST', credentials: 'include', body: form
    });
    const d = await r.json();
    document.getElementById('progressBar').style.width = '100%';
    const res = document.getElementById('importResult');
    res.style.display = 'block';
    if (d.inserted > 0) {
      res.className = 'import-result success';
      res.innerHTML = `✅ Imported ${d.inserted} account${d.inserted>1?'s':''}. ${d.failed > 0 ? `${d.failed} failed.` : ''}`;
    } else {
      res.className = 'import-result error';
      res.innerHTML = `❌ Import failed. ${d.errors?.[0]?.error || d.error || 'Check your CSV format.'}`;
    }
    if (d.inserted > 0) { setTimeout(() => { closeModal(); renderInventory(); }, 1500); }
  } catch {
    toast('Import failed – network error', 'error');
  }
}

// ── ORDERS ────────────────────────────────────────────────────
let ordFilter = { status: '', search: '', page: 1 };
async function renderOrders() {
  const qs   = new URLSearchParams({ ...(ordFilter.status && {status: ordFilter.status}), ...(ordFilter.search && {search: ordFilter.search}), page: ordFilter.page });
  const data = await api('GET', '/api/orders?' + qs).catch(() => ({ orders: [], total: 0, pages: 1 }));

  setContent(`
  <div class="toolbar">
    <div class="search-box">
      <span>🔍</span>
      <input id="ordSearch" placeholder="Search email, name, payment ID…" value="${esc(ordFilter.search)}"/>
    </div>
    <select class="filter-select" id="ordStatus">
      <option value="">All Status</option>
      <option value="pending" ${ordFilter.status==='pending'?'selected':''}>Pending</option>
      <option value="paid"    ${ordFilter.status==='paid'?'selected':''}>Paid</option>
      <option value="failed"  ${ordFilter.status==='failed'?'selected':''}>Failed</option>
    </select>
    <span style="color:#6b7280;font-size:13px">${data.total} orders</span>
  </div>
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Customer</th><th>Game</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>
          ${data.orders.length ? data.orders.map(o => `
          <tr>
            <td>
              <div class="td-name">${esc(o.buyer_email)}</div>
              ${o.buyer_name ? `<div style="font-size:11px;color:#6b7280">${esc(o.buyer_name)}</div>` : ''}
            </td>
            <td class="muted">${esc(o.emoji||'🎮')} ${esc(o.game_name||'—')}</td>
            <td><strong>₹${parseFloat(o.amount).toFixed(0)}</strong></td>
            <td><span class="badge badge-${statusColor(o.status)}">${o.status}</span></td>
            <td class="muted" style="font-size:12px">${fmtDate(o.created_at)}</td>
            <td>
              <button class="btn btn-ghost btn-xs" onclick="openOrderModal('${o.id}')">View</button>
              ${o.status==='paid' && o.has_inventory ? `<button class="btn btn-ghost btn-xs" onclick="revealCreds('${o.id}')">🔑 Reveal</button>` : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:30px">No orders yet.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="pagination">
      <span>Page ${ordFilter.page} of ${data.pages}</span>
      <div class="pagination-btns">
        ${ordFilter.page > 1 ? `<button class="page-btn" onclick="ordPage(${ordFilter.page-1})">‹</button>` : ''}
        ${Array.from({length: Math.min(data.pages, 5)}, (_,i) => i+1).map(p => `<button class="page-btn ${p===ordFilter.page?'active':''}" onclick="ordPage(${p})">${p}</button>`).join('')}
        ${ordFilter.page < data.pages ? `<button class="page-btn" onclick="ordPage(${ordFilter.page+1})">›</button>` : ''}
      </div>
    </div>
  </div>`);

  let searchTimer;
  document.getElementById('ordSearch').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { ordFilter.search = e.target.value; ordFilter.page = 1; renderOrders(); }, 350);
  });
  document.getElementById('ordStatus').addEventListener('change', e => {
    ordFilter.status = e.target.value; ordFilter.page = 1; renderOrders();
  });
}

function ordPage(p) { ordFilter.page = p; renderOrders(); }

async function openOrderModal(id) {
  const o = await api('GET', `/api/orders/${id}`).catch(() => null);
  if (!o) { toast('Failed to load order', 'error'); return; }
  openModal('Order Details', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">STATUS</div><span class="badge badge-${statusColor(o.status)}">${o.status}</span></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">AMOUNT</div><strong style="color:#e63946">₹${parseFloat(o.amount).toFixed(2)}</strong></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">CUSTOMER</div><span style="font-size:13px">${esc(o.buyer_email)}</span></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">GAME</div><span style="font-size:13px">${esc(o.emoji||'🎮')} ${esc(o.game_name||'—')}</span></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">RAZORPAY ORDER</div><span class="td-mono" style="font-size:11px">${esc(o.razorpay_order_id||'—')}</span></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">PAYMENT ID</div><span class="td-mono" style="font-size:11px">${esc(o.razorpay_payment_id||'—')}</span></div>
    </div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:8px">ORDER ID: <span class="td-mono">${o.id}</span></div>
    ${o.steam_username ? `<div style="background:#0d0f14;border:1px solid #1f2333;border-radius:8px;padding:12px;font-family:monospace;font-size:13px;color:#2ec4b6">Steam Username: ${esc(o.steam_username)}</div>` : ''}
  `, [
    ...(o.status === 'paid' && o.inventory_id ? [{ label: '🔑 Reveal Credentials', cls: 'btn-primary', action: () => { closeModal(); revealCreds(id); }}] : []),
    ...(!o.inventory_id && o.status === 'paid' ? [{ label: '📦 Assign Inventory', cls: 'btn-secondary', action: () => { closeModal(); openAssignModal(id); }}] : []),
    { label: 'Close', cls: 'btn-secondary', action: closeModal }
  ]);
}

async function revealCreds(id) {
  const creds = await api('POST', `/api/orders/${id}/reveal`).catch(() => null);
  if (!creds) { toast('Reveal failed', 'error'); return; }
  openModal('🔑 Steam Credentials', `
    <div class="cred-box visible" style="display:block">
      <div class="cred-field">
        <div class="cred-label">Steam Username</div>
        <div class="cred-value-row">
          <span class="cred-value" id="rv-user">${esc(creds.steam_username)}</span>
          <button class="copy-btn" onclick="navigator.clipboard.writeText('${esc(creds.steam_username)}');this.textContent='✓'">Copy</button>
        </div>
      </div>
      <div class="cred-field">
        <div class="cred-label">Steam Password</div>
        <div class="cred-value-row">
          <span class="cred-value" id="rv-pass">${esc(creds.steam_password)}</span>
          <button class="copy-btn" onclick="navigator.clipboard.writeText('${esc(creds.steam_password)}');this.textContent='✓'">Copy</button>
        </div>
      </div>
    </div>
    <div style="font-size:12px;color:#6b7280;margin-top:12px">This reveal has been logged to the audit trail.</div>
  `, [{ label: 'Close', cls: 'btn-secondary', action: closeModal }]);
}

async function openAssignModal(orderId) {
  if (!allGames.length) allGames = await api('GET', '/api/games').catch(() => []);
  const order = await api('GET', `/api/orders/${orderId}`).catch(() => null);
  const inv   = await api('GET', `/api/inventory?status=available${order?.game_id ? '&game_id=' + order.game_id : ''}`).catch(() => ({ items: [] }));

  openModal('Manually Assign Inventory', `
    <p style="font-size:13px;color:#f4a261;margin-bottom:14px">⚠️ This order has no inventory assigned. Select an available account to assign.</p>
    <div class="form-group">
      <label class="form-label">Available Accounts</label>
      <select class="form-select" id="assign-inv">
        <option value="">Select account…</option>
        ${inv.items.map(i => `<option value="${i.id}">[${esc(i.game_name)}] ${esc(i.steam_username)}</option>`).join('')}
      </select>
    </div>
  `, [
    { label: 'Assign', cls: 'btn-primary', action: async () => {
      const inventory_id = document.getElementById('assign-inv').value;
      if (!inventory_id) { toast('Select an account', 'error'); return; }
      const r = await api('POST', `/api/orders/${orderId}/assign-inventory`, { inventory_id }).catch(() => null);
      if (!r?.success) { toast('Assignment failed', 'error'); return; }
      toast('Inventory assigned ✅'); closeModal(); renderOrders();
    }},
    { label: 'Cancel', cls: 'btn-secondary', action: closeModal }
  ]);
}

// ── AUDIT LOG ─────────────────────────────────────────────────
async function renderAudit() {
  const logs = await api('GET', '/api/dashboard/audit-log').catch(() => []);
  setContent(`
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Action</th><th>Actor</th><th>Game</th><th>Steam User</th><th>Details</th><th>Date</th></tr></thead>
        <tbody>
          ${logs.length ? logs.map(l => `
          <tr>
            <td><span class="badge badge-${actionColor(l.action)}">${l.action}</span></td>
            <td class="muted">${esc(l.actor||'system')}</td>
            <td class="muted">${esc(l.game_name||'—')}</td>
            <td class="td-mono">${esc(l.steam_username||'—')}</td>
            <td class="muted" style="font-size:11px">${l.meta ? JSON.stringify(l.meta).substring(0,60) : '—'}</td>
            <td class="muted" style="font-size:12px">${fmtDate(l.created_at)}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:30px">No audit logs yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`);
}

// ── TEAM ──────────────────────────────────────────────────────
async function renderTeam() {
  if (adminUser.role !== 'owner') { setContent('<div class="empty-state"><p>Owner access required.</p></div>'); return; }
  addTopbarBtn('+ Add Admin', openAddAdminModal);
  const admins = await api('GET', '/api/auth/admins').catch(() => []);
  setContent(`
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>
          ${admins.map(a => `
          <tr>
            <td><strong>${esc(a.username)}</strong></td>
            <td><span class="badge ${a.role==='owner'?'badge-gold':'badge-blue'}">${a.role}</span></td>
            <td class="muted">${fmtDate(a.created_at)}</td>
            <td>
              ${a.id !== adminUser.id && a.role !== 'owner' ? `<button class="btn btn-danger btn-xs" onclick="deleteAdmin(${a.id})">Remove</button>` : '<span class="muted" style="font-size:12px">—</span>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`);
}

async function openAddAdminModal() {
  openModal('Add Admin', `
    <div class="form-group"><label class="form-label">Username</label><input class="form-input" id="ta-user" placeholder="username"/></div>
    <div class="form-group"><label class="form-label">Password</label><input class="form-input" type="password" id="ta-pass" placeholder="min 8 chars"/></div>
  `, [
    { label: 'Create', cls: 'btn-primary', action: async () => {
      const r = await api('POST', '/api/auth/admins', {
        username: document.getElementById('ta-user').value.trim(),
        password: document.getElementById('ta-pass').value
      }).catch(() => null);
      if (!r?.id) { toast(r?.error || 'Failed', 'error'); return; }
      toast('Admin created ✅'); closeModal(); renderTeam();
    }},
    { label: 'Cancel', cls: 'btn-secondary', action: closeModal }
  ]);
}

async function deleteAdmin(id) {
  if (!confirm('Remove this admin?')) return;
  const r = await api('DELETE', `/api/auth/admins/${id}`).catch(() => null);
  if (!r?.success) { toast('Delete failed', 'error'); return; }
  toast('Admin removed'); renderTeam();
}

// ── SETTINGS ──────────────────────────────────────────────────
function renderSettings() {
  setContent(`
  <div class="card" style="max-width:440px">
    <div class="card-header"><div class="card-title">Change Password</div></div>
    <div id="pwErr" style="display:none;background:rgba(230,57,70,.1);border:1px solid rgba(230,57,70,.3);color:#ff6b7a;padding:9px 12px;border-radius:6px;font-size:13px;margin-bottom:12px"></div>
    <div id="pwOk" style="display:none;background:rgba(46,196,182,.1);border:1px solid rgba(46,196,182,.3);color:#2ec4b6;padding:9px 12px;border-radius:6px;font-size:13px;margin-bottom:12px"></div>
    <div class="form-group"><label class="form-label">Current Password</label><input class="form-input" type="password" id="pw-cur" placeholder="••••••••"/></div>
    <div class="form-group"><label class="form-label">New Password</label><input class="form-input" type="password" id="pw-new" placeholder="min 8 chars"/></div>
    <div class="form-group"><label class="form-label">Confirm New Password</label><input class="form-input" type="password" id="pw-cnf" placeholder="re-enter new password"/></div>
    <button class="btn btn-primary" id="pwBtn">Update Password</button>
  </div>`);

  document.getElementById('pwBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('pwErr');
    const okEl  = document.getElementById('pwOk');
    errEl.style.display = okEl.style.display = 'none';
    const cur = document.getElementById('pw-cur').value;
    const nw  = document.getElementById('pw-new').value;
    const cnf = document.getElementById('pw-cnf').value;
    if (nw !== cnf) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return; }
    const r = await api('POST', '/api/auth/change-password', { current_password: cur, new_password: nw }).catch(() => null);
    if (!r?.success) { errEl.textContent = r?.error || 'Failed.'; errEl.style.display = 'block'; return; }
    okEl.textContent = '✅ Password updated successfully!';
    okEl.style.display = 'block';
    document.getElementById('pw-cur').value = document.getElementById('pw-new').value = document.getElementById('pw-cnf').value = '';
  });
}

// ── HELPERS / UTILS ──────────────────────────────────────────
async function api(method, url, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.error || 'API error'), { status: r.status, data: d });
  return d;
}

function setContent(html) {
  document.getElementById('mainContent').innerHTML = html;
}

function addTopbarBtn(label, action, cls = 'btn-primary') {
  const btn = document.createElement('button');
  btn.className   = `btn ${cls} btn-sm`;
  btn.textContent = label;
  btn.addEventListener('click', action);
  document.getElementById('topbarActions').appendChild(btn);
}

function openModal(title, bodyHtml, btns = []) {
  document.getElementById('modalTitle').textContent  = title;
  document.getElementById('modalBody').innerHTML     = bodyHtml;
  const footer = document.getElementById('modalFooter');
  footer.innerHTML = '';
  btns.forEach(b => {
    const btn = document.createElement('button');
    btn.className   = `btn ${b.cls}`;
    btn.textContent = b.label;
    if (b.id) btn.id = b.id;
    btn.addEventListener('click', b.action);
    footer.appendChild(btn);
  });
  document.getElementById('modalBackdrop').classList.add('open');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className   = `toast ${type}`;
  t.innerHTML   = `<span>${type === 'success' ? '✅' : '⚠️'}</span><span>${esc(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

function fmt(n) { return parseFloat(n || 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }

function statusColor(s) { return {paid:'green', pending:'gold', failed:'red', refunded:'gray'}[s] || 'gray'; }
function invStatusColor(s) { return {available:'green', sold:'blue', reserved:'gold', replaced:'gray'}[s] || 'gray'; }
function actionColor(a) {
  const m = {imported:'blue', assigned:'green', sold:'gold', replaced:'gold', deleted:'red', revealed_customer:'blue', revealed_admin:'gold'};
  return m[a] || 'gray';
}
