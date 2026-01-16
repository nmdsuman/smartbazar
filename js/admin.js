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
const ordersFilter = document.getElementById('orders-filter');
const shippingForm = document.getElementById('shipping-form');
const shippingMsg = document.getElementById('shipping-message');
// Order modal elements
const modal = document.getElementById('order-modal');
const modalClose = document.getElementById('order-close');
const modalMeta = document.getElementById('order-meta');
const modalItemsTbody = document.getElementById('order-items');
const modalAddSelect = document.getElementById('order-add-select');
const modalAddQty = document.getElementById('order-add-qty');
const modalAddBtn = document.getElementById('order-add-btn');
const modalSubtotalEl = document.getElementById('order-subtotal');
const modalDeliveryEl = document.getElementById('order-delivery');
const modalTotalEl = document.getElementById('order-total');
const modalSaveBtn = document.getElementById('order-save');
const modalPrintBtn = document.getElementById('order-print');

let productsCache = [];
let shippingCfg = null; // cached shipping settings for calc
let currentOrder = { id: null, data: null, items: [] };
let lastOrders = [];

// Product Edit modal
const editModal = document.getElementById('edit-modal');
const editClose = document.getElementById('edit-close');
const editForm = document.getElementById('edit-form');
const editMsg = document.getElementById('edit-message');
let currentEditProductId = null;

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
    productsCache = [];
    const frag = document.createDocumentFragment();
    snap.forEach(d => {
      const data = d.data();
      productsCache.push({ id: d.id, ...data, price: Number(data.price) });
      const card = document.createElement('div');
      card.className = 'border rounded-lg bg-white overflow-hidden flex flex-col';
      card.innerHTML = `
        <img src="${data.image}" alt="${data.title}" class="h-40 w-full object-cover">
        <div class="p-4 flex-1 flex flex-col">
          <h3 class="font-semibold text-lg mb-1">${data.title}</h3>
          <p class="text-sm text-gray-600 line-clamp-2 mb-3">${data.description || ''}</p>
          <div class="mt-auto flex items-center justify-between">
            <span class="text-blue-700 font-semibold">৳${Number(data.price).toFixed(2)}${data.weight ? ` · ${data.weight}` : ''}${data.size ? ` · ${data.size}` : ''}</span>
            <div class="flex items-center gap-2">
              <button class="edit bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">Edit</button>
              <button class="delete bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700">Delete</button>
            </div>
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
      card.querySelector('.edit').addEventListener('click', () => {
        currentEditProductId = d.id;
        editForm.title.value = data.title || '';
        editForm.price.value = data.price || 0;
        editForm.weight.value = data.weight || '';
        editForm.size.value = data.size || '';
        editForm.image.value = data.image || '';
        editForm.description.value = data.description || '';
        editMsg.textContent = '';
        editMsg.className = 'text-sm';
        editModal.classList.remove('hidden');
        editModal.classList.add('flex');
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
function drawOrders() {
  if (!ordersListEl) return;
  ordersListEl.innerHTML = '';
  const filterVal = ordersFilter?.value || 'All';
  const subset = lastOrders.filter(o => filterVal === 'All' || o.data.status === filterVal);
  if (subset.length === 0) {
    ordersEmptyEl?.classList.remove('hidden');
    return;
  }
  ordersEmptyEl?.classList.add('hidden');
  const frag = document.createDocumentFragment();
  subset.forEach(({ id, data: o }) => {
    const div = document.createElement('div');
    div.className = 'border rounded p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-center';
    const count = Array.isArray(o.items) ? o.items.reduce((s,i)=>s+i.qty,0) : 0;
    const when = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : '';
    div.innerHTML = `
      <div>
        <div class="font-medium">Order #${id.slice(-6)}</div>
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
      <div class="text-right">
        <button class="view px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">View</button>
      </div>
    `;
    div.querySelector('.admin-status').addEventListener('change', async (e)=>{
      try { await updateDoc(doc(db,'orders',id), { status: e.target.value }); } catch(err) { alert('Failed to update: '+err.message); }
    });
    div.querySelector('.view').addEventListener('click', ()=> { window.location.href = `view.html?id=${id}`; });
    frag.appendChild(div);
  });
  ordersListEl.appendChild(frag);
}

function renderOrders() {
  if (!ordersListEl) return;
  const oq = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  onSnapshot(oq, (snap) => {
    lastOrders = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    drawOrders();
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
    shippingCfg = s;
    if (shippingForm) {
      shippingForm.fixedFee.value = s.fixedFee ?? '';
      shippingForm.fixedUpToGrams.value = s.fixedUpToGrams ?? '';
      shippingForm.extraPerKg.value = s.extraPerKg ?? '';
      shippingForm.fallbackFee.value = s.fallbackFee ?? '';
    }
  } catch (e) {
    if (shippingMsg) shippingMsg.textContent = 'Failed to load settings: ' + e.message;
  }
}

shippingForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      fixedFee: Number(shippingForm.fixedFee.value || 0),
      fixedUpToGrams: Number(shippingForm.fixedUpToGrams.value || 0),
      extraPerKg: Number(shippingForm.extraPerKg.value || 0),
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

// Orders filter change
ordersFilter?.addEventListener('change', drawOrders);

// Edit modal handlers
editClose?.addEventListener('click', ()=>{
  editModal.classList.add('hidden');
  editModal.classList.remove('flex');
});

editForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentEditProductId) return;
  const data = new FormData(editForm);
  const payload = {
    title: (data.get('title')||'').toString().trim(),
    price: Number(data.get('price')||0),
    weight: (data.get('weight')||'').toString().trim() || null,
    size: (data.get('size')||'').toString().trim() || null,
    image: (data.get('image')||'').toString().trim(),
    description: (data.get('description')||'').toString().trim() || ''
  };
  try {
    await updateDoc(doc(db,'products', currentEditProductId), payload);
    editMsg.textContent = 'Product updated.';
    editMsg.className = 'text-sm text-green-700';
    setTimeout(()=>{
      editModal.classList.add('hidden');
      editModal.classList.remove('flex');
    }, 500);
  } catch (e) {
    editMsg.textContent = 'Save failed: ' + e.message;
    editMsg.className = 'text-sm text-red-700';
  }
});

// Helpers for order modal
function parseWeightToGrams(w){
  if (!w) return 0; const s=String(w).trim().toLowerCase();
  const m=s.match(/([0-9]*\.?[0-9]+)\s*(kg|g)?/); if(!m) return 0;
  const v=parseFloat(m[1]); const u=m[2]||'g'; return u==='kg'?Math.round(v*1000):Math.round(v);
}
function calcDeliveryForItems(items){
  const cfg = shippingCfg || { fixedFee:60, fixedUpToGrams:1000, extraPerKg:30, fallbackFee:80 };
  const grams = items.reduce((s,i)=> s + parseWeightToGrams(i.weight)*i.qty, 0);
  if (grams<=0) return cfg.fallbackFee||0;
  const base = Number(cfg.fixedFee||0); const upTo = Number(cfg.fixedUpToGrams||0); const extraKg=Number(cfg.extraPerKg||0);
  if (upTo>0 && grams<=upTo) return base;
  const over = Math.max(0, grams - upTo); const blocks = Math.ceil(over/1000);
  return base + blocks*extraKg;
}

function renderModalItems(){
  const items = currentOrder.items;
  modalItemsTbody.innerHTML='';
  let subtotal=0;
  items.forEach((it, idx)=>{
    const line = it.price*it.qty; subtotal+=line;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2 border">${it.title}${it.weight?` · ${it.weight}`:''}</td>
      <td class="p-2 border text-right">৳${Number(it.price).toFixed(2)}</td>
      <td class="p-2 border text-right"><input type="number" min="1" value="${it.qty}" data-idx="${idx}" class="w-20 border rounded px-2 py-1 qty"/></td>
      <td class="p-2 border text-right">৳${line.toFixed(2)}</td>
      <td class="p-2 border text-right"><button data-idx="${idx}" class="remove text-red-600">Remove</button></td>
    `;
    tr.querySelector('.qty').addEventListener('change', (e)=>{
      const i = Number(e.target.getAttribute('data-idx')); currentOrder.items[i].qty = Math.max(1, Number(e.target.value)||1); renderModalItems();
    });
    tr.querySelector('.remove').addEventListener('click', ()=>{
      const i = Number(tr.querySelector('.remove').getAttribute('data-idx'));
      currentOrder.items.splice(i,1); renderModalItems();
    });
    modalItemsTbody.appendChild(tr);
  });
  const delivery = calcDeliveryForItems(items);
  modalSubtotalEl.textContent = `৳${subtotal.toFixed(2)}`;
  modalDeliveryEl.textContent = `৳${delivery.toFixed(2)}`;
  modalTotalEl.textContent = `৳${(subtotal+delivery).toFixed(2)}`;
}

