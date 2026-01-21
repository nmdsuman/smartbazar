import { auth, db } from './firebase-config.js';
import { requireAdmin } from './auth.js';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  getDoc,
  setDoc,
  runTransaction,
  where,
  getDocs,
  limit
} from 'firebase/firestore';

requireAdmin();

// Normalize unexpected deployed URLs like /admin+files or /admin+chat
try {
  const m = location.pathname.match(/admin\+(\w+)/);
  if (m && m[1]) {
    const target = m[1];
    location.replace(`admin.html#${target}`);
  }
} catch {}

const form = document.getElementById('add-product-form');
const msg = document.getElementById('admin-message');
const listEl = document.getElementById('admin-products');
const emptyEl = document.getElementById('admin-empty');
const ordersListEl = document.getElementById('orders-list');
const ordersEmptyEl = document.getElementById('orders-empty');
const ordersFilter = document.getElementById('orders-filter');
const ordersBadge = document.getElementById('orders-badge');
const chatBadge = document.getElementById('chat-badge');
const shippingForm = document.getElementById('shipping-form');
const shippingMsg = document.getElementById('shipping-message');
// Site settings elements
const siteForm = document.getElementById('site-form');
const siteMsg = document.getElementById('site-message');
// Chat admin elements
const chatSessionsEl = document.getElementById('chat-sessions');
const chatCountEl = document.getElementById('chat-count');
const chatMessagesAdminEl = document.getElementById('chat-messages-admin');
const chatMetaEl = document.getElementById('chat-meta');
const chatReplyInput = document.getElementById('chat-reply');
const chatSendBtn = document.getElementById('chat-send');
// Order modal elements
const modal = document.getElementById('order-modal');
const modalClose = document.getElementById('order-close');
const modalMeta = document.getElementById('order-meta');
const modalItemsTbody = document.getElementById('order-items');
const modalAddSelect = document.getElementById('order-add-select');
const modalAddQty = document.getElementById('order-add-qty');
const modalAddBtn = document.getElementById('order-add-btn');
const modalSubtotalEl = document.getElementById('order-subtotal');
const modalDeliveryEl = document.getElementById('order-delivery');
const modalTotalEl = document.getElementById('order-total');
const modalSaveBtn = document.getElementById('order-save');
const modalPrintBtn = document.getElementById('order-print');

let productsCache = [];
let shippingCfg = null; // cached shipping settings for calc
let currentOrder = { id: null, data: null, items: [] };
let lastOrders = [];
let ordersUserFilter = null; // when set, show orders only for this userId

const IMGBB_API_KEY = '462884d7f63129dede1b67d612e66ee6';
// GitHub upload (frontend) — for security, prefer serverless in production
const GH_REPO = 'nmdsuman/image';
const GH_BRANCH = 'main';
// Site file manager target repo/branch
const SITE_GH_REPO = 'nmdsuman/smartbazar';
const SITE_GH_BRANCH = 'main';

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
 
// Generic: upload base64 content to a specific repo path (creates or updates with sha)
async function uploadB64ToGithubRepo(b64Content, repo, branch, path, message){
  const token = ensureGithubTokenAdmin();
  if (!token) throw new Error('GitHub token missing');
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${cleanPath}`;
  // Try to get existing sha (if file exists)
  let sha = undefined;
  try {
    const resHead = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    if (resHead.ok) {
      const info = await resHead.json();
      if (info && typeof info.sha === 'string') sha = info.sha;
    }
  } catch {}
  const body = { message: message || 'Update via admin', content: b64Content, branch };
  if (sha) body.sha = sha;
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error(`GitHub upload failed (${res.status}): ${txt.slice(0,200)}`);
  }
  return `https://raw.githubusercontent.com/${repo}/${branch}/${cleanPath}`;
}

function getGithubTokenAdmin(){
  try { return localStorage.getItem('GH_TOKEN') || ''; } catch { return ''; }
}
function ensureGithubTokenAdmin(){
  let t = getGithubTokenAdmin();
  if (!t) {
    try {
      t = window.prompt('Enter GitHub token for image upload (stored locally):', '') || '';
      if (t) localStorage.setItem('GH_TOKEN', t);
    } catch {}
  }
  return t;
}
function extFromTypeAdmin(type){
  if (!type) return 'jpg';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('svg')) return 'svg';
  if (type.includes('gif')) return 'gif';
  return 'jpg';
}
async function uploadToGithubAdmin(file){
  const token = ensureGithubTokenAdmin();
  if (!token) throw new Error('GitHub token missing');
  const b64 = await fileToBase64(file);
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const rand = Math.random().toString(36).slice(2,8);
  const ext = extFromTypeAdmin(file.type||'');
  const path = `images/${yyyy}/${mm}/${Date.now()}-${rand}.${ext}`;
  const apiUrl = `https://api.github.com/repos/${GH_REPO}/contents/${path}`;
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Add product image', content: b64, branch: GH_BRANCH })
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`GitHub upload failed (${res.status}): ${txt.slice(0,200)}`);
  }
  return `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${path}`;
}

// Load folders from SITE_GH_REPO to populate File Manager folder dropdown
async function loadSiteRepoFolders(){
  if (!fmFolder) return;
  try {
    // Show loading state
    fmFolder.innerHTML = '';
    const loading = document.createElement('option');
    loading.value = 'loading'; loading.textContent = 'Loading folders...';
    fmFolder.appendChild(loading);
    const token = getGithubTokenAdmin();
    const apiUrl = `https://api.github.com/repos/${SITE_GH_REPO}/git/trees/${encodeURIComponent(SITE_GH_BRANCH)}?recursive=1`;
    const res = await fetch(apiUrl, { headers: token ? { 'Authorization': `token ${token}` } : {} });
    if (!res.ok) throw new Error('Failed to list repo tree');
    const json = await res.json();
    const dirs = (json?.tree || [])
      .filter(x=>x.type==='tree')
      .map(x=>x.path)
      .filter(Boolean)
      .sort((a,b)=> a.localeCompare(b));
    // Reset and add main (root)
    fmFolder.innerHTML = '';
    const optRoot = document.createElement('option'); optRoot.value = 'main'; optRoot.textContent = 'main (root)'; fmFolder.appendChild(optRoot);
    dirs.forEach(p=>{
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      fmFolder.appendChild(opt);
    });
  } catch (e) {
    // Leave default options if listing fails
    fmFolder.innerHTML = '';
    const optRoot = document.createElement('option'); optRoot.value = 'main'; optRoot.textContent = 'main (root)'; fmFolder.appendChild(optRoot);
    if (fmMsg) { fmMsg.textContent = 'Could not load folders. You can still type a path manually.'; fmMsg.className = 'text-sm text-amber-700'; }
  }
}

