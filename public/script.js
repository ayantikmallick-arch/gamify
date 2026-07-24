/* public/script.js – Storefront & Manual UPI QR Checkout */

const PAGE_SIZE = 40;
let currentPage  = 1;
let activeFilter = 'all';
let activeSearch = '';
let currentPendingOrder = null;

// ── CART ──────────────────────────────────────────────────────
const Cart = {
  items: [],
  init()  { try { this.items = JSON.parse(localStorage.getItem('gd_cart') || '[]'); } catch { this.items = []; } },
  add(g)  {
    if (this.items.find(i => i.id === g.id)) { showToast(`"${g.name}" already in cart`, 'error'); return false; }
    this.items.push(g); this.save(); this.updateBadge();
    showToast('Added to cart 🛒'); return true;
  },
  remove(id)  { this.items = this.items.filter(i => i.id !== id); this.save(); this.updateBadge(); renderCartItems(); },
  clear()     { this.items = []; this.save(); this.updateBadge(); renderCartItems(); },
  total()     { return this.items.reduce((s,i) => s + i.price, 0); },
  count()     { return this.items.length; },
  save()      { localStorage.setItem('gd_cart', JSON.stringify(this.items)); },
  inCart(id)  { return !!this.items.find(i => i.id === id); },
  updateBadge() {
    const b = document.getElementById('cartBadge');
    if (b) { b.textContent = this.count(); b.style.display = this.count() ? 'flex' : 'none'; }
  }
};

