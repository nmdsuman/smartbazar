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
const prevTitle = document.getElementById('add-preview-title');
const prevPrice = document.getElementById('add-preview-price');
const prevExtra = document.getElementById('add-preview-extra');
const prevDesc = document.getElementById('add-preview-desc');
const prevGallery = document.getElementById('add-preview-gallery');
// Variants elements
const variantsList = document.getElementById('variants-list');
const variantAddBtn = document.getElementById('variant-add');

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
function makeVariantRow(labelValue = '', priceValue = ''){
  const row = document.createElement('div');
  row.className = 'grid grid-cols-5 gap-2';
  row.innerHTML = `
    <input type="text" placeholder="Label (e.g., 500g, 1kg)" class="col-span-3 border rounded px-3 py-2 text-sm variant-label" value="${labelValue ? String(labelValue).replace(/"/g,'&quot;') : ''}">
    <input type="number" placeholder="Price" step="0.01" min="0" class="col-span-1 border rounded px-3 py-2 text-sm variant-price" value="${priceValue !== '' && priceValue !== null && priceValue !== undefined ? String(priceValue) : ''}">
    <button type="button" class="col-span-1 px-3 py-2 rounded bg-red-50 text-red-700 hover:bg-red-100 variant-del">Remove</button>
  `;
  row.querySelector('.variant-del').addEventListener('click', ()=>{ row.remove(); });
  return row;
}

function clearVariants(){ if (variantsList) variantsList.innerHTML = ''; }

function addVariant(label='', price=''){ if (!variantsList) return; variantsList.appendChild(makeVariantRow(label, price)); }

function getVariantsFromForm(){
  if (!variantsList) return [];
  const rows = Array.from(variantsList.querySelectorAll('.variant-label')).map((_,i)=> i);
  const out = [];
  const labels = variantsList.querySelectorAll('.variant-label');
  const prices = variantsList.querySelectorAll('.variant-price');
  for (let i=0;i<labels.length;i++){
    const label = String(labels[i].value||'').trim();
    const price = Number(prices[i]?.value || NaN);
    if (!label) continue;
    if (!Number.isFinite(price)) continue;
    out.push({ label, price });
  }
  return out.slice(0,20);
}

variantAddBtn?.addEventListener('click', ()=> addVariant());

// Simple message helper (scoped here)
function setMessage(text, ok = true) {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `text-sm mt-4 ${ok ? 'text-green-700' : 'text-red-700'}`;
}

// Upload helpers (duplicated to avoid coupling)
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

// Cropper modal
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
      if (prevImg) { const u = URL.createObjectURL(file); prevImg.src = u; prevImg.classList.remove('hidden'); }
      closeCropper();
    }, 'image/jpeg', 0.9);
  } catch { closeCropper(); }
});

