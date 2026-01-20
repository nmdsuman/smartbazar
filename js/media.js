import { auth, db } from './firebase-config.js';
import { requireAdmin } from './auth.js';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
  query,
  orderBy
} from 'firebase/firestore';

requireAdmin();

const IMGBB_API_KEY = '462884d7f63129dede1b67d612e66ee6';

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function uploadToImgbb(file) {
  const b64 = await fileToBase64(file);
  const fd = new FormData();
  fd.append('image', b64);
  const res = await fetch(`https://api.imgbb.com/1/upload?expiration=0&key=${encodeURIComponent(IMGBB_API_KEY)}`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  const json = await res.json();
  if (!json?.success) throw new Error('Upload failed');
  return json.data?.url || json.data?.display_url || '';
}

const upInput = document.getElementById('lib-upload');
const upCat = document.getElementById('lib-upload-cat');
const upBtn = document.getElementById('lib-upload-btn');
const msgEl = document.getElementById('lib-msg');
const grid = document.getElementById('lib-grid');
const empty = document.getElementById('lib-empty');
const searchInput = document.getElementById('lib-search');
const clearBtn = document.getElementById('lib-clear');
const filterSel = document.getElementById('lib-filter');
const refreshBtn = document.getElementById('lib-refresh');

let allMedia = [];
let currentQ = '';
let currentCat = '';

function setMsg(text, ok=true){
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.className = `text-sm mt-2 ${ok? 'text-gray-700' : 'text-red-700'}`;
}

async function loadMedia(){
  const qy = query(collection(db,'media'), orderBy('createdAt','desc'));
  const snap = await getDocs(qy);
  allMedia = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
  renderFilterOptions();
  draw();
}

function renderFilterOptions(){
  const cats = Array.from(new Set(allMedia.map(m => (m.category||'').trim()).filter(Boolean))).sort((a,b)=> a.localeCompare(b));
  filterSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c=>`<option value="${c}">${c}</option>`).join('');
  if (currentCat) filterSel.value = currentCat;
}

function draw(){
  grid.innerHTML = '';
  const q = currentQ.trim().toLowerCase();
  const list = allMedia.filter(m => {
    if (currentCat && (m.category||'') !== currentCat) return false;
    if (!q) return true;
    const hay = `${m.url} ${m.category||''}`.toLowerCase();
    return hay.includes(q);
  });
  if (list.length === 0){
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  const frag = document.createDocumentFragment();
  list.forEach(m => {
    const card = document.createElement('div');
    card.className = 'border rounded bg-white overflow-hidden flex flex-col';
    card.innerHTML = `
      <img src="${m.url}" alt="" class="h-40 w-full object-cover bg-white">
      <div class="p-3 space-y-2">
        <div class="text-xs text-gray-600 break-all">${m.url}</div>
        <div class="flex items-center gap-2">
          <input type="text" class="flex-1 border rounded px-2 py-1 text-sm" value="${m.category||''}" placeholder="Category"/>
          <button class="save px-2 py-1 rounded bg-blue-600 text-white text-sm">Save</button>
        </div>
      </div>
    `;
    const input = card.querySelector('input');
    const btn = card.querySelector('.save');
    btn.addEventListener('click', async ()=>{
      try {
        btn.setAttribute('disabled','');
        await updateDoc(doc(db,'media', m.id), { category: input.value.trim() || null });
        setMsg('Category updated');
        m.category = input.value.trim() || null;
        renderFilterOptions();
      } catch(e){ setMsg('Update failed', false); }
      finally { btn.removeAttribute('disabled'); }
    });
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

upBtn?.addEventListener('click', async ()=>{
  try{
    const files = upInput?.files || [];
    if (!files || files.length===0){ setMsg('Please choose images first', false); return; }
    const cat = (upCat?.value||'').trim();
    upBtn.setAttribute('disabled','');
    setMsg('Uploading...');
    let done = 0;
    for (const f of files){
      if (!f || f.size===0) continue;
      try{
        setMsg(`Uploading ${++done}/${files.length}...`);
        const url = await uploadToImgbb(f);
        await addDoc(collection(db,'media'), { url, category: cat || null, createdAt: serverTimestamp(), by: auth.currentUser?auth.currentUser.uid:null });
      }catch(e){ setMsg('One file failed, continuing...', false); }
    }
    setMsg('Upload complete');
    upInput.value = '';
    await loadMedia();
  }catch(e){ setMsg('Upload failed', false); }
  finally{ upBtn.removeAttribute('disabled'); }
});

clearBtn?.addEventListener('click', ()=> { searchInput.value=''; currentQ=''; draw(); });
searchInput?.addEventListener('input', ()=> { currentQ = searchInput.value||''; draw(); });
filterSel?.addEventListener('change', ()=> { currentCat = filterSel.value||''; draw(); });
refreshBtn?.addEventListener('click', loadMedia);

// initial
loadMedia().catch(()=> setMsg('Failed to load media', false));
