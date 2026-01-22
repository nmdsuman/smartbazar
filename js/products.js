import { auth, db } from './firebase-config.js';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';

const listEl = document.getElementById('admin-products');
const emptyEl = document.getElementById('admin-empty');

let cache = [];

function setMessage(text, ok = true) {
  const msg = document.getElementById('admin-message');
  if (!msg) return;
  msg.textContent = text;
  msg.className = `text-sm mt-4 ${ok ? 'text-green-700' : 'text-red-700'}`;
}

function dispatchCacheUpdated(){
  try {
    window.productsCache = cache.slice();
    const ev = new CustomEvent('ProductsCacheUpdated', { detail: { cache: window.productsCache } });
    window.dispatchEvent(ev);
  } catch {}
}

function attachCardHandlers(card, id, data){
  card.querySelector('.delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this product?')) return;
    try { await deleteDoc(doc(db, 'products', id)); }
    catch (err) { alert('Delete failed: ' + err.message); }
  });
  card.querySelector('.edit')?.addEventListener('click', () => {
    if (window.AddProduct && typeof window.AddProduct.enterEditMode === 'function') {
      window.AddProduct.enterEditMode(id, { ...data });
    } else {
      const addSection = document.getElementById('add');
      if (addSection) addSection.scrollIntoView({ behavior: 'smooth' });
      window.showSection && window.showSection('add');
    }
  });
  card.querySelector('.toggle-active')?.addEventListener('click', async () => {
    try { await updateDoc(doc(db, 'products', id), { active: data.active === false ? true : false }); }
    catch (err) { alert('Update failed: ' + err.message); }
  });
}

function renderProductsList(){
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = '';
  if (cache.length === 0) { emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');
  const frag = document.createDocumentFragment();
  cache.forEach(({ id, data }) => {
    const d = data;
    const card = document.createElement('div');
    card.className = 'border rounded-lg bg-white overflow-hidden flex flex-col';
    card.innerHTML = `
      <img src="${d.image}" alt="${d.title}" class="h-44 w-full object-contain bg-white">
      <div class="p-4 flex-1 flex flex-col">
        <h3 class="font-semibold text-lg mb-1">${d.title}</h3>
        <p class="text-sm text-gray-600 line-clamp-2 mb-3">${d.description || ''}</p>
        <div class="mt-auto space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-blue-700 font-semibold">৳${Number(d.price).toFixed(2)}${d.weight ? ` · ${d.weight}` : ''}${d.size ? ` · ${d.size}` : ''}</span>
            <span class="text-sm ${d.active === false ? 'text-red-600' : 'text-green-700'}">${d.active === false ? 'Inactive' : 'Active'}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span>Stock: <strong>${Number(d.stock || 0)}</strong></span>
            <div class="flex items-center gap-2">
              <button class="toggle-active bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">${d.active === false ? 'Activate' : 'Deactivate'}</button>
              <button class="edit bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">Edit</button>
              <button class="delete bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      </div>`;
    attachCardHandlers(card, id, d);
    frag.appendChild(card);
  });
  listEl.appendChild(frag);
}

function initProducts(){
  const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snap) => {
    cache = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    dispatchCacheUpdated();
    renderProductsList();
  }, (err)=> setMessage('Failed to load products: ' + err.message, false));
}

// Auto-init
initProducts();

window.Products = {
  init: initProducts,
  getCache: () => cache.slice()
};