async function uploadToImgbb(file) {
  const b64 = await fileToBase64(file);
  const fd = new FormData();
  fd.append('image', b64);
  const res = await fetch(`https://api.imgbb.com/1/upload?expiration=0&key=${encodeURIComponent(IMGBB_API_KEY)}`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Image upload failed');
  const json = await res.json();
  if (!json?.success) throw new Error('Image upload failed');
  return json.data?.url || json.data?.display_url || '';
}

// Product Edit modal
const editModal = document.getElementById('edit-modal');
const editClose = document.getElementById('edit-close');
const editForm = document.getElementById('edit-form');
const editMsg = document.getElementById('edit-message');
let currentEditProductId = null;
// Edit preview elements
const editPrevImg = document.getElementById('edit-preview-image');
const editPrevThumbs = document.getElementById('edit-preview-thumbs');

function setMessage(text, ok = true) {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `text-sm mt-4 ${ok ? 'text-green-700' : 'text-red-700'}`;
}

// Live preview for Add Product
const prevImg = document.getElementById('add-preview-image');
const prevTitle = document.getElementById('add-preview-title');
const prevPrice = document.getElementById('add-preview-price');
const prevExtra = document.getElementById('add-preview-extra');
const prevDesc = document.getElementById('add-preview-desc');
const prevGallery = document.getElementById('add-preview-gallery');
const addSectionTitle = document.getElementById('add-section-title');
const addSubmitBtn = document.getElementById('add-submit-btn');
const addCancelEditBtn = document.getElementById('add-cancel-edit');
const btnImageClear = document.getElementById('btn-image-clear');
const btnGalleryClear = document.getElementById('btn-gallery-clear');
// File Manager elements
const fmFile = document.getElementById('fm-file');
const fmPath = document.getElementById('fm-path');
const fmUploadBtn = document.getElementById('fm-upload');
const fmMsg = document.getElementById('fm-msg');
const fmCommitMsg = document.getElementById('fm-message');
const fmFolder = document.getElementById('fm-folder');
const fmFolderRefresh = document.getElementById('fm-folder-refresh');

let editUsingAdd = { active: false, productId: null, original: null };

// Notes elements
const noteTitleEl = document.getElementById('note-title');
const noteContentEl = document.getElementById('note-content');
const noteSaveBtn = document.getElementById('note-save');
const noteNewBtn = document.getElementById('note-new');
const noteMsgEl = document.getElementById('note-message');
const notesListEl = document.getElementById('notes-list');

// File Manager: Upload site files directly to GitHub repo
fmUploadBtn?.addEventListener('click', async ()=>{
  try{
    const file = fmFile?.files?.[0];
    let path = (fmPath?.value || '').trim();
    const message = (fmCommitMsg?.value || 'Update via admin').trim();
    if (!file) { if (fmMsg) { fmMsg.textContent = 'Please choose a file'; fmMsg.className = 'text-sm text-red-700'; } return; }
    // Build destination path from folder + path/filename
    const folder = (fmFolder?.value || '').trim();
    let dest = path || (file.name || 'file');
    if (folder && folder !== 'main') {
      dest = `${folder.replace(/^\/+|\/+$/g,'')}/${dest.replace(/^\/+/, '')}`;
    }
    fmUploadBtn.setAttribute('disabled','');
    if (fmMsg) { fmMsg.textContent = 'Uploading to GitHub...'; fmMsg.className = 'text-sm text-gray-700'; }
    const b64 = await fileToBase64(file);
    const rawUrl = await uploadB64ToGithubRepo(b64, SITE_GH_REPO, SITE_GH_BRANCH, dest, message);
    if (fmMsg) { fmMsg.innerHTML = `Uploaded: <a class="text-blue-700 underline" href="${rawUrl}" target="_blank" rel="noopener">${dest}</a>`; fmMsg.className = 'text-sm text-green-700'; }
    if (fmFile) fmFile.value = '';
    if (fmPath) fmPath.value = '';
  } catch(e){ if (fmMsg) { fmMsg.textContent = 'Upload failed: ' + (e?.message||e); fmMsg.className = 'text-sm text-red-700'; } }
  finally{ fmUploadBtn?.removeAttribute('disabled'); }
});

// ===== Notes (Admin personal) =====
let currentNoteId = null;

function setNoteMessage(text, ok=true){
  if (!noteMsgEl) return;
  noteMsgEl.textContent = text;
  noteMsgEl.className = `text-sm mt-2 ${ok ? 'text-green-700' : 'text-red-700'}`;
}

async function loadNotes(){
  if (!notesListEl || !auth.currentUser) return;
  notesListEl.innerHTML = '';
  try {
    const qy = query(collection(db,'notes'), where('uid','==', auth.currentUser.uid), orderBy('updatedAt','desc'));
    const snap = await getDocs(qy);
    const notes = snap.docs.map(d=>({ id: d.id, ...d.data() }));
    renderNotes(notes);
  } catch (e) {
    try {
      // Fallback without orderBy index
      const qy2 = query(collection(db,'notes'), where('uid','==', auth.currentUser.uid));
      const snap2 = await getDocs(qy2);
      const notes2 = snap2.docs.map(d=>({ id: d.id, ...d.data() }))
        .sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
      renderNotes(notes2);
    } catch(err){ if (noteMsgEl) { setNoteMessage('Failed to load notes', false); } }
  }
}

function renderNotes(items){
  if (!notesListEl) return;
  notesListEl.innerHTML = '';
  if (!Array.isArray(items) || items.length===0){
    const d = document.createElement('div'); d.className='text-gray-500 text-sm'; d.textContent='No notes yet.'; notesListEl.appendChild(d); return;
  }
  const frag = document.createDocumentFragment();
  items.forEach(n=>{
    const row = document.createElement('div');
    row.className = 'border rounded p-2 flex items-start justify-between gap-2';
    const when = n.updatedAt?.toDate ? n.updatedAt.toDate().toLocaleString() : '';
    row.innerHTML = `
      <div class="min-w-0">
        <div class="font-medium truncate">${(n.title||'Untitled')}</div>
        <div class="text-xs text-gray-500 truncate">${when}</div>
      </div>
      <div class="shrink-0 flex items-center gap-2">
        <button class="copy px-2 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200">Copy</button>
        <button class="edit px-2 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700">Edit</button>
        <button class="del px-2 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
      </div>
    `;
    row.querySelector('.copy').addEventListener('click', async ()=>{
      try{ await navigator.clipboard.writeText(n.content||''); setNoteMessage('Copied to clipboard'); }catch{ setNoteMessage('Copy failed', false); }
    });
    row.querySelector('.edit').addEventListener('click', ()=>{
      currentNoteId = n.id;
      if (noteTitleEl) noteTitleEl.value = n.title||'';
      if (noteContentEl) noteContentEl.value = n.content||'';
      setNoteMessage('Loaded note for editing');
    });
    row.querySelector('.del').addEventListener('click', async ()=>{
      try{ await deleteDoc(doc(db,'notes', n.id)); setNoteMessage('Deleted'); loadNotes(); }catch(e){ setNoteMessage('Delete failed: '+e.message, false); }
    });
    frag.appendChild(row);
  });
  notesListEl.appendChild(frag);
}

noteSaveBtn?.addEventListener('click', async ()=>{
  if (!auth.currentUser) { setNoteMessage('Not signed in', false); return; }
  const title = (noteTitleEl?.value||'').toString().trim();
  const content = (noteContentEl?.value||'').toString();
  if (!content) { setNoteMessage('Content is empty', false); return; }
  try {
    if (currentNoteId) {
      await setDoc(doc(db,'notes', currentNoteId), { uid: auth.currentUser.uid, title: title||null, content, updatedAt: serverTimestamp() }, { merge: true });
      setNoteMessage('Saved changes');
    } else {
      await addDoc(collection(db,'notes'), { uid: auth.currentUser.uid, title: title||null, content, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setNoteMessage('Note saved');
    }
    currentNoteId = null;
    loadNotes();
  } catch (e) { setNoteMessage('Save failed: '+e.message, false); }
});

noteNewBtn?.addEventListener('click', ()=>{
  currentNoteId = null;
  if (noteTitleEl) noteTitleEl.value='';
  if (noteContentEl) noteContentEl.value='';
  setNoteMessage('Ready for new note');
});

// Refresh folders on click (ensure token first)
fmFolderRefresh?.addEventListener('click', (e)=>{
  e.preventDefault();
  try { if (!getGithubTokenAdmin()) ensureGithubTokenAdmin(); loadSiteRepoFolders(); } catch {}
});

// Image cropper state (for main product image in Add/Edit form)
let croppedMainImageFile = null;
let cropper = null;
const cropperModal = document.getElementById('cropper-modal');
const cropperImgEl = document.getElementById('cropper-image');
const cropperCloseBtn = document.getElementById('cropper-close');
const cropperCancelBtn = document.getElementById('cropper-cancel');
const cropperApplyBtn = document.getElementById('cropper-apply');

function openCropper(file){
  try {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (cropper) { try { cropper.destroy(); } catch {}
      cropper = null;
    }
    if (cropperImgEl) {
      cropperImgEl.src = url;
      // Show modal
      cropperModal?.classList.remove('hidden');
      cropperModal?.classList.add('flex');
      // Init after image loads
      cropperImgEl.onload = () => {
        try {
          // 1:1 square by default, good for thumbnails
          cropper = new window.Cropper(cropperImgEl, { aspectRatio: NaN, viewMode: 1, autoCropArea: 0.9 });
        } catch {}
      };
    }
  } catch {}
}

function closeCropper(){
  try {
    cropperModal?.classList.add('hidden');
    cropperModal?.classList.remove('flex');
    if (cropper) { cropper.destroy(); cropper = null; }
    if (cropperImgEl) { cropperImgEl.src = ''; }
  } catch {}
}

cropperCloseBtn?.addEventListener('click', closeCropper);
cropperCancelBtn?.addEventListener('click', ()=>{ croppedMainImageFile = null; closeCropper(); });
cropperApplyBtn?.addEventListener('click', ()=>{
  try {
    if (!cropper) { closeCropper(); return; }
    const canvas = cropper.getCroppedCanvas({ maxWidth: 1600, maxHeight: 1600 });
    if (!canvas) { closeCropper(); return; }
    canvas.toBlob((blob)=>{
      if (!blob) { closeCropper(); return; }
      const file = new File([blob], 'product.jpg', { type: blob.type || 'image/jpeg' });
      croppedMainImageFile = file;
      // Update live preview with cropped image
      if (prevImg) {
        const u = URL.createObjectURL(file);
        prevImg.src = u;
        prevImg.classList.remove('hidden');
      }
      closeCropper();
    }, 'image/jpeg', 0.9);
  } catch { closeCropper(); }
});

// ===== Media Library (inbuilt) =====
const mediaModal = document.getElementById('media-modal');
const mediaClose = document.getElementById('media-close');
const mediaUpload = document.getElementById('media-upload');
const mediaUploadBtn = document.getElementById('media-upload-btn');
const mediaGrid = document.getElementById('media-grid');
const mediaUseMain = document.getElementById('media-use-main');
const mediaCropMain = document.getElementById('media-crop-main');
const mediaUseGallery = document.getElementById('media-use-gallery');
const mediaMsg = document.getElementById('media-message');
const btnImageLibrary = document.getElementById('btn-image-library');
const btnGalleryLibrary = document.getElementById('btn-gallery-library');

let mediaItems = [];
let mediaSelected = new Set();
let mediaMode = 'main'; // 'main' or 'gallery'
let selectedMainUrl = '';
let selectedGalleryUrls = [];

function showMediaModal(mode){
  mediaMode = mode === 'gallery' ? 'gallery' : 'main';
  try {
    mediaSelected.clear();
    renderMediaGrid();
  } catch {}
  mediaModal?.classList.remove('hidden');
  mediaModal?.classList.add('flex');
  loadMediaItems();
}

function hideMediaModal(){
  mediaModal?.classList.add('hidden');
  mediaModal?.classList.remove('flex');
}

async function loadMediaItems(){
  try {
    let snap;
    try {
      const qy = query(collection(db,'media'), orderBy('createdAt','desc'));
      snap = await getDocs(qy);
    } catch (err) {
      // Fallback: read without ordering if index/field is missing
      snap = await getDocs(collection(db,'media'));
      if (mediaMsg) { mediaMsg.textContent = 'Loaded library without ordering'; mediaMsg.className = 'text-sm text-gray-700'; }
    }
    mediaItems = snap.docs.map(d=>({ id: d.id, url: d.data().url, createdAt: d.data().createdAt }));
    // Client-side sort by createdAt if available
    mediaItems.sort((a,b)=>{
      const ta = a.createdAt?.seconds || 0;
      const tb = b.createdAt?.seconds || 0;
      return tb - ta;
    });
    renderMediaGrid();
  } catch (e) {
    if (mediaMsg) { mediaMsg.textContent = 'Failed to load library.'; mediaMsg.className = 'text-sm text-red-700'; }
  }
}

function renderMediaGrid(){
  if (!mediaGrid) return;
  mediaGrid.innerHTML = '';
  const frag = document.createDocumentFragment();
  mediaItems.forEach(it => {
    const w = document.createElement('button');
    w.type = 'button';
    w.className = 'relative border rounded overflow-hidden bg-white hover:ring-2 hover:ring-blue-500 focus:outline-none';
    w.innerHTML = `<img src="${it.url}" alt="" class="w-full h-24 object-cover"><span class="absolute top-1 right-1 inline-block w-2.5 h-2.5 rounded-full ${mediaSelected.has(it.id)?'bg-blue-600':'bg-white border'}"></span>`;
    w.addEventListener('click', ()=>{
      if (mediaMode==='main') { mediaSelected.clear(); mediaSelected.add(it.id); } else {
        if (mediaSelected.has(it.id)) mediaSelected.delete(it.id); else mediaSelected.add(it.id);
      }
      renderMediaGrid();
    });
    frag.appendChild(w);
  });
  mediaGrid.appendChild(frag);
}

mediaClose?.addEventListener('click', hideMediaModal);

mediaUploadBtn?.addEventListener('click', async ()=>{
  try {
    if (!mediaUpload || !mediaUpload.files || mediaUpload.files.length === 0) return;
    mediaUploadBtn.setAttribute('disabled','');
    if (mediaMsg) { mediaMsg.textContent = 'Uploading...'; mediaMsg.className = 'text-sm text-gray-700'; }
    for (const f of mediaUpload.files) {
      if (!f || f.size===0) continue;
      let url = '';
      try { url = await uploadToGithubAdmin(f); }
      catch { url = await uploadToImgbb(f); }
      if (url) {
        await addDoc(collection(db,'media'), { url, createdAt: serverTimestamp(), by: auth.currentUser?auth.currentUser.uid:null });
      }
    }
    mediaUpload.value = '';
    if (mediaMsg) { mediaMsg.textContent = 'Uploaded.'; mediaMsg.className = 'text-sm text-green-700'; }
    await loadMediaItems();
  } catch (e) {
    if (mediaMsg) { mediaMsg.textContent = 'Upload failed.'; mediaMsg.className = 'text-sm text-red-700'; }
  } finally {
    mediaUploadBtn?.removeAttribute('disabled');
  }
});

mediaUseMain?.addEventListener('click', ()=>{
  const first = mediaItems.find(x=> mediaSelected.has(x.id));
  if (!first) return;
  selectedMainUrl = first.url;
  croppedMainImageFile = null; // prefer URL
  if (prevImg) { prevImg.src = selectedMainUrl; prevImg.classList.remove('hidden'); }
  hideMediaModal();
});

mediaUseGallery?.addEventListener('click', ()=>{
  const urls = mediaItems.filter(x=> mediaSelected.has(x.id)).map(x=>x.url);
  if (urls.length === 0) return;
  const left = Math.max(0, 5 - selectedGalleryUrls.length);
  selectedGalleryUrls = selectedGalleryUrls.concat(urls.slice(0,left));
  renderSelectedGalleryPreview();
  hideMediaModal();
});

btnImageLibrary?.addEventListener('click', ()=> showMediaModal('main'));
btnGalleryLibrary?.addEventListener('click', ()=> showMediaModal('gallery'));

mediaCropMain?.addEventListener('click', async ()=>{
  try {
    const first = mediaItems.find(x=> mediaSelected.has(x.id));
    if (!first) return;
    // Fetch the image and open cropper
    const res = await fetch(first.url);
    const blob = await res.blob();
    const file = new File([blob], 'library.jpg', { type: blob.type || 'image/jpeg' });
    // Clear any library main URL so cropped file is used
    selectedMainUrl = '';
    // Close media modal before opening cropper
    hideMediaModal();
    openCropper(file);
  } catch (e) {
    if (mediaMsg) { mediaMsg.textContent = 'Failed to open cropper for this image.'; mediaMsg.className = 'text-sm text-red-700'; }
  }
});

function renderSelectedGalleryPreview(){
  if (!prevGallery) return;
  prevGallery.innerHTML = '';
  selectedGalleryUrls.forEach((u, idx)=>{
    const wrap = document.createElement('div');
    wrap.className = 'relative group';
    const img = document.createElement('img');
    img.src = u; img.alt='Gallery'; img.className = 'w-full h-16 object-contain bg-white border rounded';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'hidden group-hover:flex items-center justify-center absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white shadow';
    rm.innerHTML = '×';
    rm.addEventListener('click', (e)=>{
      e.preventDefault();
      selectedGalleryUrls = selectedGalleryUrls.filter((x, i)=> i!==idx);
      renderSelectedGalleryPreview();
    });
    wrap.appendChild(img);
    wrap.appendChild(rm);
    prevGallery.appendChild(wrap);
  });
}

function updateAddPreview() {
  if (!form || !prevTitle || !prevPrice || !prevExtra || !prevDesc) return;
  const title = form.title ? String(form.title.value || '').trim() : '';
  const price = form.price ? Number(form.price.value || 0) : 0;
  const weightVal = form.weightValue ? String(form.weightValue.value || '').trim() : '';
  const weightUnit = form.weightUnit ? String(form.weightUnit.value || '').trim() : '';
  const unitLabel = weightUnit === 'l' ? 'L' : (weightUnit === 'ml' ? 'ml' : (weightUnit === 'kg' ? 'kg' : 'g'));
  const weight = weightVal ? `${weightVal}${unitLabel}` : '';
  const size = form.size ? String(form.size.value || '').trim() : '';
  const desc = form.description ? String(form.description.value || '').trim() : '';

  prevTitle.textContent = title || '—';
  prevPrice.textContent = `৳${Number(price || 0).toFixed(2)}`;
  const extra = [weight, size].filter(Boolean).join(' · ');
  prevExtra.textContent = extra || '\u00A0';
  prevDesc.textContent = desc || '\u00A0';
}

function updateAddPreviewImage() {
  if (!form || !prevImg) return;
  // If a main image was chosen from the media library, prefer showing that
  if (selectedMainUrl) {
    prevImg.src = selectedMainUrl;
    prevImg.classList.remove('hidden');
    return;
  }
  const file = form.image && form.image.files ? form.image.files[0] : null;
  if (file) {
    const url = URL.createObjectURL(file);
    prevImg.src = url;
    prevImg.classList.remove('hidden');
  } else {
    if (editUsingAdd.active && editUsingAdd.original?.image) {
      prevImg.src = editUsingAdd.original.image;
      prevImg.classList.remove('hidden');
    } else {
      prevImg.src = '';
      prevImg.classList.add('hidden');
    }
  }
}

function updateAddPreviewGallery() {
  if (!form || !prevGallery) return;
  const input = form.querySelector('[name="gallery"]');
  const files = input && input.files ? input.files : [];
  prevGallery.innerHTML = '';
  const max = Math.min(5, files.length);
  if (max > 0) {
    for (let i = 0; i < max; i++) {
      const f = files[i];
      if (!f) continue;
      const url = URL.createObjectURL(f);
      const div = document.createElement('div');
      div.className = 'relative';
      const img = document.createElement('img');
      img.src = url; img.alt = 'Preview'; img.className = 'w-full h-16 object-contain bg-white border rounded opacity-90';
      div.appendChild(img);
      prevGallery.appendChild(div);
    }
  }
  // Also render any library-selected gallery images with removal buttons
  if (selectedGalleryUrls.length > 0) {
    renderSelectedGalleryPreview();
  } else if (max === 0 && editUsingAdd.active) {
    const urls = Array.isArray(editUsingAdd.original?.images) ? editUsingAdd.original.images.slice(0,5) : [];
    urls.forEach(u => {
      const img = document.createElement('img');
      img.src = u;
      img.alt = 'Gallery';
      img.className = 'w-full h-16 object-contain bg-white border rounded';
      prevGallery.appendChild(img);
    });
  }
}

// Wire preview listeners
if (form) {
  ['title','price','weightValue','weightUnit','size','description'].forEach(name => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.addEventListener('input', updateAddPreview);
  });
  const imgInput = form.querySelector('[name="image"]');
  if (imgInput) imgInput.addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    if (f) {
      // Start cropper workflow
      openCropper(f);
    }
    // Also refresh preview (will be overridden after crop apply)
    updateAddPreviewImage();
  });
  const galInput = form.querySelector('[name="gallery"]');
  if (galInput) galInput.addEventListener('change', updateAddPreviewGallery);
  // initial state
  updateAddPreview();
}

