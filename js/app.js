import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import { initAuthHeader } from './auth.js';
import {
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  runTransaction
} from 'firebase/firestore';

// CART utils (localStorage)
const CART_KEY = 'bazar_cart';
let shippingSettings = null; // { baseFee, extraPerBlock, blockGrams, fallbackFee }
let cloudSaveTimer = null;
let allProducts = [];
let currentFilters = { q: '', category: '' };

// Inject minimal CSS for cart animations once
let cartAnimStylesInjected = false;
function ensureCartAnimStyles() {
  if (cartAnimStylesInjected) return;
  const css = `
  @keyframes cart-bump { 0%{transform:scale(1)} 30%{transform:scale(1.15)} 100%{transform:scale(1)} }
  #cart-count.bump { animation: cart-bump 300ms ease; }
  .fly-img { position: fixed; z-index: 9999; width: 64px; height: 64px; object-fit: cover; pointer-events: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.2); transition: transform 800ms cubic-bezier(.2,.7,.2,1), opacity 800ms; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  cartAnimStylesInjected = true;
}

function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function writeCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
  // Also persist to cloud for logged-in users (debounced)
  if (auth.currentUser) {
    if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(async () => {
      try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { cart }, { merge: true });
      } catch (e) {
        console.warn('Cloud cart save failed', e);
      }
    }, 250);
  }
}

export function addToCart(item) {
  const cart = readCart();
  const existing = cart.find(p => p.id === item.id);
  if (existing) {
    // Do not increase count on repeated Add-to-Cart; keep one entry
    // Quantity should be adjusted from the Cart page only
    existing.qty = Math.max(1, existing.qty | 0);
  } else {
    cart.push({ ...item, qty: 1 });
  }
  writeCart(cart);
}

function bumpCartBadge() {
  const countEl = document.getElementById('cart-count');
  if (!countEl) return;
  countEl.classList.remove('bump');
  // force reflow to restart animation
  // eslint-disable-next-line no-unused-expressions
  countEl.offsetHeight;
  countEl.classList.add('bump');
}

function flyToCartFrom(imgEl) {
  // Prefer bottom nav cart badge on mobile
  const isSmall = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  const bottomBadge = document.getElementById('cart-count-bottom');
  const headerBadge = document.getElementById('cart-count');
  const cartEl = (isSmall && bottomBadge) ? bottomBadge : headerBadge;
  if (!imgEl || !cartEl) return;
  const rect = imgEl.getBoundingClientRect();
  const target = cartEl.getBoundingClientRect();
  const clone = document.createElement('img');
  clone.src = imgEl.src;
  clone.className = 'fly-img';
  clone.style.left = `${rect.left + window.scrollX}px`;
  clone.style.top = `${rect.top + window.scrollY}px`;
  document.body.appendChild(clone);
  const dx = target.left + target.width / 2 - (rect.left + rect.width / 2);
  const dy = target.top + target.height / 2 - (rect.top + rect.height / 2) + window.scrollY;
  requestAnimationFrame(() => {
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`;
    clone.style.opacity = '0.2';
  });
  setTimeout(() => { clone.remove(); }, 900);
}

export function removeFromCart(id) {
  let cart = readCart();
  cart = cart.filter(p => p.id !== id);
  writeCart(cart);
}

export function setQty(id, qty) {
  const cart = readCart();
  const item = cart.find(p => p.id === id);
  if (item) {
    item.qty = Math.max(1, qty | 0);
    writeCart(cart);
  }
}

export function updateCartBadge() {
  const countEl = document.getElementById('cart-count');
  if (!countEl) return;
  const cart = readCart();
  const totalQty = cart.reduce((sum, p) => sum + p.qty, 0);
  countEl.textContent = String(totalQty);
  // Sync bottom nav badge if present
  const bottom = document.getElementById('cart-count-bottom');
  if (bottom) bottom.textContent = String(totalQty);
}