// Media Library
function showMediaModal(mode){ mediaMode = mode === 'gallery' ? 'gallery' : 'main'; try { mediaSelected.clear(); renderMediaGrid(); } catch {} mediaModal?.classList.remove('hidden'); mediaModal?.classList.add('flex'); loadMediaItems(); }
function hideMediaModal(){ mediaModal?.classList.add('hidden'); mediaModal?.classList.remove('flex'); }
async function loadMediaItems(){
  try {
    // Media items are stored in Firestore 'media' collection
    const { getDocs, query, collection, orderBy } = await import('firebase/firestore');
    let snap;
    try { snap = await getDocs(query(collection(db,'media'), orderBy('createdAt','desc'))); }
    catch { snap = await getDocs(collection(db,'media')); if (mediaMsg) { mediaMsg.textContent = 'Loaded library without ordering'; mediaMsg.className = 'text-sm text-gray-700'; } }
    mediaItems = snap.docs.map(d=>({ id: d.id, url: d.data().url, createdAt: d.data().createdAt }));
    mediaItems.sort((a,b)=> (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
    renderMediaGrid();
  } catch (e) { if (mediaMsg) { mediaMsg.textContent = 'Failed to load library.'; mediaMsg.className = 'text-sm text-red-700'; } }
}
function renderMediaGrid(){ if (!mediaGrid) return; mediaGrid.innerHTML=''; const frag=document.createDocumentFragment(); mediaItems.forEach(it=>{ const w=document.createElement('button'); w.type='button'; w.className='relative border rounded overflow-hidden bg-white hover:ring-2 hover:ring-blue-500 focus:outline-none'; w.innerHTML=`<img src="${it.url}" alt="" class="w-full h-24 object-cover"><span class="absolute top-1 right-1 inline-block w-2.5 h-2.5 rounded-full ${mediaSelected.has(it.id)?'bg-blue-600':'bg-white border'}"></span>`; w.addEventListener('click', ()=>{ if (mediaMode==='main'){ mediaSelected.clear(); mediaSelected.add(it.id);} else { if (mediaSelected.has(it.id)) mediaSelected.delete(it.id); else mediaSelected.add(it.id);} renderMediaGrid(); }); frag.appendChild(w); }); mediaGrid.appendChild(frag); }
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
      if (url) { await addDoc(collection(db,'media'), { url, createdAt: serverTimestamp(), by: auth.currentUser?auth.currentUser.uid:null }); }
    }
    mediaUpload.value = '';
    if (mediaMsg) { mediaMsg.textContent = 'Uploaded.'; mediaMsg.className = 'text-sm text-green-700'; }
    await loadMediaItems();
  } catch (e) { if (mediaMsg) { mediaMsg.textContent = 'Upload failed.'; mediaMsg.className = 'text-sm text-red-700'; } }
  finally { mediaUploadBtn?.removeAttribute('disabled'); }
});
btnImageLibrary?.addEventListener('click', ()=> showMediaModal('main'));
btnGalleryLibrary?.addEventListener('click', ()=> showMediaModal('gallery'));
mediaUseMain?.addEventListener('click', ()=>{ const first = mediaItems.find(x=> mediaSelected.has(x.id)); if (!first) return; selectedMainUrl = first.url; croppedMainImageFile = null; if (prevImg) { prevImg.src = selectedMainUrl; prevImg.classList.remove('hidden'); } hideMediaModal(); });
mediaUseGallery?.addEventListener('click', ()=>{ const urls = mediaItems.filter(x=> mediaSelected.has(x.id)).map(x=>x.url); if (urls.length === 0) return; const left = Math.max(0, 5 - selectedGalleryUrls.length); selectedGalleryUrls = selectedGalleryUrls.concat(urls.slice(0,left)); renderSelectedGalleryPreview(); hideMediaModal(); });
mediaCropMain?.addEventListener('click', async ()=>{
  try {
    const first = mediaItems.find(x=> mediaSelected.has(x.id));
    if (!first) return;
    const res = await fetch(first.url); const blob = await res.blob();
    const file = new File([blob], 'library.jpg', { type: blob.type || 'image/jpeg' });
    selectedMainUrl = '';
    hideMediaModal();
    openCropper(file);
  } catch (e) { if (mediaMsg) { mediaMsg.textContent = 'Failed to open cropper for this image.'; mediaMsg.className = 'text-sm text-red-700'; } }
});

function renderSelectedGalleryPreview(){ if (!prevGallery) return; prevGallery.innerHTML=''; selectedGalleryUrls.forEach((u, idx)=>{ const wrap=document.createElement('div'); wrap.className='relative group'; const img=document.createElement('img'); img.src=u; img.alt='Gallery'; img.className='w-full h-16 object-contain bg-white border rounded'; const rm=document.createElement('button'); rm.type='button'; rm.className='hidden group-hover:flex items-center justify-center absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white shadow'; rm.innerHTML='×'; rm.addEventListener('click',(e)=>{ e.preventDefault(); selectedGalleryUrls = selectedGalleryUrls.filter((x,i)=> i!==idx); renderSelectedGalleryPreview(); }); wrap.appendChild(img); wrap.appendChild(rm); prevGallery.appendChild(wrap); }); }

