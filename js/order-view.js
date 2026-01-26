import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc, serverTimestamp } from 'firebase/firestore';

(function init() {
  initAuthHeader();
  
  // DOM Elements
  const container = document.getElementById('order-view');
  const emptyEl = document.getElementById('ov-empty');
  const itemsBody = document.getElementById('ov-items');
  
  // Info Elements
  const idDisplay = document.getElementById('ov-id-display');
  const dateDisplay = document.getElementById('ov-date');
  const statusBadge = document.getElementById('ov-status');
  const customerInfo = document.getElementById('ov-customer-info');
  
  // Totals
  const subtotalEl = document.getElementById('ov-subtotal');
  const deliveryEl = document.getElementById('ov-delivery');
  const totalEl = document.getElementById('ov-total');

  // Controls
  const controlsDiv = document.getElementById('ov-controls');
  const addSelect = document.getElementById('ov-add-select');
  const addQty = document.getElementById('ov-add-qty');
  const addBtn = document.getElementById('ov-add-btn');
  const saveBtn = document.getElementById('ov-save');
  const printBtn = document.getElementById('ov-print');

  // State
  let orderId = new URLSearchParams(window.location.search).get('id');
  let orderData = null;
  let items = [];
  let products = [];
  let canEdit = false;
  let hasChanges = false;

  // Helpers
  const formatMoney = (amount) => `৳${Number(amount || 0).toFixed(2)}`;
  
  function parseProductLabel(str) {
    // Extract Name and Unit from "Onion 1kg"
    return str; // Simple return for now, can be enhanced
  }

  // Load Data
  async function loadData() {
    if (!orderId) { showEmpty('No Order ID provided.'); return; }
    
    emptyEl.textContent = 'Loading...';
    emptyEl.classList.remove('hidden');
    container.classList.add('hidden');

    try {
      // 1. Get Products for the dropdown (Admin/Edit mode)
      const prodSnap = await getDocs(query(collection(db, 'products'), orderBy('createdAt', 'desc')));
      products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2. Get Order
      const snap = await getDoc(doc(db, 'orders', orderId));
      if (!snap.exists()) { showEmpty('Order not found.'); return; }
      
      orderData = snap.data();
      items = Array.isArray(orderData.items) ? [...orderData.items] : [];

      // Check Permissions
      auth.onAuthStateChanged(user => {
        if (!user) { window.location.href = 'login.html'; return; }
        
        // Determine Edit Rights
        // Admin can always edit. User can edit ONLY if status is Pending.
        getDoc(doc(db, 'users', user.uid)).then(uSnap => {
           const role = uSnap.exists() ? uSnap.data().role : 'user';
           const isOwner = orderData.userId === user.uid;
           
           if (role !== 'admin' && !isOwner) {
             window.location.href = 'orders.html'; // Unauthorized
             return;
           }
           
           // Admin Button Show
           if (role === 'admin') {
             document.getElementById('nav-admin')?.classList.remove('hidden');
           }

           // Edit Logic
           canEdit = (role === 'admin') || (isOwner && (orderData.status === 'Pending'));
           
           render();
           container.classList.remove('hidden');
           emptyEl.classList.add('hidden');

           // Populate Dropdown if editable
           if (canEdit) {
             controlsDiv.classList.remove('hidden');
             saveBtn.classList.remove('hidden'); // Show save button if editable
             populateSelect();
           }
        });
      });

    } catch (e) {
      console.error(e);
      showEmpty('Error loading order: ' + e.message);
    }
  }

  function populateSelect() {
    addSelect.innerHTML = '<option value="">Select Product...</option>';
    products.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      // Show variants if any
      const variants = p.options && p.options.length ? p.options : [{ price: p.price }];
      // For simplicity, just adding base product. 
      // A full implementation would allow selecting variants.
      opt.textContent = p.title;
      opt.setAttribute('data-price', p.price);
      addSelect.appendChild(opt);
    });
  }

  function showEmpty(msg) {
    emptyEl.textContent = msg;
    emptyEl.classList.remove('hidden');
    container.classList.add('hidden');
  }

  // RENDER UI
  function render() {
    // Meta
    idDisplay.textContent = `Order #${orderId.slice(-6).toUpperCase()}`;
    if (orderData.createdAt) {
      dateDisplay.textContent = `Date: ${new Date(orderData.createdAt.seconds * 1000).toLocaleDateString()}`;
    }
    
    // Status Color
    const st = orderData.status || 'Pending';
    statusBadge.textContent = st;
    statusBadge.className = `inline-block px-3 py-1 text-xs font-bold rounded uppercase tracking-wide ${
       st === 'Delivered' ? 'bg-green-100 text-green-800' :
       st === 'Cancelled' ? 'bg-red-100 text-red-800' :
       'bg-blue-100 text-blue-800'
    }`;

    // Customer
    const cust = orderData.customer || {};
    customerInfo.innerHTML = `
      <div class="font-bold text-gray-900">${cust.name || 'N/A'}</div>
      <div>${cust.phone || ''}</div>
      <div>${cust.address || ''}</div>
    `;

    // Items
    itemsBody.innerHTML = '';
    let subtotal = 0;

    items.forEach((item, index) => {
      const lineTotal = (item.price || 0) * (item.qty || 1);
      subtotal += lineTotal;
      
      const tr = document.createElement('tr');
      tr.className = 'border-b last:border-0 hover:bg-gray-50 transition';
      tr.innerHTML = `
        <td class="py-3 pr-2">
          <div class="font-medium text-gray-900">${item.title || 'Product'}</div>
          <div class="text-xs text-gray-500">${item.variant || ''}</div>
        </td>
        <td class="py-3 text-center">${item.qty}</td>
        <td class="py-3 text-right">${formatMoney(item.price)}</td>
        <td class="py-3 text-right font-medium">${formatMoney(lineTotal)}</td>
        <td class="py-3 text-right no-print">
          ${canEdit ? `<button class="text-red-500 hover:text-red-700 p-1" data-idx="${index}">&times;</button>` : ''}
        </td>
      `;
      itemsBody.appendChild(tr);
    });

    // Remove buttons handler
    if (canEdit) {
      itemsBody.querySelectorAll('button[data-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          items.splice(idx, 1);
          hasChanges = true;
          saveBtn.textContent = 'Save Changes*';
          render();
        });
      });
    }

    // Totals
    const delivery = Number(orderData.deliveryFee || 0);
    const total = subtotal + delivery;
    
    subtotalEl.textContent = formatMoney(subtotal);
    deliveryEl.textContent = formatMoney(delivery);
    totalEl.textContent = formatMoney(total);
  }

  // ADD ITEM
  addBtn.addEventListener('click', () => {
    const pid = addSelect.value;
    if (!pid) return;
    
    const p = products.find(x => x.id === pid);
    const qty = parseInt(addQty.value) || 1;
    
    if (p) {
      items.push({
        id: p.id,
        title: p.title,
        price: Number(p.price || 0),
        qty: qty,
        variant: '' // Default variant for admin add
      });
      hasChanges = true;
      saveBtn.textContent = 'Save Changes*';
      render();
      addSelect.value = '';
      addQty.value = 1;
    }
  });

  // SAVE CHANGES
  saveBtn.addEventListener('click', async () => {
    if (!hasChanges) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      // Recalculate totals
      const sub = items.reduce((sum, i) => sum + (i.price * i.qty), 0);
      const del = Number(orderData.deliveryFee || 0);
      
      await updateDoc(doc(db, 'orders', orderId), {
        items: items,
        subtotal: sub,
        total: sub + del,
        updatedAt: serverTimestamp()
      });
      
      hasChanges = false;
      saveBtn.textContent = 'Saved';
      setTimeout(() => { saveBtn.textContent = 'Save Changes'; saveBtn.disabled = false; }, 2000);
      
      // Update local data
      orderData.items = items;
      render();

    } catch (e) {
      alert('Error saving: ' + e.message);
      saveBtn.disabled = false;
    }
  });

  // PRINT
  printBtn.addEventListener('click', () => {
    window.print();
  });

  // Start
  loadData();

})();
