/* ============================================================
   GamifyDeals.com – Script v3
   Dynamic game rendering · Cart · QR · Pagination
   UPI: ayantikmallick@fam
   ============================================================ */

const UPI_ID   = 'ayantikmallick@fam';
const UPI_NAME = 'GamifyDeals';
const QR_API   = 'https://api.qrserver.com/v1/create-qr-code/';
const PAGE_SIZE = 40; // games per "load more"

let currentPage   = 1;
let activeFilter  = 'all';
let activeSearch  = '';

// ── CART SYSTEM ───────────────────────────────────────────────
const Cart = {
  items: [],
  init() {
    try { this.items = JSON.parse(localStorage.getItem('gd_cart') || '[]'); }
    catch(e) { this.items = []; }
  },
  add(game) {
    if (this.items.find(i => i.id === game.id)) {
      showToast(`"${game.name}" already in cart!`, 'error'); return false;
    }
    this.items.push(game);
    this.save(); this.updateBadge();
    showToast('🛒 Added to cart!', 'success');
    return true;
  },
  remove(id) {
    this.items = this.items.filter(i => i.id !== id);
    this.save(); this.updateBadge(); renderCartItems();
  },
  clear() { this.items = []; this.save(); this.updateBadge(); renderCartItems(); },
  total()  { return this.items.reduce((s,i) => s + i.price, 0); },
  count()  { return this.items.length; },
  save()   { localStorage.setItem('gd_cart', JSON.stringify(this.items)); },
  inCart(id){ return !!this.items.find(i => i.id === id); },
  updateBadge() {
    const b = document.getElementById('cartBadge');
    if (!b) return;
    b.textContent = this.count();
    b.style.display = this.count() > 0 ? 'flex' : 'none';
  }
};

// ── GAME CARD RENDERER ────────────────────────────────────────
function imgUrl(id) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
}
function fallbackUrl(id) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
}

