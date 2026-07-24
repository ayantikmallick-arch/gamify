/* admin/admin.js – GamifyDeals Admin Panel SPA (Automated Autocomplete Game & Credentials) */

// ── STATE ─────────────────────────────────────────────────────
let adminUser   = null;
let currentSec  = 'dashboard';
let pollTimer   = null;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
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

  document.getElementById('adminNameSidebar').textContent = adminUser.username;
  document.getElementById('adminRoleSidebar').textContent = adminUser.role;
  document.getElementById('adminAvatar').textContent      = adminUser.username[0].toUpperCase();
  if (adminUser.role === 'owner') {
    document.getElementById('teamNavItem').style.display = 'flex';
  }

  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.section));
  });
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('modalBackdrop')) closeModal();
  });

  navigateTo('dashboard');
  startLivePolling();
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
  if (pollTimer) clearInterval(pollTimer);
  await api('POST', '/api/auth/logout').catch(() => {});
  window.location.reload();
}

// Live Polling for New UTR Payment Notifications
function startLivePolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const data = await api('GET', '/api/orders?status=pending_approval');
      const badge = document.getElementById('pendingBadge');
      if (badge) {
        if (data.pending_count > 0) {
          badge.textContent   = data.pending_count;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (e) {
      // silent polling catch
    }
  }, 10000);
}