function updateAddPreview(){ if (!form || !prevTitle || !prevPrice || !prevExtra || !prevDesc) return; const title = form.title ? String(form.title.value || '').trim() : ''; const price = form.price ? Number(form.price.value || 0) : 0; const weightVal = form.weightValue ? String(form.weightValue.value || '').trim() : ''; const weightUnit = form.weightUnit ? String(form.weightUnit.value || '').trim() : ''; const unitLabel = weightUnit === 'l' ? 'L' : (weightUnit === 'ml' ? 'ml' : (weightUnit === 'kg' ? 'kg' : 'g')); const weight = weightVal ? `${weightVal}${unitLabel}` : ''; const size = form.size ? String(form.size.value || '').trim() : ''; const desc = form.description ? String(form.description.value || '').trim() : ''; prevTitle.textContent = title || '—'; prevPrice.textContent = `৳${Number(price || 0).toFixed(2)}`; const extra = [weight, size].filter(Boolean).join(' · '); prevExtra.textContent = extra || '\u00A0'; prevDesc.textContent = desc || '\u00A0'; }
function updateAddPreviewImage(){ if (!form || !prevImg) return; if (selectedMainUrl) { prevImg.src = selectedMainUrl; prevImg.classList.remove('hidden'); return; } const file = form.image && form.image.files ? form.image.files[0] : null; if (file) { const url = URL.createObjectURL(file); prevImg.src = url; prevImg.classList.remove('hidden'); } else { if (editUsingAdd.active && editUsingAdd.original?.image) { prevImg.src = editUsingAdd.original.image; prevImg.classList.remove('hidden'); } else { prevImg.src = ''; prevImg.classList.add('hidden'); } } }
function updateAddPreviewGallery(){ if (!form || !prevGallery) return; const input = form.querySelector('[name="gallery"]'); const files = input && input.files ? input.files : []; const urlsTextEl = form.querySelector('[name="galleryUrls"]'); const typed = (urlsTextEl?.value||'').toString(); const typedUrls = typed.split(/[\n,]/).map(s=>s.trim()).filter(Boolean).slice(0,5); prevGallery.innerHTML=''; // typed URLs first
  typedUrls.forEach(u=>{ const img=document.createElement('img'); img.src=u; img.alt='Gallery'; img.className='w-full h-16 object-contain bg-white border rounded'; prevGallery.appendChild(img); });
  // then file previews up to remaining slots
  const remaining = Math.max(0, 5 - typedUrls.length);
  const max = Math.min(remaining, files.length);
  for (let i=0;i<max;i++){ const f = files[i]; if (!f) continue; const url = URL.createObjectURL(f); const div=document.createElement('div'); div.className='relative'; const img=document.createElement('img'); img.src=url; img.alt='Preview'; img.className='w-full h-16 object-contain bg-white border rounded opacity-90'; div.appendChild(img); prevGallery.appendChild(div); }
  // Also render any library-selected gallery images
  if (selectedGalleryUrls.length>0){ renderSelectedGalleryPreview(); }
  else if (typedUrls.length===0 && max===0 && editUsingAdd.active){ const urls = Array.isArray(editUsingAdd.original?.images) ? editUsingAdd.original.images.slice(0,5) : []; urls.forEach(u=>{ const img=document.createElement('img'); img.src=u; img.alt='Gallery'; img.className='w-full h-16 object-contain bg-white border rounded'; prevGallery.appendChild(img); }); }
}

// Wire preview listeners
if (form){ ['title','price','weightValue','weightUnit','size','description'].forEach(name=>{ const el = form.querySelector(`[name="${name}"]`); if (el) el.addEventListener('input', updateAddPreview); }); const imgInput = form.querySelector('[name="image"]'); if (imgInput) imgInput.addEventListener('change', (e)=>{ const f = e.target.files && e.target.files[0] ? e.target.files[0] : null; if (f) { openCropper(f); } updateAddPreviewImage(); }); const imgUrl = form.querySelector('[name="imageUrl"]'); if (imgUrl) imgUrl.addEventListener('input', ()=>{ selectedMainUrl = imgUrl.value.trim(); updateAddPreviewImage(); }); const galInput = form.querySelector('[name="gallery"]'); if (galInput) galInput.addEventListener('change', updateAddPreviewGallery); const galUrls = form.querySelector('[name="galleryUrls"]'); if (galUrls) galUrls.addEventListener('input', updateAddPreviewGallery); updateAddPreview(); }

// Cancel edit mode
addCancelEditBtn?.addEventListener('click', ()=>{ editUsingAdd = { active:false, productId:null, original:null }; if (addSectionTitle) addSectionTitle.textContent = 'Add Product'; if (addSubmitBtn) addSubmitBtn.textContent = 'Add Product'; addCancelEditBtn.classList.add('hidden'); if (form) form.reset(); updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery(); });