// Render products on index.html
function drawProducts() {
  const grid = document.getElementById('products-grid');
  const empty = document.getElementById('empty-state');
  if (!grid) return;

  const list = allProducts
    .filter(p => (p.data.active === false ? false : true))
    .filter(p => {
      if (!currentFilters.category) return true;
      return (p.data.category || '').toLowerCase() === currentFilters.category.toLowerCase();
    })
    .filter(p => {
      const q = currentFilters.q.trim().toLowerCase();
      if (!q) return true;
      const hay = `${p.data.title} ${p.data.description || ''} ${p.data.category || ''}`.toLowerCase();
      return hay.includes(q);
    });

  const frag = document.createDocumentFragment();
  if (list.length === 0) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  grid.innerHTML = '';
  list.forEach(({ id, data: d }) => {
      if (d.active === false) return; // hide inactive
      const card = document.createElement('div');
      card.className = 'relative border border-gray-200 rounded-lg bg-white overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow';
      const stock = Number(d.stock || 0);
      const out = stock <= 0;
      const hasOptions = Array.isArray(d.options) && d.options.length > 0;
      const opts = hasOptions ? d.options : [];
      // Compute initial price display: base price or min–max from options
      let priceDisplayHtml = '';
      if (hasOptions) {
        const priceList = opts
          .map(o => Number(o.price ?? d.price))
          .filter(v => Number.isFinite(v));
        if (priceList.length > 0) {
          const minP = Math.min(...priceList);
          // Show only the lowest price initially for optioned products
          priceDisplayHtml = `৳${minP.toFixed(2)}`;
        } else {
          priceDisplayHtml = `৳${Number(d.price).toFixed(2)}`;
        }
      } else {
        priceDisplayHtml = `৳${Number(d.price).toFixed(2)}`;
      }
      card.innerHTML = `
        ${out ? '<span class="absolute top-2 left-2 text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white">Out of stock</span>' : ''}
        <a href="productfullview.html?id=${encodeURIComponent(id)}" class="block bg-white">
          <img src="${d.image}" alt="${d.title}" class="h-56 w-full object-contain">
        </a>
        <div class="p-2 pb-3 flex-1 flex flex-col">
          <h3 class="font-semibold text-[15px] mb-0.5 leading-snug line-clamp-2"><a href="productfullview.html?id=${encodeURIComponent(id)}" class="hover:text-blue-700">${d.title}</a></h3>
          <div class="flex items-center justify-between mt-1">
            <div class="price-view text-orange-600 font-bold text-sm">${priceDisplayHtml}</div>
            <span></span>
          </div>
          ${hasOptions ? `
          <div class="mt-2 grid gap-1" data-opt-inline>
            ${opts.map((o,i)=>`
              <button type="button" data-idx="${i}" class="opt-inline-pill text-xs border border-gray-200 rounded px-2 py-1 text-left hover:border-blue-400">
                <span>${o.label || o.weight || ''}</span>
                <span class="ml-2 text-[11px] text-gray-600">৳${Number(o.price ?? d.price).toFixed(2)}</span>
              </button>
            `).join('')}
          </div>
          ` : ''}
        </div>
        <button class="add-to-cart ${out ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white ${hasOptions ? 'px-3' : 'w-10'} h-10 rounded-full shadow-md flex items-center justify-center absolute bottom-2 right-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:scale-[0.98] transition" ${out ? 'disabled' : ''} aria-label="${hasOptions ? 'Select options' : 'Add to cart'}">
          ${hasOptions ? '<span class="btn-label text-xs font-medium">Select Options</span>' : '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"w-5 h-5\"><circle cx=\"9\" cy=\"21\" r=\"1\"/><circle cx=\"20\" cy=\"21\" r=\"1\"/><path d=\"M1 1h4l2.68 12.39a2 2 0 0 0 2 1.61h7.72a2 2 0 0 0 2-1.61L23 6H6\"/></svg>'}
        </button>
      `;
      if (!out) {
        const btn = card.querySelector('.add-to-cart');
        const imgEl = card.querySelector('img');
        const priceEl = card.querySelector('.price-view');
        // Inline options selection
        if (hasOptions){
          const pills = card.querySelectorAll('.opt-inline-pill');
          const labelSpan = btn.querySelector('.btn-label');
          let selectedOpt = null;
          function refreshPillStyles(){
            pills.forEach(p=>{
              const idx = Number(p.getAttribute('data-idx')||'-1');
              if (selectedOpt === idx){
                p.classList.remove('border-gray-200');
                p.classList.add('border-blue-600','bg-blue-50');
              } else {
                p.classList.remove('border-blue-600','bg-blue-50');
                p.classList.add('border-gray-200');
              }
            });
          }
          pills.forEach(p=>{
            p.addEventListener('click', ()=>{
              selectedOpt = Number(p.getAttribute('data-idx')||'0');
              btn.setAttribute('aria-label','Add to cart');
              if (labelSpan) labelSpan.textContent = 'Add To Cart';
              btn.classList.remove('px-3'); btn.classList.add('px-3');
              // Update the main price to the selected option's price
              try {
                const opt = opts[selectedOpt] || {};
                const selPrice = Number(opt.price ?? d.price);
                if (priceEl && Number.isFinite(selPrice)) priceEl.textContent = `৳${selPrice.toFixed(2)}`;
              } catch {}
              refreshPillStyles();
            });
          });
          btn.addEventListener('click', () => {
            if (selectedOpt === null){
              // Require selecting an option first
              btn.classList.add('ring-2','ring-blue-400');
              setTimeout(()=>btn.classList.remove('ring-2','ring-blue-400'), 600);
              return;
            }
            const opt = opts[selectedOpt] || {};
            addToCart({ id: `${id}__${opt.label||opt.weight||'opt'}`, title: d.title, price: Number((opt.price ?? d.price)), image: d.image, weight: opt.label || opt.weight || d.weight || '', qty: 1 });
            bumpCartBadge();
            flyToCartFrom(imgEl);
          });
          return; // skip default
        }
        btn.addEventListener('click', () => {
          addToCart({ id, title: d.title, price: Number(d.price), image: d.image, weight: d.weight || '' });
          bumpCartBadge();
          flyToCartFrom(imgEl);
        });
      }
      frag.appendChild(card);
    });
  grid.appendChild(frag);
}

