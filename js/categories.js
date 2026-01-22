import { db, auth } from './firebase-config.js';
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs, doc, updateDoc, deleteDoc, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';

const catNameEl = document.getElementById('cat-name');
const catAddBtn = document.getElementById('cat-add');
const catMsgEl = document.getElementById('cat-msg');
const catListEl = document.getElementById('cat-list');
const addCatSelect = document.getElementById('add-category');
const addSubcatSelect = document.getElementById('add-subcategory');

let categoriesCache = [];

function setCatMsg(text, ok=true){ if (!catMsgEl) return; catMsgEl.textContent = text; catMsgEl.className = `text-sm mt-2 ${ok?'text-green-700':'text-red-700'}`; }

function slugify(s){ return String(s||'').trim(); }

async function loadCategories(){
  try {
    const snap = await getDocs(query(collection(db,'categories'), orderBy('name','asc')));
    categoriesCache = snap.docs.map(d=>({ id: d.id, ...d.data(), subcategories: Array.isArray(d.data().subcategories)? d.data().subcategories: [] }));
    renderCatList();
    populateAddFormSelects();
    try {
      window.categoriesCache = categoriesCache.slice();
      window.dispatchEvent(new CustomEvent('CategoriesUpdated'));
    } catch {}
  } catch (e) { setCatMsg('Failed to load categories', false); }
}

function renderCatList(){
  if (!catListEl) return;
  catListEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  categoriesCache.forEach(c => {
    const wrap = document.createElement('div');
    wrap.className = 'border rounded p-3';
    const subsHtml = c.subcategories.map(sc=>`<span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-100 mr-2 mb-2">${sc}<button data-sub="${sc}" class="sub-del text-red-600">×</button></span>`).join('');
    wrap.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="font-medium">${c.name}</div>
        <button data-del class="px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 text-sm">Delete</button>
      </div>
      <div class="flex items-center gap-2 mb-2">
        <input data-sub-name type="text" placeholder="Add subcategory" class="border rounded px-2 py-1 text-sm"/>
        <button data-sub-add class="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm">Add</button>
      </div>
      <div class="flex flex-wrap">${subsHtml}</div>
    `;
    // Delete category
    wrap.querySelector('[data-del]')?.addEventListener('click', async ()=>{
      if (!confirm('Delete this category?')) return;
      try { await deleteDoc(doc(db,'categories', c.id)); setCatMsg('Deleted'); loadCategories(); } catch(e){ setCatMsg('Delete failed: '+e.message, false); }
    });
    // Add subcategory
    wrap.querySelector('[data-sub-add]')?.addEventListener('click', async ()=>{
      const input = wrap.querySelector('[data-sub-name]');
      const val = String(input?.value||'').trim(); if (!val) return;
      try{ await updateDoc(doc(db,'categories', c.id), { subcategories: arrayUnion(val) }); setCatMsg('Added'); input.value=''; loadCategories(); }catch(e){ setCatMsg('Failed: '+e.message, false); }
    });
    // Delete subcategory
    wrap.querySelectorAll('.sub-del').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const name = btn.getAttribute('data-sub'); if (!name) return;
        try{ await updateDoc(doc(db,'categories', c.id), { subcategories: arrayRemove(name) }); setCatMsg('Removed'); loadCategories(); }catch(e){ setCatMsg('Remove failed: '+e.message, false); }
      });
    });
    frag.appendChild(wrap);
  });
  catListEl.appendChild(frag);
}

function populateAddFormSelects(selectedCat=null, selectedSub=null){
  if (!addCatSelect || !addSubcatSelect) return;
  const opts = categoriesCache.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  addCatSelect.innerHTML = '<option value="">— Select —</option>' + opts;
  // Set selected
  if (selectedCat){ addCatSelect.value = selectedCat; }
  // Build subcats for selected cat
  const catObj = categoriesCache.find(c=> c.name === (addCatSelect.value||''));
  const subs = (catObj?.subcategories || []).map(s=>`<option value="${s}">${s}</option>`).join('');
  addSubcatSelect.innerHTML = '<option value="">— Optional —</option>' + subs;
  if (selectedSub){ addSubcatSelect.value = selectedSub; }
}

addCatSelect?.addEventListener('change', ()=>{
  populateAddFormSelects(addCatSelect.value || '', '');
});

catAddBtn?.addEventListener('click', async ()=>{
  const name = slugify(catNameEl?.value||'');
  if (!name){ setCatMsg('Enter a category name', false); return; }
  try {
    // Use a deterministic id based on name to prevent duplicates
    const id = name.toLowerCase().replace(/\s+/g,'-');
    await setDoc(doc(db,'categories', id), { name, subcategories: [], createdAt: serverTimestamp(), by: auth.currentUser?auth.currentUser.uid:null });
    setCatMsg('Added'); catNameEl.value='';
    loadCategories();
  } catch (e) { setCatMsg('Add failed: '+e.message, false); }
});

// Expose API for other modules
window.Categories = {
  load: loadCategories,
  getAll: ()=> categoriesCache.slice(),
  populateSelects: (selectedCat, selectedSub)=> populateAddFormSelects(selectedCat||'', selectedSub||'')
};

// init
loadCategories();