function openOrderModal(id, data){
  currentOrder.id = id;
  currentOrder.data = data;
  currentOrder.items = Array.isArray(data.items) ? data.items.map(x=>({ ...x })) : [];
  modalMeta.textContent = `Order #${id.slice(-6)} · ${data.customer?.name||''} · ${data.customer?.phone||''}`;
  // populate product select
  modalAddSelect.innerHTML = '<option value="">Select product</option>' + productsCache.map(p=>`<option value="${p.id}">${p.title} — ৳${Number(p.price).toFixed(2)}${p.weight?` · ${p.weight}`:''}</option>`).join('');
  renderModalItems();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

modalClose?.addEventListener('click', ()=>{
  modal.classList.add('hidden');
  modal.classList.remove('flex');
});

modalAddBtn?.addEventListener('click', ()=>{
  const pid = modalAddSelect.value; const qty = Math.max(1, Number(modalAddQty.value)||1);
  if (!pid) return;
  const p = productsCache.find(x=>x.id===pid); if(!p) return;
  const existing = currentOrder.items.find(i=>i.id===pid);
  if (existing) existing.qty += qty; else currentOrder.items.push({ id: pid, title: p.title, price: Number(p.price), image: p.image, weight: p.weight||'', qty });
  renderModalItems();
});

modalSaveBtn?.addEventListener('click', async ()=>{
  try {
    const subtotal = currentOrder.items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
    const delivery = calcDeliveryForItems(currentOrder.items);
    await updateDoc(doc(db,'orders', currentOrder.id), {
      items: currentOrder.items,
      subtotal,
      delivery,
      total: subtotal + delivery
    });
    alert('Order updated');
    modal.classList.add('hidden'); modal.classList.remove('flex');
  } catch (e) { alert('Save failed: ' + e.message); }
});

modalPrintBtn?.addEventListener('click', ()=>{
  const w = window.open('', '_blank');
  const rows = currentOrder.items.map(i=>`<tr>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        <img src="${i.image||''}" alt="${i.title}" style="width:32px;height:32px;object-fit:cover;border:1px solid #ddd;border-radius:4px"/>
        <span>${i.title}${i.weight?` · ${i.weight}`:''}</span>
      </div>
    </td>
    <td style='text-align:right'>${i.qty}</td>
    <td style='text-align:right'>৳${Number(i.price).toFixed(2)}</td>
    <td style='text-align:right'>৳${(i.qty*i.price).toFixed(2)}</td>
  </tr>`).join('');
  const subtotal = currentOrder.items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
  const delivery = calcDeliveryForItems(currentOrder.items);
  const total = subtotal + delivery;
  w.document.write(`
    <html><head><title>Invoice</title><style>
    body{font-family:Arial,sans-serif;padding:24px}
    table{width:100%;border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px}
    </style></head><body>
      <h2>Bazar — Delivery Invoice</h2>
      <div>Order #${currentOrder.id.slice(-6)}</div>
      <div>${currentOrder.data.customer?.name||''} · ${currentOrder.data.customer?.phone||''}</div>
      <div>${currentOrder.data.customer?.address||''}</div>
      <hr/>
      <table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>
      ${rows}
      </tbody></table>
      <h3 style='text-align:right'>Subtotal: ৳${subtotal.toFixed(2)}<br/>Delivery: ৳${delivery.toFixed(2)}<br/>Total: ৳${total.toFixed(2)}</h3>
      <p>Thank you.</p>
      <script>window.print();</script>
    </body></html>
  `);
  w.document.close();
});