// Cancel edit using Add form
addCancelEditBtn?.addEventListener('click', () => {
  editUsingAdd = { active: false, productId: null, original: null };
  if (addSectionTitle) addSectionTitle.textContent = 'Add Product';
  if (addSubmitBtn) addSubmitBtn.textContent = 'Add Product';
  addCancelEditBtn.classList.add('hidden');
  if (form) {
    form.reset();
  }
  updateAddPreview();
  updateAddPreviewImage();
  updateAddPreviewGallery();
});

// Clear buttons
btnImageClear?.addEventListener('click', ()=>{
  try {
    const imgInput = form?.querySelector('[name="image"]');
    if (imgInput) imgInput.value = '';
    selectedMainUrl = '';
    croppedMainImageFile = null;
    if (prevImg) { prevImg.src=''; prevImg.classList.add('hidden'); }
  } catch {}
});

btnGalleryClear?.addEventListener('click', ()=>{
  try {
    const galInput = form?.querySelector('[name="gallery"]');
    if (galInput) galInput.value = '';
    selectedGalleryUrls = [];
    renderSelectedGalleryPreview();
  } catch {}
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const title = (data.get('title') || '').toString().trim();
  const price = Number(data.get('price'));
  let imageFile = data.get('image');
  const galleryInput = form.querySelector('[name="gallery"]');
  const galleryFiles = galleryInput && galleryInput.files ? galleryInput.files : [];
  const description = (data.get('description') || '').toString().trim();
  const category = (data.get('category') || '').toString().trim();
  const wv = (data.get('weightValue') || '').toString().trim();
  const wu = (data.get('weightUnit') || '').toString().trim();
  const unitOut = wu === 'l' ? 'L' : (wu === 'ml' ? 'ml' : (wu === 'kg' ? 'kg' : 'g'));
  const weight = wv ? `${wv}${unitOut}` : '';
  const size = (data.get('size') || '').toString().trim();
  const stock = Number(data.get('stock') || 0);
  const active = data.get('active') ? true : false;

  if (!title || Number.isNaN(price)) {
    setMessage('Please fill all required fields correctly.', false);
    return;
  }

  try {
    const submitBtn = form.querySelector('button[type="submit"]');
    const prevDisabled = submitBtn?.disabled;
    if (submitBtn) submitBtn.disabled = true;
    if (!editUsingAdd.active) {
      // Create new
      // If a library image was chosen, use it; else prefer cropped file; else raw file upload
      let image = '';
      if (selectedMainUrl) {
        image = selectedMainUrl;
      } else {
        const mainFile = (croppedMainImageFile instanceof File) ? croppedMainImageFile : imageFile;
        if (!(mainFile instanceof File) || mainFile.size === 0) {
          throw new Error('Please select a product image.');
        }
        setMessage('Uploading image...', true);
        try { image = await uploadToGithubAdmin(mainFile); }
        catch { image = await uploadToImgbb(mainFile); }
      }
      // Build gallery images: start from selected gallery URLs, then append uploads up to 5
      const images = Array.isArray(selectedGalleryUrls) ? selectedGalleryUrls.slice(0,5) : [];
      try {
        const left = Math.max(0, 5 - images.length);
        const max = Math.min(left, galleryFiles.length);
        for (let i = 0; i < max; i++) {
          const f = galleryFiles[i];
          if (f && f.size > 0) {
            let url = '';
            try { url = await uploadToGithubAdmin(f); }
            catch { url = await uploadToImgbb(f); }
            if (url) images.push(url);
          }
        }
      } catch {}
      if (!image) throw new Error('Image upload returned empty URL');
      await addDoc(collection(db, 'products'), {
        title,
        price,
        image,
        category: category || null,
        description,
        weight: weight || null,
        size: size || null,
        images,
        stock: Number.isFinite(stock) ? stock : 0,
        active: !!active,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser ? auth.currentUser.uid : null
      });
      form.reset();
      updateAddPreview();
      updateAddPreviewImage();
      updateAddPreviewGallery();
      setMessage('Product added successfully.');
      if (submitBtn) submitBtn.disabled = prevDisabled ?? false;
      croppedMainImageFile = null; selectedMainUrl = ''; selectedGalleryUrls = [];
    } else {
      // Update existing
      const payload = {
        title,
        price,
        category: category || null,
        description,
        weight: weight || null,
        size: size || null,
        stock: Number.isFinite(stock) ? stock : 0,
        active: !!active
      };
      if (selectedMainUrl) {
        payload.image = selectedMainUrl;
      } else {
        const mainFileUpd = (croppedMainImageFile instanceof File) ? croppedMainImageFile : (imageFile instanceof File ? imageFile : null);
        if (mainFileUpd instanceof File && mainFileUpd.size > 0) {
          setMessage('Uploading image...', true);
          let uploaded = '';
          try { uploaded = await uploadToGithubAdmin(mainFileUpd); }
          catch { uploaded = await uploadToImgbb(mainFileUpd); }
          if (uploaded) payload.image = uploaded;
        }
      }
      // Gallery: if new files selected, replace existing images with up to 5 uploads; else keep original
      try {
        const selectedCount = Array.isArray(selectedGalleryUrls) ? selectedGalleryUrls.length : 0;
        const leftSlots = Math.max(0, 5 - selectedCount);
        const max = Math.min(leftSlots, galleryFiles.length);
        if (max > 0 || selectedCount > 0) {
          const imagesNew = Array.isArray(selectedGalleryUrls) ? selectedGalleryUrls.slice(0,5) : [];
          for (let i = 0; i < max; i++) {
            const f = galleryFiles[i];
            if (f && f.size > 0) {
              let url = '';
              try { url = await uploadToGithubAdmin(f); }
              catch { url = await uploadToImgbb(f); }
              if (url) imagesNew.push(url);
            }
          }
          payload.images = imagesNew;
        }
      } catch {}
      await updateDoc(doc(db,'products', editUsingAdd.productId), payload);
      setMessage('Product updated.');
      // Exit edit mode
      editUsingAdd = { active: false, productId: null, original: null };
      if (addSectionTitle) addSectionTitle.textContent = 'Add Product';
      if (addSubmitBtn) addSubmitBtn.textContent = 'Add Product';
      if (addCancelEditBtn) addCancelEditBtn.classList.add('hidden');
      form.reset();
      updateAddPreview();
      updateAddPreviewImage();
      updateAddPreviewGallery();
      // After successful edit, go to All Products tab
      try { location.hash = '#products'; showSection('products'); } catch {}
      if (submitBtn) submitBtn.disabled = prevDisabled ?? false;
      croppedMainImageFile = null; selectedMainUrl = ''; selectedGalleryUrls = [];
    }
  } catch (err) {
    setMessage('Failed to add product: ' + err.message, false);
  } finally {
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = false;
  }
});

