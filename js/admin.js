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

// Add Product moved to js/add-product.js

// Notes moved to js/notes.js

// Cropper handled in add-product.js

// Cropper handlers moved to add-product.js

// Media library moved to add-product.js

// Gallery preview moved to add-product.js

// Add Product form, preview, media and submit logic moved to add-product.js

// Products list moved to js/products.js
// Keep a local mirror of productsCache for admin usage (e.g., order modal)
try {
  if (window.Products && typeof window.Products.getCache === 'function') {
    productsCache = window.Products.getCache().map(x=>({ id: x.id, ...x.data }));
  }
  window.addEventListener('ProductsCacheUpdated', () => {
    try {
      const src = Array.isArray(window.productsCache) ? window.productsCache : [];
      productsCache = src.map(x=> ({ id: x.id, ...x.data }));
    } catch {}
  });
} catch {}

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
  
  // When entering Notes, ensure notes are loaded
  if (key === 'notes') {
    try { window.Notes && window.Notes.loadNotes && window.Notes.loadNotes(); } catch {}
  }
}

// Expose for other modules (e.g., add-product.js)
try { window.showSection = showSection; } catch {}

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
        <div class="text-sm text-gray-600">Items: ${count} Â· User: ${o.userId || 'guest'} Â· ${when}</div>
        <div class="text-sm text-gray-600">${o.customer?.name || ''} Â· ${o.customer?.phone || ''}</div>
      </div>
      <div class="font-semibold">à§³${Number(o.total || 0).toFixed(2)}</div>
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
          const ordInfo = lastOrder ? ` Â· Last order #${lastOrder.id.slice(-6)} (${(lastOrder.data().status)||'Pending'})` : '';
          meta += ` Â· Role: ${role}${ordInfo} Â· <a href="orders.html#orders-section" id="chat-view-orders" class="text-blue-700 hover:underline">View orders</a>`;
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
      ind.textContent = 'User is typingâ€¦';
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


