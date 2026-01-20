import { auth, db } from './firebase-config.js';
import { requireAdmin } from './auth.js';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
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

async function uploadUrlToImgbb(imageUrl){
  const fd = new FormData();
  fd.append('image', imageUrl);
  const res = await fetch(`https://api.imgbb.com/1/upload?expiration=0&key=${encodeURIComponent(IMGBB_API_KEY)}`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  const json = await res.json();
  if (!json?.success) throw new Error('Upload failed');
  return json.data?.url || json.data?.display_url || '';
}

const upInput = document.getElementById('lib-upload');
const upCat = document.getElementById('lib-upload-cat');
const upBtn = document.getElementById('lib-upload-btn');
const upLinkInput = document.getElementById('lib-upload-link');
const upLinkBtn = document.getElementById('lib-upload-link-btn');
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
  try{
    let snap;
    try {
      const qy = query(collection(db,'media'), orderBy('createdAt','desc'));
      snap = await getDocs(qy);
    } catch(err){
      // Fallback: no index or field issues — read without ordering
      snap = await getDocs(collection(db,'media'));
      setMsg('Loaded without ordering (missing index or createdAt on some items)', false);
    }
    allMedia = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    // If no ordering, sort by createdAt if available
    allMedia.sort((a,b)=> {
      const ta = (a.createdAt?.seconds||0);
      const tb = (b.createdAt?.seconds||0);
      return tb - ta;
    });
    renderFilterOptions();
    setMsg(`Loaded ${allMedia.length} images`);
    draw();
  } catch(e){
    console.error('loadMedia error', e);
    setMsg('Failed to load media', false);
    allMedia = [];
    renderFilterOptions();
    draw();
  }
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
    const catLabel = (m.category || '').trim() ? m.category : 'Uncategorized';
    card.innerHTML = `
      <img src="${m.url}" alt="" class="h-40 w-full object-cover bg-white">
      <div class="p-3 space-y-2">
        <div class="text-xs text-gray-600 break-all">${m.url}</div>
        <div class="flex items-center justify-between cat-row">
          <div class="text-sm"><span class="text-gray-500">Category:</span> <span class="cat-text font-medium">${catLabel}</span></div>
          <div class="flex items-center gap-2">
            <button class="edit px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm hover:bg-gray-200">Edit</button>
            <button class="del px-2 py-1 rounded bg-red-600 text-white text-sm">Delete</button>
          </div>
        </div>
      </div>
    `;
    const del = card.querySelector('.del');
    const editBtn = card.querySelector('.edit');
    const catText = card.querySelector('.cat-text');

    function openInlineEditor(){
      const row = card.querySelector('.cat-row');
      if (!row) return;
      row.innerHTML = `
        <div class="flex-1">
          <input type="text" class="w-full border rounded px-2 py-1 text-sm" value="${m.category||''}" placeholder="Category"/>
        </div>
        <div class="flex items-center gap-2 pl-2">
          <button class="save px-2 py-1 rounded bg-blue-600 text-white text-sm">Save</button>
          <button class="cancel px-2 py-1 rounded bg-gray-100 text-sm">Cancel</button>
        </div>
      `;
      const input = row.querySelector('input');
      const save = row.querySelector('.save');
      const cancel = row.querySelector('.cancel');
      input?.focus();
      input?.select();
      const doSave = async ()=>{
        try{
          save.setAttribute('disabled','');
          await updateDoc(doc(db,'media', m.id), { category: input.value.trim() || null });
          m.category = input.value.trim() || null;
          const newLabel = (m.category||'').trim()? m.category : 'Uncategorized';
          row.innerHTML = `
            <div class="text-sm"><span class="text-gray-500">Category:</span> <span class="cat-text font-medium">${newLabel}</span></div>
            <div class="flex items-center gap-2">
              <button class="edit px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm hover:bg-gray-200">Edit</button>
              <button class="del px-2 py-1 rounded bg-red-600 text-white text-sm">Delete</button>
            </div>`;
          // rebind buttons
          row.querySelector('.edit')?.addEventListener('click', openInlineEditor);
          row.querySelector('.del')?.addEventListener('click', del.onclick);
          setMsg('Category updated');
          renderFilterOptions();
        } catch(e){ setMsg('Update failed', false); }
        finally { save.removeAttribute('disabled'); }
      };
      save.addEventListener('click', doSave);
      input?.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter') { e.preventDefault(); doSave(); }
        if (e.key === 'Escape') { e.preventDefault(); row.innerHTML = '';
          row.innerHTML = `<div class="text-sm"><span class="text-gray-500">Category:</span> <span class="cat-text font-medium">${(m.category||'').trim()? m.category : 'Uncategorized'}</span></div>
            <div class=\"flex items-center gap-2\"><button class=\"edit px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm hover:bg-gray-200\">Edit</button>
            <button class=\"del px-2 py-1 rounded bg-red-600 text-white text-sm\">Delete</button></div>`;
          row.querySelector('.edit')?.addEventListener('click', openInlineEditor);
          row.querySelector('.del')?.addEventListener('click', del.onclick);
        }
      });
      cancel.addEventListener('click', ()=>{
        row.innerHTML = `<div class="text-sm"><span class="text-gray-500">Category:</span> <span class="cat-text font-medium">${(m.category||'').trim()? m.category : 'Uncategorized'}</span></div>
          <div class="flex items-center gap-2"><button class="edit px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm hover:bg-gray-200">Edit</button>
          <button class="del px-2 py-1 rounded bg-red-600 text-white text-sm">Delete</button></div>`;
        row.querySelector('.edit')?.addEventListener('click', openInlineEditor);
        row.querySelector('.del')?.addEventListener('click', del.onclick);
      });
    }

    editBtn.addEventListener('click', openInlineEditor);

    del.addEventListener('click', async ()=>{
      try {
        if (!confirm('Delete this image from library?')) return;
        del.setAttribute('disabled','');
        await deleteDoc(doc(db,'media', m.id));
        setMsg('Image deleted');
        allMedia = allMedia.filter(x=> x.id !== m.id);
        renderFilterOptions();
        draw();
      } catch(e){ setMsg('Delete failed', false); }
      finally { del.removeAttribute('disabled'); }
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

upLinkBtn?.addEventListener('click', async ()=>{
  try{
    const link = (upLinkInput?.value || '').trim();
    if (!link){ setMsg('Please paste an image link', false); return; }
    try { new URL(link); } catch { setMsg('Invalid URL', false); return; }
    const cat = (upCat?.value||'').trim();
    upLinkBtn.setAttribute('disabled','');
    setMsg('Uploading link...');
    let finalUrl = '';
    const isImgbbLike = /(^https?:\/\/i\.ibb\.co\/)|(^https?:\/\/.*imgbb\.com\//i).test(link);
    try{
      if (isImgbbLike){
        // Already hosted on imgbb; no need to re-upload
        finalUrl = link;
      } else {
        finalUrl = await uploadUrlToImgbb(link);
      }
    } catch(e){
      // Fallback: store the original URL directly
      finalUrl = link;
      setMsg('imgbb rejected link; saving external URL directly...', false);
    }
    await addDoc(collection(db,'media'), { url: finalUrl, category: cat || null, createdAt: serverTimestamp(), by: auth.currentUser?auth.currentUser.uid:null });
    setMsg('Link added');
    upLinkInput.value = '';
    await loadMedia();
  }catch(e){ setMsg('Upload by link failed', false); }
  finally{ upLinkBtn.removeAttribute('disabled'); }
});

clearBtn?.addEventListener('click', ()=> { searchInput.value=''; currentQ=''; draw(); });
searchInput?.addEventListener('input', ()=> { currentQ = searchInput.value||''; draw(); });
filterSel?.addEventListener('change', ()=> { currentCat = filterSel.value||''; draw(); });
refreshBtn?.addEventListener('click', loadMedia);

// initial
loadMedia().catch(()=> setMsg('Failed to load media', false));