function renderProducts() {
  const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snap) => {
    listEl.innerHTML = '';
    if (snap.empty) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');
    productsCache = [];
    const frag = document.createDocumentFragment();
    snap.forEach(d => {
      const data = d.data();
      productsCache.push({ id: d.id, ...data, price: Number(data.price) });
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
        </div>
      `;
      card.querySelector('.delete').addEventListener('click', async () => {
        if (!confirm('Delete this product?')) return;
        try {
          await deleteDoc(doc(db, 'products', d.id));
        } catch (err) {
          alert('Delete failed: ' + err.message);
        }
      });
      card.querySelector('.edit').addEventListener('click', () => {
        // Use Add Product form for editing
        editUsingAdd = { active: true, productId: d.id, original: { ...data } };
        if (addSectionTitle) addSectionTitle.textContent = 'Edit Product';
        if (addSubmitBtn) addSubmitBtn.textContent = 'Save Changes';
        if (addCancelEditBtn) addCancelEditBtn.classList.remove('hidden');
        // Fill form fields
        if (form) {
          if (form.title) form.title.value = data.title || '';
          if (form.price) form.price.value = data.price || 0;
          const cat = form.querySelector('[name="category"]'); if (cat) cat.value = data.category || '';
          // Parse existing weight like '1kg', '500g', '1L'
          try {
            const s = String(data.weight || '').trim().toLowerCase();
            const m = s.match(/([0-9]*\.?[0-9]+)\s*(kg|g|l|liter|ltr)?/);
            if (m) {
              const v = parseFloat(m[1]);
              const u = m[2] || 'g';
              if (form.weightValue && form.weightUnit) {
                if (u === 'kg') { form.weightValue.value = String(v); form.weightUnit.value = 'kg'; }
                else if (u === 'l' || u === 'liter' || u === 'ltr') { form.weightValue.value = String(v); form.weightUnit.value = 'l'; }
                else { // grams -> convert to kg
                  form.weightValue.value = String((v/1000));
                  form.weightUnit.value = 'kg';
                }
              }
            } else {
              if (form.weightValue) form.weightValue.value = '';
            }
          } catch { if (form.weightValue) form.weightValue.value = ''; }
          if (form.size) form.size.value = data.size || '';
          if (form.description) form.description.value = data.description || '';
          if (form.stock) form.stock.value = Number(data.stock || 0);
          if (form.active) form.active.checked = data.active === false ? false : true;
          // Reset file inputs
          if (form.image) form.image.value = '';
          const gal = form.querySelector('[name="gallery"]'); if (gal) gal.value = '';
        }
        // Update preview with existing images
        updateAddPreview();
        updateAddPreviewImage();
        updateAddPreviewGallery();
        // Scroll to Add section
        const addSection = document.getElementById('add');
        if (addSection) addSection.scrollIntoView({ behavior: 'smooth' });
        // Switch visible section to Add
        showSection('add');
      });
      card.querySelector('.toggle-active').addEventListener('click', async () => {
        try {
          await updateDoc(doc(db, 'products', d.id), { active: data.active === false ? true : false });
        } catch (err) {
          alert('Update failed: ' + err.message);
        }
      });
      frag.appendChild(card);
    });
    listEl.appendChild(frag);
  }, (err) => {
    setMessage('Failed to load products: ' + err.message, false);
  });
}

renderProducts();

// Section visibility control (show only one section at a time)
const sectionMap = {
  add: document.getElementById('add'),
  products: document.getElementById('products'),
  'orders-section': document.getElementById('orders-section'),
  shipping: document.getElementById('shipping'),
  site: document.getElementById('site'),
  notes: document.getElementById('notes'),
  files: document.getElementById('files'),
  chat: document.getElementById('chat')
};

function showSection(id) {
  const key = id && sectionMap[id] ? id : 'products';
  Object.entries(sectionMap).forEach(([k, el]) => {
    if (!el) return;
    if (k === key) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
  // When entering File Manager, refresh folder list
  if (key === 'files') {
    try { if (!getGithubTokenAdmin()) ensureGithubTokenAdmin(); loadSiteRepoFolders(); } catch {}
  }
  // When entering Notes, ensure notes are loaded
  if (key === 'notes') {
    try { loadNotes(); } catch {}
  }
}

window.addEventListener('hashchange', () => showSection(location.hash.replace('#','')));
// Initial section (DOMContentLoaded safety)
try {
  const init = () => showSection(location.hash.replace('#',''));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
} catch {}

// Try to pre-load folders once DOM is ready regardless of current section
try {
  const kick = () => { try { if (location.hash.replace('#','') === 'files') { if (!getGithubTokenAdmin()) ensureGithubTokenAdmin(); loadSiteRepoFolders(); } } catch {} };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kick, { once: true });
  } else {
    kick();
  }
} catch {}

// Sidebar links safety: force SPA-style switch without full reload
try {
  document.querySelectorAll('.admin-nav a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const hash = (a.getAttribute('href') || '#').replace('#','');
      if (hash) {
        history.replaceState(null, '', `admin.html#${hash}`);
        showSection(hash);
      }
    });
  });
} catch {}

