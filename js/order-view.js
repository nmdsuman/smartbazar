import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';

(function init(){
  initAuthHeader();
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('id');
  const view = document.getElementById('order-view');
  const empty = document.getElementById('ov-empty');
  const meta = document.getElementById('ov-meta');
  const tbody = document.getElementById('ov-items');
  const addSelect = document.getElementById('ov-add-select');
  const addQty = document.getElementById('ov-add-qty');
  const addBtn = document.getElementById('ov-add-btn');
  const subtotalEl = document.getElementById('ov-subtotal');
  const deliveryEl = document.getElementById('ov-delivery');
  const totalEl = document.getElementById('ov-total');
  const saveBtn = document.getElementById('ov-save');
  const printBtn = document.getElementById('ov-print');

  let products = [];
  let shippingCfg = null;
  let items = [];
  let orderData = null;
  let canEdit = false; // computed based on role and order status

  function parseWeightToGrams(w){
    if (!w) return 0; const s=String(w).trim().toLowerCase();
    const m=s.match(/([0-9]*\.?[0-9]+)\s*(kg|g)?/); if(!m) return 0;
    const v=parseFloat(m[1]); const u=m[2]||'g'; return u==='kg'?Math.round(v*1000):Math.round(v);
  }
  function calcDelivery(){
    const cfg = shippingCfg || { fixedFee:60, fixedUpToGrams:1000, extraPerKg:30, fallbackFee:80 };
    const grams = items.reduce((s,i)=> s + parseWeightToGrams(i.weight)*i.qty, 0);
    if (grams<=0) return cfg.fallbackFee||0;
    const base = Number(cfg.fixedFee||0); const upTo = Number(cfg.fixedUpToGrams||0); const extraKg=Number(cfg.extraPerKg||0);
    if (upTo>0 && grams<=upTo) return base;
    const over = Math.max(0, grams - upTo); const blocks = Math.ceil(over/1000);
    return base + blocks*extraKg;
  }

  function render(){
    tbody.innerHTML = '';
    let subtotal = 0;
    items.forEach((it, idx)=>{
      const line = Number(it.price)*Number(it.qty); subtotal += line;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class=\"p-2 border\"><div class=\"flex items-center gap-2\"><img src=\"${it.image||''}\" alt=\"${it.title}\" class=\"w-10 h-10 object-cover rounded border\"/><span>${it.title}${it.weight?` · ${it.weight}`:''}</span></div></td>
        <td class=\"p-2 border text-right\">৳${Number(it.price).toFixed(2)}</td>
        <td class=\"p-2 border text-right\">${canEdit ? `<input type=\"number\" min=\"1\" value=\"${it.qty}\" data-idx=\"${idx}\" class=\"w-20 border rounded px-2 py-1 qty\"/>` : `<span>${it.qty}</span>`}</td>
        <td class=\"p-2 border text-right\">৳${line.toFixed(2)}</td>
        <td class=\"p-2 border text-right\">${canEdit ? `<button data-idx=\"${idx}\" class=\"remove text-red-600\">Remove</button>` : ''}</td>
      `;
      if (canEdit) {
        tr.querySelector('.qty')?.addEventListener('change', (e)=>{
          const i = Number(e.target.getAttribute('data-idx')); items[i].qty = Math.max(1, Number(e.target.value)||1); render();
        });
        tr.querySelector('.remove')?.addEventListener('click', ()=>{
          const i = Number(tr.querySelector('.remove').getAttribute('data-idx'));
          items.splice(i,1); render();
        });
      }
      tbody.appendChild(tr);
    });
    const delivery = calcDelivery();
    subtotalEl.textContent = `৳${subtotal.toFixed(2)}`;
    deliveryEl.textContent = `৳${delivery.toFixed(2)}`;
    totalEl.textContent = `৳${(subtotal+delivery).toFixed(2)}`;

    // Toggle add/save controls
    addSelect.disabled = !canEdit;
    addQty.disabled = !canEdit;
    addBtn.disabled = !canEdit;
    saveBtn.disabled = !canEdit;
  }

  function fillProductsSelect(){
    addSelect.innerHTML = '<option value="">Select product</option>' +
      products.map(p=>`<option value="${p.id}">${p.title} — ৳${Number(p.price).toFixed(2)}${p.weight?` · ${p.weight}`:''}</option>`).join('');
  }

  addBtn.addEventListener('click', ()=>{
    const pid = addSelect.value; const qty = Math.max(1, Number(addQty.value)||1);
    if (!pid) return; const p = products.find(x=>x.id===pid); if (!p) return;
    const existing = items.find(i=>i.id===pid);
    if (existing) existing.qty += qty; else items.push({ id: p.id, title: p.title, price: Number(p.price), image: p.image, weight: p.weight||'', qty });
    render();
  });

  saveBtn.addEventListener('click', async ()=>{
    if (!canEdit) return;
    try {
      const subtotal = items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
      const delivery = calcDelivery();
      await updateDoc(doc(db,'orders', orderId), {
        items,
        subtotal,
        delivery,
        total: subtotal + delivery
      });
      alert('Order updated.');
    } catch (e) { alert('Save failed: ' + e.message); }
  });

  printBtn.addEventListener('click', ()=>{
    const w = window.open('', '_blank');
    const rows = items.map(i=>`<tr><td>${i.title}${i.weight?` · ${i.weight}`:''}</td><td style='text-align:right'>${i.qty}</td><td style='text-align:right'>৳${Number(i.price).toFixed(2)}</td><td style='text-align:right'>৳${(i.qty*i.price).toFixed(2)}</td></tr>`).join('');
    const subtotal = items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
    const delivery = calcDelivery();
    const total = subtotal + delivery;
    w.document.write(`
      <html><head><title>Invoice</title><style>
      body{font-family:Arial,sans-serif;padding:24px}
      table{width:100%;border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px}
      </style></head><body>
        <h2>Bazar — Delivery Invoice</h2>
        <div>Order #${orderId.slice(-6)}</div>
        <div>${orderData?.customer?.name||''} · ${orderData?.customer?.phone||''}</div>
        <div>${orderData?.customer?.address||''}</div>
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

  auth.onAuthStateChanged(async (user)=>{
    if (!user) { window.location.replace('login.html'); return; }
    try {
      // Determine role
      const uSnap = await getDoc(doc(db,'users', user.uid));
      const role = uSnap.exists() && uSnap.data()?.role ? uSnap.data().role : 'user';
      // shipping settings
      const setSnap = await getDoc(doc(db,'settings','shipping'));
      if (setSnap.exists()) shippingCfg = setSnap.data();
      // products
      const prodSnap = await getDocs(query(collection(db,'products'), orderBy('createdAt','desc')));
      products = prodSnap.docs.map(d=>({ id: d.id, ...d.data(), price: Number(d.data().price) }));
      fillProductsSelect();
      // order
      const ordSnap = await getDoc(doc(db,'orders', orderId));
      if (!ordSnap.exists()) { empty.textContent = 'Order not found.'; return; }
      orderData = ordSnap.data();
      // Permission: admin can edit always; user can edit only if owns and status Pending
      const isOwner = orderData.userId && (orderData.userId === user.uid);
      canEdit = role === 'admin' || (isOwner && (orderData.status === 'Pending'));
      // If user (not admin) tries to view someone else's order, redirect
      if (role !== 'admin' && !isOwner) { window.location.replace('orders.html'); return; }
      items = Array.isArray(orderData.items) ? orderData.items.map(x=>({ ...x })) : [];
      meta.textContent = `${orderData.status||'Pending'} · ${orderData.customer?.name||''} · ${orderData.customer?.phone||''} · ${orderData.customer?.address||''}`;
      render();
      empty.classList.add('hidden'); view.classList.remove('hidden');
    } catch (e) {
      empty.textContent = 'Failed to load: ' + e.message;
    }
  });
})();
