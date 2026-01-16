import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';

(function init() {
  initAuthHeader();
  const listEl = document.getElementById('orders-list');
  const emptyEl = document.getElementById('orders-empty');

  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.replace('login.html');
      return;
    }
    const q = query(
      collection(db, 'orders'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    onSnapshot(q, (snap) => {
      listEl.innerHTML = '';
      if (snap.empty) {
        emptyEl.classList.remove('hidden');
        return;
      }
      emptyEl.classList.add('hidden');
      const frag = document.createDocumentFragment();
      snap.forEach(d => {
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
            <div class="font-semibold">৳${Number(o.total || 0).toFixed(2)}</div>
          </div>
        `;
        frag.appendChild(div);
      });
      listEl.appendChild(frag);
    });
  });
})();