// Live Orders list
function drawOrders() {
  if (!ordersListEl) return;
  ordersListEl.innerHTML = '';
  const filterVal = ordersFilter?.value || 'All';
  let subset = lastOrders.filter(o => filterVal === 'All' || o.data.status === filterVal);
  if (ordersUserFilter) subset = subset.filter(o => (o.data.userId || null) === ordersUserFilter);
  if (subset.length === 0) {
    ordersEmptyEl?.classList.remove('hidden');
    updateOrdersBadge();
    return;
  }
  ordersEmptyEl?.classList.add('hidden');
  const frag = document.createDocumentFragment();
  subset.forEach(({ id, data: o }) => {
    const div = document.createElement('div');
    div.className = 'border rounded p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-center';
    const count = Array.isArray(o.items) ? o.items.reduce((s,i)=>s+i.qty,0) : 0;
    const when = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : '';
    div.innerHTML = `
      <div>
        <div class="font-medium">Order #${id.slice(-6)}</div>
        <div class="text-sm text-gray-600">Items: ${count} · User: ${o.userId || 'guest'} · ${when}</div>
        <div class="text-sm text-gray-600">${o.customer?.name || ''} · ${o.customer?.phone || ''}</div>
      </div>
      <div class="font-semibold">৳${Number(o.total || 0).toFixed(2)}</div>
      <div class="flex items-center gap-2">
        <label class="text-sm">Status</label>
        <select class="border rounded px-2 py-1 admin-status">
          ${['Pending','Processing','Shipped','Delivered','Cancelled'].map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="text-right">
        <button class="view px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">View</button>
      </div>
    `;
    div.querySelector('.admin-status').addEventListener('change', async (e)=>{
      const nextStatus = e.target.value;
      try {
        await runTransaction(db, async (tx) => {
          const orderRef = doc(db, 'orders', id);
          const ordSnap = await tx.get(orderRef);
          if (!ordSnap.exists()) throw new Error('Order not found');
          const ord = ordSnap.data() || {};
          const prevStatus = ord.status || 'Pending';
          const alreadyRestocked = !!ord.restocked;
          // If transitioning to Cancelled and not restocked before, add items back to stock
          if (nextStatus === 'Cancelled' && prevStatus !== 'Cancelled' && !alreadyRestocked) {
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
            tx.update(orderRef, { status: nextStatus, restocked: true });
          } else {
            // Just update status (do not decrement again if moving out of Cancelled)
            tx.update(orderRef, { status: nextStatus });
          }
        });
      } catch(err) { alert('Failed to update: '+err.message); }
    });
    div.querySelector('.view').addEventListener('click', ()=> { window.location.href = `view.html?id=${id}`; });
    frag.appendChild(div);
  });
  ordersListEl.appendChild(frag);
  updateOrdersBadge();
}

// ========== Live Chat (Admin) ==========
let chatSessions = [];
let selectedChatId = null;
let unsubChatMessages = null;
let unsubChatSessionMeta = null;
let adminTypingTimer = null;
let selectedGroupKey = null;

function getGroupKey(s){
  const d = s.data || {};
  return d.userId ? `user:${d.userId}` : (d.userEmail ? `email:${d.userEmail}` : `guest:${s.id}`);
}