// ── GAME CARDS ────────────────────────────────────────────────
function imgUrl(id) { return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`; }
function fallUrl(id) { return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`; }
function escH(s) { return String(s || '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }

function createCardHTML(g) {
  const disc = g.orig ? Math.round((1 - g.price/g.orig)*100) : 0;
  const badgeHTML = g.badge ? `<span class="game-badge ${g.badge}">${{hot:'🔥 Hot',new:'✨ New',bestseller:'⭐ Popular'}[g.badge]||g.badge}</span>` : '';
  return `
  <div class="game-card" data-id="${g.id}" data-name="${escH(g.name)}" data-price="${g.price}" data-genre="${escH(g.genre)}" data-emoji="${g.emoji||'🎮'}" data-appid="${g.id}">
    <img class="game-cover" src="${imgUrl(g.id)}" alt="${escH(g.name)}" loading="lazy"
      onerror="this.onerror=null;this.src='${fallUrl(g.id)}'"/>
    ${badgeHTML}
    <div class="game-info">
      <div class="game-title">${escH(g.name)}</div>
      <div class="game-genre">${escH(g.genre||'')} · ${escH(g.sub||'')}</div>
      <div class="game-price-row">
        <div class="price-block">
          ${g.orig ? `<span class="original-price">₹${g.orig}</span>` : ''}
          <span class="sale-price">₹${g.price} <span>/ acc</span></span>
        </div>
        ${disc ? `<span class="discount-tag">-${disc}%</span>` : ''}
      </div>
      <div class="card-btns">
        <button class="btn-buy">Buy Now</button>
        <button class="btn-cart ${Cart.inCart(g.id)?'in-cart':''}">${Cart.inCart(g.id)?'✓':'🛒'}</button>
      </div>
    </div>
  </div>`;
}

// ── RENDER GAMES ──────────────────────────────────────────────
function getFiltered() {
  if (typeof GAMES_DATA === 'undefined') return [];
  return GAMES_DATA.filter(g => {
    const mf = activeFilter === 'all' || g.genre === activeFilter;
    const ms = !activeSearch || g.name.toLowerCase().includes(activeSearch);
    return mf && ms;
  });
}

function renderGames(reset = false) {
  const grid    = document.getElementById('gamesGrid');
  const countEl = document.getElementById('gamesCountLabel');
  const moreBtn = document.getElementById('loadMoreBtn');
  if (!grid) return;
  const filtered = getFiltered();
  const total    = filtered.length;
  const showing  = Math.min(currentPage * PAGE_SIZE, total);
  const slice    = filtered.slice(0, showing);
  if (reset) { grid.innerHTML = slice.map(createCardHTML).join(''); }
  else { grid.insertAdjacentHTML('beforeend', filtered.slice((currentPage-1)*PAGE_SIZE, showing).map(createCardHTML).join('')); }
  attachCardListeners();
  if (countEl) countEl.textContent = `Showing ${showing} of ${total} games`;
  if (moreBtn) moreBtn.style.display = showing < total ? 'inline-block' : 'none';
}

function attachCardListeners() {
  document.querySelectorAll('.game-card').forEach(card => {
    const buy = card.querySelector('.btn-buy');
    if (buy && !buy._l) {
      buy._l = true;
      buy.addEventListener('click', e => {
        e.preventDefault();
        openBuyModal({
          id:    card.dataset.id,
          name:  card.dataset.name,
          price: parseFloat(card.dataset.price),
          genre: card.dataset.genre,
          img:   card.querySelector('img')?.src || ''
        });
      });
    }
    const cart = card.querySelector('.btn-cart');
    if (cart && !cart._l) {
      cart._l = true;
      cart.addEventListener('click', e => {
        e.stopPropagation();
        const added = Cart.add({
          id:    parseInt(card.dataset.id),
          name:  card.dataset.name,
          price: parseFloat(card.dataset.price),
          genre: card.dataset.genre,
          emoji: card.dataset.emoji,
          img:   card.querySelector('img')?.src || ''
        });
        if (added) { cart.textContent = '✓'; cart.classList.add('in-cart'); renderCartItems(); }
      });
    }
  });
}

// ── BUY MODAL (Step 1 -> Step 2 UPI QR) ──────────────────────
function openBuyModal({ id, name, price, genre, img }) {
  const m = document.getElementById('buyModal');
  if (!m) return;

  document.getElementById('modalGameImg').src           = img || imgUrl(id);
  document.getElementById('modalGameName').textContent  = name;
  document.getElementById('modalGamePrice').textContent = `₹${price}`;
  document.getElementById('modalGenre').textContent     = genre;

  m.dataset.gameId   = id || '';
  m.dataset.gameName = name;
  m.dataset.price    = price;

  // Reset steps
  document.getElementById('checkoutStep1').style.display = 'block';
  document.getElementById('checkoutStep2').style.display = 'none';
  document.getElementById('modalTitle').textContent     = 'Complete Your Order';
  document.getElementById('modalSubtitle').textContent  = 'Step 1: Enter your contact details';
  document.getElementById('utrInput').value              = '';
  if (document.getElementById('payerNameInput')) document.getElementById('payerNameInput').value = '';

  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('buyModal')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── CHECKOUT FLOW ─────────────────────────────────────────────
async function handleStep1Proceed() {
  const m = document.getElementById('buyModal');
  let email = document.getElementById('buyerEmail')?.value.trim();
  const whatsapp = document.getElementById('buyerWhatsapp')?.value.trim();

  if (!email || !email.includes('@')) {
    if (typeof loggedInUserEmail !== 'undefined' && loggedInUserEmail) {
      email = loggedInUserEmail;
    } else {
      email = `buyer_${Date.now()}@gamifydeals.com`;
    }
  }

  const btn = document.getElementById('proceedToPayBtn');
  btn.disabled = true;
  btn.textContent = 'Generating UPI QR…';

  try {
    const res = await fetch('/api/orders/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer_email:    email,
        buyer_whatsapp: whatsapp || null,
        amount:         parseFloat(m.dataset.price),
        game_id:        m.dataset.gameId ? parseInt(m.dataset.gameId) : null,
        game_name:      m.dataset.gameName || null
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to create order', 'error');
      btn.disabled = false;
      btn.textContent = 'Generate UPI QR Code →';
      return;
    }

    currentPendingOrder = data;

    // Transition to Step 2
    document.getElementById('upiQrImage').src               = data.qr_code_data_url;
    document.getElementById('upiIdDisplay').textContent     = data.upi_id || '9851228158@fam';
    document.getElementById('upiAmountDisplay').textContent = `₹${data.amount}`;

    document.getElementById('checkoutStep1').style.display = 'none';
    document.getElementById('checkoutStep2').style.display = 'block';
    document.getElementById('modalTitle').textContent     = 'Scan & Submit Payment Details';
    document.getElementById('modalSubtitle').textContent  = 'Step 2: Pay via UPI & submit UTR + Payer Name';

    btn.disabled = false;
    btn.textContent = 'Generate UPI QR Code →';
  } catch (err) {
    console.error('Create order error:', err);
    showToast('Network error. Is the server running?', 'error');
    btn.disabled = false;
    btn.textContent = 'Generate UPI QR Code →';
  }
}

async function handleSubmitUtr() {
  if (!currentPendingOrder) {
    showToast('Order session expired. Please start again.', 'error');
    closeModal();
    return;
  }

  const utr       = document.getElementById('utrInput')?.value.trim();
  const payerName = document.getElementById('payerNameInput')?.value.trim();

  const cleanUtr = utr ? utr.replace(/[\s-]/g, '') : '';
  if (!cleanUtr || cleanUtr.length !== 12 || !/^\d{12}$/.test(cleanUtr)) {
    showToast('Please enter your valid 12-digit UPI Transaction Ref / UTR ID to proceed.', 'error');
    return;
  }

  const btn = document.getElementById('submitUtrBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting Payment…';

  try {
    const res = await fetch('/api/orders/submit-utr', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id:   currentPendingOrder.order_id,
        token:      currentPendingOrder.view_token,
        utr_number: utr,
        payer_name: payerName || null
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || 'Failed to submit UTR. Try again.', 'error');
      btn.disabled = false;
      btn.textContent = 'Submit Payment & Get Access →';
      return;
    }

    try {
      const hist = JSON.parse(localStorage.getItem('gd_my_orders') || '[]');
      hist.unshift({
        order_id:   data.order_id,
        view_token: data.view_token,
        date:       new Date().toISOString()
      });
      localStorage.setItem('gd_my_orders', JSON.stringify(hist.slice(0, 20)));
    } catch (e) {}

    Cart.clear();
    closeModal();
    window.location.href = data.redirect_url;
  } catch (err) {
    showToast('Network error while submitting UTR.', 'error');
    btn.disabled = false;
    btn.textContent = 'Submit Payment & Get Access →';
  }
}

function copyUpiId() {
  const upi = document.getElementById('upiIdDisplay').textContent;
  navigator.clipboard.writeText(upi).then(() => {
    showToast('UPI ID Copied: ' + upi);
  });
}

// ── CART SIDEBAR ──────────────────────────────────────────────
function injectCartSidebar() {
  if (document.getElementById('cartOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="cart-overlay" id="cartOverlay">
    <div class="cart-panel">
      <div class="cart-header">
        <div><h3>🛒 Shopping Cart</h3><div class="cart-count-label" id="cartCountLabel">0 items</div></div>
        <button class="close-cart-btn" id="closeCartBtn">✕</button>
      </div>
      <div id="cartBody" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;"></div>
      <div class="cart-footer" id="cartFooter" style="display:none">
        <div class="cart-summary">
          <div class="cart-summary-row"><span>Subtotal</span><span id="cartSubtotal">₹0</span></div>
          <div class="cart-summary-row"><span>Delivery</span><span style="color:var(--green)">Instant Access</span></div>
          <div class="cart-summary-row total"><span>Total</span><span class="price" id="cartTotalDisplay">₹0</span></div>
        </div>
        <button class="cart-checkout-btn" id="cartCheckoutBtn">Proceed to Checkout →</button>
        <button class="cart-clear-btn" id="cartClearBtn">🗑 Clear Cart</button>
        <div class="cart-warranty-note"><span>🛡️</span> Lifetime Replacement Warranty</div>
      </div>
    </div>
  </div>`);
  document.getElementById('closeCartBtn').addEventListener('click', closeCart);
  document.getElementById('cartOverlay').addEventListener('click', e => { if (e.target===document.getElementById('cartOverlay')) closeCart(); });
  document.getElementById('cartClearBtn').addEventListener('click', () => { if(confirm('Clear cart?')) Cart.clear(); });
  document.getElementById('cartCheckoutBtn').addEventListener('click', openCartCheckout);
  renderCartItems();
}

function openCart()  { injectCartSidebar(); renderCartItems(); document.getElementById('cartOverlay').classList.add('open'); document.body.style.overflow='hidden'; }
function closeCart() { document.getElementById('cartOverlay')?.classList.remove('open'); document.body.style.overflow=''; }

function renderCartItems() {
  const body   = document.getElementById('cartBody');
  const footer = document.getElementById('cartFooter');
  const label  = document.getElementById('cartCountLabel');
  if (!body) return;
  if (label) label.textContent = `${Cart.count()} item${Cart.count()!==1?'s':''}`;
  if (!Cart.count()) {
    body.innerHTML = `<div class="cart-empty"><div class="empty-icon">🛒</div><p>Your cart is empty</p><a href="#games">Browse catalog →</a></div>`;
    if (footer) footer.style.display = 'none';
    return;
  }
  body.innerHTML = `<div class="cart-items-list">${Cart.items.map(item=>`
    <div class="cart-item">
      ${item.img ? `<img class="cart-item-img" src="${item.img}" alt="${escH(item.name)}" onerror="this.style.display='none'">` : `<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;font-size:22px">${item.emoji}</div>`}
      <div class="cart-item-info">
        <div class="cart-item-name">${escH(item.name)}</div>
        <div class="cart-item-genre">${escH(item.genre)}</div>
        <div class="cart-item-price">₹${item.price}</div>
      </div>
      <button class="cart-item-remove" onclick="Cart.remove(${item.id})">✕</button>
    </div>`).join('')}</div>`;
  if (footer) {
    footer.style.display = 'block';
    const t = Cart.total();
    document.getElementById('cartSubtotal').textContent    = `₹${t}`;
    document.getElementById('cartTotalDisplay').textContent = `₹${t}`;
  }
}

function openCartCheckout() {
  closeCart();
  openCartModal();
}

function openCartModal() {
  const m = document.getElementById('buyModal');
  if (!m) return;
  document.getElementById('modalGameImg').src           = '/logo.png';
  document.getElementById('modalGameName').textContent  = `Cart (${Cart.count()} items)`;
  document.getElementById('modalGamePrice').textContent = `₹${Cart.total()}`;
  document.getElementById('modalGenre').textContent     = 'Multiple Games';
  m.dataset.gameName = Cart.items.map(i=>i.name).join(', ');
  m.dataset.price    = Cart.total();
  m.dataset.gameId   = '';

  document.getElementById('checkoutStep1').style.display = 'block';
  document.getElementById('checkoutStep2').style.display = 'none';
  document.getElementById('modalTitle').textContent     = 'Complete Your Order';
  document.getElementById('modalSubtitle').textContent  = 'Step 1: Enter your contact details';
  document.getElementById('utrInput').value              = '';
  if (document.getElementById('payerNameInput')) document.getElementById('payerNameInput').value = '';

  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ── FILTERS / INSTANT AUTOCOMPLETE SEARCH ─────────────────────
function initFilterBar() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); activeFilter = btn.dataset.filter; currentPage = 1; renderGames(true);
    });
  });
}

function initSearch() {
  const desktopSearch = document.getElementById('desktopSearch');
  const mobileSearch  = document.getElementById('mobileSearchBar');

  // Inject Autocomplete Dropdown Containers
  if (desktopSearch && !document.getElementById('desktopSearchDropdown')) {
    desktopSearch.insertAdjacentHTML('beforeend', '<div class="nav-search-dropdown" id="desktopSearchDropdown"></div>');
  }
  if (mobileSearch && !document.getElementById('mobileSearchDropdown')) {
    mobileSearch.insertAdjacentHTML('beforeend', '<div class="nav-search-dropdown" id="mobileSearchDropdown" style="left:0;right:0;width:100%"></div>');
  }

  const handleInput = (e, dropdownId) => {
    const q = e.target.value.toLowerCase().trim();
    activeSearch = q;
    activeFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter==='all'));
    currentPage = 1;
    renderGames(true);

    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    if (!q) {
      dropdown.style.display = 'none';
      return;
    }

    const catalog = typeof GAMES_DATA !== 'undefined' ? GAMES_DATA : [];
    const matches = catalog.filter(g => g.name.toLowerCase().includes(q)).slice(0, 15);

    if (!matches.length) {
      dropdown.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--text-muted);text-align:center">No matching games found</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = matches.map(g => `
      <div class="search-dropdown-item" onclick="handleDropdownSelect(${g.id}, '${escH(g.name).replace(/'/g, "\\'")}', ${g.price}, '${escH(g.genre)}')">
        <img src="${imgUrl(g.id)}" alt="${escH(g.name)}" onerror="this.src='${fallUrl(g.id)}'"/>
        <div class="dropdown-item-info">
          <div class="dropdown-item-title">${escH(g.name)}</div>
          <div class="dropdown-item-genre">${escH(g.genre)} · ${escH(g.sub||'')}</div>
        </div>
        <div class="dropdown-item-price">₹${g.price}</div>
      </div>
    `).join('');

    dropdown.style.display = 'block';
  };

  const desktopInput      = document.getElementById('searchInput');
  const mobileInput       = document.getElementById('mobileSearchInput');
  const mobileHeaderInput = document.getElementById('mobileHeaderSearchInput');

  desktopInput?.addEventListener('input', e => handleInput(e, 'desktopSearchDropdown'));
  mobileInput?.addEventListener('input', e => handleInput(e, 'mobileSearchDropdown'));
  mobileHeaderInput?.addEventListener('input', e => handleInput(e, 'mobileHeaderSearchDropdown'));

  // Close dropdown on click outside
  document.addEventListener('click', e => {
    if (!e.target.closest('#desktopSearch')) {
      const d = document.getElementById('desktopSearchDropdown');
      if (d) d.style.display = 'none';
    }
    if (!e.target.closest('#mobileSearchBar')) {
      const m = document.getElementById('mobileSearchDropdown');
      if (m) m.style.display = 'none';
    }
  });
}

function handleDropdownSelect(id, name, price, genre) {
  document.querySelectorAll('.nav-search-dropdown').forEach(d => d.style.display = 'none');
  openBuyModal({
    id,
    name,
    price,
    genre,
    img: imgUrl(id)
  });
}

// ── MODAL INITIALIZATION ──────────────────────────────────────
function initModal() {
  const m = document.getElementById('buyModal');
  if (!m) return;
  m.addEventListener('click', e => { if (e.target===m) closeModal(); });
  document.getElementById('closeModal')?.addEventListener('click',  closeModal);
  document.getElementById('cancelModal')?.addEventListener('click', closeModal);

  document.getElementById('proceedToPayBtn')?.addEventListener('click', handleStep1Proceed);
  document.getElementById('submitUtrBtn')?.addEventListener('click', handleSubmitUtr);
  document.getElementById('backToStep1Btn')?.addEventListener('click', () => {
    document.getElementById('checkoutStep1').style.display = 'block';
    document.getElementById('checkoutStep2').style.display = 'none';
    document.getElementById('modalTitle').textContent     = 'Complete Your Order';
    document.getElementById('modalSubtitle').textContent  = 'Step 1: Enter your contact details';
  });
}

// ── HAMBURGER ─────────────────────────────────────────────────
function initHamburger() {
  const btn = document.getElementById('hamburger');
  const nav = document.querySelector('.nav-links');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => { btn.classList.toggle('open'); nav.classList.toggle('mobile-open'); });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('mobile-open'); btn.classList.remove('open'); }));
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type='success') {
  let t = document.querySelector('.toast');
  if (!t) { t=document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
  t.innerHTML = `<span>${type==='success'?'✅':'⚠️'}</span><span>${msg}</span>`;
  t.className = `toast ${type}`;
  void t.offsetWidth; t.classList.add('show');
  clearTimeout(t._tid); t._tid = setTimeout(()=>t.classList.remove('show'),3000);
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Cart.init();
  injectCartSidebar();
  Cart.updateBadge();
  document.querySelectorAll('#navCartBtn').forEach(b => b.addEventListener('click', openCart));
  initModal();
  initFilterBar();
  initSearch();
  document.getElementById('loadMoreBtn')?.addEventListener('click', () => { currentPage++; renderGames(false); });
  renderGames(true);
  initHamburger();
});