// Clear buttons
btnImageClear?.addEventListener('click', ()=>{ try { const imgInput = form?.querySelector('[name="image"]'); if (imgInput) imgInput.value=''; const imgUrl = form?.querySelector('[name="imageUrl"]'); if (imgUrl) imgUrl.value=''; selectedMainUrl = ''; croppedMainImageFile = null; if (prevImg){ prevImg.src=''; prevImg.classList.add('hidden'); } } catch {} });
btnGalleryClear?.addEventListener('click', ()=>{ try { const galInput = form?.querySelector('[name="gallery"]'); if (galInput) galInput.value=''; const galUrls = form?.querySelector('[name="galleryUrls"]'); if (galUrls) galUrls.value=''; selectedGalleryUrls = []; renderSelectedGalleryPreview(); updateAddPreviewGallery(); } catch {} });

// Submit handler
form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const data = new FormData(form);
  const title = (data.get('title') || '').toString().trim();
  const price = Number(data.get('price'));
  let imageFile = data.get('image');
  const imageUrlTyped = (data.get('imageUrl') || '').toString().trim();
  const galleryInput = form.querySelector('[name="gallery"]');
  const galleryFiles = galleryInput && galleryInput.files ? galleryInput.files : [];
  const galleryUrlsTyped = (data.get('galleryUrls') || '').toString();
  const galleryUrls = galleryUrlsTyped.split(/[\n,]/).map(s=>s.trim()).filter(Boolean).slice(0,5);
  const description = (data.get('description') || '').toString().trim();
  const category = (data.get('category') || '').toString().trim();
  const wv = (data.get('weightValue') || '').toString().trim();
  const wu = (data.get('weightUnit') || '').toString().trim();
  const unitOut = wu === 'l' ? 'L' : (wu === 'ml' ? 'ml' : (wu === 'kg' ? 'kg' : 'g'));
  const weight = wv ? `${wv}${unitOut}` : '';
  const size = (data.get('size') || '').toString().trim();
  const stock = Number(data.get('stock') || 0);
  const active = data.get('active') ? true : false;
  const options = getVariantsFromForm();
  if (!title || Number.isNaN(price)) { setMessage('Please fill all required fields correctly.', false); return; }
  try {
    const submitBtn = form.querySelector('button[type="submit"]');
    const prevDisabled = submitBtn?.disabled;
    if (submitBtn) submitBtn.disabled = true;
    if (!editUsingAdd.active){
      let image = '';
      if (imageUrlTyped){ image = imageUrlTyped; selectedMainUrl = image; }
      else if (selectedMainUrl){ image = selectedMainUrl; }
      else {
        const mainFile = (croppedMainImageFile instanceof File) ? croppedMainImageFile : imageFile;
        if (!(mainFile instanceof File) || mainFile.size === 0) throw new Error('Please select a product image.');
        setMessage('Uploading image...', true);
        try { image = await uploadToGithubAdmin(mainFile); } catch { image = await uploadToImgbb(mainFile); }
      }
      const images = [];
      // typed gallery URLs first
      galleryUrls.forEach(u=>{ if (images.length<5) images.push(u); });
      // then selected from library
      const remainingSlots = Math.max(0, 5 - images.length);
      if (remainingSlots>0 && Array.isArray(selectedGalleryUrls)){
        selectedGalleryUrls.slice(0, remainingSlots).forEach(u=> images.push(u));
      }
      try {
        const left = Math.max(0, 5 - images.length);
        const max = Math.min(left, galleryFiles.length);
        for (let i=0;i<max;i++){
          const f = galleryFiles[i]; if (f && f.size>0){ let url=''; try { url = await uploadToGithubAdmin(f); } catch { url = await uploadToImgbb(f); } if (url) images.push(url); }
        }
      } catch {}
      if (!image) throw new Error('Image upload returned empty URL');
      await addDoc(collection(db,'products'), {
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
        options: Array.isArray(options) && options.length>0 ? options : null,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser ? auth.currentUser.uid : null
      });
      form.reset();
      updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery();
      setMessage('Product added successfully.');
      if (submitBtn) submitBtn.disabled = prevDisabled ?? false;
      croppedMainImageFile = null; selectedMainUrl = ''; selectedGalleryUrls = []; clearVariants();
    } else {
      const payload = { title, price, category: category || null, description, weight: weight || null, size: size || null, stock: Number.isFinite(stock) ? stock : 0, active: !!active };
      if (Array.isArray(options) && options.length>0) payload.options = options; else payload.options = null;
      if (imageUrlTyped) { payload.image = imageUrlTyped; selectedMainUrl = imageUrlTyped; }
      else if (selectedMainUrl) { payload.image = selectedMainUrl; }
      else {
        const mainFileUpd = (croppedMainImageFile instanceof File) ? croppedMainImageFile : (imageFile instanceof File ? imageFile : null);
        if (mainFileUpd instanceof File && mainFileUpd.size>0){ setMessage('Uploading image...', true); let uploaded=''; try { uploaded = await uploadToGithubAdmin(mainFileUpd); } catch { uploaded = await uploadToImgbb(mainFileUpd); } if (uploaded) payload.image = uploaded; }
      }
      try {
        // Combine typed URLs, selected gallery, and uploaded files
        const base = galleryUrls.slice(0,5);
        let imagesNew = base.slice(0,5);
        const leftSlots = Math.max(0, 5 - imagesNew.length);
        const fromLib = Array.isArray(selectedGalleryUrls) ? selectedGalleryUrls.slice(0,leftSlots) : [];
        imagesNew = imagesNew.concat(fromLib).slice(0,5);
        const leftAfterLib = Math.max(0, 5 - imagesNew.length);
        const max = Math.min(leftAfterLib, galleryFiles.length);
        for (let i=0;i<max;i++){ const f = galleryFiles[i]; if (f && f.size>0){ let url=''; try { url = await uploadToGithubAdmin(f); } catch { url = await uploadToImgbb(f); } if (url) imagesNew.push(url); } }
        if (imagesNew.length>0) payload.images = imagesNew.slice(0,5);
      } catch {}
      await updateDoc(doc(db,'products', editUsingAdd.productId), payload);
      setMessage('Product updated.');
      editUsingAdd = { active:false, productId:null, original:null };
      if (addSectionTitle) addSectionTitle.textContent = 'Add Product';
      if (addSubmitBtn) addSubmitBtn.textContent = 'Add Product';
      if (addCancelEditBtn) addCancelEditBtn.classList.add('hidden');
      form.reset(); updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery(); clearVariants();
      try { location.hash = '#products'; window.showSection && window.showSection('products'); } catch {}
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

// Public API used by admin.js
window.AddProduct = {
  enterEditMode: (productId, data) => {
    editUsingAdd = { active: true, productId, original: { ...data } };
    if (addSectionTitle) addSectionTitle.textContent = 'Edit Product';
    if (addSubmitBtn) addSubmitBtn.textContent = 'Save Changes';
    if (addCancelEditBtn) addCancelEditBtn.classList.remove('hidden');
    if (form) {
      if (form.title) form.title.value = data.title || '';
      if (form.price) form.price.value = data.price || 0;
      const cat = form.querySelector('[name="category"]'); if (cat) cat.value = data.category || '';
      try {
        const s = String(data.weight || '').trim().toLowerCase();
        const m = s.match(/([0-9]*\.?[0-9]+)\s*(kg|g|l|liter|ltr)?/);
        if (m) {
          const v = parseFloat(m[1]);
          const u = m[2] || 'g';
          if (form.weightValue && form.weightUnit) {
            if (u === 'kg') { form.weightValue.value = String(v); form.weightUnit.value = 'kg'; }
            else if (u === 'l' || u === 'liter' || u === 'ltr') { form.weightValue.value = String(v); form.weightUnit.value = 'l'; }
            else { form.weightValue.value = String((v/1000)); form.weightUnit.value = 'kg'; }
          }
        } else { if (form.weightValue) form.weightValue.value = ''; }
      } catch { if (form.weightValue) form.weightValue.value = ''; }
      if (form.size) form.size.value = data.size || '';
      if (form.description) form.description.value = data.description || '';
      if (form.stock) form.stock.value = Number(data.stock || 0);
      if (form.active) form.active.checked = data.active === false ? false : true;
      if (form.image) form.image.value = '';
      const gal = form.querySelector('[name="gallery"]'); if (gal) gal.value = '';
    }
    updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery();
    const addSection = document.getElementById('add');
    if (addSection) addSection.scrollIntoView({ behavior: 'smooth' });
    window.showSection && window.showSection('add');
  },
  updateAllPreviews: () => { updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery(); }
};