async function loadProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  try {
    const qy = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(qy);
    allProducts = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    populateCategories();
    drawProducts();
  } catch (e) {
    const empty = document.getElementById('empty-state');
    console.error('Failed to load products', e);
    empty?.classList.remove('hidden');
    if (empty) empty.textContent = 'Failed to load products.';
  }
}

function populateCategories() {
  const select = document.getElementById('category-filter');
  if (!select) return;
  const cats = Array.from(new Set(allProducts.map(p => (p.data.category || '').trim()).filter(Boolean))).sort();
  select.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function setupFilters() {
  const search = document.getElementById('search-input');
  const cat = document.getElementById('category-filter');
  const btn = document.getElementById('search-btn');
  if (search) {
    search.addEventListener('input', () => {
      currentFilters.q = search.value || '';
      drawProducts();
    });
    // Pressing Enter will trigger Search button if present
    search.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btn) btn.click(); else drawProducts();
      }
    });
  }
  if (cat) {
    cat.addEventListener('change', () => {
      currentFilters.category = cat.value || '';
      drawProducts();
    });
  }
  if (btn) {
    btn.addEventListener('click', () => {
      const v = search ? (search.value || '') : '';
      currentFilters.q = v;
      drawProducts();
    });
  }
}

function hideHomeLinkOnHome() {
  // If current page is index (either / or /index.html), hide any nav link that points to home
  const path = window.location.pathname;
  const onHome = path === '/' || path.endsWith('/index.html');
  if (!onHome) return;
  const navLinks = document.querySelectorAll('header nav a');
  navLinks.forEach(a => {
    try {
      const url = new URL(a.getAttribute('href'), window.location.origin);
      const p = url.pathname;
      if (p === '/' || p.endsWith('/index.html')) {
        a.classList.add('hidden');
      }
    } catch {}
  });
}

