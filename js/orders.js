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
        div.className = 'border rounded p-4';
        const items = (o.items || []).map(i => `${i.title} x${i.qty}`).join(', ');
        const when = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : '';
        div.innerHTML = `
          <div class="flex items-start justify-between">
            <div>
              <div class="font-semibold">Order #${d.id.slice(-6)} · <span class="text-sm text-gray-600">${when}</span></div>
              <div class="text-sm text-gray-700">${items}</div>
              <div class="text-sm text-gray-600">Status: ${o.status || 'Pending'}</div>
            </div>
            <div class="text-right space-y-2">
              <div class="font-semibold">৳${Number(o.total || 0).toFixed(2)}</div>
              <a class="inline-block text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200" href="view.html?id=${d.id}">View</a>
            </div>
          </div>
        `;
        frag.appendChild(div);
      });
      listEl.appendChild(frag);
    });
  });
})();
