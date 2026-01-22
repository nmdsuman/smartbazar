import { auth, db } from '../firebase-config.js';
import { collection, addDoc, getDocs, orderBy, query, serverTimestamp } from 'firebase/firestore';

(function(){
  // Elements
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

  // Provide global openCropper so other modules can use it
  let cropper = null;
  const cropperModal = document.getElementById('cropper-modal');
  const cropperImgEl = document.getElementById('cropper-image');
  const cropperCloseBtn = document.getElementById('cropper-close');
  const cropperCancelBtn = document.getElementById('cropper-cancel');
  const cropperApplyBtn = document.getElementById('cropper-apply');

  window.openCropper = function(file){
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
  };
  function closeCropper(){
    try {
      cropperModal?.classList.add('hidden');
      cropperModal?.classList.remove('flex');
      if (cropper) { cropper.destroy(); cropper = null; }
      if (cropperImgEl) cropperImgEl.src = '';
    } catch {}
  }
  cropperCloseBtn?.addEventListener('click', closeCropper);
  cropperCancelBtn?.addEventListener('click', closeCropper);
  // Note: apply is handled by feature modules (e.g., add-product) listening to cropper state

  // Upload helpers
  const IMGBB_API_KEY = '462884d7f63129dede1b67d612e66ee6';
  const GH_REPO = 'nmdsuman/image';
  const GH_BRANCH = 'main';

  function getGithubToken(){ try { return localStorage.getItem('GH_TOKEN') || ''; } catch { return ''; } }
  function ensureGithubToken(){ let t = getGithubToken(); if (!t) { try { t = window.prompt('Enter GitHub token for image upload (stored locally):', '') || ''; if (t) localStorage.setItem('GH_TOKEN', t); } catch {} } return t; }

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
    const ext = (file.type||'').includes('png')?'png':(file.type||'').includes('webp')?'webp':(file.type||'').includes('svg')?'svg':(file.type||'').includes('gif')?'gif':'jpg';
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

  // Media library state
  let mediaItems = [];
  let mediaSelected = new Set();
  let mediaMode = 'main';
  let selectedMainUrl = '';
  let selectedGalleryUrls = [];

  function renderMediaGrid(){
    if (!mediaGrid) return;
    mediaGrid.innerHTML='';
    const frag = document.createDocumentFragment();
    mediaItems.forEach(it=>{
      const w = document.createElement('button');
      w.type='button';
      w.className='relative border rounded overflow-hidden bg-white hover:ring-2 hover:ring-blue-500 focus:outline-none';
      w.innerHTML = `<img src="${it.url}" alt="" class="w-full h-24 object-cover"><span class="absolute top-1 right-1 inline-block w-2.5 h-2.5 rounded-full ${mediaSelected.has(it.id)?'bg-blue-600':'bg-white border'}"></span>`;
      w.addEventListener('click', ()=>{
        if (mediaMode==='main') { mediaSelected.clear(); mediaSelected.add(it.id); } else { if (mediaSelected.has(it.id)) mediaSelected.delete(it.id); else mediaSelected.add(it.id); }
        renderMediaGrid();
      });
      frag.appendChild(w);
    });
    mediaGrid.appendChild(frag);
  }

  async function loadMediaItems(){
    try {
      let snap;
      try { snap = await getDocs(query(collection(db,'media'), orderBy('createdAt','desc'))); }
      catch { snap = await getDocs(collection(db,'media')); if (mediaMsg) { mediaMsg.textContent='Loaded library without ordering'; mediaMsg.className='text-sm text-gray-700'; } }
      mediaItems = snap.docs.map(d=>({ id: d.id, url: d.data().url, createdAt: d.data().createdAt }));
      mediaItems.sort((a,b)=> (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      renderMediaGrid();
    } catch { if (mediaMsg) { mediaMsg.textContent='Failed to load library.'; mediaMsg.className='text-sm text-red-700'; } }
  }

  function showMediaModal(mode){ mediaMode = mode==='gallery'?'gallery':'main'; try{ mediaSelected.clear(); renderMediaGrid(); }catch{} mediaModal?.classList.remove('hidden'); mediaModal?.classList.add('flex'); loadMediaItems(); }
  function hideMediaModal(){ mediaModal?.classList.add('hidden'); mediaModal?.classList.remove('flex'); }

  mediaClose?.addEventListener('click', hideMediaModal);
  btnImageLibrary?.addEventListener('click', ()=> showMediaModal('main'));
  btnGalleryLibrary?.addEventListener('click', ()=> showMediaModal('gallery'));

  mediaUploadBtn?.addEventListener('click', async ()=>{
    try {
      if (!mediaUpload || !mediaUpload.files || mediaUpload.files.length===0) return;
      mediaUploadBtn.setAttribute('disabled','');
      if (mediaMsg) { mediaMsg.textContent='Uploading...'; mediaMsg.className='text-sm text-gray-700'; }
      for (const f of mediaUpload.files){ if (!f || f.size===0) continue; let url=''; try { url = await uploadToGithub(f); } catch { url = await uploadToImgbb(f); } if (url) { await addDoc(collection(db,'media'), { url, createdAt: serverTimestamp(), by: auth.currentUser?auth.currentUser.uid:null }); } }
      mediaUpload.value='';
      if (mediaMsg) { mediaMsg.textContent='Uploaded.'; mediaMsg.className='text-sm text-green-700'; }
      await loadMediaItems();
    } catch { if (mediaMsg) { mediaMsg.textContent='Upload failed.'; mediaMsg.className='text-sm text-red-700'; } }
    finally { mediaUploadBtn?.removeAttribute('disabled'); }
  });

  mediaUseMain?.addEventListener('click', ()=>{
    const first = mediaItems.find(x=> mediaSelected.has(x.id)); if (!first) return;
    try {
      const prevImg = document.getElementById('add-preview-image');
      if (prevImg) { prevImg.src = first.url; prevImg.classList.remove('hidden'); }
    } catch {}
    hideMediaModal();
  });

  mediaUseGallery?.addEventListener('click', ()=>{
    const urls = mediaItems.filter(x=> mediaSelected.has(x.id)).map(x=>x.url);
    if (urls.length===0) return; hideMediaModal();
    // Let add-product module read previews from DOM; no shared state enforced here
  });

  mediaCropMain?.addEventListener('click', async ()=>{
    try {
      const first = mediaItems.find(x=> mediaSelected.has(x.id)); if (!first) return;
      const res = await fetch(first.url); const blob = await res.blob(); const file = new File([blob], 'library.jpg', { type: blob.type || 'image/jpeg' });
      hideMediaModal();
      window.openCropper?.(file);
    } catch { if (mediaMsg) { mediaMsg.textContent='Failed to open cropper for this image.'; mediaMsg.className='text-sm text-red-700'; } }
  });
})();
