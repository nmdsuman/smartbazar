import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

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
          <div class="p-6">
            <div class="flex items-start justify-between gap-4">
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
              
              <div class="text-right min-w-[140px]">
                <div class="text-sm text-gray-500 mb-1">Total</div>
                <div class="text-2xl font-bold text-gray-900 mb-3 order-price">৳${Number(o.total || 0).toFixed(2)}</div>
                <a class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors" href="view.html?id=${d.id}">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                  </svg>
                  View Details
                </a>
              </div>
            </div>
          </div>
        `;
        frag.appendChild(div);
      });
      listEl.appendChild(frag);
    });
  });
})();