function renderChatSessions(){
  if (!chatSessionsEl) return;
  chatSessionsEl.innerHTML = '';
  // Build groups by user (guests remain separate)
  const groupsMap = new Map();
  chatSessions.forEach(s=>{
    const key = getGroupKey(s);
    let g = groupsMap.get(key);
    const ts = s.data.updatedAt?.toDate ? s.data.updatedAt.toDate().getTime() : 0;
    if (!g) {
      g = {
        key,
        isUser: !!s.data.userId,
        title: s.data.userId ? (s.data.userEmail || s.data.userId) : (s.data.userEmail || `Guest ${s.id.slice(-6)}`),
        lastMessage: s.data.lastMessage || '',
        updatedAtMs: ts,
        anyUnread: !!s.data.adminUnread,
        latestSessionId: s.id
      };
      groupsMap.set(key, g);
    } else {
      if (ts > g.updatedAtMs) { g.updatedAtMs = ts; g.lastMessage = s.data.lastMessage || ''; g.latestSessionId = s.id; }
      if (s.data.adminUnread) g.anyUnread = true;
    }
  });
  const groups = Array.from(groupsMap.values()).sort((a,b)=> b.updatedAtMs - a.updatedAtMs);
  if (chatCountEl) chatCountEl.textContent = groups.length > 0 ? `${groups.length}` : '';
  // Update unread badge in sidebar (unique users)
  try {
    const unread = groups.filter(g => g.anyUnread).length;
    if (chatBadge) {
      if (unread > 0) { chatBadge.textContent = String(unread); chatBadge.classList.remove('hidden'); }
      else { chatBadge.classList.add('hidden'); }
    }
  } catch {}
  const frag = document.createDocumentFragment();
  groups.forEach(g => {
    const div = document.createElement('div');
    const unreadDot = g.anyUnread ? '<span class="ml-2 inline-block w-2 h-2 rounded-full bg-blue-600 align-middle"></span>' : '';
    div.className = `px-3 py-2 cursor-pointer ${selectedGroupKey===g.key?'bg-blue-50':''}`;
    const when = g.updatedAtMs ? new Date(g.updatedAtMs).toLocaleString() : '';
    div.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="font-medium flex items-center">${g.title}${unreadDot}</div>
        <span class="text-xs ${g.isUser?'text-green-700':'text-gray-500'}">${g.isUser?'User':'Guest'}</span>
      </div>
      <div class="text-xs text-gray-600 line-clamp-1">${g.lastMessage || ''}</div>
      <div class="text-[11px] text-gray-400">${when}</div>
    `;
    div.addEventListener('click', ()=> selectChatGroup(g));
    frag.appendChild(div);
  });
  chatSessionsEl.appendChild(frag);
}

async function selectChatSession(id){
  selectedChatId = id;
  chatMessagesAdminEl.innerHTML = '';
  if (unsubChatMessages) { unsubChatMessages(); unsubChatMessages = null; }
  if (unsubChatSessionMeta) { unsubChatSessionMeta(); unsubChatSessionMeta = null; }
  const cur = chatSessions.find(x=>x.id===id);
  if (chatMetaEl) {
    let meta = 'Select a session';
    if (cur) {
      const isUser = !!cur.data.userId;
      const label = isUser ? (cur.data.userEmail || cur.data.userId) : `Guest ${id.slice(-6)}`;
      // Links: view orders filtered and profile (for users)
      if (isUser) {
        meta = `User: <a href="#" id="chat-user-link" class="text-blue-700 hover:underline">${label}</a>`;
      } else {
        meta = `Guest: ${label}`;
      }
      // append profile + latest order if user
      if (isUser) {
        try {
          const uSnap = await getDoc(doc(db,'users', cur.data.userId));
          const role = uSnap.exists() ? (uSnap.data()?.role || 'user') : 'user';
          const oq = query(collection(db,'orders'), where('userId','==', cur.data.userId), orderBy('createdAt','desc'), limit(1));
          const oSnap = await getDocs(oq);
          const lastOrder = oSnap.docs[0];
          const ordInfo = lastOrder ? ` · Last order #${lastOrder.id.slice(-6)} (${(lastOrder.data().status)||'Pending'})` : '';
          meta += ` · Role: ${role}${ordInfo} · <a href="orders.html#orders-section" id="chat-view-orders" class="text-blue-700 hover:underline">View orders</a>`;
        } catch {}
      }
    }
    chatMetaEl.innerHTML = meta;
    // Wire links
    try {
      const cur2 = cur;
      const link = document.getElementById('chat-user-link');
      if (link && cur2?.data?.userId) {
        link.addEventListener('click', (e)=>{
          e.preventDefault();
          // jump to orders section filtered by this user
          window.location.hash = '#orders-section';
          showSection('orders-section');
          window.setOrdersUserFilter(cur2.data.userId);
          drawOrders();
        });
      }
      const viewOrders = document.getElementById('chat-view-orders');
      if (viewOrders && cur2?.data?.userId) {
        viewOrders.addEventListener('click', (e)=>{
          e.preventDefault();
          window.location.hash = '#orders-section';
          showSection('orders-section');
          window.setOrdersUserFilter(cur2.data.userId);
          drawOrders();
        });
      }
    } catch {}
  }
  // stream messages
  unsubChatMessages = onSnapshot(query(collection(db,'chat_sessions', id, 'messages'), orderBy('createdAt','asc')), (snap)=>{
    chatMessagesAdminEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    snap.forEach(d=>{
      const m = d.data();
      const mine = m.from === 'admin';
      const row = document.createElement('div');
      row.className = `flex ${mine ? 'justify-end' : 'justify-start'}`;
      const bubble = document.createElement('div');
      bubble.className = `${mine ? 'bg-gray-800 text-white' : 'bg-white border'} inline-block rounded-2xl px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words`;
      bubble.textContent = m.text || '';
      row.appendChild(bubble);
      frag.appendChild(row);
    });
    chatMessagesAdminEl.appendChild(frag);
    chatMessagesAdminEl.scrollTop = chatMessagesAdminEl.scrollHeight;
  });
  // stream session meta for typing indicator from user + live draft bubble
  try {
    const typingId = 'chat-typing-admin';
    let ind = document.getElementById(typingId);
    if (!ind) {
      ind = document.createElement('div');
      ind.id = typingId;
      ind.className = 'px-3 py-1 text-xs text-gray-500 hidden';
      ind.textContent = 'User is typing…';
      chatMessagesAdminEl?.parentElement?.insertBefore(ind, chatMessagesAdminEl.nextSibling);
    }
    unsubChatSessionMeta = onSnapshot(doc(db,'chat_sessions', id), (snap)=>{
      const data = snap.data() || {};
      if (data.userTyping) ind.classList.remove('hidden');
      else ind.classList.add('hidden');
      // Live draft bubble (faint preview of what user is typing)
      try {
        const prevId = 'chat-draft-preview';
        let prev = document.getElementById(prevId);
        if (data.userDraft && String(data.userDraft).trim().length > 0) {
          if (!prev) {
            prev = document.createElement('div');
            prev.id = prevId;
            prev.className = 'mt-1';
            // append after current messages
            chatMessagesAdminEl.appendChild(prev);
          }
          // Render as faint incoming bubble
          prev.innerHTML = '';
          const row = document.createElement('div');
          row.className = 'flex justify-start';
          const bubble = document.createElement('div');
          bubble.className = 'inline-block rounded-2xl px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words bg-white border opacity-70';
          bubble.textContent = String(data.userDraft).slice(0,500);
          row.appendChild(bubble);
          prev.appendChild(row);
          // keep scroll at bottom when draft updates
          chatMessagesAdminEl.scrollTop = chatMessagesAdminEl.scrollHeight;
        } else if (prev) {
          prev.remove();
        }
      } catch {}
    });
  } catch {}
  // mark as read for admin
  try {
    await updateDoc(doc(db,'chat_sessions', id), { adminUnread: false, adminUnreadCount: 0 });
  } catch {}
}

async function selectChatGroup(group){
  selectedGroupKey = group.key;
  // Always open latest session in the group
  await selectChatSession(group.latestSessionId);
  // If this is a user group, clear unread across all sessions for this user
  try {
    if (group.isUser) {
      const uid = (group.key || '').replace(/^user:/,'');
      const qy = query(collection(db,'chat_sessions'), where('userId','==', uid));
      const snap = await getDocs(qy);
      await Promise.all(snap.docs.map(d=> updateDoc(doc(db,'chat_sessions', d.id), { adminUnread: false, adminUnreadCount: 0 }).catch(()=>{})));
    }
  } catch {}
}

async function sendAdminReply(){
  const text = (chatReplyInput?.value||'').toString().trim();
  if (!selectedChatId || !text) return;
  try {
    await addDoc(collection(db,'chat_sessions', selectedChatId, 'messages'), {
      text,
      from: 'admin',
      adminId: auth.currentUser ? auth.currentUser.uid : null,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db,'chat_sessions', selectedChatId), {
      updatedAt: serverTimestamp(),
      lastMessage: text,
      lastFrom: 'admin',
      userUnread: true
    });
    if (chatReplyInput) { chatReplyInput.value = ''; chatSendBtn?.setAttribute('disabled',''); }
  } catch (e) { alert('Send failed: ' + e.message); }
}

