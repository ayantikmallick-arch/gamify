/* public/script.js – GamifyDeals Storefront v4 (Razorpay Checkout) */

const PAGE_SIZE = 40;
let currentPage  = 1;
let activeFilter = 'all';
let activeSearch = '';

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
function escH(s) { return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }

function createCardHTML(g) {
  const disc = g.orig ? Math.round((1 - g.price/g.orig)*100) : 0;
  const badgeHTML = g.badge ? `<span class="game-badge ${g.badge}">${{hot:'🔥 Hot',new:'✨ New',bestseller:'⭐ Best'}[g.badge]||g.badge}</span>` : '';
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
        <a href="#" class="btn-buy">Buy Now</a>
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

// ── BUY MODAL (collect email → Razorpay) ─────────────────────
function openBuyModal({ name, price, genre, img }) {
  const m = document.getElementById('buyModal');
  if (!m) return;
  document.getElementById('modalGameImg').src           = img;
  document.getElementById('modalGameName').textContent  = name;
  document.getElementById('modalGamePrice').textContent = `₹${price}`;
  document.getElementById('modalGenre').textContent     = genre;

  // Store for checkout
  m.dataset.name  = name;
  m.dataset.price = price;
  m.dataset.genre = genre;
  m.dataset.img   = img;

  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('buyModal')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── RAZORPAY CHECKOUT ─────────────────────────────────────────
async function startCheckout({ name, price, email, whatsapp }) {
  try {
    const res  = await fetch('/api/orders/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer_email:    email,
        buyer_whatsapp: whatsapp || null,
        amount:         price,
        game_id:        null, // single game checkout; if you know game_id pass it
        cart_items:     Cart.count() ? Cart.items : null
      })
    });
    const order = await res.json();
    if (!res.ok) { showToast(order.error || 'Could not create order', 'error'); return; }

    const options = {
      key:          order.key_id,
      amount:       order.amount,
      currency:     order.currency || 'INR',
      order_id:     order.rzp_order_id,
      name:         'GamifyDeals',
      description:  `Purchase: ${name}`,
      image:        '/logo.png',
      prefill:      { email, contact: whatsapp || '' },
      theme:        { color: '#e63946' },
      handler:      async function(response) {
        await verifyPayment({ ...response, order_id: order.order_id });
      },
      modal: {
        ondismiss: () => showToast('Payment cancelled', 'error')
      }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function(r) {
      showToast('Payment failed: ' + (r.error?.description || 'Unknown error'), 'error');
    });
    rzp.open();
  } catch (err) {
    console.error('Checkout error:', err);
    showToast('Could not open payment. Please try again.', 'error');
  }
}

async function verifyPayment({ razorpay_payment_id, razorpay_order_id, razorpay_signature, order_id }) {
  showToast('Verifying payment…');
  try {
    const res  = await fetch('/api/orders/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ razorpay_payment_id, razorpay_order_id, razorpay_signature, order_id })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      showToast(data.error || 'Payment verification failed. Contact support.', 'error');
      return;
    }

    Cart.clear();
    closeModal();

    // Redirect to My Order page
    window.location.href = data.redirect_url || `/my-order.html?order_id=${data.order_id}&token=${data.view_token}`;
  } catch (err) {
    showToast('Verification error. Contact WhatsApp support with your payment ID.', 'error');
  }
}

// ── CART SIDEBAR ──────────────────────────────────────────────
function injectCartSidebar() {
  if (document.getElementById('cartOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div class="cart-overlay" id="cartOverlay">
    <div class="cart-panel">
      <div class="cart-header">
        <div><h3>🛒 Cart</h3><div class="cart-count-label" id="cartCountLabel">0 items</div></div>
        <button class="close-cart-btn" id="closeCartBtn">✕</button>
      </div>
      <div id="cartBody" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;"></div>
      <div class="cart-footer" id="cartFooter" style="display:none">
        <div class="cart-summary">
          <div class="cart-summary-row"><span>Subtotal</span><span id="cartSubtotal">₹0</span></div>
          <div class="cart-summary-row"><span>Delivery</span><span style="color:var(--green)">FREE</span></div>
          <div class="cart-summary-row total"><span>Total</span><span class="price" id="cartTotalDisplay">₹0</span></div>
        </div>
        <button class="cart-checkout-btn" id="cartCheckoutBtn">Pay Now →</button>
        <button class="cart-clear-btn" id="cartClearBtn">🗑 Clear Cart</button>
        <div class="cart-warranty-note"><span>🛡️</span> Lifetime warranty · Instant delivery</div>
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
    body.innerHTML = `<div class="cart-empty"><div class="empty-icon">🛒</div><p>Cart is empty</p><a href="#games">Browse games →</a></div>`;
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
  document.getElementById('modalGenre').textContent     = 'Multiple games';
  m.dataset.name  = Cart.items.map(i=>i.name).join(', ');
  m.dataset.price = Cart.total();
  m.dataset.isCart = '1';
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ── FILTERS / SEARCH ─────────────────────────────────────────
function initFilterBar() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); activeFilter = btn.dataset.filter; currentPage = 1; renderGames(true);
    });
  });
}
function initSearch() {
  const handler = e => {
    activeSearch = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#searchInput,#mobileSearchInput').forEach(i=>i.value=e.target.value);
    activeFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter==='all'));
    currentPage = 1; renderGames(true);
  };
  document.getElementById('searchInput')?.addEventListener('input', handler);
  document.getElementById('mobileSearchInput')?.addEventListener('input', handler);
}

// ── MODAL FORM SUBMIT ─────────────────────────────────────────
function initModal() {
  const m = document.getElementById('buyModal');
  if (!m) return;
  m.addEventListener('click', e => { if (e.target===m) closeModal(); });
  document.getElementById('closeModal')?.addEventListener('click',  closeModal);
  document.getElementById('cancelModal')?.addEventListener('click', closeModal);

  document.getElementById('proceedBtn')?.addEventListener('click', () => {
    const email    = document.getElementById('buyerEmail')?.value.trim();
    const whatsapp = document.getElementById('buyerWhatsapp')?.value.trim();
    if (!email || !email.includes('@')) { showToast('Enter a valid email', 'error'); return; }
    const price = parseFloat(m.dataset.price);
    const name  = m.dataset.name;
    closeModal();
    startCheckout({ name, price, email, whatsapp });
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
function openFeaturedModal(name, price, genre, img) { openBuyModal({name, price: parseFloat(price.replace('₹','')), genre, img}); }

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
