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
// GitHub upload (frontend) â€” for security, prefer serverless in production
const GH_REPO = 'nmdsuman/image';
const GH_BRANCH = 'main';
// Site file manager target repo/branch
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
 
// Generic: upload base64 content to a specific repo path (creates or updates with sha)
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

let editUsingAdd = { active: false, productId: null, original: null };\n// Image cropper state (for main product image in Add/Edit form)
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
});\nfunction updateAddPreview() {
  if (!form || !prevTitle || !prevPrice || !prevExtra || !prevDesc) return;
  const title = form.title ? String(form.title.value || '').trim() : '';
  const price = form.price ? Number(form.price.value || 0) : 0;
  const weightVal = form.weightValue ? String(form.weightValue.value || '').trim() : '';
  const weightUnit = form.weightUnit ? String(form.weightUnit.value || '').trim() : '';
  const unitLabel = weightUnit === 'l' ? 'L' : (weightUnit === 'ml' ? 'ml' : (weightUnit === 'kg' ? 'kg' : 'g'));
  const weight = weightVal ? `${weightVal}${unitLabel}` : '';
  const size = form.size ? String(form.size.value || '').trim() : '';
  const desc = form.description ? String(form.description.value || '').trim() : '';

  prevTitle.textContent = title || 'â€”';
  prevPrice.textContent = `à§³${Number(price || 0).toFixed(2)}`;
  const extra = [weight, size].filter(Boolean).join(' Â· ');
  prevExtra.textContent = extra || '\u00A0';
  prevDesc.textContent = desc || '\u00A0';
}\nfunction updateAddPreviewGallery() {
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

// Wire preview listeners\n// Cancel edit using Add form\n// Enable Enter to send (Shift+Enter for newline)\n\n

// Admin typing indicator (debounced)
chatReplyInput?.addEventListener('input', ()=>{
  const curId = selectedChatId;
  if (!curId) return;
  try { updateDoc(doc(db,'chat_sessions', curId), { adminTyping: true }); } catch {}
  if (adminTypingTimer) clearTimeout(adminTypingTimer);
  adminTypingTimer = setTimeout(()=>{
    try { updateDoc(doc(db,'chat_sessions', curId), { adminTyping: false }); } catch {}
  }, 1200);
});\nfunction renderOrders() {
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

loadShipping();\n

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
      <td class="p-2 border">${it.title}${it.weight?` Â· ${it.weight}`:''}</td>
      <td class="p-2 border text-right">à§³${Number(it.price).toFixed(2)}</td>
      <td class="p-2 border text-right"><input type="number" min="1" value="${it.qty}" data-idx="${idx}" class="w-20 border rounded px-2 py-1 qty"/></td>
      <td class="p-2 border text-right">à§³${line.toFixed(2)}</td>
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
  modalSubtotalEl.textContent = `à§³${subtotal.toFixed(2)}`;
  modalDeliveryEl.textContent = `à§³${delivery.toFixed(2)}`;
  modalTotalEl.textContent = `à§³${(subtotal+delivery).toFixed(2)}`;
}

function openOrderModal(id, data){
  currentOrder.id = id;
  currentOrder.data = data;
  currentOrder.items = Array.isArray(data.items) ? data.items.map(x=>({ ...x })) : [];
  modalMeta.textContent = `Order #${id.slice(-6)} Â· ${data.customer?.name||''} Â· ${data.customer?.phone||''}`;
  // populate product select
  modalAddSelect.innerHTML = '<option value="">Select product</option>' + productsCache.map(p=>`<option value="${p.id}">${p.title} â€” à§³${Number(p.price).toFixed(2)}${p.weight?` Â· ${p.weight}`:''}</option>`).join('');
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
        <span>${i.title}${i.weight?` Â· ${i.weight}`:''}</span>
      </div>
    </td>
    <td style='text-align:right'>${i.qty}</td>
    <td style='text-align:right'>à§³${Number(i.price).toFixed(2)}</td>
    <td style='text-align:right'>à§³${(i.qty*i.price).toFixed(2)}</td>
  </tr>`).join('');
  const subtotal = currentOrder.items.reduce((s,i)=> s + Number(i.price)*Number(i.qty), 0);
  const delivery = calcDeliveryForItems(currentOrder.items);
  const total = subtotal + delivery;
  w.document.write(`
    <html><head><title>Invoice</title><style>
    body{font-family:Arial,sans-serif;padding:24px}
    table{width:100%;border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px}
    </style></head><body>
      <h2>Bazar â€” Delivery Invoice</h2>
      <div>Order #${currentOrder.id.slice(-6)}</div>
      <div>${currentOrder.data.customer?.name||''} Â· ${currentOrder.data.customer?.phone||''}</div>
      <div>${currentOrder.data.customer?.address||''}</div>
      <hr/>
      <table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>
      ${rows}
      </tbody></table>
      <h3 style='text-align:right'>Subtotal: à§³${subtotal.toFixed(2)}<br/>Delivery: à§³${delivery.toFixed(2)}<br/>Total: à§³${total.toFixed(2)}</h3>
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
          chip.innerHTML = `User filter: ${ordersUserFilter.slice(-6)} <button id="orders-user-chip-clear" class="ml-1 px-1 rounded bg-blue-600 text-white">Ã—</button>`;
          chip.classList.remove('hidden');
          chip.querySelector('#orders-user-chip-clear')?.addEventListener('click', ()=>{ window.setOrdersUserFilter(null); drawOrders(); });
        } else {
          chip.classList.add('hidden');
        }
      }
    }
  } catch {}
}