chatSendBtn?.addEventListener('click', async ()=>{
  await sendAdminReply();
});

// Enable Enter to send (Shift+Enter for newline)
chatReplyInput?.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAdminReply();
  }
});

// Disable send button if empty
function updateAdminSendState(){
  const has = !!String(chatReplyInput?.value||'').trim();
  if (chatSendBtn) chatSendBtn.disabled = !has;
}
chatReplyInput?.addEventListener('input', updateAdminSendState);
updateAdminSendState();

// Admin typing indicator (debounced)
chatReplyInput?.addEventListener('input', ()=>{
  const curId = selectedChatId;
  if (!curId) return;
  try { updateDoc(doc(db,'chat_sessions', curId), { adminTyping: true }); } catch {}
  if (adminTypingTimer) clearTimeout(adminTypingTimer);
  adminTypingTimer = setTimeout(()=>{
    try { updateDoc(doc(db,'chat_sessions', curId), { adminTyping: false }); } catch {}
  }, 1200);
});

// Load chat sessions live
if (chatSessionsEl) {
  const cq = query(collection(db,'chat_sessions'), orderBy('updatedAt','desc'));
  onSnapshot(cq, (snap)=>{
    chatSessions = snap.docs.map(d=>({ id: d.id, data: d.data() }));
    renderChatSessions();
  }, (err)=> console.error('Chat load failed', err));
}

function renderOrders() {
  if (!ordersListEl) return;
  const oq = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  onSnapshot(oq, (snap) => {
    lastOrders = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    drawOrders();
  }, (err)=>{
    console.error('Orders load failed', err);
  });
}

renderOrders();

// Delivery settings
async function loadShipping() {
  if (!shippingForm) return;
  try {
    const ref = doc(db, 'settings', 'shipping');
    const snap = await getDoc(ref);
    const s = snap.exists() ? snap.data() : {};
    shippingCfg = s;
    if (shippingForm) {
      shippingForm.fixedFee.value = s.fixedFee ?? '';
      shippingForm.fixedUpToGrams.value = s.fixedUpToGrams ?? '';
      shippingForm.extraPerKg.value = s.extraPerKg ?? '';
      shippingForm.fallbackFee.value = s.fallbackFee ?? '';
    }
  } catch (e) {
    if (shippingMsg) shippingMsg.textContent = 'Failed to load settings: ' + e.message;
  }
}

shippingForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      fixedFee: Number(shippingForm.fixedFee.value || 0),
      fixedUpToGrams: Number(shippingForm.fixedUpToGrams.value || 0),
      extraPerKg: Number(shippingForm.extraPerKg.value || 0),
      fallbackFee: Number(shippingForm.fallbackFee.value || 0),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, 'settings', 'shipping'), payload, { merge: true });
    shippingMsg.textContent = 'Settings saved.';
    shippingMsg.className = 'text-sm mt-3 text-green-700';
  } catch (e) {
    shippingMsg.textContent = 'Save failed: ' + e.message;
    shippingMsg.className = 'text-sm mt-3 text-red-700';
  }
});

loadShipping();
// Site settings load/save
async function loadSiteSettings(){
  if (!siteForm) return;
  try {
    const ref = doc(db, 'settings', 'site');
    const snap = await getDoc(ref);
    const s = snap.exists() ? snap.data() : {};
    siteForm.title.value = s.title ?? '';
    siteForm.logo.value = s.logo ?? '';
    siteForm.favicon.value = s.favicon ?? '';
    siteForm.email.value = s.email ?? '';
    siteForm.phone.value = s.phone ?? '';
    if ('marqueeEnabled' in siteForm) siteForm.marqueeEnabled.checked = !!s.marqueeEnabled;
    if ('marqueeText' in siteForm) siteForm.marqueeText.value = s.marqueeText ?? '';
    // update previews if existing
    const lp = document.getElementById('site-logo-preview');
    const fp = document.getElementById('site-favicon-preview');
    if (lp) { if (s.logo) { lp.src = s.logo; lp.classList.remove('hidden'); } else { lp.src=''; lp.classList.add('hidden'); } }
    if (fp) { if (s.favicon) { fp.src = s.favicon; fp.classList.remove('hidden'); } else { fp.src=''; fp.classList.add('hidden'); } }
  } catch (e) {
    if (siteMsg) { siteMsg.textContent = 'Failed to load site settings: ' + e.message; siteMsg.className = 'text-sm mt-3 text-red-700'; }
  }
}

siteForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  try {
    if (siteMsg) { siteMsg.textContent = 'Saving...'; siteMsg.className = 'text-sm mt-3 text-gray-700'; }
    // Upload files if provided
    let logoUrl = (siteForm.logo.value || '').toString().trim();
    let favUrl = (siteForm.favicon.value || '').toString().trim();
    const logoFile = siteForm.querySelector('[name="logoFile"]').files?.[0];
    const faviconFile = siteForm.querySelector('[name="faviconFile"]').files?.[0];
    if (logoFile && logoFile.size > 0) {
      const up = await uploadToImgbb(logoFile);
      if (up) logoUrl = up;
    }
    if (faviconFile && faviconFile.size > 0) {
      const up = await uploadToImgbb(faviconFile);
      if (up) favUrl = up;
    }
    const payload = {
      title: (siteForm.title.value || '').toString().trim() || null,
      logo: logoUrl || null,
      favicon: favUrl || null,
      email: (siteForm.email.value || '').toString().trim() || null,
      phone: (siteForm.phone.value || '').toString().trim() || null,
      marqueeEnabled: siteForm.marqueeEnabled?.checked ? true : false,
      marqueeText: (siteForm.marqueeText?.value || '').toString().trim() || null,
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db,'settings','site'), payload, { merge: true });
    if (siteMsg) { siteMsg.textContent = 'Site settings saved.'; siteMsg.className = 'text-sm mt-3 text-green-700'; }
    // refresh previews
    const lp = document.getElementById('site-logo-preview');
    const fp = document.getElementById('site-favicon-preview');
    if (lp) { if (payload.logo) { lp.src = payload.logo; lp.classList.remove('hidden'); } else { lp.src=''; lp.classList.add('hidden'); } }
    if (fp) { if (payload.favicon) { fp.src = payload.favicon; fp.classList.remove('hidden'); } else { fp.src=''; fp.classList.add('hidden'); } }
  } catch (e) {
    if (siteMsg) { siteMsg.textContent = 'Save failed: ' + e.message; siteMsg.className = 'text-sm mt-3 text-red-700'; }
  }
});

loadSiteSettings();

// Live preview handlers for logo and favicon (URL and file)
if (siteForm) {
  const logoUrl = siteForm.querySelector('[name="logo"]');
  const favUrl = siteForm.querySelector('[name="favicon"]');
  const logoFile = siteForm.querySelector('[name="logoFile"]');
  const favFile = siteForm.querySelector('[name="faviconFile"]');
  const lp = document.getElementById('site-logo-preview');
  const fp = document.getElementById('site-favicon-preview');
  const show = (imgEl, url)=>{ if (!imgEl) return; if (url) { imgEl.src=url; imgEl.classList.remove('hidden'); } else { imgEl.src=''; imgEl.classList.add('hidden'); } };
  logoUrl?.addEventListener('input', ()=> show(lp, logoUrl.value.trim()));
  favUrl?.addEventListener('input', ()=> show(fp, favUrl.value.trim()));
  logoFile?.addEventListener('change', ()=>{ const f=logoFile.files?.[0]; if (f) show(lp, URL.createObjectURL(f)); });
  favFile?.addEventListener('change', ()=>{ const f=favFile.files?.[0]; if (f) show(fp, URL.createObjectURL(f)); });
}

// Orders filter change
ordersFilter?.addEventListener('change', drawOrders);

// Edit modal handlers
editClose?.addEventListener('click', ()=>{
  editModal.classList.add('hidden');
  editModal.classList.remove('flex');
});

editForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentEditProductId) return;
  const data = new FormData(editForm);
  const file = data.get('imageFile');
  const nextImageUrl = (data.get('image')||'').toString().trim();
  const rawImages = (data.get('images')||'').toString();
  let images = rawImages.split(/[\n,]/).map(s=>s.trim()).filter(Boolean).slice(0,5);
  const payload = {
    title: (data.get('title')||'').toString().trim(),
    price: Number(data.get('price')||0),
    category: (data.get('category')||'').toString().trim() || null,
    weight: (data.get('weight')||'').toString().trim() || null,
    size: (data.get('size')||'').toString().trim() || null,
    image: nextImageUrl,
    description: (data.get('description')||'').toString().trim() || '',
    stock: Number(data.get('stock')||0),
    active: data.get('active') ? true : false
  };
  payload.images = images; // set even if empty to allow clearing
  try {
    if (file instanceof File && file.size > 0) {
      const uploaded = await uploadToImgbb(file);
      payload.image = uploaded;
    }
    // Upload up to 5 optional gallery files (g1..g5) and append to images
    try {
      const optNames = ['g1','g2','g3','g4','g5'];
      for (const nm of optNames) {
        const f = editForm.querySelector(`[name="${nm}"]`)?.files?.[0];
        if (f && f.size > 0) {
          const url = await uploadToImgbb(f);
          if (url) images.push(url);
        }
      }
      payload.images = images.slice(0,5);
    } catch {}
    await updateDoc(doc(db,'products', currentEditProductId), payload);
    editMsg.textContent = 'Product updated.';
    editMsg.className = 'text-sm text-green-700';
    setTimeout(()=>{
      editModal.classList.add('hidden');
      editModal.classList.remove('flex');
    }, 500);
  } catch (e) {
    editMsg.textContent = 'Save failed: ' + e.message;
    editMsg.className = 'text-sm text-red-700';
  }
});

// Helpers for order modal
function parseWeightToGrams(w){
  if (!w) return 0; const s=String(w).trim().toLowerCase();
  const m=s.match(/([0-9]*\.?[0-9]+)\s*(kg|g)?/); if(!m) return 0;
  const v=parseFloat(m[1]); const u=m[2]||'g'; return u==='kg'?Math.round(v*1000):Math.round(v);
}
function calcDeliveryForItems(items){
  const cfg = shippingCfg || { fixedFee:60, fixedUpToGrams:1000, extraPerKg:30, fallbackFee:80 };
  const grams = items.reduce((s,i)=> s + parseWeightToGrams(i.weight)*i.qty, 0);
  if (grams<=0) return cfg.fallbackFee||0;
  const base = Number(cfg.fixedFee||0); const upTo = Number(cfg.fixedUpToGrams||0); const extraKg=Number(cfg.extraPerKg||0);
  if (upTo>0 && grams<=upTo) return base;
  const over = Math.max(0, grams - upTo); const blocks = Math.ceil(over/1000);
  return base + blocks*extraKg;
}

function renderModalItems(){
  const items = currentOrder.items;
  modalItemsTbody.innerHTML='';
  let subtotal=0;
  items.forEach((it, idx)=>{
    const line = it.price*it.qty; subtotal+=line;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2 border">${it.title}${it.weight?` · ${it.weight}`:''}</td>
      <td class="p-2 border text-right">৳${Number(it.price).toFixed(2)}</td>
      <td class="p-2 border text-right"><input type="number" min="1" value="${it.qty}" data-idx="${idx}" class="w-20 border rounded px-2 py-1 qty"/></td>
      <td class="p-2 border text-right">৳${line.toFixed(2)}</td>
      <td class="p-2 border text-right"><button data-idx="${idx}" class="remove text-red-600">Remove</button></td>
    `;
    tr.querySelector('.qty').addEventListener('change', (e)=>{
      const i = Number(e.target.getAttribute('data-idx')); currentOrder.items[i].qty = Math.max(1, Number(e.target.value)||1); renderModalItems();
    });
    tr.querySelector('.remove').addEventListener('click', ()=>{
      const i = Number(tr.querySelector('.remove').getAttribute('data-idx'));
      currentOrder.items.splice(i,1); renderModalItems();
    });
    modalItemsTbody.appendChild(tr);
  });
  const delivery = calcDeliveryForItems(items);
  modalSubtotalEl.textContent = `৳${subtotal.toFixed(2)}`;
  modalDeliveryEl.textContent = `৳${delivery.toFixed(2)}`;
  modalTotalEl.textContent = `৳${(subtotal+delivery).toFixed(2)}`;
}

function openOrderModal(id, data){
  currentOrder.id = id;
  currentOrder.data = data;
  currentOrder.items = Array.isArray(data.items) ? data.items.map(x=>({ ...x })) : [];
  modalMeta.textContent = `Order #${id.slice(-6)} · ${data.customer?.name||''} · ${data.customer?.phone||''}`;
  // populate product select
  modalAddSelect.innerHTML = '<option value="">Select product</option>' + productsCache.map(p=>`<option value="${p.id}">${p.title} — ৳${Number(p.price).toFixed(2)}${p.weight?` · ${p.weight}`:''}</option>`).join('');
  renderModalItems();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

modalClose?.addEventListener('click', ()=>{
  modal.classList.add('hidden');
  modal.classList.remove('flex');
});

modalAddBtn?.addEventListener('click', ()=>{
  const pid = modalAddSelect.value; const qty = Math.max(1, Number(modalAddQty.value)||1);
  if (!pid) return;
  const p = productsCache.find(x=>x.id===pid); if(!p) return;
  const existing = currentOrder.items.find(i=>i.id===pid);
  if (existing) existing.qty += qty; else currentOrder.items.push({ id: pid, title: p.title, price: Number(p.price), image: p.image, weight: p.weight||'', qty });
  renderModalItems();
});

modalSaveBtn?.addEventListener('click', async ()=>{
  try {
    const subtotal = currentOrder.items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
    const delivery = calcDeliveryForItems(currentOrder.items);
    await updateDoc(doc(db,'orders', currentOrder.id), {
      items: currentOrder.items,
      subtotal,
      delivery,
      total: subtotal + delivery
    });
    alert('Order updated');
    modal.classList.add('hidden'); modal.classList.remove('flex');
  } catch (e) { alert('Save failed: ' + e.message); }
});

modalPrintBtn?.addEventListener('click', ()=>{
  const w = window.open('', '_blank');
  const rows = currentOrder.items.map(i=>`<tr>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        <img src="${i.image||''}" alt="${i.title}" style="width:32px;height:32px;object-fit:cover;border:1px solid #ddd;border-radius:4px"/>
        <span>${i.title}${i.weight?` · ${i.weight}`:''}</span>
      </div>
    </td>
    <td style='text-align:right'>${i.qty}</td>
    <td style='text-align:right'>৳${Number(i.price).toFixed(2)}</td>
    <td style='text-align:right'>৳${(i.qty*i.price).toFixed(2)}</td>
  </tr>`).join('');
  const subtotal = currentOrder.items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
  const delivery = calcDeliveryForItems(currentOrder.items);
  const total = subtotal + delivery;
  w.document.write(`
    <html><head><title>Invoice</title><style>
    body{font-family:Arial,sans-serif;padding:24px}
    table{width:100%;border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px}
    </style></head><body>
      <h2>Bazar — Delivery Invoice</h2>
      <div>Order #${currentOrder.id.slice(-6)}</div>
      <div>${currentOrder.data.customer?.name||''} · ${currentOrder.data.customer?.phone||''}</div>
      <div>${currentOrder.data.customer?.address||''}</div>
      <hr/>
      <table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>
      ${rows}
      </tbody></table>
      <h3 style='text-align:right'>Subtotal: ৳${subtotal.toFixed(2)}<br/>Delivery: ৳${delivery.toFixed(2)}<br/>Total: ৳${total.toFixed(2)}</h3>
      <p>Thank you.</p>
      <script>window.print();</script>
    </body></html>
  `);
  w.document.close();
});

// Sidebar badge updater
function updateOrdersBadge(){
  if (!ordersBadge) return;
  const pending = lastOrders.filter(o => (o.data.status || 'Pending') === 'Pending').length;
  if (pending > 0) {
    ordersBadge.textContent = String(pending);
    ordersBadge.classList.remove('hidden');
  } else {
    ordersBadge.classList.add('hidden');
  }
}

// Expose a helper to filter orders by user from elsewhere (e.g., chat)
window.setOrdersUserFilter = function(userId){
  ordersUserFilter = userId || null;
  // Show a small chip next to the filter if element exists
  try {
    let host = document.getElementById('orders-section');
    if (host) {
      let chip = host.querySelector('#orders-user-chip');
      if (!chip) {
        const bar = host.querySelector('div.flex.items-center.justify-between');
        if (bar) {
          chip = document.createElement('span');
          chip.id = 'orders-user-chip';
          chip.className = 'ml-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 border';
          bar.appendChild(chip);
        }
      }
      if (chip) {
        if (ordersUserFilter) {
          chip.innerHTML = `User filter: ${ordersUserFilter.slice(-6)} <button id="orders-user-chip-clear" class="ml-1 px-1 rounded bg-blue-600 text-white">×</button>`;
          chip.classList.remove('hidden');
          chip.querySelector('#orders-user-chip-clear')?.addEventListener('click', ()=>{ window.setOrdersUserFilter(null); drawOrders(); });
        } else {
          chip.classList.add('hidden');
        }
      }
    }
  } catch {}
}