function createCardHTML(g) {
  const inCart = Cart.inCart(g.id);
  const badgeHTML = g.badge
    ? `<span class="game-badge ${g.badge}">${g.badge === 'hot' ? '🔥 Hot' : g.badge === 'new' ? '✨ New' : '⭐ Bestseller'}</span>`
    : '';
  const disc = Math.round((1 - g.price / g.orig) * 100);

  return `
  <div class="game-card"
    data-game-id="${g.id}"
    data-game-name="${escHtml(g.name)}"
    data-game-price="₹${g.price}"
    data-genre="${g.genre}"
    data-emoji="${g.emoji}"
  >
    <img class="game-cover"
      src="${imgUrl(g.id)}"
      alt="${escHtml(g.name)}"
      loading="lazy"
      onerror="this.onerror=null;this.src='${fallbackUrl(g.id)}';"
    />
    ${badgeHTML}
    <div class="game-info">
      <div class="game-title" title="${escHtml(g.name)}">${escHtml(g.name)}</div>
      <div class="game-genre">${g.genre} · ${g.sub}</div>
      <div class="game-price-row">
        <div class="price-block">
          <span class="original-price">₹${g.orig}</span>
          <span class="sale-price">₹${g.price} <span>/ acc</span></span>
        </div>
        <span class="discount-tag">-${disc}%</span>
      </div>
      <div class="card-btns">
        <a href="#" class="btn-buy">Buy Now</a>
        <button class="btn-cart ${inCart ? 'in-cart' : ''}" title="${inCart ? 'In cart' : 'Add to cart'}">${inCart ? '✓' : '🛒'}</button>
      </div>
    </div>
  </div>`;
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

// ── FILTERED GAMES ────────────────────────────────────────────
function getFilteredGames() {
  if (typeof GAMES_DATA === 'undefined') return [];
  return GAMES_DATA.filter(g => {
    const matchFilter = activeFilter === 'all' || g.genre === activeFilter;
    const matchSearch = !activeSearch || g.name.toLowerCase().includes(activeSearch);
    return matchFilter && matchSearch;
  });
}

// ── RENDER GAMES GRID ─────────────────────────────────────────
function renderGames(reset = false) {
  const grid    = document.getElementById('gamesGrid');
  const countEl = document.getElementById('gamesCountLabel');
  const moreBtn = document.getElementById('loadMoreBtn');
  if (!grid) return;

  const filtered = getFilteredGames();
  const total    = filtered.length;
  const showing  = Math.min(currentPage * PAGE_SIZE, total);
  const slice    = filtered.slice(0, showing);

  if (reset) {
    grid.innerHTML = slice.map(createCardHTML).join('');
  } else {
    const prev = (currentPage - 1) * PAGE_SIZE;
    const newCards = filtered.slice(prev, showing).map(createCardHTML).join('');
    grid.insertAdjacentHTML('beforeend', newCards);
  }

  // Re-attach listeners
  attachCardListeners();

  if (countEl) countEl.textContent = `Showing ${showing} of ${total} games`;
  if (moreBtn) moreBtn.style.display = showing < total ? 'inline-block' : 'none';
}

function loadMore() {
  currentPage++;
  renderGames(false);
}

// ── CARD LISTENERS ────────────────────────────────────────────
function attachCardListeners() {
  document.querySelectorAll('.game-card').forEach(card => {
    // Buy Now
    const buyBtn = card.querySelector('.btn-buy');
    if (buyBtn && !buyBtn._hasListener) {
      buyBtn._hasListener = true;
      buyBtn.addEventListener('click', e => {
        e.preventDefault();
        const name   = card.dataset.gameName;
        const price  = card.dataset.gamePrice;
        const genre  = card.dataset.genre;
        const img    = card.querySelector('img.game-cover');
        openBuyModal({ name, price, genre, imgSrc: img ? img.src : '' });
      });
    }

    // Add to Cart
    const cartBtn = card.querySelector('.btn-cart');
    if (cartBtn && !cartBtn._hasListener) {
      cartBtn._hasListener = true;
      cartBtn.addEventListener('click', e => {
        e.stopPropagation();
        const id    = parseInt(card.dataset.gameId);
        const name  = card.dataset.gameName;
        const price = parseFloat(String(card.dataset.gamePrice).replace('₹',''));
        const genre = card.dataset.genre;
        const emoji = card.dataset.emoji;
        const img   = card.querySelector('img.game-cover');
        const added = Cart.add({ id, name, price, genre, emoji, imgSrc: img ? img.src : '' });
        if (added) {
          cartBtn.textContent = '✓';
          cartBtn.classList.add('in-cart');
          cartBtn.title = 'In cart';
        }
        renderCartItems();
      });
    }
  });
}

// ── FILTER & SEARCH ───────────────────────────────────────────
function initFilterBar() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      currentPage  = 1;
      renderGames(true);
    });
  });
}

function initSearchBar() {
  const input = document.getElementById('searchInput');
  const mobileInput = document.getElementById('mobileSearchInput');
  const handler = (e) => {
    activeSearch = e.target.value.toLowerCase().trim();
    // sync both inputs
    if (input) input.value = e.target.value;
    if (mobileInput) mobileInput.value = e.target.value;
    activeFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === 'all');
    });
    currentPage = 1;
    renderGames(true);
  };
  if (input) input.addEventListener('input', handler);
  if (mobileInput) mobileInput.addEventListener('input', handler);
}

// ── BUY MODAL ─────────────────────────────────────────────────
function openBuyModal({ name, price, genre, imgSrc }) {
  const modal = document.getElementById('buyModal');
  if (!modal) return;
  document.getElementById('modalGameImg').src = imgSrc || '';
  document.getElementById('modalGameName').textContent  = name;
  document.getElementById('modalGamePrice').textContent = price;
  document.getElementById('modalGenre').textContent     = genre;
  document.getElementById('proceedToPayment').href =
    `payment.html?game=${encodeURIComponent(name)}&price=${encodeURIComponent(price)}`;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('buyModal')?.classList.remove('open');
  document.body.style.overflow = '';
}

