import { db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { addToCart, updateCartBadge } from './app.js';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

function getParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

async function loadProduct(id) {
  const ref = doc(db, 'products', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Product not found');
  return { id: snap.id, data: snap.data() };
}

async function loadRelated(category, excludeId) {
  if (!category) return [];
  const qy = query(
    collection(db, 'products'),
    where('category', '==', category)
  );
  const snap = await getDocs(qy);
  return snap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .filter(p => p.id !== excludeId && p.data.active !== false)
    .slice(0, 8);
}

function renderRelated(list) {
  const grid = document.getElementById('related-grid');
  const empty = document.getElementById('related-empty');
  if (!grid) return;
  grid.innerHTML = '';
  if (!list || list.length === 0) {
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  const frag = document.createDocumentFragment();
  list.forEach(({ id, data: d }) => {
    const card = document.createElement('a');
    card.href = `productfullview.html?id=${encodeURIComponent(id)}`;
    card.className = 'border rounded bg-white overflow-hidden block hover:shadow';
    card.innerHTML = `
      <img src="${d.image}" alt="${d.title}" class="h-36 w-full object-contain bg-white">
      <div class="p-2">
        <div class="text-sm font-medium line-clamp-1">${d.title}</div>
        <div class="text-sm text-blue-700">৳${Number(d.price).toFixed(2)}</div>
      </div>
    `;
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

async function main() {
  initAuthHeader();
  updateCartBadge();
  const id = getParam('id');
  if (!id) {
    window.location.replace('index.html');
    return;
  }
  try {
    const { id: pid, data: p } = await loadProduct(id);
    // Populate main
    const img = document.getElementById('pv-image');
    const title = document.getElementById('pv-title');
    const meta = document.getElementById('pv-meta');
    const price = document.getElementById('pv-price');
    const desc = document.getElementById('pv-desc');
    const addBtn = document.getElementById('pv-add');

    if (img) img.src = p.image || '';
    if (title) title.textContent = p.title || 'Product';
    const metaBits = [];
    if (p.category) metaBits.push(p.category);
    if (p.weight) metaBits.push(p.weight);
    if (p.size) metaBits.push(p.size);
    if (meta) meta.textContent = metaBits.join(' · ');
    if (price) price.textContent = Number(p.price || 0).toFixed(2);
    if (desc) desc.textContent = p.description || '';
    const out = Number(p.stock || 0) <= 0;
    if (addBtn) {
      addBtn.disabled = out;
      addBtn.textContent = out ? 'Unavailable' : 'Add to Cart';
      addBtn.addEventListener('click', () => {
        addToCart({ id: pid, title: p.title, price: Number(p.price), image: p.image, weight: p.weight || '' });
      });
    }

    // Related
    const related = await loadRelated(p.category || '', pid);
    renderRelated(related);
  } catch (e) {
    alert('Failed to load product: ' + e.message);
    window.location.replace('index.html');
  }
}

main();
