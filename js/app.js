import { auth, db } from './firebase-config.js';
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
  setDoc
} from 'firebase/firestore';

// CART utils (localStorage)
const CART_KEY = 'bazar_cart';

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
}

export function addToCart(item) {
  const cart = readCart();
  const existing = cart.find(p => p.id === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...item, qty: 1 });
  }
  writeCart(cart);
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
}

// Render products on index.html
async function renderProducts() {
  const grid = document.getElementById('products-grid');
  const empty = document.getElementById('empty-state');
  if (!grid) return;

  try {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    if (snap.empty) {
      empty?.classList.remove('hidden');
      return;
    }
    const frag = document.createDocumentFragment();
    snap.forEach(doc => {
      const d = doc.data();
      const card = document.createElement('div');
      card.className = 'border rounded-lg bg-white overflow-hidden flex flex-col';
      card.innerHTML = `
        <img src="${d.image}" alt="${d.title}" class="h-48 w-full object-cover">
        <div class="p-4 flex-1 flex flex-col">
          <h3 class="font-semibold text-lg mb-1">${d.title}</h3>
          <p class="text-sm text-gray-600 line-clamp-2 mb-3">${d.description || ''}</p>
          <div class="mt-auto flex items-center justify-between">
            <span class="text-blue-700 font-semibold">৳${Number(d.price).toFixed(2)}${d.weight ? ` · ${d.weight}` : ''}</span>
            <button class="add-to-cart bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">Add to Cart</button>
          </div>
        </div>
      `;
      card.querySelector('.add-to-cart').addEventListener('click', () => {
        addToCart({
          id: doc.id,
          title: d.title,
          price: Number(d.price),
          image: d.image,
          weight: d.weight || ''
        });
      });
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  } catch (e) {
    console.error('Failed to load products', e);
    empty?.classList.remove('hidden');
    empty.textContent = 'Failed to load products.';
  }
}

// Render cart page
export function renderCartPage() {
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

  if (!itemsEl) return;

  function parseWeightToGrams(w) {
    if (!w) return 0;
    const s = String(w).trim().toLowerCase();
    const m = s.match(/([0-9]*\.?[0-9]+)\s*(kg|g)?/);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    const unit = m[2] || 'g';
    return unit === 'kg' ? Math.round(val * 1000) : Math.round(val);
  }

  function calcDelivery(cart) {
    const totalGrams = cart.reduce((sum, i) => sum + parseWeightToGrams(i.weight) * i.qty, 0);
    if (totalGrams <= 0) return 80; // fallback flat fee when weights are unknown
    // Base 60 for first 1000g, then +30 per additional 1000g block
    const base = 60;
    const extraBlocks = Math.max(0, Math.ceil(totalGrams / 1000) - 1);
    return base + extraBlocks * 30;
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

  function refresh() {
    const cart = readCart();
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
          <img src="${item.image}" alt="${item.title}" class="w-16 h-16 object-cover rounded">
          <div>
            <div class="font-medium">${item.title}${item.weight ? ` · ${item.weight}` : ''}</div>
            <div class="text-sm text-gray-600">৳${item.price.toFixed(2)}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <input type="number" min="1" value="${item.qty}" class="w-16 border rounded px-2 py-1 qty-input">
          <button class="remove px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700">Remove</button>
        </div>
      `;
      row.querySelector('.qty-input').addEventListener('change', (e) => {
        setQty(item.id, Number(e.target.value));
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
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    const delivery = calcDelivery(cart);
    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const address = addressInput ? addressInput.value.trim() : '';
    if (!name || !phone || !address) {
      alert('Please enter name, phone, and address.');
      return;
    }
    try {
      // Save/merge profile
      if (auth.currentUser) {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { name, phone, address }, { merge: true });
      }
      await addDoc(collection(db, 'orders'), {
        items: cart,
        subtotal: total,
        delivery,
        total: total + delivery,
        currency: 'BDT',
        userId: auth.currentUser ? auth.currentUser.uid : null,
        customer: { name, phone, address },
        status: 'Pending',
        createdAt: serverTimestamp()
      });
      localStorage.removeItem(CART_KEY);
      updateCartBadge();
      refresh();
      alert('Order placed successfully.');
      window.location.href = 'index.html';
    } catch (e) {
      alert('Failed to place order: ' + e.message);
    }
  });

  refresh();
  loadProfile();
}

// Initialize header + home
(function init() {
  initAuthHeader();
  updateCartBadge();
  renderProducts();
})();