function openFeaturedModal(name, price, genre, imgSrc) {
  openBuyModal({ name, price, genre, imgSrc });
}

function initModal() {
  const overlay = document.getElementById('buyModal');
  if (!overlay) return;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.getElementById('closeModal')?.addEventListener('click',  closeModal);
  document.getElementById('cancelModal')?.addEventListener('click', closeModal);
}

// ── CART SIDEBAR ──────────────────────────────────────────────
function injectCartSidebar() {
  if (document.getElementById('cartOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="cart-overlay" id="cartOverlay">
    <div class="cart-panel" id="cartPanel">
      <div class="cart-header">
        <div>
          <h3>🛒 Cart</h3>
          <div class="cart-count-label" id="cartCountLabel">0 items</div>
        </div>
        <button class="close-cart-btn" id="closeCartBtn">✕</button>
      </div>
      <div id="cartBody" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;"></div>
      <div class="cart-footer" id="cartFooter" style="display:none;">
        <div class="cart-summary">
          <div class="cart-summary-row"><span>Subtotal</span><span id="cartSubtotal">₹0</span></div>
          <div class="cart-summary-row"><span>Delivery</span><span style="color:var(--green)">FREE</span></div>
          <div class="cart-summary-row total"><span>Total</span><span class="price" id="cartTotalDisplay">₹0</span></div>
        </div>
        <a href="#" class="cart-checkout-btn" id="cartCheckoutBtn">Pay Now →</a>
        <button class="cart-clear-btn" id="cartClearBtn">🗑 Clear Cart</button>
        <div class="cart-warranty-note"><span>🛡️</span> Lifetime warranty · Instant delivery</div>
      </div>
    </div>
  </div>`);

  document.getElementById('closeCartBtn').addEventListener('click', closeCart);
  document.getElementById('cartOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('cartOverlay')) closeCart();
  });
  document.getElementById('cartClearBtn').addEventListener('click', () => {
    if (confirm('Clear all items?')) Cart.clear();
  });
  renderCartItems();
}

function openCart()  {
  injectCartSidebar(); renderCartItems();
  document.getElementById('cartOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCart() {
  document.getElementById('cartOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

function renderCartItems() {
  const body   = document.getElementById('cartBody');
  const footer = document.getElementById('cartFooter');
  const label  = document.getElementById('cartCountLabel');
  if (!body) return;
  if (label) label.textContent = `${Cart.count()} item${Cart.count() !== 1 ? 's' : ''}`;

  if (Cart.count() === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <div class="empty-icon">🛒</div>
        <p>Your cart is empty</p>
        <a href="index.html#games">Browse games →</a>
      </div>`;
    if (footer) footer.style.display = 'none';
    return;
  }

  body.innerHTML = `<div class="cart-items-list">${Cart.items.map(item => `
    <div class="cart-item">
      ${item.imgSrc
        ? `<img class="cart-item-img" src="${item.imgSrc}" alt="${escHtml(item.name)}"
             onerror="this.outerHTML='<div class=\\'cart-item-img\\' style=\\'font-size:22px;display:flex;align-items:center;justify-content:center;\\'>${item.emoji}</div>'">`
        : `<div class="cart-item-img" style="font-size:22px;display:flex;align-items:center;justify-content:center;">${item.emoji}</div>`}
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(item.name)}</div>
        <div class="cart-item-genre">${item.genre}</div>
        <div class="cart-item-price">₹${item.price}</div>
      </div>
      <button class="cart-item-remove" onclick="Cart.remove(${item.id})">✕</button>
    </div>`).join('')}</div>`;

  if (footer) {
    footer.style.display = 'block';
    const total = Cart.total();
    document.getElementById('cartSubtotal').textContent   = `₹${total}`;
    document.getElementById('cartTotalDisplay').textContent = `₹${total}`;
    const btn = document.getElementById('cartCheckoutBtn');
    if (btn) {
      const names = Cart.items.map(i => i.name).join(',');
      btn.href = `payment.html?total=${total}&games=${encodeURIComponent(names)}&source=cart`;
    }
  }
}

