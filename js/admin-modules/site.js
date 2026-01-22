import { db } from '../firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

(function(){
  const siteForm = document.getElementById('site-form');
  const siteMsg = document.getElementById('site-message');
  const logoPreview = document.getElementById('site-logo-preview');
  const faviconPreview = document.getElementById('site-favicon-preview');

  const IMGBB_API_KEY = '462884d7f63129dede1b67d612e66ee6';

  async function uploadToImgbb(file){
    const b64 = await new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = ()=> reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
    const fd = new FormData();
    fd.append('image', b64);
    const res = await fetch(`https://api.imgbb.com/1/upload?expiration=0&key=${encodeURIComponent(IMGBB_API_KEY)}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Image upload failed');
    const json = await res.json();
    if (!json?.success) throw new Error('Image upload failed');
    return json.data?.url || json.data?.display_url || '';
  }

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
      if (logoPreview) { if (s.logo) { logoPreview.src = s.logo; logoPreview.classList.remove('hidden'); } else { logoPreview.src=''; logoPreview.classList.add('hidden'); } }
      if (faviconPreview) { if (s.favicon) { faviconPreview.src = s.favicon; faviconPreview.classList.remove('hidden'); } else { faviconPreview.src=''; faviconPreview.classList.add('hidden'); } }
    } catch (e) {
      if (siteMsg) { siteMsg.textContent = 'Failed to load site settings: ' + e.message; siteMsg.className = 'text-sm mt-3 text-red-700'; }
    }
  }

  siteForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    try {
      if (siteMsg) { siteMsg.textContent = 'Saving...'; siteMsg.className = 'text-sm mt-3 text-gray-700'; }
      let logoUrl = (siteForm.logo.value || '').toString().trim();
      let favUrl = (siteForm.favicon.value || '').toString().trim();
      const logoFile = siteForm.querySelector('[name="logoFile"]').files?.[0];
      const faviconFile = siteForm.querySelector('[name="faviconFile"]').files?.[0];
      if (logoFile && logoFile.size > 0) { const up = await uploadToImgbb(logoFile); if (up) logoUrl = up; }
      if (faviconFile && faviconFile.size > 0) { const up = await uploadToImgbb(faviconFile); if (up) favUrl = up; }
      const payload = {
        title: (siteForm.title.value || '').toString().trim() || null,
        logo: logoUrl || null,
        favicon: favUrl || null,
        email: (siteForm.email.value || '').toString().trim() || null,
        phone: (siteForm.phone.value || '').toString().trim() || null,
        marqueeEnabled: siteForm.marqueeEnabled?.checked ? true : false,
        marqueeText: (siteForm.marqueeText?.value || '').toString(),
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, 'settings', 'site'), payload, { merge: true });
      if (siteMsg) { siteMsg.textContent = 'Settings saved.'; siteMsg.className = 'text-sm mt-3 text-green-700'; }
    } catch (e) {
      if (siteMsg) { siteMsg.textContent = 'Save failed: ' + e.message; siteMsg.className = 'text-sm mt-3 text-red-700'; }
    }
  });

  function maybeLoad(){ if (location.hash.replace('#','') === 'site') loadSiteSettings(); }
  window.addEventListener('hashchange', maybeLoad);
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', maybeLoad, { once: true }); } else { maybeLoad(); }
})();
