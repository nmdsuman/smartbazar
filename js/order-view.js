import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';

(function init(){
  initAuthHeader();
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('id');
  
  // UI Elements
  const loadingEl = document.getElementById('ov-loading');
  const viewEl = document.getElementById('order-view');
  
  const idEl = document.getElementById('ov-id');
  const statusEl = document.getElementById('ov-status');
  const customerEl = document.getElementById('ov-customer');
  const tbody = document.getElementById('ov-items');
  
  const addSection = document.getElementById('add-section');
  const addSelect = document.getElementById('ov-add-select');
  const addQty = document.getElementById('ov-add-qty');
  const addBtn = document.getElementById('ov-add-btn');
  
  const subtotalEl = document.getElementById('ov-subtotal');
  const deliveryEl = document.getElementById('ov-delivery');
  const totalEl = document.getElementById('ov-total');
  
  const saveBtn = document.getElementById('ov-save');
  const printBtn = document.getElementById('ov-print');

  // State
  let products = [];
  let shippingCfg = null;
  let items = [];
  let orderData = null;
  let canEdit = false;
  let isAdmin = false;

  // Helpers
  function parseWeightToGrams(w){
    if (!w) return 0; const s=String(w).trim().toLowerCase();
    const m=s.match(/([0-9]*\.?[0-9]+)\s*(kg|g|l|liter|ltr|ml)?/); if(!m) return 0;
    const v=parseFloat(m[1]); const u=m[2]||'g';
    if (u==='kg' || u==='l' || u==='liter' || u==='ltr') return Math.round(v*1000);
    return Math.round(v);
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
      // Compact row styling
      tr.className = "hover:bg-gray-50 group";
      
      tr.innerHTML = `
        <td class="py-2 px-2 border-b border-gray-100">
          <div class="flex items-center gap-2">
            ${it.image ? `<img src="${it.image}" alt="Product" class="w-8 h-8 object-cover rounded border bg-white">` : ''}
            <div class="flex flex-col">
              <span class="font-medium text-gray-800 leading-tight">${it.title}</span>
              ${it.weight ? `<span class="text-[10px] text-gray-500">${it.weight}</span>` : ''}
            </div>
          </div>
        </td>
        <td class="py-2 px-2 border-b border-gray-100 text-right text-gray-600">৳${Number(it.price).toFixed(2)}</td>
        <td class="py-2 px-2 border-b border-gray-100 text-center">
          ${canEdit 
            ? `<input type="number" min="1" value="${it.qty}" data-idx="${idx}" class="qty w-12 text-center border rounded px-1 py-0.5 text-sm focus:border-blue-500 focus:outline-none"/>` 
            : `<span class="font-medium">${it.qty}</span>`}
        </td>
        <td class="py-2 px-2 border-b border-gray-100 text-right font-medium text-gray-800">৳${line.toFixed(2)}</td>
        <td class="py-2 px-2 border-b border-gray-100 text-center">
          ${canEdit ? `<button data-idx="${idx}" class="remove text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" title="Remove">✕</button>` : ''}
        </td>
      `;
      
      if (canEdit) {
        const qtyInput = tr.querySelector('.qty');
        const removeBtn = tr.querySelector('.remove');
        if(qtyInput) qtyInput.addEventListener('change', (e)=>{
          const i = Number(e.target.getAttribute('data-idx'));
          items[i].qty = Math.max(1, Number(e.target.value)||1);
          render();
        });
        if(removeBtn) removeBtn.addEventListener('click', ()=>{
          const i = Number(removeBtn.getAttribute('data-idx'));
          if(confirm('Remove this item?')) {
            items.splice(i,1);
            render();
          }
        });
      }
      tbody.appendChild(tr);
    });

    const delivery = calcDelivery();
    subtotalEl.textContent = `৳${subtotal.toFixed(2)}`;
    deliveryEl.textContent = `৳${delivery.toFixed(2)}`;
    totalEl.textContent = `৳${(subtotal+delivery).toFixed(2)}`;

    // Toggle Visibility based on permissions
    if (canEdit) {
      addSection.classList.remove('hidden');
      saveBtn.classList.remove('hidden');
    } else {
      addSection.classList.add('hidden');
      saveBtn.classList.add('hidden');
    }

    if (isAdmin) {
      printBtn.classList.remove('hidden');
    } else {
      printBtn.classList.add('hidden');
    }
  }

  function fillProductsSelect(){
    addSelect.innerHTML = '<option value="">-- Select Product to Add --</option>' +
      products.map(p=>`<option value="${p.id}">${p.title} (৳${p.price})</option>`).join('');
  }

  addBtn.addEventListener('click', ()=>{
    const pid = addSelect.value; 
    const qty = Math.max(1, Number(addQty.value)||1);
    if (!pid) return; 
    
    const p = products.find(x=>x.id===pid); 
    if (!p) return;
    
    const existing = items.find(i=>i.id===pid);
    if (existing) {
      existing.qty += qty; 
    } else {
      items.push({ 
        id: p.id, 
        title: p.title, 
        price: Number(p.price), 
        image: p.image, 
        weight: p.weight||'', 
        qty 
      });
    }
    // Reset inputs
    addSelect.value = "";
    addQty.value = "1";
    render();
  });

  saveBtn.addEventListener('click', async ()=>{
    if (!canEdit) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const subtotal = items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
      const delivery = calcDelivery();
      await updateDoc(doc(db,'orders', orderId), {
        items,
        subtotal,
        delivery,
        total: subtotal + delivery
      });
      alert('Order updated successfully.');
    } catch (e) { 
      alert('Save failed: ' + e.message); 
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });

  // PROFESSIONAL PRINT FUNCTION
  printBtn.addEventListener('click', ()=>{
    const w = window.open('', '_blank');
    
    // Rows generation
    const rows = items.map(i=>`
      <tr>
        <td style="padding:4px 0;">
          <div style="font-weight:bold;font-size:11px;">${i.title}</div>
          ${i.weight ? `<div style="font-size:9px;color:#666;">${i.weight}</div>` : ''}
        </td>
        <td style="text-align:right;padding:4px 0;">${i.qty}</td>
        <td style="text-align:right;padding:4px 0;">৳${Number(i.price).toFixed(2)}</td>
        <td style="text-align:right;padding:4px 0;">৳${(i.qty*i.price).toFixed(2)}</td>
      </tr>
      <tr><td colspan="4" style="border-bottom:1px solid #eee;"></td></tr>
    `).join('');

    const subtotal = items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
    const delivery = calcDelivery();
    const total = subtotal + delivery;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice #${orderId.slice(-6)}</title>
        <style>
          @page { size: A4; margin: 1cm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; line-height: 1.3; color: #333; max-width: 100%; margin: 0; padding: 0; }
          .header { display: flex; justify-content: space-between; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .brand h1 { margin: 0; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; }
          .brand p { margin: 2px 0 0; font-size: 9px; color: #555; }
          .invoice-meta { text-align: right; }
          .invoice-meta h2 { margin: 0; font-size: 16px; color: #333; }
          .invoice-meta p { margin: 2px 0 0; }
          
          .info-grid { display: flex; gap: 30px; margin-bottom: 20px; }
          .info-col { flex: 1; }
          .info-label { font-size: 9px; font-weight: bold; text-transform: uppercase; color: #777; border-bottom: 1px solid #ddd; margin-bottom: 4px; padding-bottom: 2px; }
          .info-content { font-size: 11px; font-weight: 500; }
          
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { text-align: left; border-bottom: 1px solid #333; padding: 5px 0; font-size: 10px; text-transform: uppercase; }
          .nums { text-align: right; }
          
          .totals { margin-left: auto; width: 40%; }
          .total-row { display: flex; justify-content: space-between; padding: 3px 0; }
          .total-row.final { font-weight: bold; font-size: 13px; border-top: 1px solid #333; margin-top: 5px; padding-top: 5px; }
          
          .footer { margin-top: 30px; font-size: 9px; text-align: center; color: #888; border-top: 1px solid #eee; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">
            <h1>Bazar Shop</h1>
            <p>123 Market Road, Dhaka, Bangladesh<br>Phone: +880 1700-000000</p>
          </div>
          <div class="invoice-meta">
            <h2>INVOICE</h2>
            <p>#${orderId.slice(-6).toUpperCase()}</p>
            <p>${new Date().toLocaleDateString()}</p>
          </div>
        </div>

        <div class="info-grid">
          <div class="info-col">
            <div class="info-label">Customer Details</div>
            <div class="info-content">
              ${orderData?.customer?.name || 'N/A'}<br>
              ${orderData?.customer?.phone || ''}
            </div>
          </div>
          <div class="info-col">
            <div class="info-label">Delivery Address</div>
            <div class="info-content">
              ${orderData?.customer?.address || 'N/A'}
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:50%">Item</th>
              <th class="nums">Qty</th>
              <th class="nums">Price</th>
              <th class="nums">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="totals">
          <div class="total-row"><span>Subtotal</span><span>৳${subtotal.toFixed(2)}</span></div>
          <div class="total-row"><span>Delivery</span><span>৳${delivery.toFixed(2)}</span></div>
          <div class="total-row final"><span>TOTAL PAYABLE</span><span>৳${total.toFixed(2)}</span></div>
        </div>

        <div class="footer">
          Thank you for shopping with Bazar. If you have any questions about this invoice, please contact us.
        </div>
        <script>window.print();</script>
      </body>
      </html>
    `;
    w.document.write(html);
    w.document.close();
  });

  auth.onAuthStateChanged(async (user)=>{
    if (!user) { window.location.replace('login.html'); return; }
    try {
      // Role Check
      const uSnap = await getDoc(doc(db,'users', user.uid));
      const role = uSnap.exists() && uSnap.data()?.role ? uSnap.data().role : 'user';
      isAdmin = role === 'admin';

      // Settings & Products
      const setSnap = await getDoc(doc(db,'settings','shipping'));
      if (setSnap.exists()) shippingCfg = setSnap.data();
      
      const prodSnap = await getDocs(query(collection(db,'products'), orderBy('createdAt','desc')));
      products = prodSnap.docs.map(d=>({ id: d.id, ...d.data(), price: Number(d.data().price) }));
      fillProductsSelect();

      // Order Data
      const ordSnap = await getDoc(doc(db,'orders', orderId));
      if (!ordSnap.exists()) { loadingEl.textContent = 'Order not found.'; return; }
      orderData = ordSnap.data();

      // Auto-update status for admin if pending
      if (isAdmin && (orderData.status || 'Pending') === 'Pending') {
        await updateDoc(doc(db,'orders', orderId), { status: 'Processing' });
        orderData.status = 'Processing';
      }

      // Populate Meta
      idEl.textContent = '#' + orderId.slice(-6).toUpperCase();
      statusEl.textContent = orderData.status || 'Pending';
      // Style status badge
      const st = (orderData.status || 'Pending').toLowerCase();
      statusEl.className = `px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide border ${
        st==='pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
        st==='processing' ? 'bg-blue-100 text-blue-700 border-blue-200' :
        st==='delivered' ? 'bg-green-100 text-green-700 border-green-200' :
        'bg-gray-100 text-gray-700 border-gray-200'
      }`;

      // Compact Customer Info
      customerEl.innerHTML = `
        <div class="font-bold">${orderData.customer?.name || 'Guest'}</div>
        <div class="text-xs text-gray-500">${orderData.customer?.phone || ''}</div>
        <div class="mt-1 text-gray-700">${orderData.customer?.address || ''}</div>
      `;

      // Permissions Logic
      const isOwner = orderData.userId && (orderData.userId === user.uid);
      const isPending = (orderData.status || 'Pending') === 'Pending';
      
      // Admin can always edit. User can edit ONLY if Owner AND Pending.
      // If Processing/Delivered/etc -> User CANNOT edit (canEdit = false).
      canEdit = isAdmin || (isOwner && isPending);

      // Security Redirect
      if (!isAdmin && !isOwner) { window.location.replace('orders.html'); return; }

      items = Array.isArray(orderData.items) ? orderData.items.map(x=>({ ...x })) : [];
      
      render();
      
      loadingEl.classList.add('hidden');
      viewEl.classList.remove('hidden');

    } catch (e) {
      console.error(e);
      loadingEl.textContent = 'Failed to load: ' + e.message;
    }
  });
})();
