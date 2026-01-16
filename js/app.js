import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import {
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  serverTimestamp
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

  if (!itemsEl) return;

  function refresh() {
    const cart = readCart();
    itemsEl.innerHTML = '';
    if (cart.length === 0) {
      emptyEl.classList.remove('hidden');
      summaryEl.classList.add('hidden');
      totalEl.textContent = '৳0.00';
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
  }

  checkoutBtn?.addEventListener('click', async () => {
    const cart = readCart();
    if (cart.length === 0) return;
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    try {
      await addDoc(collection(db, 'orders'), {
        items: cart,
        total,
        currency: 'BDT',
        userId: auth.currentUser ? auth.currentUser.uid : null,
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
}

// Initialize header + home
(function init() {
  initAuthHeader();
  updateCartBadge();
  renderProducts();
})();
