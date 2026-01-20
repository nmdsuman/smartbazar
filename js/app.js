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
      card.className = 'relative border rounded-lg bg-white overflow-hidden flex flex-col shadow-sm';
      const stock = Number(d.stock || 0);
      const out = stock <= 0;
      card.innerHTML = `
        ${out ? '<span class="absolute top-2 left-2 text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white">Out of stock</span>' : ''}
        <a href="productfullview.html?id=${encodeURIComponent(id)}" class="block">
          <img src="${d.image}" alt="${d.title}" class="h-44 w-full object-contain bg-white">
        </a>
        <div class="p-3 flex-1 flex flex-col">
          <h3 class="font-semibold text-base mb-1 line-clamp-1"><a href="productfullview.html?id=${encodeURIComponent(id)}" class="hover:text-blue-700">${d.title}</a></h3>
          <p class="text-sm text-gray-600 line-clamp-2 mb-2">${d.description || ''}</p>
          <div class="mt-auto flex items-center justify-between gap-2">
            <span class="text-blue-700 font-semibold text-sm">৳${Number(d.price).toFixed(2)}${d.weight ? ` · ${d.weight}` : ''}</span>
            <button class="add-to-cart ${out ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white px-3 py-1.5 rounded text-sm" ${out ? 'disabled' : ''}>${out ? 'Unavailable' : 'Add to Cart'}</button>
          </div>
        </div>
      `;
      if (!out) {
        const btn = card.querySelector('.add-to-cart');
        const imgEl = card.querySelector('img');
        btn.addEventListener('click', () => {
          addToCart({
            id: id,
            title: d.title,
            price: Number(d.price),
            image: d.image,
            weight: d.weight || ''
          });
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
    const m = s.match(/([0-9]*\.?[0-9]+)\s*(kg|g|l|liter|ltr)?/);
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
      row.className = 'flex items-center justify-between border rounded p-3';
      const itemTotal = item.price * item.qty;
      total += itemTotal;
      row.innerHTML = `
        <div class="flex items-center gap-3">
          <img src="${item.image}" alt="${item.title}" class="w-16 h-16 object-contain bg-white rounded">
          <div>
            <div class="font-medium">${item.title}${item.weight ? ` · ${item.weight}` : ''}</div>
            <div class="text-sm text-gray-600">৳${item.price.toFixed(2)}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1">
            <button class="qty-dec w-7 h-7 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-sm">−</button>
            <span class="min-w-[2rem] text-center text-sm">${item.qty}</span>
            <button class="qty-inc w-7 h-7 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-sm">+</button>
          </div>
          <button class="remove w-9 h-9 flex items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700" aria-label="Remove item" title="Remove">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
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
