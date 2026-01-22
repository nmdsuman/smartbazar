import { db } from '../firebase-config.js';
import { collection, onSnapshot, query, orderBy, updateDoc, doc } from 'firebase/firestore';

(function(){
  const listEl = document.getElementById('admin-products');
  const emptyEl = document.getElementById('admin-empty');
  const form = document.getElementById('add-product-form');
  const addSectionTitle = document.getElementById('add-section-title');
  const addSubmitBtn = document.getElementById('add-submit-btn');
  const addCancelEditBtn = document.getElementById('add-cancel-edit');

  if (!listEl) return;

  function showSection(id){
    try {
      const ids = ['add','products','orders-section','shipping','site','files','chat','notes'];
      const key = ids.includes(id) ? id : 'products';
      ids.forEach(k=>{
        const el = document.getElementById(k);
        if (!el) return;
        if (k===key) el.classList.remove('hidden'); else el.classList.add('hidden');
      });
    } catch {}
  }

  function renderProducts(){
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snap) => {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.toggle('hidden', !snap.empty);
      if (snap.empty) return;
      const frag = document.createDocumentFragment();
      snap.forEach(d => {
        const data = d.data();
        const card = document.createElement('div');
        card.className = 'border rounded-lg bg-white overflow-hidden flex flex-col';
        card.innerHTML = `
          <img src="${data.image}" alt="${data.title}" class="h-44 w-full object-contain bg-white">
          <div class="p-4 flex-1 flex flex-col">
            <h3 class="font-semibold text-lg mb-1">${data.title}</h3>
            <p class="text-sm text-gray-600 line-clamp-2 mb-3">${data.description || ''}</p>
            <div class="mt-auto space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-blue-700 font-semibold">৳${Number(data.price).toFixed(2)}${data.weight ? ` · ${data.weight}` : ''}${data.size ? ` · ${data.size}` : ''}</span>
                <span class="text-sm ${data.active === false ? 'text-red-600' : 'text-green-700'}">${data.active === false ? 'Inactive' : 'Active'}</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span>Stock: <strong>${Number(data.stock || 0)}</strong></span>
                <div class="flex items-center gap-2">
                  <button class="toggle-active bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">${data.active === false ? 'Activate' : 'Deactivate'}</button>
                  <button class="edit bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">Edit</button>
                  <button class="delete bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700">Delete</button>
                </div>
              </div>
            </div>
          </div>`;
        card.querySelector('.delete')?.addEventListener('click', async ()=>{
          if (!confirm('Delete this product?')) return;
          try { await updateDoc(doc(db, 'products', d.id), { deleted: true }); } catch {}
        });
        card.querySelector('.toggle-active')?.addEventListener('click', async ()=>{
          try { await updateDoc(doc(db, 'products', d.id), { active: data.active === false ? true : false }); } catch {}
        });
        card.querySelector('.edit')?.addEventListener('click', ()=>{
          try {
            if (!form) { location.hash = '#add'; showSection('add'); return; }
            if (addSectionTitle) addSectionTitle.textContent = 'Edit Product';
            if (addSubmitBtn) addSubmitBtn.textContent = 'Save Changes';
            if (addCancelEditBtn) addCancelEditBtn.classList.remove('hidden');
            if (form.title) form.title.value = data.title || '';
            if (form.price) form.price.value = data.price || 0;
            const cat = form.querySelector('[name="category"]'); if (cat) cat.value = data.category || '';
            if (form.size) form.size.value = data.size || '';
            if (form.description) form.description.value = data.description || '';
            if (form.stock) form.stock.value = Number(data.stock || 0);
            if (form.active) form.active.checked = data.active === false ? false : true;
            // simple trigger to update previews if listeners exist
            form.dispatchEvent(new Event('input', { bubbles: true }));
            location.hash = '#add';
            showSection('add');
          } catch {}
        });
        frag.appendChild(card);
      });
      listEl.appendChild(frag);
    });
  }

  renderProducts();
})();