// Render cart page
export async function renderCartPage() {
  initAuthHeader();
  updateCartBadge();

  const itemsEl = document.getElementById('cart-items');
  const emptyEl = document.getElementById('cart-empty');
  const summaryEl = document.getElementById('cart-summary');
  const totalEl = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('checkout-btn');
  const nameInput = document.getElementById('chk-name');
  const phoneInput = document.getElementById('chk-phone');
  const addressInput = document.getElementById('chk-address');
  const deliveryEl = document.getElementById('delivery-fee');
  const grandTotalEl = document.getElementById('grand-total');
  // Invoice modal elements
  const invModal = document.getElementById('inv-modal');
  const invBody = document.getElementById('inv-body');
  const invClose = document.getElementById('inv-close');
  const invConfirm = document.getElementById('inv-confirm');

  if (!itemsEl) return;

  function parseWeightToGrams(w) {
    if (!w) return 0;
    const s = String(w).trim().toLowerCase();
    const m = s.match(/([0-9]*\.?[0-9]+)\s*(kg|g|l|liter|ltr|ml)?/);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    const unit = m[2] || 'g';
    // Treat liter as kilogram equivalent for delivery: 1L == 1kg
    if (unit === 'kg' || unit === 'l' || unit === 'liter' || unit === 'ltr') {
      return Math.round(val * 1000);
    }
    return Math.round(val);
  }

  function calcDelivery(cart) {
    const cfg = shippingSettings || { fixedFee: 60, fixedUpToGrams: 1000, extraPerKg: 30, fallbackFee: 80 };
    const totalGrams = cart.reduce((sum, i) => sum + parseWeightToGrams(i.weight) * i.qty, 0);
    // Fixed fee always applies
    const fixedUpTo = Number(cfg.fixedUpToGrams || 0);
    const base = Number(cfg.fixedFee || 0);
    const extraPerKg = Number(cfg.extraPerKg || 0);
    if (totalGrams <= 0) return base;
    if (fixedUpTo > 0 && totalGrams <= fixedUpTo) return base;
    const overGrams = Math.max(0, totalGrams - fixedUpTo);
    const extraKgBlocks = Math.ceil(overGrams / 1000);
    return base + extraKgBlocks * extraPerKg;
  }

  async function loadProfile() {
    try {
      if (!auth.currentUser) return;
      const ref = doc(db, 'users', auth.currentUser.uid);
      const snap = await getDoc(ref);
      const p = snap.exists() ? snap.data() : {};
      if (nameInput && p.name) nameInput.value = p.name;
      if (phoneInput && p.phone) phoneInput.value = p.phone;
      if (addressInput && p.address) addressInput.value = p.address;
    } catch {}
  }

  async function loadShippingSettings() {
    try {
      const ref = doc(db, 'settings', 'shipping');
      const snap = await getDoc(ref);
      if (snap.exists()) shippingSettings = snap.data();
    } catch {}
  }

  function refresh() {
    const raw = localStorage.getItem(CART_KEY);
    console.debug('Cart raw localStorage', raw);
    const cart = readCart();
    console.debug('Parsed cart items', cart);
    itemsEl.innerHTML = '';
    if (cart.length === 0) {
      emptyEl.classList.remove('hidden');
      summaryEl.classList.add('hidden');
      totalEl.textContent = '৳0.00';
      if (deliveryEl) deliveryEl.textContent = '৳0.00';
      if (grandTotalEl) grandTotalEl.textContent = '৳0.00';
      return;
    }
    emptyEl.classList.add('hidden');
    summaryEl.classList.remove('hidden');

    let total = 0;
    cart.forEach(item => {
      const row = document.createElement('div');
      row.className = 'relative border rounded p-2';
      const itemTotal = item.price * item.qty;
      total += itemTotal;
      row.innerHTML = `
        <button class="remove w-9 h-9 flex items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 absolute top-2 right-2" aria-label="Remove item" title="Remove">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
        <div class="flex items-start gap-3 pr-12">
          <img src="${item.image}" alt="${item.title}" class="w-16 h-16 object-contain bg-white rounded">
          <div class="flex-1">
            <div class="font-medium leading-tight">${item.title}${item.weight ? ` · ${item.weight}` : ''}</div>
            <div class="text-sm text-gray-600">৳${item.price.toFixed(2)}</div>
            <div class="mt-2 flex items-center justify-end">
              <div class="inline-flex items-center rounded-full border border-gray-200 overflow-hidden shadow-sm">
                <button aria-label="Decrease quantity" class="qty-dec w-9 h-9 flex items-center justify-center bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-base">−</button>
                <span class="w-10 text-center text-sm select-none">${item.qty}</span>
                <button aria-label="Increase quantity" class="qty-inc w-9 h-9 flex items-center justify-center bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-base">+</button>
              </div>
            </div>
          </div>
        </div>
      `;
      const decBtn = row.querySelector('.qty-dec');
      const incBtn = row.querySelector('.qty-inc');
      decBtn.addEventListener('click', () => {
        const next = Math.max(1, (item.qty | 0) - 1);
        setQty(item.id, next);
        refresh();
      });
      incBtn.addEventListener('click', () => {
        const next = (item.qty | 0) + 1;
        setQty(item.id, next);
        refresh();
      });
      row.querySelector('.remove').addEventListener('click', () => {
        removeFromCart(item.id);
        refresh();
      });
      itemsEl.appendChild(row);
    });
    totalEl.textContent = `৳${total.toFixed(2)}`;
    const delivery = calcDelivery(cart);
    if (deliveryEl) deliveryEl.textContent = `৳${delivery.toFixed(2)}`;
    if (grandTotalEl) grandTotalEl.textContent = `৳${(total + delivery).toFixed(2)}`;
  }

  checkoutBtn?.addEventListener('click', async () => {
    const cart = readCart();
    if (cart.length === 0) return;
    const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    const delivery = calcDelivery(cart);
    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const address = addressInput ? addressInput.value.trim() : '';
    if (!name || !phone || !address) {
      // Simple inline validation styling
      [nameInput, phoneInput, addressInput].forEach(el => el && el.classList.add('ring-1','ring-red-400'));
      return;
    }
    [nameInput, phoneInput, addressInput].forEach(el => el && el.classList.remove('ring-1','ring-red-400'));

    // Build invoice preview HTML
    const rows = cart.map(i => `
      <tr>
        <td class="p-2 border">
          <div class="flex items-center gap-2"><img src="${i.image}" alt="${i.title}" class="w-10 h-10 object-contain bg-white rounded border"/><span>${i.title}${i.weight?` · ${i.weight}`:''}</span></div>
        </td>
        <td class="p-2 border text-right">${i.qty}</td>
        <td class="p-2 border text-right">৳${Number(i.price).toFixed(2)}</td>
        <td class="p-2 border text-right">৳${(i.qty*i.price).toFixed(2)}</td>
      </tr>`).join('');
    invBody.innerHTML = `
      <div class="text-sm text-gray-700">${name} · ${phone}<br/>${address}</div>
      <table class="w-full text-sm border">
        <thead class="bg-gray-50"><tr><th class="text-left p-2 border">Product</th><th class="text-right p-2 border">Qty</th><th class="text-right p-2 border">Price</th><th class="text-right p-2 border">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="text-right space-y-1">
        <div>Subtotal: <span class="font-semibold">৳${subtotal.toFixed(2)}</span></div>
        <div>Delivery: <span class="font-semibold">৳${delivery.toFixed(2)}</span></div>
        <div class="text-lg">Total: <span class="inline-block font-semibold bg-blue-600 text-white px-3 py-1 rounded-full">৳${(subtotal+delivery).toFixed(2)}</span></div>
      </div>
    `;
    // Show modal
    invModal?.classList.remove('hidden');
    invModal?.classList.add('flex');

    // Wire confirm once per open
    const onConfirm = async () => {
      try {
        // Save/merge profile
        if (auth.currentUser) {
          await setDoc(doc(db, 'users', auth.currentUser.uid), { name, phone, address }, { merge: true });
        }
        // Place order atomically: validate and decrement stock, then create order
        const ordersCol = collection(db, 'orders');
        const newOrderRef = doc(ordersCol);
        const newOrderId = newOrderRef.id;
        await runTransaction(db, async (tx) => {
          // 1) Read all product docs first (no writes yet)
          const writePlan = [];
          for (const it of cart) {
            const prodRef = doc(db, 'products', it.id);
            const snap = await tx.get(prodRef);
            if (!snap.exists()) throw new Error(`Product not found: ${it.title || it.id}`);
            const data = snap.data() || {};
            const currentStock = Number(data.stock || 0);
            const need = Number(it.qty || 0);
            if (!Number.isFinite(need) || need <= 0) throw new Error('Invalid quantity');
            if (currentStock < need) throw new Error(`Insufficient stock for ${data.title || it.title || 'item'}`);
            writePlan.push({ ref: prodRef, newStock: currentStock - need });
          }
          // 2) Perform all writes after all reads
          writePlan.forEach(({ ref, newStock }) => {
            tx.update(ref, { stock: newStock });
          });
          // 3) Create order document
          tx.set(newOrderRef, {
            items: cart,
            subtotal,
            delivery,
            total: subtotal + delivery,
            currency: 'BDT',
            userId: auth.currentUser ? auth.currentUser.uid : null,
            customer: { name, phone, address },
            status: 'Pending',
            createdAt: serverTimestamp()
          });
        });
        localStorage.removeItem(CART_KEY);
        updateCartBadge();
        invModal.classList.add('hidden'); invModal.classList.remove('flex');
        // Redirect to orders with success flag
        window.location.href = `orders.html?placed=${encodeURIComponent(newOrderId)}`;
      } catch (e) {
        alert('Failed to place order: ' + e.message);
      } finally {
        invConfirm?.removeEventListener('click', onConfirm);
      }
    };
    invConfirm?.addEventListener('click', onConfirm);
  });

  invClose?.addEventListener('click', () => {
    invModal?.classList.add('hidden');
    invModal?.classList.remove('flex');
  });

  await loadShippingSettings();
  refresh();
  loadProfile();
}

