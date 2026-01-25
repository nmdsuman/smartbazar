import { auth, db } from './firebase-config.js';
import {
  collection,
  addDoc,
  doc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';

// Elements
const form = document.getElementById('add-product-form');
const msg = document.getElementById('admin-message');
const addSectionTitle = document.getElementById('add-section-title');
const addSubmitBtn = document.getElementById('add-submit-btn');
const addCancelEditBtn = document.getElementById('add-cancel-edit');
const btnImageClear = document.getElementById('btn-image-clear');
const btnGalleryClear = document.getElementById('btn-gallery-clear');

// Live preview elements
const prevImg = document.getElementById('add-preview-image');
const prevPlaceholder = document.getElementById('preview-placeholder');
const prevTitle = document.getElementById('add-preview-title');
const prevPrice = document.getElementById('add-preview-price');
const prevExtra = document.getElementById('add-preview-extra');
const prevDesc = document.getElementById('add-preview-desc'); // Might not exist in new layout but good to keep safe
const prevGallery = document.getElementById('add-preview-gallery');

// Variants elements
const variantsList = document.getElementById('variants-list');
const variantAddBtn = document.getElementById('variant-add');
const pieceWeightWrap = document.getElementById('piece-weight');

// Media Library elements
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

// State
let editUsingAdd = { active: false, productId: null, original: null };
let croppedMainImageFile = null;
let cropper = null;
let mediaItems = [];
let mediaSelected = new Set();
let mediaMode = 'main';
let selectedMainUrl = '';
let selectedGalleryUrls = [];

// ===== Variants helpers =====
function currentUnitLabel(){
  try { const wu = form && form.weightUnit ? String(form.weightUnit.value||'').trim() : 'kg'; return wu === 'l' ? 'L' : (wu === 'kg' ? 'kg' : (wu === 'pc' ? 'pc' : 'kg')); } catch { return 'kg'; }
}

// Updated to match the new "Base Variant" row design perfectly
function makeVariantRow(labelValue = '', priceValue = ''){
  const row = document.createElement('div');
  row.className = 'grid grid-cols-1 sm:grid-cols-12 gap-4 items-start relative animate-fade-in p-3 rounded-lg border border-gray-200 bg-gray-50';
  
  // Parse incoming label like '500g', '0.5kg', '1L', '2pc'
  let initVal = '';
  let initUnit = (currentUnitLabel() === 'L' ? 'l' : (currentUnitLabel() || 'kg'));
  try {
    const s = String(labelValue||'').trim().toLowerCase().replace(/\s+/g,'');
    if (s){
      const m = s.match(/^([0-9]*\.?[0-9]+)(kg|g|l|liter|ltr|ml|pc)?$/);
      if (m){
        let v = parseFloat(m[1]);
        let u = m[2] || initUnit;
        if (u === 'liter' || u === 'ltr') u = 'l';
        if (u === 'g'){ v = v/1000; u = 'kg'; }
        if (u === 'ml'){ v = v/1000; u = 'l'; }
        initVal = Number.isFinite(v) ? String(v) : '';
        initUnit = u;
      } else {
        initVal = s; // fallback
      }
    }
  } catch {}

  row.innerHTML = `
    <!-- Delete Button (Top Right) -->
    <button type="button" class="variant-del absolute -top-2 -right-2 bg-white text-red-500 hover:text-red-700 hover:bg-red-50 border border-gray-200 rounded-full p-1 shadow-sm transition-colors z-10" title="Remove option">
       <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
    </button>

    <!-- Weight Value -->
    <div class="sm:col-span-4">
      <label class="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Weight Value</label>
      <input type="number" step="0.01" min="0" placeholder="e.g. 0.5" class="w-full border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 py-2 px-3 variant-weight" value="${initVal ? String(initVal).replace(/"/g,'&quot;') : ''}">
    </div>

    <!-- Unit Select -->
    <div class="sm:col-span-3">
      <label class="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Unit</label>
      <select class="variant-unit-select w-full border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 py-2 px-3 bg-white">
        <option value="kg" ${initUnit==='kg'?'selected':''}>kg</option>
        <option value="l" ${initUnit==='l'?'selected':''}>L</option>
        <option value="pc" ${initUnit==='pc'?'selected':''}>pc</option>
      </select>
    </div>

    <!-- Price Input -->
    <div class="sm:col-span-3">
      <label class="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Price</label>
      <div class="relative">
        <span class="absolute left-3 top-2 text-gray-400">৳</span>
        <input type="number" step="0.01" min="0" placeholder="0.00" class="w-full pl-7 border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 py-2 font-semibold text-gray-700 variant-price" value="${priceValue !== '' && priceValue !== null && priceValue !== undefined ? String(priceValue) : ''}">
      </div>
    </div>
    
    <!-- Placeholder for alignment -->
    <div class="sm:col-span-2"></div>
  `;
  
  row.querySelector('.variant-del').addEventListener('click', ()=>{ 
    row.style.opacity = '0';
    setTimeout(() => row.remove(), 200); 
  });
  
  return row;
}

function clearVariants(){ if (variantsList) variantsList.innerHTML = ''; }

function addVariant(label='', price=''){ if (!variantsList) return; variantsList.appendChild(makeVariantRow(label, price)); }

function getVariantsFromForm(){
  if (!variantsList) return [];
  const rows = Array.from(variantsList.querySelectorAll('.variant-price')).map((_,i)=> i);
  const out = [];
  const weights = variantsList.querySelectorAll('.variant-weight');
  const unitSelects = variantsList.querySelectorAll('.variant-unit-select');
  const prices = variantsList.querySelectorAll('.variant-price');
  
  // Piece weight per unit logic
  let perPieceGrams = 0;
  try {
    if (form) {
      const pwv = form.querySelector('[name="pieceWeightValue"]');
      const pwu = form.querySelector('[name="pieceWeightUnit"]');
      const v = Number(pwv && pwv.value ? pwv.value : NaN);
      const u = pwu && pwu.value ? String(pwu.value).trim() : 'g';
      if (Number.isFinite(v) && v > 0) {
        perPieceGrams = u === 'kg' ? v * 1000 : v;
      }
    }
  } catch {}

  for (let i=0;i<rows.length;i++){
    const wv = String(weights[i]?.value||'').trim();
    const wu = String(unitSelects[i]?.value||'').trim();
    const price = Number(prices[i]?.value || NaN);
    
    if (!wv) continue;
    if (!Number.isFinite(price)) continue;
    
    const unitOut = wu === 'l' ? 'L' : (wu === 'kg' ? 'kg' : (wu === 'pc' ? 'pc' : 'kg'));
    const label = `${wv}${unitOut}`;
    const opt = { label, price };
    
    if (wu === 'pc' && perPieceGrams > 0) {
      let count = Number(wv);
      if (Number.isFinite(count) && count > 0) {
        opt.weightGrams = Math.round(count * perPieceGrams);
      }
    }
    out.push(opt);
  }
  return out.slice(0,20);
}

variantAddBtn?.addEventListener('click', ()=> addVariant());

// Simple message helper
function setMessage(text, ok = true) {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `text-sm font-medium ${ok ? 'text-green-600' : 'text-red-600'}`;
  // Fade out after 5s
  setTimeout(() => { if(msg.textContent === text) msg.textContent = ''; }, 5000);
}

// Upload helpers (ImageBB & GitHub)
const IMGBB_API_KEY = '462884d7f63129dede1b67d612e66ee6';
const GH_REPO = 'nmdsuman/image';
const GH_BRANCH = 'main';

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
function getGithubTokenAdmin(){ try { return localStorage.getItem('GH_TOKEN') || ''; } catch { return ''; } }
function ensureGithubTokenAdmin(){ let t = getGithubTokenAdmin(); if (!t) { try { t = window.prompt('Enter GitHub token for image upload (stored locally):', '') || ''; if (t) localStorage.setItem('GH_TOKEN', t); } catch {} } return t; }
function extFromTypeAdmin(type){ if (!type) return 'jpg'; if (type.includes('png')) return 'png'; if (type.includes('webp')) return 'webp'; if (type.includes('svg')) return 'svg'; if (type.includes('gif')) return 'gif'; return 'jpg'; }
async function uploadToGithubAdmin(file){ const token = ensureGithubTokenAdmin(); if (!token) throw new Error('GitHub token missing'); const b64 = await fileToBase64(file); const now = new Date(); const yyyy = now.getFullYear(); const mm = String(now.getMonth()+1).padStart(2,'0'); const rand = Math.random().toString(36).slice(2,8); const ext = extFromTypeAdmin(file.type||''); const path = `images/${yyyy}/${mm}/${Date.now()}-${rand}.${ext}`; const apiUrl = `https://api.github.com/repos/${GH_REPO}/contents/${path}`; const res = await fetch(apiUrl, { method: 'PUT', headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Add product image', content: b64, branch: GH_BRANCH }) }); if (!res.ok) { const txt = await res.text().catch(()=> ''); throw new Error(`GitHub upload failed (${res.status}): ${txt.slice(0,200)}`); } return `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${path}`; }
async function uploadToImgbb(file){ const b64 = await fileToBase64(file); const fd = new FormData(); fd.append('image', b64); const res = await fetch(`https://api.imgbb.com/1/upload?expiration=0&key=${encodeURIComponent(IMGBB_API_KEY)}`, { method: 'POST', body: fd }); if (!res.ok) throw new Error('Image upload failed'); const json = await res.json(); if (!json?.success) throw new Error('Image upload failed'); return json.data?.url || json.data?.display_url || ''; }

// Cropper modal logic
const cropperModal = document.getElementById('cropper-modal');
const cropperImgEl = document.getElementById('cropper-image');
const cropperCloseBtn = document.getElementById('cropper-close');
const cropperCancelBtn = document.getElementById('cropper-cancel');
const cropperApplyBtn = document.getElementById('cropper-apply');

function openCropper(file){
  try {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (cropper) { try { cropper.destroy(); } catch {} cropper = null; }
    if (cropperImgEl) {
      cropperImgEl.src = url;
      cropperModal?.classList.remove('hidden');
      cropperModal?.classList.add('flex');
      cropperImgEl.onload = () => {
        try { cropper = new window.Cropper(cropperImgEl, { aspectRatio: NaN, viewMode: 1, autoCropArea: 0.9 }); } catch {}
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
      if (prevImg) { const u = URL.createObjectURL(file); prevImg.src = u; prevImg.classList.remove('hidden'); if(prevPlaceholder) prevPlaceholder.classList.add('hidden'); }
      closeCropper();
    }, 'image/jpeg', 0.9);
  } catch { closeCropper(); }
});

// Media Library
function showMediaModal(mode){ mediaMode = mode === 'gallery' ? 'gallery' : 'main'; try { mediaSelected.clear(); renderMediaGrid(); } catch {} mediaModal?.classList.remove('hidden'); mediaModal?.classList.add('flex'); loadMediaItems(); }
function hideMediaModal(){ mediaModal?.classList.add('hidden'); mediaModal?.classList.remove('flex'); }
async function loadMediaItems(){
  try {
    const { getDocs, query, collection, orderBy } = await import('firebase/firestore');
    let snap;
    try { snap = await getDocs(query(collection(db,'media'), orderBy('createdAt','desc'))); }
    catch { snap = await getDocs(collection(db,'media')); if (mediaMsg) { mediaMsg.textContent = 'Loaded without sort'; } }
    mediaItems = snap.docs.map(d=>({ id: d.id, url: d.data().url, createdAt: d.data().createdAt }));
    mediaItems.sort((a,b)=> (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
    renderMediaGrid();
  } catch (e) { if (mediaMsg) { mediaMsg.textContent = 'Failed to load library.'; } }
}
function renderMediaGrid(){ 
  if (!mediaGrid) return; mediaGrid.innerHTML=''; 
  const frag=document.createDocumentFragment(); 
  mediaItems.forEach(it=>{ 
    const w=document.createElement('button'); w.type='button'; 
    w.className=`relative border rounded-lg overflow-hidden bg-gray-50 focus:outline-none transition-all group aspect-square ${mediaSelected.has(it.id)?'ring-2 ring-blue-600 ring-offset-1':''}`;
    w.innerHTML=`<img src="${it.url}" alt="" class="w-full h-full object-cover group-hover:scale-110 transition-transform"><span class="absolute top-1 right-1 inline-block w-4 h-4 rounded-full border border-gray-200 ${mediaSelected.has(it.id)?'bg-blue-600 border-blue-600':'bg-white'}"></span>`; 
    w.addEventListener('click', ()=>{ if (mediaMode==='main'){ mediaSelected.clear(); mediaSelected.add(it.id);} else { if (mediaSelected.has(it.id)) mediaSelected.delete(it.id); else mediaSelected.add(it.id);} renderMediaGrid(); }); 
    frag.appendChild(w); 
  }); 
  mediaGrid.appendChild(frag); 
}

mediaClose?.addEventListener('click', hideMediaModal);
// Auto-upload on file select in media modal
mediaUpload?.addEventListener('change', async ()=>{
  try {
    if (!mediaUpload.files || mediaUpload.files.length === 0) return;
    if (mediaMsg) { mediaMsg.textContent = 'Uploading...'; mediaMsg.className = 'text-gray-600 animate-pulse'; }
    for (const f of mediaUpload.files) {
      if (!f || f.size===0) continue;
      let url = '';
      try { url = await uploadToGithubAdmin(f); } catch { url = await uploadToImgbb(f); }
      if (url) { await addDoc(collection(db,'media'), { url, createdAt: serverTimestamp(), by: auth.currentUser?auth.currentUser.uid:null }); }
    }
    mediaUpload.value = '';
    if (mediaMsg) { mediaMsg.textContent = 'Upload complete.'; mediaMsg.className = 'text-green-600'; setTimeout(()=> mediaMsg.textContent='', 3000); }
    await loadMediaItems();
  } catch (e) { if (mediaMsg) { mediaMsg.textContent = 'Upload failed.'; mediaMsg.className = 'text-red-600'; } }
});

btnImageLibrary?.addEventListener('click', ()=> showMediaModal('main'));
btnGalleryLibrary?.addEventListener('click', ()=> showMediaModal('gallery'));
mediaUseMain?.addEventListener('click', ()=>{ const first = mediaItems.find(x=> mediaSelected.has(x.id)); if (!first) return; selectedMainUrl = first.url; croppedMainImageFile = null; if (prevImg) { prevImg.src = selectedMainUrl; prevImg.classList.remove('hidden'); if(prevPlaceholder) prevPlaceholder.classList.add('hidden'); } hideMediaModal(); });
mediaUseGallery?.addEventListener('click', ()=>{ const urls = mediaItems.filter(x=> mediaSelected.has(x.id)).map(x=>x.url); if (urls.length === 0) return; const left = Math.max(0, 5 - selectedGalleryUrls.length); selectedGalleryUrls = selectedGalleryUrls.concat(urls.slice(0,left)); renderSelectedGalleryPreview(); hideMediaModal(); });
mediaCropMain?.addEventListener('click', async ()=>{
  try {
    const first = mediaItems.find(x=> mediaSelected.has(x.id));
    if (!first) return;
    const res = await fetch(first.url); const blob = await res.blob();
    const file = new File([blob], 'library.jpg', { type: blob.type || 'image/jpeg' });
    selectedMainUrl = ''; hideMediaModal(); openCropper(file);
  } catch (e) { if (mediaMsg) mediaMsg.textContent = 'Error opening cropper.'; }
});

function renderSelectedGalleryPreview(){ 
  if (!prevGallery) return; prevGallery.innerHTML=''; 
  selectedGalleryUrls.forEach((u, idx)=>{ 
    const wrap=document.createElement('div'); wrap.className='relative group aspect-square rounded-lg overflow-hidden border bg-gray-50'; 
    const img=document.createElement('img'); img.src=u; img.className='w-full h-full object-cover'; 
    const rm=document.createElement('button'); rm.type='button'; 
    rm.className='absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-sm'; 
    rm.innerHTML='×'; 
    rm.addEventListener('click',(e)=>{ e.preventDefault(); selectedGalleryUrls = selectedGalleryUrls.filter((x,i)=> i!==idx); renderSelectedGalleryPreview(); }); 
    wrap.appendChild(img); wrap.appendChild(rm); prevGallery.appendChild(wrap); 
  }); 
}

function updateAddPreview(){ 
  if (!form || !prevTitle || !prevPrice || !prevExtra) return; 
  const title = form.title ? String(form.title.value || '').trim() : ''; 
  const price = form.price ? Number(form.price.value || 0) : 0; 
  const weightVal = form.weightValue ? String(form.weightValue.value || '').trim() : ''; 
  const weightUnit = form.weightUnit ? String(form.weightUnit.value || '').trim() : ''; 
  
  // Format weight display
  let weight = '';
  if (weightVal) {
    if (weightUnit === 'kg' && Number(weightVal) < 1) weight = `${Number(weightVal)*1000} g`;
    else if (weightUnit === 'l' && Number(weightVal) < 1) weight = `${Number(weightVal)*1000} ml`;
    else weight = `${weightVal} ${weightUnit}`;
  }

  prevTitle.textContent = title || 'Product Name'; 
  prevPrice.textContent = `৳${Number(price || 0).toFixed(2)}`; 
  prevExtra.textContent = weight || ''; 
}

function updateAddPreviewImage(){ 
  if (!form || !prevImg) return; 
  if (selectedMainUrl) { prevImg.src = selectedMainUrl; prevImg.classList.remove('hidden'); if(prevPlaceholder) prevPlaceholder.classList.add('hidden'); return; } 
  // No file input listener here since we use library primarily, but check if user set manual URL via hidden input
  // Fallback
  if (editUsingAdd.active && editUsingAdd.original?.image) { prevImg.src = editUsingAdd.original.image; prevImg.classList.remove('hidden'); if(prevPlaceholder) prevPlaceholder.classList.add('hidden'); } 
  else { prevImg.src = ''; prevImg.classList.add('hidden'); if(prevPlaceholder) prevPlaceholder.classList.remove('hidden'); } 
}

function updateAddPreviewGallery(){ 
  // Mostly handled by renderSelectedGalleryPreview
  // If in edit mode, show original gallery if nothing selected yet
  if (!prevGallery) return;
  if (selectedGalleryUrls.length > 0) { renderSelectedGalleryPreview(); return; }
  
  if (editUsingAdd.active && editUsingAdd.original?.images && selectedGalleryUrls.length === 0){
     prevGallery.innerHTML='';
     const urls = Array.isArray(editUsingAdd.original.images) ? editUsingAdd.original.images.slice(0,5) : []; 
     urls.forEach(u=>{ 
       const img=document.createElement('img'); img.src=u; img.className='w-full h-12 object-cover rounded bg-gray-50 border opacity-60'; 
       prevGallery.appendChild(img); 
     }); 
  }
}

// Wire preview listeners
if (form){ 
  ['title','price','weightValue','weightUnit','description'].forEach(name=>{ 
    const el = form.querySelector(`[name="${name}"]`); 
    if (el) el.addEventListener('input', updateAddPreview); 
  }); 
  try { window.Categories && window.Categories.populateSelects && window.Categories.populateSelects('', ''); } catch {} 
  updateAddPreview(); 
}

function togglePieceWeight(){
  try {
    const wu = form && form.weightUnit ? String(form.weightUnit.value||'').trim() : '';
    if (pieceWeightWrap){ if (wu === 'pc') pieceWeightWrap.classList.remove('hidden'); else pieceWeightWrap.classList.add('hidden'); }
  } catch {}
}
try {
  const wuEl = form ? form.weightUnit : null;
  if (wuEl){ wuEl.addEventListener('change', ()=>{ togglePieceWeight(); updateAddPreview(); }); togglePieceWeight(); }
} catch {}

// Cancel edit mode
addCancelEditBtn?.addEventListener('click', ()=>{ 
  editUsingAdd = { active:false, productId:null, original:null }; 
  if (addSectionTitle) addSectionTitle.textContent = 'Add New Product'; 
  if (addSubmitBtn) addSubmitBtn.textContent = 'Add Product'; 
  addCancelEditBtn.classList.add('hidden'); 
  if (form) form.reset(); 
  selectedMainUrl = ''; selectedGalleryUrls = [];
  updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery(); 
  clearVariants();
});

// Clear buttons
btnImageClear?.addEventListener('click', ()=>{ selectedMainUrl = ''; croppedMainImageFile = null; updateAddPreviewImage(); });
btnGalleryClear?.addEventListener('click', ()=>{ selectedGalleryUrls = []; renderSelectedGalleryPreview(); });

// Submit handler
form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const data = new FormData(form);
  const title = (data.get('title') || '').toString().trim();
  const price = Number(data.get('price'));
  const description = (data.get('description') || '').toString().trim();
  const category = (data.get('category') || '').toString().trim();
  const subcategory = (data.get('subcategory') || '').toString().trim();
  const wv = (data.get('weightValue') || '').toString().trim();
  const wu = (data.get('weightUnit') || '').toString().trim();
  const unitOut = wu === 'l' ? 'L' : (wu === 'kg' ? 'kg' : (wu === 'pc' ? 'pc' : 'kg'));
  const weight = wv ? `${wv}${unitOut}` : '';
  const stock = Number(data.get('stock') || 0);
  const active = data.get('active') ? true : false;
  const options = getVariantsFromForm();

  if (!title || Number.isNaN(price)) { setMessage('Please enter title and valid price.', false); return; }
  
  try {
    const submitBtn = form.querySelector('button[type="submit"]');
    const prevDisabled = submitBtn?.disabled;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    // Final image resolution
    let image = selectedMainUrl || '';
    if (!image && editUsingAdd.active && editUsingAdd.original?.image) image = editUsingAdd.original.image;
    
    // If user cropped a new file but didn't save to library explicitly, we must upload it now
    if (croppedMainImageFile) {
       try { image = await uploadToImgbb(croppedMainImageFile); } catch(err){ console.warn('Crop upload fallback failed', err); }
    }
    
    if (!editUsingAdd.active && !image) { 
        setMessage('Please select a product image.', false); 
        if (submitBtn) { submitBtn.disabled = prevDisabled ?? false; submitBtn.textContent = 'Add Product'; }
        return; 
    }

    // Final gallery resolution
    const images = [...selectedGalleryUrls];
    
    const payload = {
        title,
        price,
        image,
        category: category || null,
        subcategory: subcategory || null,
        description,
        weight: weight || null,
        images: images.length > 0 ? images.slice(0,5) : null,
        stock: Number.isFinite(stock) ? stock : 0,
        active: !!active,
        options: Array.isArray(options) && options.length>0 ? options : null,
        updatedAt: serverTimestamp()
    };

    if (!editUsingAdd.active){
      payload.createdAt = serverTimestamp();
      payload.createdBy = auth.currentUser ? auth.currentUser.uid : null;
      await addDoc(collection(db,'products'), payload);
      setMessage('Product added successfully.');
    } else {
      await updateDoc(doc(db,'products', editUsingAdd.productId), payload);
      setMessage('Product updated successfully.');
      // Exit edit mode
      editUsingAdd = { active:false, productId:null, original:null };
      addSectionTitle.textContent = 'Add New Product';
      addSubmitBtn.textContent = 'Add Product';
      addCancelEditBtn.classList.add('hidden');
    }
    
    // Reset form
    form.reset();
    selectedMainUrl = ''; croppedMainImageFile = null; selectedGalleryUrls = [];
    clearVariants(); updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery();
    
    // Scroll top
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    setMessage('Error: ' + err.message, false);
  } finally {
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { 
        submitBtn.disabled = false; 
        submitBtn.textContent = editUsingAdd.active ? 'Update Product' : 'Add Product';
    }
  }
});

// Public API used by admin.js
window.AddProduct = {
  enterEditMode: (productId, data) => {
    editUsingAdd = { active: true, productId, original: { ...data } };
    if (addSectionTitle) addSectionTitle.textContent = 'Edit Product';
    if (addSubmitBtn) addSubmitBtn.textContent = 'Update Product';
    if (addCancelEditBtn) addCancelEditBtn.classList.remove('hidden');
    
    if (form) {
      if (form.title) form.title.value = data.title || '';
      if (form.price) form.price.value = data.price || 0;
      const cat = form.querySelector('[name="category"]'); if (cat) cat.value = data.category || '';
      // Trigger change to load subcategories?
      try { 
          if(window.Categories && window.Categories.onCategoryChange) {
              window.Categories.onCategoryChange({target:cat});
              setTimeout(()=>{
                  const sub = form.querySelector('[name="subcategory"]'); 
                  if (sub && data.subcategory) sub.value = data.subcategory; 
              }, 100);
          }
      } catch {}

      // Parse weight back to Value + Unit
      try {
        const s = String(data.weight || '').trim().toLowerCase();
        const m = s.match(/([0-9]*\.?[0-9]+)\s*(kg|g|l|liter|ltr|pc)?/);
        if (m) {
          const v = parseFloat(m[1]);
          const u = m[2] || 'g';
          if (form.weightValue && form.weightUnit) {
            if (u === 'kg') { form.weightValue.value = String(v); form.weightUnit.value = 'kg'; }
            else if (u === 'l' || u === 'liter' || u === 'ltr') { form.weightValue.value = String(v); form.weightUnit.value = 'l'; }
            else if (u === 'pc') { form.weightValue.value = String(v); form.weightUnit.value = 'pc'; }
            else { form.weightValue.value = String((v/1000)); form.weightUnit.value = 'kg'; }
          }
        } else { if (form.weightValue) form.weightValue.value = ''; }
      } catch { if (form.weightValue) form.weightValue.value = ''; }

      if (form.description) form.description.value = data.description || '';
      if (form.stock) form.stock.value = Number(data.stock || 0);
      if (form.active) form.active.checked = data.active === false ? false : true;
      
      // Load gallery
      selectedGalleryUrls = Array.isArray(data.images) ? [...data.images] : [];
      if(data.image) selectedMainUrl = data.image;

      // Populate variants
      try {
        clearVariants();
        const opts = Array.isArray(data.options) ? data.options : [];
        if (opts.length > 0) {
          opts.slice(0,20).forEach(o => {
            const raw = String(o.label || '').trim();
            const m = raw.toLowerCase().replace(/\s+/g,'').match(/^([0-9]*\.?[0-9]+)(kg|g|l|liter|ltr|ml|pc)?$/);
            const display = m ? m[1] : raw; 
            addVariant(display, o.price ?? '');
          });
        }
      } catch {}
    }
    updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery();
    togglePieceWeight();
    
    // Switch tab/view to add
    try { location.hash = '#add'; } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  updateAllPreviews: () => { updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery(); }
};