// ── NAVIGATION ────────────────────────────────────────────────
function navigateTo(section) {
  currentSec = section;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.section === section));
  const titles = {
    dashboard: 'Dashboard Overview',
    games:     'Games Catalog & Credentials',
    orders:    'Orders & Payment Approvals',
    audit:     'Audit Log',
    team:      'Team',
    settings:  'Settings'
  };
  document.getElementById('topbarTitle').textContent = titles[section] || section;
  document.getElementById('topbarActions').innerHTML = '';
  document.getElementById('mainContent').innerHTML   = '<div class="empty-state"><div class="spinner" style="width:28px;height:28px;border-width:3px"></div></div>';

  const renders = {
    dashboard: renderDashboard,
    games:     renderGames,
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
  if (!data) { setContent('<div class="empty-state"><p>Failed to load dashboard stats.</p></div>'); return; }

  const r = data.revenue, o = data.order_stats;

  setContent(`
  ${r.pending_approval > 0 ? `
  <div style="background:rgba(244,162,97,.12);border:1px solid rgba(244,162,97,.3);border-radius:10px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;">
    <div style="color:#f4a261;font-size:14px;font-weight:600">
      🔔 <strong>${r.pending_approval} Pending Payment${r.pending_approval > 1 ? 's' : ''}</strong> waiting for UTR verification!
    </div>
    <button class="btn btn-primary btn-sm" onclick="navigateTo('orders')">Review Orders →</button>
  </div>` : ''}

  <div class="stats-grid">
    <div class="stat-card green">
      <div class="stat-icon">💰</div>
      <div class="stat-label">Verified Revenue</div>
      <div class="stat-value">₹${fmt(r.total_revenue)}</div>
      <div class="stat-sub">₹${fmt(r.revenue_7d)} last 7 days</div>
    </div>
    <div class="stat-card gold">
      <div class="stat-icon">⏳</div>
      <div class="stat-label">Pending Approvals</div>
      <div class="stat-value">${r.pending_approval}</div>
      <div class="stat-sub">Requires admin UTR check</div>
    </div>
    <div class="stat-card blue">
      <div class="stat-icon">🛒</div>
      <div class="stat-label">Delivered Orders</div>
      <div class="stat-value">${r.total_orders}</div>
      <div class="stat-sub">${o.delivered} delivered · ${o.rejected} rejected</div>
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
          <thead><tr><th>Customer</th><th>Game</th><th>UTR / Ref</th><th>Status</th></tr></thead>
          <tbody>
            ${data.recent_orders.length ? data.recent_orders.map(o => `
            <tr>
              <td class="td-name">${esc(o.buyer_email)}</td>
              <td class="muted">${esc(o.emoji || '🎮')} ${esc(o.game_name || '—')}</td>
              <td class="td-mono">${esc(o.utr_number || '—')}</td>
              <td><span class="badge badge-${statusColor(o.status)}">${statusLabel(o.status)}</span></td>
            </tr>`).join('') : '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No orders yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Top Games -->
    <div class="card">
      <div class="card-header"><div class="card-title">Top Selling Games</div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Game</th><th>Delivered</th><th>Revenue</th></tr></thead>
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

// ── GAMES MANAGEMENT (ONE SINGLE "Add New Game" BUTTON) ────────
let gamesSearch = '';
async function renderGames() {
  addTopbarBtn('+ Add New Game', openAddGameAutomatedModal);
  const url  = gamesSearch ? `/api/games/admin/list?search=${encodeURIComponent(gamesSearch)}` : '/api/games/admin/list';
  const rows = await api('GET', url).catch(() => []);

  setContent(`
  <div class="toolbar">
    <div class="search-box">
      <span>🔍</span>
      <input id="gamesSearchInput" placeholder="Search games catalog…" value="${esc(gamesSearch)}"/>
    </div>
  </div>
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Game Banner &amp; Name</th><th>Genre</th><th>Price</th><th>Steam Account Slots</th><th>Actions</th></tr></thead>
        <tbody id="gamesBody">
          ${rows.length ? rows.map(g => `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:12px">
                <img src="${g.steam_app_id ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam_app_id}/capsule_sm_120.jpg` : '/logo.png'}"
                     style="width:50px;height:32px;border-radius:4px;object-fit:cover;background:#1a1d28"
                     onerror="this.src='/logo.png'">
                <div>
                  <strong style="font-size:14px;color:#e8eaf0">${esc(g.name)}</strong>
                  ${g.sub_genre ? `<div style="font-size:11px;color:#6b7280">${esc(g.sub_genre)}</div>` : ''}
                </div>
              </div>
            </td>
            <td class="muted"><span class="badge badge-gray">${esc(g.genre || 'Action')}</span></td>
            <td><strong style="color:#e63946">₹${parseFloat(g.price).toFixed(0)}</strong></td>
            <td><span class="badge ${g.total_slots > 0 ? 'badge-green' : 'badge-gold'}">${g.total_slots} slot${g.total_slots!==1?'s':''} active</span></td>
            <td>
              <button class="btn btn-primary btn-xs" onclick="openGameAccountsModal(${g.id}, '${esc(g.name).replace(/'/g, "\\'")}')">🔑 Steam Slots</button>
              <button class="btn btn-danger btn-xs" onclick="deleteGame(${g.id})">Delete</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">No games added to active database yet. Click "+ Add New Game" above to select games and add credentials!</td></tr>'}
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

// ── AUTOMATED GAME SELECTION & CREDENTIALS MODAL ─────────────
let selectedCatalogGame = null;

function openAddGameAutomatedModal() {
  selectedCatalogGame = null;

  openModal('Add Game & Steam Credentials', `
    <div style="font-size:12px;color:#9ea3b5;margin-bottom:14px">
      Type a game name below. Select any game from the website catalog to automatically load its Banner, Price, and Genre!
    </div>

    <!-- Autocomplete Search Input -->
    <div class="form-group" style="position:relative">
      <label class="form-label">Search Game Name *</label>
      <input class="form-input" id="autoGameSearch" placeholder="Type first letters (e.g. Grand Theft Auto, Red Dead, Cyberpunk...)" autocomplete="off"/>
      <div id="autocompleteDropdown" style="position:absolute;top:100%;left:0;right:0;background:#1a1d28;border:1px solid #252836;border-radius:8px;max-height:180px;overflow-y:auto;z-index:99;display:none;"></div>
    </div>

    <!-- Auto-Filled Game Card Preview -->
    <div id="gamePreviewCard" style="display:none;background:#0d0f14;border:1px solid #1f2333;border-radius:10px;padding:14px;margin-bottom:16px;align-items:center;gap:14px">
      <img id="prevBanner" src="" style="width:70px;height:45px;border-radius:6px;object-fit:cover;background:#1a1d28"/>
      <div style="flex:1">
        <div id="prevName" style="font-size:14px;font-weight:700;color:#e8eaf0">Game Name</div>
        <div style="font-size:11px;color:#6b7280"><span id="prevGenre">Genre</span> · Fixed Price: <strong style="color:#e63946" id="prevPrice">₹149</strong></div>
      </div>
      <span class="badge badge-green">Auto-Filled</span>
    </div>

    <!-- Steam Credentials Section (2 clear fields) -->
    <div style="background:#13161e;border:1px solid #1f2333;border-radius:10px;padding:16px;margin-top:10px">
      <div style="font-size:13px;font-weight:600;color:#2ec4b6;margin-bottom:12px">🔑 Steam Account Credentials</div>
      
      <div class="form-group">
        <label class="form-label">Steam Username *</label>
        <input class="form-input" id="ag-steam-username" placeholder="e.g. steam_user_account"/>
      </div>
      
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Steam Password *</label>
        <input class="form-input" type="text" id="ag-steam-password" placeholder="e.g. steam_pass_123"/>
      </div>
    </div>
  `, [
    { label: 'Save Game & Steam Credentials', cls: 'btn-primary', id: 'saveAutoGameBtn', action: saveAutomatedGame },
    { label: 'Cancel', cls: 'btn-secondary', action: closeModal }
  ]);

  // Attach Autocomplete Listener
  const searchInput = document.getElementById('autoGameSearch');
  const dropdown    = document.getElementById('autocompleteDropdown');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }

    const catalog = typeof GAMES_DATA !== 'undefined' ? GAMES_DATA : [];
    const matches = catalog.filter(g => g.name.toLowerCase().includes(q)).slice(0, 10);

    if (!matches.length) {
      dropdown.innerHTML = `<div style="padding:10px;font-size:12px;color:#6b7280;text-align:center">Custom game name: "${esc(q)}"</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = matches.map(g => `
      <div class="auto-item" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #1f2333;font-size:13px;display:flex;align-items:center;gap:10px;transition:background .15s"
           onclick="selectCatalogGame(${g.id}, '${esc(g.name).replace(/'/g, "\\'")}', '${esc(g.genre)}', ${g.price}, '${esc(g.sub||'')}', '${esc(g.badge||'')}', '${esc(g.emoji||'🎮')}', ${g.orig||0})">
        <img src="https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}/capsule_sm_120.jpg" style="width:36px;height:24px;border-radius:4px;object-fit:cover" onerror="this.style.display='none'"/>
        <div style="flex:1">
          <strong style="color:#e8eaf0">${esc(g.name)}</strong>
          <span style="font-size:11px;color:#6b7280;margin-left:6px">${esc(g.genre)}</span>
        </div>
        <span style="color:#e63946;font-weight:700">₹${g.price}</span>
      </div>
    `).join('');

    dropdown.style.display = 'block';
  });
}

function selectCatalogGame(appId, name, genre, price, sub, badge, emoji, orig) {
  selectedCatalogGame = { id: appId, name, genre, price, sub, badge, emoji, orig };

  document.getElementById('autoGameSearch').value = name;
  document.getElementById('autocompleteDropdown').style.display = 'none';

  // Update preview card
  const prevCard  = document.getElementById('gamePreviewCard');
  const prevImg   = document.getElementById('prevBanner');
  const prevName  = document.getElementById('prevName');
  const prevGenre = document.getElementById('prevGenre');
  const prevPrice = document.getElementById('prevPrice');

  prevImg.src           = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
  prevName.textContent  = name;
  prevGenre.textContent = genre;
  prevPrice.textContent = `₹${price}`;

  prevCard.style.display = 'flex';
}

async function saveAutomatedGame() {
  const searchVal      = document.getElementById('autoGameSearch').value.trim();
  const steam_username = document.getElementById('ag-steam-username').value.trim();
  const steam_password = document.getElementById('ag-steam-password').value.trim();

  if (!searchVal) {
    toast('Please select or type a Game Name', 'error');
    return;
  }
  if (!steam_username || !steam_password) {
    toast('Steam Username and Steam Password are required', 'error');
    return;
  }

  const btn = document.getElementById('saveAutoGameBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const payload = {
    name:           selectedCatalogGame ? selectedCatalogGame.name  : searchVal,
    genre:          selectedCatalogGame ? selectedCatalogGame.genre : 'Action',
    sub_genre:      selectedCatalogGame ? selectedCatalogGame.sub   : null,
    steam_app_id:   selectedCatalogGame ? selectedCatalogGame.id    : null,
    price:          selectedCatalogGame ? selectedCatalogGame.price  : 149,
    original_price: selectedCatalogGame ? selectedCatalogGame.orig   : 1799,
    badge:          selectedCatalogGame ? selectedCatalogGame.badge  : null,
    emoji:          selectedCatalogGame ? selectedCatalogGame.emoji  : '🎮',
    steam_username,
    steam_password
  };

  const r = await api('POST', '/api/games/add-with-account', payload).catch(e => e.data);

  if (!r?.success) {
    toast(r?.error || 'Failed to save game and credentials', 'error');
    btn.disabled = false;
    btn.textContent = 'Save Game & Steam Credentials';
    return;
  }

  toast(`Game "${payload.name}" & Steam Credentials saved successfully! ✅`);
  closeModal();
  renderGames();
}

async function deleteGame(id) {
  if (!confirm('Are you sure you want to delete this game?')) return;
  const r = await api('DELETE', `/api/games/${id}`).catch(() => null);
  if (!r?.success) { toast('Delete failed', 'error'); return; }
  toast('Game deleted'); renderGames();
}

// ── MULTI-SLOT STEAM CREDENTIALS MODAL ─────────────────────────
async function openGameAccountsModal(gameId, gameName) {
  const accounts = await api('GET', `/api/games/${gameId}/accounts`).catch(() => []);

  openModal(`Steam Credentials — ${gameName}`, `
    <div style="font-size:12px;color:#9ea3b5;margin-bottom:16px">
      Manage active Steam account slots for <strong>${esc(gameName)}</strong>.
    </div>

    <!-- Accounts List -->
    <div id="accountsList" style="max-height:240px;overflow-y:auto;margin-bottom:16px;border:1px solid #1f2333;border-radius:8px;">
      ${accounts.length ? accounts.map((acc, i) => `
        <div style="padding:10px 14px;border-bottom:1px solid #1f2333;display:flex;align-items:center;justify-content:space-between;background:#0d0f14;">
          <div>
            <div style="font-size:13px;font-weight:600;color:#2ec4b6">
              <span class="badge badge-blue">${esc(acc.slot_name || 'Slot ' + (i+1))}</span>
              User: <span class="td-mono">${esc(acc.steam_username)}</span>
            </div>
            <div style="font-size:12px;color:#9ea3b5;margin-top:2px">
              Password: <span class="td-mono" style="color:#f4a261">${esc(acc.steam_password)}</span>
            </div>
          </div>
          <div>
            <button class="btn btn-ghost btn-xs" onclick="fillAccountEditForm(${acc.id}, '${esc(acc.slot_name)}', '${esc(acc.steam_username)}', '${esc(acc.steam_password)}')">Edit</button>
            <button class="btn btn-danger btn-xs" onclick="deleteAccountSlot(${acc.id}, ${gameId}, '${esc(gameName)}')">Del</button>
          </div>
        </div>
      `).join('') : '<div class="empty-state" style="padding:20px"><p>No Steam account slots added yet. Add one below!</p></div>'}
    </div>

    <!-- Add/Edit Form -->
    <div style="background:#13161e;padding:14px;border-radius:8px;border:1px solid #1f2333">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px" id="accFormTitle">Add Additional Steam Slot</div>
      <input type="hidden" id="fa-account-id" value=""/>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Slot Name</label>
          <input class="form-input" id="fa-slot-name" placeholder="e.g. Slot 2"/>
        </div>
        <div class="form-group">
          <label class="form-label">Steam Username *</label>
          <input class="form-input" id="fa-username" placeholder="e.g. steam_user_02"/>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Steam Password *</label>
        <input class="form-input" type="text" id="fa-password" placeholder="e.g. steam_pass_456"/>
      </div>
      <button class="btn btn-primary btn-sm" id="saveAccountBtn">Save Account Slot</button>
      <button class="btn btn-ghost btn-sm" id="resetAccountBtn" style="display:none" onclick="resetAccForm()">Cancel Edit</button>
    </div>
  `, [
    { label: 'Close', cls: 'btn-secondary', action: closeModal }
  ]);

  document.getElementById('saveAccountBtn').addEventListener('click', async () => {
    const account_id     = document.getElementById('fa-account-id').value;
    const slot_name      = document.getElementById('fa-slot-name').value || `Slot ${accounts.length + 1}`;
    const steam_username = document.getElementById('fa-username').value.trim();
    const steam_password = document.getElementById('fa-password').value.trim();

    if (!steam_username || !steam_password) {
      toast('Steam username and password are required', 'error');
      return;
    }

    const r = await api('POST', `/api/games/${gameId}/accounts`, {
      account_id: account_id || null,
      slot_name,
      steam_username,
      steam_password
    }).catch(() => null);

    if (!r?.success) {
      toast(r?.error || 'Failed to save account slot', 'error');
      return;
    }

    toast('Steam account slot saved ✅');
    openGameAccountsModal(gameId, gameName);
  });
}

function fillAccountEditForm(id, slotName, username, password) {
  document.getElementById('fa-account-id').value = id;
  document.getElementById('fa-slot-name').value   = slotName;
  document.getElementById('fa-username').value    = username;
  document.getElementById('fa-password').value    = password;
  document.getElementById('accFormTitle').textContent = 'Edit Steam Slot: ' + slotName;
  document.getElementById('resetAccountBtn').style.display = 'inline-block';
}

function resetAccForm() {
  document.getElementById('fa-account-id').value = '';
  document.getElementById('fa-slot-name').value   = '';
  document.getElementById('fa-username').value    = '';
  document.getElementById('fa-password').value    = '';
  document.getElementById('accFormTitle').textContent = 'Add Additional Steam Slot';
  document.getElementById('resetAccountBtn').style.display = 'none';
}

async function deleteAccountSlot(accountId, gameId, gameName) {
  if (!confirm('Delete this Steam account slot?')) return;
  const r = await api('DELETE', `/api/games/accounts/${accountId}`).catch(() => null);
  if (!r?.success) { toast('Failed to delete slot', 'error'); return; }
  toast('Slot deleted');
  openGameAccountsModal(gameId, gameName);
}

// ── ORDERS & MANUAL UPI APPROVAL ──────────────────────────────
let ordFilter = { status: '', search: '', page: 1 };
async function renderOrders() {
  const qs   = new URLSearchParams({ ...(ordFilter.status && {status: ordFilter.status}), ...(ordFilter.search && {search: ordFilter.search}), page: ordFilter.page });
  const data = await api('GET', '/api/orders?' + qs).catch(() => ({ orders: [], total: 0, pages: 1, pending_count: 0 }));

  setContent(`
  <div class="toolbar">
    <div class="search-box">
      <span>🔍</span>
      <input id="ordSearch" placeholder="Search email, name, UTR number…" value="${esc(ordFilter.search)}"/>
    </div>
    <select class="filter-select" id="ordStatus">
      <option value="">All Statuses</option>
      <option value="pending_approval" ${ordFilter.status==='pending_approval'?'selected':''}>Pending Verification (UTR)</option>
      <option value="delivered"        ${ordFilter.status==='delivered'?'selected':''}>Delivered / Approved</option>
      <option value="rejected"         ${ordFilter.status==='rejected'?'selected':''}>Rejected</option>
    </select>
    <span style="color:#6b7280;font-size:13px">${data.total} orders</span>
  </div>

  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Customer Email</th><th>Game</th><th>Amount</th><th>Submitted UTR</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>
          ${data.orders.length ? data.orders.map(o => `
          <tr>
            <td>
              <div class="td-name">${esc(o.buyer_email)}</div>
              ${o.buyer_whatsapp ? `<div style="font-size:11px;color:#2ec4b6">WA: ${esc(o.buyer_whatsapp)}</div>` : ''}
            </td>
            <td class="muted">${esc(o.emoji||'🎮')} ${esc(o.game_name||'—')}</td>
            <td><strong>₹${parseFloat(o.amount).toFixed(0)}</strong></td>
            <td class="td-mono" style="color:#2ec4b6"><strong>${esc(o.utr_number || '—')}</strong></td>
            <td><span class="badge badge-${statusColor(o.status)}">${statusLabel(o.status)}</span></td>
            <td class="muted" style="font-size:12px">${fmtDate(o.created_at)}</td>
            <td>
              ${o.status === 'pending_approval' ? `
                <button class="btn btn-primary btn-xs" onclick="approveOrder('${o.id}')">✅ Approve &amp; Deliver</button>
                <button class="btn btn-danger btn-xs" onclick="rejectOrder('${o.id}')">❌ Reject</button>
              ` : `
                <button class="btn btn-ghost btn-xs" onclick="openOrderModal('${o.id}')">View</button>
                ${o.status === 'delivered' ? `<button class="btn btn-ghost btn-xs" onclick="revealCreds('${o.id}')">🔑 Creds</button>` : ''}
              `}
            </td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">No orders found.</td></tr>'}
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

async function approveOrder(id) {
  if (!confirm('Approve this order and deliver Steam credentials to the buyer?')) return;
  const r = await api('POST', `/api/orders/${id}/approve`, {}).catch(e => e.data);
  if (!r?.success) {
    toast(r?.error || 'Failed to approve order', 'error');
    return;
  }
  toast('Order Approved & Delivered! ✅');
  renderOrders();
}

async function rejectOrder(id) {
  const reason = prompt('Enter reason for rejecting this UTR payment (e.g. UTR Not Received / Invalid UTR):', 'UTR Not Found in Bank Statement');
  if (reason === null) return;
  const r = await api('POST', `/api/orders/${id}/reject`, { reason }).catch(() => null);
  if (!r?.success) { toast('Failed to reject order', 'error'); return; }
  toast('Order Rejected');
  renderOrders();
}

async function openOrderModal(id) {
  const o = await api('GET', `/api/orders/${id}`).catch(() => null);
  if (!o) { toast('Failed to load order', 'error'); return; }
  openModal('Order Details', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">STATUS</div><span class="badge badge-${statusColor(o.status)}">${statusLabel(o.status)}</span></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">AMOUNT</div><strong style="color:#e63946">₹${parseFloat(o.amount).toFixed(2)}</strong></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">SUBMITTED UTR</div><span class="td-mono" style="color:#2ec4b6;font-weight:700">${esc(o.utr_number||'—')}</span></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">CUSTOMER</div><span style="font-size:13px">${esc(o.buyer_email)}</span></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">GAME</div><span style="font-size:13px">${esc(o.emoji||'🎮')} ${esc(o.game_name||'—')}</span></div>
      <div><div style="font-size:11px;color:#6b7280;margin-bottom:3px">APPROVED BY</div><span style="font-size:12px">${esc(o.approved_by||'—')}</span></div>
    </div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:8px">ORDER ID: <span class="td-mono">${o.id}</span></div>
    ${o.assigned_username ? `<div style="background:#0d0f14;border:1px solid #1f2333;border-radius:8px;padding:12px;font-family:monospace;font-size:13px;color:#2ec4b6">Assigned Steam Username: ${esc(o.assigned_username)}</div>` : ''}
  `, [
    ...(o.status === 'delivered' ? [{ label: '🔑 Reveal Password', cls: 'btn-primary', action: () => { closeModal(); revealCreds(id); }}] : []),
    ...(o.status === 'pending_approval' ? [{ label: '✅ Approve & Deliver', cls: 'btn-primary', action: () => { closeModal(); approveOrder(id); }}] : []),
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
  `, [{ label: 'Close', cls: 'btn-secondary', action: closeModal }]);
}

// ── AUDIT LOG ─────────────────────────────────────────────────
async function renderAudit() {
  const logs = await api('GET', '/api/dashboard/audit-log').catch(() => []);
  setContent(`
  <div class="card">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Action</th><th>Actor</th><th>Game</th><th>Details</th><th>Date</th></tr></thead>
        <tbody>
          ${logs.length ? logs.map(l => `
          <tr>
            <td><span class="badge badge-${actionColor(l.action)}">${l.action}</span></td>
            <td class="muted">${esc(l.actor||'system')}</td>
            <td class="muted">${esc(l.game_name||'—')}</td>
            <td class="muted" style="font-size:11px">${l.meta ? JSON.stringify(l.meta).substring(0,70) : '—'}</td>
            <td class="muted" style="font-size:12px">${fmtDate(l.created_at)}</td>
          </tr>`).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">No audit logs yet.</td></tr>'}
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
    <div class="card-header"><div class="card-title">Change Admin Password</div></div>
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

// ── UTILS ─────────────────────────────────────────────────────
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

function statusColor(s) { return {delivered:'green', pending_approval:'gold', rejected:'red'}[s] || 'gray'; }
function statusLabel(s) { return {delivered:'Delivered', pending_approval:'Pending UTR', rejected:'Rejected'}[s] || s; }
function actionColor(a) {
  const m = {approved_delivered:'green', rejected:'red', order_created:'gold', revealed_customer:'blue', revealed_admin:'gold'};
  return m[a] || 'gray';
}