// Initialize header + home
(function init() {
  initAuthHeader();
  updateCartBadge();
  ensureCartAnimStyles();
  setupFilters();
  hideHomeLinkOnHome();
  loadProducts();
})();

// ===== Options Modal (weight/size variants) =====
function openOptionsModal({ id, data, imgEl }){
  let host = document.getElementById('opt-modal');
  if (!host) return;
  const body = host.querySelector('#opt-body');
  const addBtn = host.querySelector('#opt-add');
  const closeBtn = host.querySelector('#opt-close');
  const minusBtn = host.querySelector('#opt-minus');
  const plusBtn = host.querySelector('#opt-plus');
  const qtyView = host.querySelector('#opt-qty-view');
  const options = Array.isArray(data.options) ? data.options : [];

  // Build pill list (buttons)
  const optsHtml = options.map((o,i)=>`
    <button data-idx="${i}" class="opt-pill inline-flex items-center justify-between w-full border rounded px-3 py-2 text-sm">
      <span>${o.label || o.weight || ''}</span>
      <span class="font-semibold">৳${Number(o.price ?? data.price).toFixed(2)}</span>
    </button>
  `).join('');

  body.innerHTML = `
    <div class="flex items-center gap-3">
      <img src="${data.image}" alt="${data.title}" class="w-16 h-16 object-contain bg-white border rounded"/>
      <div>
        <div class="font-medium">${data.title}</div>
        <div class="text-xs text-gray-600">Choose an option</div>
      </div>
    </div>
    <div class="mt-3 grid gap-2">${optsHtml}</div>
  `;

  // Local state
  let selectedIdx = 0;
  let qty = 1;
  if (qtyView) qtyView.textContent = String(qty);

  // Style helpers
  function refreshPills(){
    body.querySelectorAll('.opt-pill').forEach((el, i)=>{
      if (i === selectedIdx){
        el.classList.remove('border-gray-200');
        el.classList.add('bg-green-600','text-white','border-green-600');
      } else {
        el.classList.remove('bg-green-600','text-white','border-green-600');
        el.classList.add('border-gray-200');
      }
    });
  }
  refreshPills();
  body.querySelectorAll('.opt-pill').forEach(btn=>{
    btn.addEventListener('click', ()=>{ selectedIdx = Number(btn.getAttribute('data-idx')||'0'); refreshPills(); });
  });

  minusBtn && minusBtn.addEventListener('click', ()=>{ qty = Math.max(1, qty-1); if (qtyView) qtyView.textContent = String(qty); });
  plusBtn && plusBtn.addEventListener('click', ()=>{ qty = Math.max(1, qty+1); if (qtyView) qtyView.textContent = String(qty); });

  const cleanup = ()=>{
    addBtn.onclick=null; closeBtn.onclick=null;
    minusBtn && (minusBtn.onclick=null); plusBtn && (plusBtn.onclick=null);
    host.classList.add('hidden'); host.classList.remove('flex');
  };
  closeBtn.onclick = cleanup;
  addBtn.onclick = ()=>{
    const idx = Number.isFinite(selectedIdx) ? selectedIdx : 0;
    const opt = options[idx] || {};
    addToCart({ id: `${id}__${opt.label||opt.weight||'opt'}`, title: data.title, price: Number((opt.price ?? data.price)), image: data.image, weight: opt.label || opt.weight || data.weight || '', qty });
    bumpCartBadge();
    flyToCartFrom(imgEl);
    cleanup();
  };
  host.classList.remove('hidden');
  host.classList.add('flex');
}