function initCartButton() {
  document.querySelectorAll('#navCartBtn').forEach(btn => {
    btn.addEventListener('click', openCart);
  });
  Cart.updateBadge();
}

// ── QR CODE ───────────────────────────────────────────────────
function generateUPIQR(amount, note) {
  const uri = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME)}&am=${Number(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note || 'GamifyDeals')}`;
  return `${QR_API}?data=${encodeURIComponent(uri)}&size=200x200&margin=12&format=png`;
}

function renderPaymentQR(amount, gameName) {
  const qrEl    = document.getElementById('dynamicQR');
  const badgeEl = document.getElementById('qrAmountBadge');
  const loadEl  = document.getElementById('qrLoadingText');
  if (!qrEl) return;
  if (!amount || amount <= 0) { if (loadEl) loadEl.textContent = 'Select a game to generate QR'; return; }

  if (badgeEl) { badgeEl.textContent = `₹${Math.round(amount)}`; badgeEl.style.display = 'inline-block'; }
  if (loadEl)  loadEl.textContent = 'Generating QR…';
  qrEl.style.opacity = '0';
  qrEl.src = generateUPIQR(amount, gameName ? `GamifyDeals-${gameName.substring(0,25)}` : 'GamifyDeals');
  qrEl.onload  = () => { qrEl.style.cssText += ';opacity:1;transition:opacity .3s;'; if (loadEl) loadEl.textContent = ''; };
  qrEl.onerror = () => { if (loadEl) loadEl.textContent = '⚠️ QR failed. Use UPI ID below.'; };
}

// ── PAYMENT PAGE ──────────────────────────────────────────────
function initPaymentPage() {
  const p   = new URLSearchParams(window.location.search);
  const src = p.get('source');
  let amount = 0, label = 'Your Order';

  if (src === 'cart') {
    amount = parseFloat(p.get('total') || '0');
    const games = p.get('games') || '';
    const parts = games.split(',');
    label  = parts[0] + (parts.length > 1 ? ` +${parts.length-1} more` : '');

    // Populate from cart
    const listEl = document.getElementById('orderItemsList');
    if (listEl && Cart.count() > 0) {
      listEl.innerHTML = Cart.items.map(i => `
        <div class="order-item">
          <div class="order-item-img" style="display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--bg-secondary);">${i.emoji}</div>
          <div>
            <div class="order-item-name">${escHtml(i.name)}</div>
            <div class="order-item-detail">Shared Steam · Offline Mode</div>
          </div>
          <div class="order-item-price">₹${i.price}</div>
        </div>`).join('');
    }
  } else {
    const raw = p.get('price') || '₹0';
    amount = parseFloat(raw.replace('₹','').trim()) || 0;
    label  = p.get('game') || 'Selected Game';
    const nameEl = document.getElementById('orderGameName');
    if (nameEl) nameEl.textContent = label;
  }

  document.querySelectorAll('.order-game-price, #orderTotalAmt').forEach(el => {
    el.textContent = `₹${amount}`;
  });

  renderPaymentQR(amount, label);
}

// ── PAYMENT TABS ──────────────────────────────────────────────
function initPaymentTabs() {
  const tabs   = document.querySelectorAll('.payment-tab');
  const panels = document.querySelectorAll('.payment-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`)?.classList.add('active');
    });
  });
  if (tabs[0]) tabs[0].click();
}

