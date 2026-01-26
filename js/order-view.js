import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc, serverTimestamp } from 'firebase/firestore';

(function init() {
  initAuthHeader();
  
  // Elements
  const container = document.getElementById('order-view');
  const emptyEl = document.getElementById('ov-empty');
  const itemsBody = document.getElementById('ov-items');
  const saveBtn = document.getElementById('ov-save');
  const printBtn = document.getElementById('ov-print');
  const addMoreBtn = document.getElementById('ov-add-more');
  
  // Modal Elements
  const modal = document.getElementById('product-modal');
  const modalClose = document.getElementById('pm-close');
  const modalGrid = document.getElementById('pm-grid');
  const modalSearch = document.getElementById('pm-search');

  // State
  let orderId = new URLSearchParams(window.location.search).get('id');
  let orderData = null;
  let items = [];
  let products = []; // Full product list
  let canEdit = false;
  let hasChanges = false;
  let isAdmin = false;

  const formatMoney = (amount) => `৳${Number(amount || 0).toFixed(2)}`;

  // Load Data
  async function loadData() {
    if (!orderId) { showEmpty('No Order ID.'); return; }
    
    emptyEl.textContent = 'Loading details...';
    emptyEl.classList.remove('hidden');
    container.classList.add('hidden');

    try {
      // 1. Get All Products (for the popup)
      const prodSnap = await getDocs(query(collection(db, 'products'), orderBy('createdAt', 'desc')));
      products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2. Get Order
      const snap = await getDoc(doc(db, 'orders', orderId));
      if (!snap.exists()) { showEmpty('Order not found.'); return; }
      
      orderData = snap.data();
      items = Array.isArray(orderData.items) ? [...orderData.items] : [];

      // 3. Auth Check
      auth.onAuthStateChanged(user => {
        if (!user) { window.location.href = 'login.html'; return; }
        
        getDoc(doc(db, 'users', user.uid)).then(uSnap => {
           const role = uSnap.exists() ? uSnap.data().role : 'user';
           isAdmin = (role === 'admin');
           const isOwner = orderData.userId === user.uid;
           const isPending = (orderData.status === 'Pending');
           
           if (!isAdmin && !isOwner) {
             window.location.href = 'orders.html'; return;
           }

           if (isAdmin) document.getElementById('nav-admin')?.classList.remove('hidden');

           // Edit Permission: Admin OR (Owner AND Pending)
           canEdit = isAdmin || (isOwner && isPending);
           
           render();
           container.classList.remove('hidden');
           emptyEl.classList.add('hidden');
        });
      });

    } catch (e) {
      console.error(e);
      showEmpty('Error: ' + e.message);
    }
  }

  function showEmpty(msg) {
    emptyEl.textContent = msg;
    emptyEl.classList.remove('hidden');
    container.classList.add('hidden');
  }

  // RENDER MAIN VIEW
  function render() {
    // 1. Meta Data
    document.getElementById('ov-id-display').textContent = `Order #${orderId.slice(-6).toUpperCase()}`;
    if (orderData.createdAt) {
      document.getElementById('ov-date').textContent = `Date: ${new Date(orderData.createdAt.seconds * 1000).toLocaleDateString()}`;
    }
    
    const st = orderData.status || 'Pending';
    const sBadge = document.getElementById('ov-status');
    sBadge.textContent = st;
    sBadge.className = `inline-block px-3 py-1 text-xs font-bold rounded uppercase tracking-wide ${
       st === 'Delivered' ? 'bg-green-100 text-green-800' :
       st === 'Cancelled' ? 'bg-red-100 text-red-800' :
       'bg-blue-100 text-blue-800'
    }`;

    // 2. Customer
    const cust = orderData.customer || {};
    document.getElementById('ov-customer-info').innerHTML = `
      <div class="font-bold text-gray-900 text-lg">${cust.name || 'Unknown'}</div>
      <div class="mt-1">${cust.phone || ''}</div>
      <div class="mt-1">${cust.address || ''}</div>
    `;

    // 3. Items List
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
          ${canEdit ? `<button class="text-red-500 hover:text-red-700 p-2 rounded hover:bg-red-50 transition" data-idx="${index}" title="Remove">&times;</button>` : ''}
        </td>
      `;
      itemsBody.appendChild(tr);
    });

    // Remove Item Handler
    if (canEdit) {
      itemsBody.querySelectorAll('button[data-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.target.dataset.idx);
          if(confirm('Remove this item?')){
            items.splice(idx, 1);
            markChanged();
            render();
          }
        });
      });
    }

    // 4. Totals
    const delivery = Number(orderData.deliveryFee || 0);
    const total = subtotal + delivery;
    
    document.getElementById('ov-subtotal').textContent = formatMoney(subtotal);
    document.getElementById('ov-delivery').textContent = formatMoney(delivery);
    document.getElementById('ov-total').textContent = formatMoney(total);

    // 5. Button Visibility
    // Admin gets Print, Everyone who canEdit gets "Add Items"
    if (isAdmin) {
      printBtn.classList.remove('hidden');
    } else {
      printBtn.classList.add('hidden'); // Hide print for users
    }

    if (canEdit) {
      addMoreBtn.classList.remove('hidden');
      if (hasChanges) saveBtn.classList.remove('hidden');
    } else {
      addMoreBtn.classList.add('hidden');
      saveBtn.classList.add('hidden');
    }
  }

  function markChanged() {
    hasChanges = true;
    saveBtn.textContent = 'Save Changes*';
    saveBtn.classList.remove('hidden');
  }

  // --- MODAL & ADD PRODUCT LOGIC ---

  addMoreBtn.addEventListener('click', () => {
    renderModalProducts(products);
    modal.classList.remove('hidden');
  });

  modalClose.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  // Render cards in popup
  function renderModalProducts(list) {
    modalGrid.innerHTML = '';
    if (list.length === 0) {
      modalGrid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-10">No products found.</div>';
      return;
    }

    list.forEach(p => {
      // Image fallback
      const img = p.image || 'https://via.placeholder.com/150?text=No+Image';
      
      const div = document.createElement('div');
      div.className = 'bg-white rounded-lg shadow-sm border overflow-hidden hover:shadow-md transition flex flex-col h-full';
      div.innerHTML = `
        <div class="h-32 bg-gray-200 w-full relative">
          <img src="${img}" class="w-full h-full object-cover">
        </div>
        <div class="p-3 flex flex-col flex-1">
          <h4 class="font-semibold text-sm text-gray-800 line-clamp-2 mb-1">${p.title}</h4>
          <div class="text-green-600 font-bold text-sm mb-3">${formatMoney(p.price)}</div>
          
          <div class="mt-auto">
             <button class="add-to-order-btn w-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-200 py-1.5 rounded text-sm font-medium transition" 
               data-id="${p.id}">
               + Add
             </button>
          </div>
        </div>
      `;
      
      // Add Click Handler with variant selection
      div.querySelector('.add-to-order-btn').addEventListener('click', function() {
        const btn = this;
        const product = p;
        
        // Check if product has variants/options
        if (Array.isArray(product.options) && product.options.length > 0) {
          // Show variant selection modal
          showVariantSelection(product, btn);
        } else {
          // Direct add for products without variants
          addProductToOrder(product, null, btn);
        }
      });

      modalGrid.appendChild(div);
    });
  }

  // Search in Modal
  modalSearch.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = products.filter(p => p.title.toLowerCase().includes(term));
    renderModalProducts(filtered);
  });

  // Variant Selection Modal
  function showVariantSelection(product, originalBtn) {
    // Create variant selection overlay
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden">
        <div class="p-4 border-b">
          <h3 class="font-bold text-lg">Select Variant</h3>
          <p class="text-sm text-gray-600">${product.title}</p>
        </div>
        <div class="p-4 max-h-60 overflow-y-auto">
          ${product.options.map((opt, idx) => `
            <div class="variant-option border rounded-lg p-3 mb-2 cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition" data-idx="${idx}">
              <div class="flex justify-between items-center">
                <div>
                  <div class="font-medium">${opt.label}</div>
                  <div class="text-sm text-gray-500">${formatMoney(opt.price)}</div>
                </div>
                <div class="flex items-center gap-2">
                  <input type="number" min="1" value="1" class="w-16 border rounded px-2 py-1 text-center variant-qty">
                  <button class="bg-blue-600 text-white px-3 py-1 rounded text-sm add-variant-btn">Add</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="p-4 border-t">
          <button class="w-full bg-gray-200 text-gray-700 py-2 rounded-lg cancel-variant-btn">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Add event listeners
    overlay.querySelector('.cancel-variant-btn').addEventListener('click', () => {
      overlay.remove();
    });

    overlay.querySelectorAll('.add-variant-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const optionDiv = e.target.closest('.variant-option');
        const idx = parseInt(optionDiv.dataset.idx);
        const qty = parseInt(optionDiv.querySelector('.variant-qty').value) || 1;
        const selectedOption = product.options[idx];
        
        addProductToOrder(product, selectedOption, originalBtn, qty);
        overlay.remove();
      });
    });

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }

  function addProductToOrder(product, variant, btn, qty = 1) {
    // Animation
    const originalText = btn.textContent;
    btn.textContent = 'Added';
    btn.classList.add('bg-green-600', 'text-white', 'border-green-600');
    setTimeout(() => {
       btn.textContent = originalText;
       btn.classList.remove('bg-green-600', 'text-white', 'border-green-600');
    }, 1000);

    // Add to items list
    items.push({
      id: product.id,
      title: product.title,
      price: variant ? Number(variant.price || 0) : Number(product.price || 0),
      qty: qty,
      variant: variant ? variant.label : ''
    });
    markChanged();
    render(); // Update background table
  }

  // SAVE TO FIREBASE
  saveBtn.addEventListener('click', async () => {
    if (!hasChanges) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const sub = items.reduce((sum, i) => sum + (i.price * i.qty), 0);
      const del = Number(orderData.deliveryFee || 0);
      
      await updateDoc(doc(db, 'orders', orderId), {
        items: items,
        subtotal: sub,
        total: sub + del,
        updatedAt: serverTimestamp()
      });
      
      hasChanges = false;
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { 
        saveBtn.textContent = 'Save Changes'; 
        saveBtn.disabled = false;
        saveBtn.classList.add('hidden'); // Hide until next change
      }, 2000);
      
      orderData.items = items;
      render();

    } catch (e) {
      alert('Error saving: ' + e.message);
      saveBtn.disabled = false;
    }
  });

  loadData();
})();
