import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { collection, onSnapshot, query, where, doc, updateDoc, runTransaction } from 'firebase/firestore';

// Show success message based on URL parameters
function showSuccessMessage() {
  const params = new URLSearchParams(window.location.search);
  const successType = params.get('success');
  
  if (successType) {
    const successContainer = document.getElementById('success-message');
    if (successContainer) {
      let message = '';
      let bgColor = '';
      let borderColor = '';
      let textColor = '';
      
      if (successType === 'cod') {
        message = '🎉 Order placed successfully! Your order has been confirmed and will be delivered soon.';
        bgColor = 'bg-green-50';
        borderColor = 'border-green-200';
        textColor = 'text-green-800';
      } else if (successType === 'bkash') {
        message = '💳 Payment submitted successfully! Admin will verify your bKash payment shortly.';
        bgColor = 'bg-blue-50';
        borderColor = 'border-blue-200';
        textColor = 'text-blue-800';
      }
      
      if (message) {
        successContainer.className = `mb-6 p-4 rounded-lg border ${bgColor} ${borderColor}`;
        successContainer.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="flex-shrink-0">
              <svg class="w-6 h-6 ${textColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <div class="flex-1">
              <p class="${textColor} font-medium">${message}</p>
            </div>
            <button onclick="this.parentElement.parentElement.classList.add('hidden')" class="flex-shrink-0">
              <svg class="w-5 h-5 ${textColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        `;
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
          successContainer.classList.add('hidden');
        }, 10000);
        
        // Clean URL
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    }
  }
}

// Call success message function when page loads
document.addEventListener('DOMContentLoaded', showSuccessMessage);

// Cancel order function
async function cancelOrder(orderId, orderData) {
  if (!confirm('Are you sure you want to cancel this order? This action cannot be undone.')) {
    return;
  }
  
  try {
    await runTransaction(db, async (tx) => {
      const orderRef = doc(db, 'orders', orderId);
      const ordSnap = await tx.get(orderRef);
      if (!ordSnap.exists()) throw new Error('Order not found');
      
      const ord = ordSnap.data() || {};
      const prevStatus = ord.status || 'Pending';
      
      // Only allow cancellation if order is still pending
      if (prevStatus !== 'Pending') {
        throw new Error('Only pending orders can be cancelled');
      }
      
      // Add items back to stock
      const items = Array.isArray(ord.items) ? ord.items : [];
      for (const it of items) {
        const pid = it.id;
        const qty = Number(it.qty || 0);
        if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
        
        const prodRef = doc(db, 'products', pid);
        const prodSnap = await tx.get(prodRef);
        if (!prodSnap.exists()) continue;
        
        const cur = Number(prodSnap.data().stock || 0);
        tx.update(prodRef, { stock: cur + qty });
      }
      
      // Update order status
      tx.update(orderRef, { 
        status: 'Cancelled',
        cancelledAt: new Date(),
        cancelledBy: 'customer'
      });
    });
    
    // Show success message
    const successBanner = document.createElement('div');
    successBanner.className = 'mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800';
    successBanner.textContent = 'Order cancelled successfully.';
    listEl.parentElement.insertBefore(successBanner, listEl);
    
    // Remove banner after 5 seconds
    setTimeout(() => {
      if (successBanner.parentNode) {
        successBanner.parentNode.removeChild(successBanner);
      }
    }, 5000);
    
  } catch (err) {
    alert('Failed to cancel order: ' + err.message);
  }
}

(function init() {
  initAuthHeader();
  const listEl = document.getElementById('orders-list');
  const emptyEl = document.getElementById('orders-empty');
  // Success banner if redirected after checkout
  const params = new URLSearchParams(window.location.search);
  const placed = params.get('placed');
  if (placed) {
    const banner = document.createElement('div');
    banner.className = 'mb-4 p-3 rounded bg-green-50 border border-green-200 text-green-800';
    banner.textContent = 'Order placed successfully.';
    listEl.parentElement.insertBefore(banner, listEl);
    // Clean query param to avoid showing again on refresh
    const url = new URL(window.location.href);
    url.searchParams.delete('placed');
    window.history.replaceState({}, '', url);
  }

  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.replace('login.html');
      return;
    }
    const q = query(collection(db, 'orders'), where('userId', '==', user.uid));
    onSnapshot(q, (snap) => {
      listEl.innerHTML = '';
      if (snap.empty) {
        emptyEl.classList.remove('hidden');
        return;
      }
      emptyEl.classList.add('hidden');
      const docs = [];
      snap.forEach(d => docs.push(d));
      docs.sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
      const frag = document.createDocumentFragment();
      docs.forEach(d => {
        const o = d.data();
        const div = document.createElement('div');
        div.className = 'bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden order-card';
        const items = (o.items || []).map(i => `${i.title} ×${i.qty}`).join(', ');
        const when = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        }) : '';
        const status = (o.status || 'Pending');
        const badgeClass = {
          'Pending': 'bg-amber-50 text-amber-700 border-amber-200',
          'Processing': 'bg-blue-50 text-blue-700 border-blue-200',
          'Shipped': 'bg-indigo-50 text-indigo-700 border-indigo-200',
          'Delivered': 'bg-emerald-50 text-emerald-700 border-emerald-200',
          'Cancelled': 'bg-red-50 text-red-700 border-red-200'
        }[status] || 'bg-gray-50 text-gray-700 border-gray-200';
        // thumbnails preview (first 3)
        const thumbs = (o.items||[]).slice(0,3).map(i => `<img src="${i.image||''}" alt="" class="w-12 h-12 object-contain bg-gray-50 rounded-lg border border-gray-200"/>`).join('');
        div.innerHTML = `
          <div class="p-4 sm:p-6">
            <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-3 flex-wrap mb-3">
                  <div class="text-lg font-bold text-gray-900 order-title">Order #${d.id.slice(-6)}</div>
                  <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${badgeClass}">
                    ${status}
                  </span>
                  <span class="text-sm text-gray-500">${when}</span>
                </div>
                
                <div class="flex items-center gap-2 mb-3">${thumbs}</div>
                
                <div class="text-sm text-gray-700 leading-relaxed mb-4">${items}</div>
                
                <div class="flex items-center gap-4 text-sm text-gray-500">
                  <div class="flex items-center gap-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
                    </svg>
                    ${(o.items || []).length} items
                  </div>
                </div>
              </div>
              
              <div class="text-left lg:text-right min-w-[140px]">
                <div class="text-sm text-gray-500 mb-1">Total</div>
                <div class="text-2xl font-bold text-gray-900 mb-3 order-price">৳${Number(o.total || 0).toFixed(2)}</div>
                <div class="flex flex-col sm:flex-row gap-2">
                  <a class="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors" href="view.html?id=${d.id}">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                    </svg>
                    <span class="hidden xs:inline">View Details</span>
                    <span class="xs:hidden">View</span>
                  </a>
                  ${status === 'Pending' ? `
                    <button class="cancel-order-btn inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors" data-order-id="${d.id}" data-order-data='${JSON.stringify(o)}'>
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                      <span class="hidden xs:inline">Cancel Order</span>
                      <span class="xs:hidden">Cancel</span>
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>
          </div>
        `;
        frag.appendChild(div);
      });
      listEl.appendChild(frag);
      
      // Add event listeners for cancel buttons
      listEl.querySelectorAll('.cancel-order-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const orderId = btn.getAttribute('data-order-id');
          const orderData = JSON.parse(btn.getAttribute('data-order-data'));
          await cancelOrder(orderId, orderData);
        });
      });
    });
  });
})();
