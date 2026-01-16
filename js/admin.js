import { auth, db } from './firebase-config.js';
import { requireAuth } from './auth.js';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy
} from 'firebase/firestore';

requireAuth();

const form = document.getElementById('add-product-form');
const msg = document.getElementById('admin-message');
const listEl = document.getElementById('admin-products');
const emptyEl = document.getElementById('admin-empty');

function setMessage(text, ok = true) {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `text-sm mt-4 ${ok ? 'text-green-700' : 'text-red-700'}`;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const title = (data.get('title') || '').toString().trim();
  const price = Number(data.get('price'));
  const image = (data.get('image') || '').toString().trim();
  const description = (data.get('description') || '').toString().trim();

  if (!title || !image || Number.isNaN(price)) {
    setMessage('Please fill all required fields correctly.', false);
    return;
  }

  try {
    await addDoc(collection(db, 'products'), {
      title,
      price,
      image,
      description,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser ? auth.currentUser.uid : null
    });
    form.reset();
    setMessage('Product added successfully.');
  } catch (err) {
    setMessage('Failed to add product: ' + err.message, false);
  }
});

function renderProducts() {
  const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snap) => {
    listEl.innerHTML = '';
    if (snap.empty) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');
    const frag = document.createDocumentFragment();
    snap.forEach(d => {
      const data = d.data();
      const card = document.createElement('div');
      card.className = 'border rounded-lg bg-white overflow-hidden flex flex-col';
      card.innerHTML = `
        <img src="${data.image}" alt="${data.title}" class="h-40 w-full object-cover">
        <div class="p-4 flex-1 flex flex-col">
          <h3 class="font-semibold text-lg mb-1">${data.title}</h3>
          <p class="text-sm text-gray-600 line-clamp-2 mb-3">${data.description || ''}</p>
          <div class="mt-auto flex items-center justify-between">
            <span class="text-blue-700 font-semibold">$${Number(data.price).toFixed(2)}</span>
            <button class="delete bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700">Delete</button>
          </div>
        </div>
      `;
      card.querySelector('.delete').addEventListener('click', async () => {
        if (!confirm('Delete this product?')) return;
        try {
          await deleteDoc(doc(db, 'products', d.id));
        } catch (err) {
          alert('Delete failed: ' + err.message);
        }
      });
      frag.appendChild(card);
    });
    listEl.appendChild(frag);
  }, (err) => {
    setMessage('Failed to load products: ' + err.message, false);
  });
}

renderProducts();
