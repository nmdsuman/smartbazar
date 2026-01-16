import { auth, db } from './firebase-config.js';
import { requireAdmin } from './auth.js';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  getDoc,
  setDoc
} from 'firebase/firestore';

requireAdmin();

const form = document.getElementById('add-product-form');
const msg = document.getElementById('admin-message');
const listEl = document.getElementById('admin-products');
const emptyEl = document.getElementById('admin-empty');
const ordersListEl = document.getElementById('orders-list');
const ordersEmptyEl = document.getElementById('orders-empty');
const shippingForm = document.getElementById('shipping-form');
const shippingMsg = document.getElementById('shipping-message');

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
  const weight = (data.get('weight') || '').toString().trim();
  const size = (data.get('size') || '').toString().trim();

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
      weight: weight || null,
      size: size || null,
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
            <span class="text-blue-700 font-semibold">৳${Number(data.price).toFixed(2)}${data.weight ? ` · ${data.weight}` : ''}${data.size ? ` · ${data.size}` : ''}</span>
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

// Live Orders list
function renderOrders() {
  if (!ordersListEl) return;
  const oq = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  onSnapshot(oq, (snap) => {
    ordersListEl.innerHTML = '';
    if (snap.empty) {
      ordersEmptyEl?.classList.remove('hidden');
      return;
    }
    ordersEmptyEl?.classList.add('hidden');
    const frag = document.createDocumentFragment();
    snap.forEach(docSnap => {
      const o = docSnap.data();
      const div = document.createElement('div');
      div.className = 'border rounded p-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-center';
      const count = Array.isArray(o.items) ? o.items.reduce((s,i)=>s+i.qty,0) : 0;
      const when = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : '';
      div.innerHTML = `
        <div>
          <div class="font-medium">Order #${docSnap.id.slice(-6)}</div>
          <div class="text-sm text-gray-600">Items: ${count} · User: ${o.userId || 'guest'} · ${when}</div>
          <div class="text-sm text-gray-600">${o.customer?.name || ''} · ${o.customer?.phone || ''}</div>
        </div>
        <div class="font-semibold">৳${Number(o.total || 0).toFixed(2)}</div>
        <div class="flex items-center gap-2">
          <label class="text-sm">Status</label>
          <select class="border rounded px-2 py-1 admin-status">
            ${['Pending','Processing','Shipped','Delivered','Cancelled'].map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      `;
      div.querySelector('.admin-status').addEventListener('change', async (e)=>{
        try { await updateDoc(doc(db,'orders',docSnap.id), { status: e.target.value }); } catch(err) { alert('Failed to update: '+err.message); }
      });
      frag.appendChild(div);
    });
    ordersListEl.appendChild(frag);
  }, (err)=>{
    console.error('Orders load failed', err);
  });
}

renderOrders();

// Delivery settings
async function loadShipping() {
  if (!shippingForm) return;
  try {
    const ref = doc(db, 'settings', 'shipping');
    const snap = await getDoc(ref);
    const s = snap.exists() ? snap.data() : {};
    shippingForm.baseFee.value = s.baseFee ?? '';
    shippingForm.extraPerBlock.value = s.extraPerBlock ?? '';
    shippingForm.blockGrams.value = s.blockGrams ?? '';
    shippingForm.fallbackFee.value = s.fallbackFee ?? '';
  } catch (e) {
    if (shippingMsg) shippingMsg.textContent = 'Failed to load settings: ' + e.message;
  }
}

shippingForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      baseFee: Number(shippingForm.baseFee.value || 0),
      extraPerBlock: Number(shippingForm.extraPerBlock.value || 0),
      blockGrams: Number(shippingForm.blockGrams.value || 1000),
      fallbackFee: Number(shippingForm.fallbackFee.value || 0),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'settings', 'shipping'), payload, { merge: true });
    shippingMsg.textContent = 'Settings saved.';
    shippingMsg.className = 'text-sm mt-3 text-green-700';
  } catch (e) {
    shippingMsg.textContent = 'Save failed: ' + e.message;
    shippingMsg.className = 'text-sm mt-3 text-red-700';
  }
});

loadShipping();
