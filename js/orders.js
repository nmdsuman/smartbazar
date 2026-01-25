import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

(function init() {
  initAuthHeader();
  const listEl = document.getElementById('orders-list');
  const emptyEl = document.getElementById('orders-empty');

  const params = new URLSearchParams(window.location.search);
  const placed = params.get('placed');
  if (placed) {
    const banner = document.createElement('div');
    banner.className = 'mb-6 p-4 rounded-lg bg-green-100 border-l-4 border-green-500 text-green-700 shadow-sm';
    banner.innerHTML = '<p class="font-bold">সফল হয়েছে!</p><p class="text-sm">আপনার অর্ডারটি সঠিকভাবে গ্রহণ করা হয়েছে।</p>';
    listEl.parentElement.insertBefore(banner, listEl);
    
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
        div.className = 'group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-all duration-200 mb-4';
        
        const items = (o.items || []).map(i => `${i.title} ×${i.qty}`).join(', ');
        const when = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        const status = (o.status || 'Pending');
        
        const badgeClass = {
          'Pending': 'bg-amber-100 text-amber-700',
          'Processing': 'bg-blue-100 text-blue-700',
          'Shipped': 'bg-purple-100 text-purple-700',
          'Delivered': 'bg-green-100 text-green-700',
          'Cancelled': 'bg-red-100 text-red-700'
        }[status] || 'bg-gray-100 text-gray-700';

        const thumbs = (o.items||[]).slice(0,4).map(i => `
          <div class="w-10 h-10 rounded-lg border border-gray-100 bg-gray-50 flex items-center justify-center overflow-hidden">
            <img src="${i.image||''}" alt="" class="w-full h-full object-cover"/>
          </div>
        `).join('');

        div.innerHTML = `
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-1">
                <span class="text-lg font-bold text-gray-900">Order #${d.id.slice(-6).toUpperCase()}</span>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeClass}">${status}</span>
              </div>
              <div class="text-sm text-gray-500 mb-3">${when}</div>
              <div class="flex items-center gap-2 mb-3">${thumbs}</div>
              <p class="text-sm text-gray-600 line-clamp-1 italic">${items}</p>
            </div>
            
            <div class="flex md:flex-col items-center md:items-end justify-between border-t md:border-t-0 pt-4 md:pt-0">
              <div class="text-right">
                <p class="text-xs text-gray-400 uppercase tracking-wider font-semibold">Total Amount</p>
                <p class="text-xl font-black text-blue-600">৳ ${Number(o.total || 0).toLocaleString('en-IN')}</p>
              </div>
              <a href="view.html?id=${d.id}" class="mt-3 inline-flex items-center px-5 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors">
                View Details
              </a>
            </div>
          </div>
        `;
        frag.appendChild(div);
      });
      listEl.appendChild(frag);
    });
  });
})();