// ── UPI & CRYPTO BUTTONS ──────────────────────────────────────
function initUPIButtons() {
  document.querySelectorAll('.upi-app-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.upi-app-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function initCryptoOptions() {
  const wallets = {
    btc:  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    usdt: 'TG9nDGFHPbJhPpGkV9HAbFMkqPKGp3ZGeQ',
    eth:  '0x742d35Cc6634C0532925a3b8D4C9C2b3f7Ca3e1A',
    ltc:  'LfVzSvVGsqoMVpfvNf7D2tqhJwdL1TY6vK',
    bnb:  'bnb1grpf0955h0ykzq3ar5nmum7y6gdfl6lxfn46h2',
    sol:  '4X5p1GvUJJDTJJZGsGAFZgGDpT5qNp7XtHt3Kk8vBkS'
  };
  document.querySelectorAll('.crypto-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.crypto-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const el = document.getElementById('cryptoWalletAddress');
      if (el) el.textContent = wallets[btn.dataset.coin] || 'N/A';
    });
  });
  document.querySelector('.crypto-btn')?.click();
}

// ── COPY BUTTONS ──────────────────────────────────────────────
function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.copy;
      const text = id ? (document.getElementById(id)?.textContent.trim() || '') : (btn.dataset.text || '');
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent; btn.textContent = '✓ Copied!';
        setTimeout(() => btn.textContent = orig, 2000);
        showToast('Copied!', 'success');
      }).catch(() => showToast('Copy failed – copy manually', 'error'));
    });
  });
}

// ── PAYMENT SUBMIT ────────────────────────────────────────────
function initPaymentForm() {
  document.getElementById('paymentForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('buyerEmail')?.value.trim();
    const txn   = document.querySelector('[name="txnId"], #txnInput')?.value.trim() || '';
    const tab   = document.querySelector('.payment-tab.active')?.dataset.tab;
    if (!email) { showToast('Enter your email', 'error'); return; }
    if (['upi','paypal','crypto','bank'].includes(tab) && !txn) {
      showToast('Enter Transaction ID', 'error'); return;
    }
    const p    = new URLSearchParams(window.location.search);
    const game = p.get('game') || p.get('games') || 'Order';
    const msg  = encodeURIComponent(`Hi GamifyDeals! 🎮\n\nPayment done!\nGame: ${game}\nTransaction ID: ${txn || 'Card/Razorpay'}\nEmail: ${email}\n\nPlease send Steam credentials!`);
    document.getElementById('paymentFormPanel').style.display = 'none';
    const ss = document.getElementById('successScreen');
    if (ss) {
      ss.classList.add('show');
      const wp = document.getElementById('whatsappLink');
      if (wp) wp.href = `https://wa.me/917908719976?text=${msg}`;
    }
    Cart.clear();
  });
}

// ── CONTACT FORM ──────────────────────────────────────────────
function initContactForm() {
  document.getElementById('contactForm')?.addEventListener('submit', e => {
    e.preventDefault();
    showToast("Message sent! We'll reply within 24 hours ✅", 'success');
    e.target.reset();
  });
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.innerHTML = `<span>${type === 'success' ? '✅' : '⚠️'}</span><span>${msg}</span>`;
  t.className = `toast ${type}`;
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── HIGHLIGHT NAV ─────────────────────────────────────────────
function highlightNav() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href')?.split('#')[0] === path);
  });
}

// ── HAMBURGER ─────────────────────────────────────────────────
function initHamburger() {
  const btn = document.getElementById('hamburger');
  const nav = document.querySelector('.nav-links');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    nav.classList.toggle('mobile-open');
  });
  // close on link click
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => nav.classList.remove('mobile-open'));
  });
}

// ── LOAD MORE BUTTON ──────────────────────────────────────────
function initLoadMore() {
  document.getElementById('loadMoreBtn')?.addEventListener('click', loadMore);
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Cart.init();
  injectCartSidebar();
  initCartButton();
  initModal();
  initFilterBar();
  initSearchBar();
  initLoadMore();
  renderGames(true);   // dynamic rendering from GAMES_DATA
  initPaymentTabs();
  initPaymentPage();
  initUPIButtons();
  initCryptoOptions();
  initCopyButtons();
  initPaymentForm();
  initContactForm();
  highlightNav();
  initHamburger();
});
