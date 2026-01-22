import { auth, db } from '../firebase-config.js';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

(function(){
  const form = document.getElementById('add-product-form');
  const msg = document.getElementById('admin-message');
  const addSectionTitle = document.getElementById('add-section-title');
  const addSubmitBtn = document.getElementById('add-submit-btn');
  const addCancelEditBtn = document.getElementById('add-cancel-edit');
  const btnImageClear = document.getElementById('btn-image-clear');
  const btnGalleryClear = document.getElementById('btn-gallery-clear');

  // Preview elements
  const prevImg = document.getElementById('add-preview-image');
  const prevTitle = document.getElementById('add-preview-title');
  const prevPrice = document.getElementById('add-preview-price');
  const prevExtra = document.getElementById('add-preview-extra');
  const prevDesc = document.getElementById('add-preview-desc');
  const prevGallery = document.getElementById('add-preview-gallery');

  function setMessage(text, ok = true) {
    if (!msg) return;
    msg.textContent = text;
    msg.className = `text-sm mt-4 ${ok ? 'text-green-700' : 'text-red-700'}`;
  }

  // ---- Helpers (uploads) ----
  const IMGBB_API_KEY = '462884d7f63129dede1b67d612e66ee6';
  const GH_REPO = 'nmdsuman/image';
  const GH_BRANCH = 'main';

  function getGithubToken(){ try { return localStorage.getItem('GH_TOKEN') || ''; } catch { return ''; } }
  function ensureGithubToken(){ let t = getGithubToken(); if (!t) { try { t = window.prompt('Enter GitHub token for image upload (stored locally):', '') || ''; if (t) localStorage.setItem('GH_TOKEN', t); } catch {} } return t; }

  function extFromType(type){ if (!type) return 'jpg'; if (type.includes('png')) return 'png'; if (type.includes('webp')) return 'webp'; if (type.includes('svg')) return 'svg'; if (type.includes('gif')) return 'gif'; return 'jpg'; }

  async function fileToBase64(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadToGithub(file){
    const token = ensureGithubToken();
    if (!token) throw new Error('GitHub token missing');
    const b64 = await fileToBase64(file);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const rand = Math.random().toString(36).slice(2,8);
    const ext = extFromType(file.type||'');
    const path = `images/${yyyy}/${mm}/${Date.now()}-${rand}.${ext}`;
    const apiUrl = `https://api.github.com/repos/${GH_REPO}/contents/${path}`;
    const res = await fetch(apiUrl, { method: 'PUT', headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Add product image', content: b64, branch: GH_BRANCH }) });
    if (!res.ok) { const txt = await res.text().catch(()=> ''); throw new Error(`GitHub upload failed (${res.status}): ${txt.slice(0,200)}`); }
    return `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${path}`;
  }

  async function uploadToImgbb(file){
    const b64 = await fileToBase64(file);
    const fd = new FormData();
    fd.append('image', b64);
    const res = await fetch(`https://api.imgbb.com/1/upload?expiration=0&key=${encodeURIComponent(IMGBB_API_KEY)}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Image upload failed');
    const json = await res.json();
    if (!json?.success) throw new Error('Image upload failed');
    return json.data?.url || json.data?.display_url || '';
  }

  // ---- Cropper ----
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
      if (cropper) { try { cropper.destroy(); } catch {} cropper = null; }
      if (cropperImgEl) {
        cropperImgEl.src = url;
        cropperModal?.classList.remove('hidden');
        cropperModal?.classList.add('flex');
        cropperImgEl.onload = () => { try { cropper = new window.Cropper(cropperImgEl, { aspectRatio: NaN, viewMode: 1, autoCropArea: 0.9 }); } catch {} };
      }
    } catch {}
  }
  function closeCropper(){ try { cropperModal?.classList.add('hidden'); cropperModal?.classList.remove('flex'); if (cropper) { cropper.destroy(); cropper = null; } if (cropperImgEl) cropperImgEl.src=''; } catch {} }
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

  // ---- Media selection (minimal: pick main from URL via modal left to future) ----
  let selectedMainUrl = '';
  let selectedGalleryUrls = [];

  function renderSelectedGalleryPreview(){
    if (!prevGallery) return;
    prevGallery.innerHTML = '';
    selectedGalleryUrls.forEach((u, idx)=>{
      const wrap = document.createElement('div'); wrap.className = 'relative group';
      const img = document.createElement('img'); img.src = u; img.alt='Gallery'; img.className='w-full h-16 object-contain bg-white border rounded';
      const rm = document.createElement('button'); rm.type='button'; rm.className='hidden group-hover:flex items-center justify-center absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white shadow'; rm.innerHTML='×';
      rm.addEventListener('click', (e)=>{ e.preventDefault(); selectedGalleryUrls = selectedGalleryUrls.filter((x,i)=> i!==idx); renderSelectedGalleryPreview(); });
      wrap.appendChild(img); wrap.appendChild(rm); prevGallery.appendChild(wrap);
    });
  }

  function updateAddPreview(){
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

  function updateAddPreviewImage(){
    if (!form || !prevImg) return;
    if (selectedMainUrl) { prevImg.src = selectedMainUrl; prevImg.classList.remove('hidden'); return; }
    const file = form.image && form.image.files ? form.image.files[0] : null;
    if (file) { const url = URL.createObjectURL(file); prevImg.src = url; prevImg.classList.remove('hidden'); }
    else { prevImg.src = ''; prevImg.classList.add('hidden'); }
  }

  function updateAddPreviewGallery(){
    if (!form || !prevGallery) return;
    const input = form.querySelector('[name="gallery"]');
    const files = input && input.files ? input.files : [];
    prevGallery.innerHTML = '';
    const max = Math.min(5, files.length);
    for (let i=0;i<max;i++){ const f = files[i]; if (!f) continue; const url = URL.createObjectURL(f); const div = document.createElement('div'); div.className='relative'; const img = document.createElement('img'); img.src=url; img.alt='Preview'; img.className='w-full h-16 object-contain bg-white border rounded opacity-90'; div.appendChild(img); prevGallery.appendChild(div); }
    if (selectedGalleryUrls.length > 0) { renderSelectedGalleryPreview(); }
  }

  if (form){
    ['title','price','weightValue','weightUnit','size','description'].forEach(name=>{ const el = form.querySelector(`[name="${name}"]`); if (el) el.addEventListener('input', updateAddPreview); });
    const imgInput = form.querySelector('[name="image"]');
    if (imgInput) imgInput.addEventListener('change', (e)=>{ const f = e.target.files && e.target.files[0] ? e.target.files[0] : null; if (f) openCropper(f); updateAddPreviewImage(); });
    const galInput = form.querySelector('[name="gallery"]'); if (galInput) galInput.addEventListener('change', updateAddPreviewGallery);
    updateAddPreview();
  }

  addCancelEditBtn?.addEventListener('click', ()=>{
    try {
      if (addSectionTitle) addSectionTitle.textContent = 'Add Product';
      if (addSubmitBtn) addSubmitBtn.textContent = 'Add Product';
      addCancelEditBtn.classList.add('hidden');
      form?.reset();
      selectedMainUrl = '';
      selectedGalleryUrls = [];
      croppedMainImageFile = null;
      updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery();
    } catch {}
  });

  btnImageClear?.addEventListener('click', ()=>{
    try { const imgInput = form?.querySelector('[name="image"]'); if (imgInput) imgInput.value = ''; selectedMainUrl = ''; croppedMainImageFile = null; if (prevImg) { prevImg.src=''; prevImg.classList.add('hidden'); } } catch {}
  });

  btnGalleryClear?.addEventListener('click', ()=>{
    try { const galInput = form?.querySelector('[name="gallery"]'); if (galInput) galInput.value=''; selectedGalleryUrls = []; renderSelectedGalleryPreview(); } catch {}
  });

  form?.addEventListener('submit', async (e)=>{
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

    if (!title || Number.isNaN(price)) { setMessage('Please fill all required fields correctly.', false); return; }

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      const prevDisabled = submitBtn?.disabled; if (submitBtn) submitBtn.disabled = true;
      // Create new only (edit flow handled elsewhere if needed)
      let image = '';
      if (selectedMainUrl) image = selectedMainUrl; else {
        const mainFile = (croppedMainImageFile instanceof File) ? croppedMainImageFile : imageFile;
        if (!(mainFile instanceof File) || mainFile.size === 0) { throw new Error('Please select a product image.'); }
        setMessage('Uploading image...', true);
        try { image = await uploadToGithub(mainFile); } catch { image = await uploadToImgbb(mainFile); }
      }
      const images = Array.isArray(selectedGalleryUrls) ? selectedGalleryUrls.slice(0,5) : [];
      try {
        const left = Math.max(0, 5 - images.length);
        const max = Math.min(left, galleryFiles.length);
        for (let i=0;i<max;i++){
          const f = galleryFiles[i]; if (f && f.size>0){ let url=''; try { url = await uploadToGithub(f); } catch { url = await uploadToImgbb(f); } if (url) images.push(url); }
        }
      } catch {}
      if (!image) throw new Error('Image upload returned empty URL');
      await addDoc(collection(db, 'products'), { title, price, image, images, description, category: category||null, weight: weight||null, size: size||null, stock, active, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setMessage('Product added successfully.');
      form.reset(); selectedMainUrl=''; selectedGalleryUrls=[]; croppedMainImageFile=null; updateAddPreview(); updateAddPreviewImage(); updateAddPreviewGallery();
    } catch (err){ setMessage('Failed to add product: ' + (err?.message||err), false); }
    finally { const submitBtn = form.querySelector('button[type="submit"]'); if (submitBtn) submitBtn.disabled = false; }
  });
})();
