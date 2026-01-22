import { db } from '../firebase-config.js';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

(function(){
  const ordersListEl = document.getElementById('orders-list');
  const ordersEmptyEl = document.getElementById('orders-empty');
  const ordersFilter = document.getElementById('orders-filter');
  const ordersBadge = document.getElementById('orders-badge');

  let lastOrders = [];

  function drawOrders(){
    if (!ordersListEl) return;
    ordersListEl.innerHTML = '';
    const filterVal = ordersFilter?.value || 'All';
    let subset = lastOrders.filter(o => filterVal === 'All' || o.data.status === filterVal);
    if (ordersEmptyEl) ordersEmptyEl.classList.toggle('hidden', subset.length > 0);
    const frag = document.createDocumentFragment();
    subset.forEach(o => {
      const row = document.createElement('div');
      row.className = 'border rounded p-3 bg-white flex items-start justify-between gap-3';
      const itemsCount = Array.isArray(o.data.items) ? o.data.items.length : 0;
      row.innerHTML = `
        <div class="min-w-0">
          <div class="font-medium">${o.data.name || 'Customer'}</div>
          <div class="text-xs text-gray-600 truncate">${o.data.phone || ''} · ${o.data.address || ''}</div>
          <div class="text-xs text-gray-500">Items: ${itemsCount} · Status: ${o.data.status || 'Pending'}</div>
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <button class="view px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm">View</button>
        </div>`;
      frag.appendChild(row);
    });
    ordersListEl.appendChild(frag);
    if (ordersBadge) {
      const pending = lastOrders.filter(o=> (o.data.status||'') === 'Pending').length;
      if (pending > 0) { ordersBadge.textContent = String(pending); ordersBadge.classList.remove('hidden'); }
      else { ordersBadge.textContent = '0'; ordersBadge.classList.add('hidden'); }
    }
  }

  function liveOrders(){
    try {
      const oq = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      onSnapshot(oq, (snap) => {
        lastOrders = snap.docs.map(d => ({ id: d.id, data: d.data() }));
        drawOrders();
      });
    } catch {}
  }

  function maybeRun(){
    const sec = location.hash.replace('#','');
    if (sec === 'orders-section') liveOrders();
  }

  window.addEventListener('hashchange', ()=>{ if (location.hash.replace('#','')==='orders-section') drawOrders(); });
  if (ordersFilter) ordersFilter.addEventListener('change', drawOrders);

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', maybeRun, { once: true }); } else { maybeRun(); }
})();
