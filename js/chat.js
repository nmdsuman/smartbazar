import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, setDoc, getDoc, doc, collection, serverTimestamp, onSnapshot, query, orderBy, updateDoc } from 'firebase/firestore';

(function initChatWidget(){
  if (window.__chatWidgetInit) return; window.__chatWidgetInit = true;
  // Build floating button
  const btn = document.createElement('button');
  btn.id = 'chat-fab';
  btn.className = 'fixed right-4 z-40 bg-blue-600 text-white rounded-full shadow-lg flex items-center gap-2 hover:bg-blue-700 px-4 h-12 sm:bottom-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]';
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M2.25 12c0-4.556 4.144-8.25 9.25-8.25s9.25 3.694 9.25 8.25-4.144 8.25-9.25 8.25c-1.18 0-2.305-.206-3.337-.584-.508-.186-1.064-.176-1.544.054L3 20.25l1.327-2.394c.24-.434.23-.966-.025-1.391A8.182 8.182 0 0 1 2.25 12z"/></svg><span class="hidden sm:inline text-sm font-medium">Chat</span><span id="chat-fab-badge" class="ml-2 hidden inline-flex items-center justify-center text-[10px] rounded-full bg-red-600 text-white min-w-[18px] h-[18px] px-1">0</span>';
  document.body.appendChild(btn);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'chat-panel';
  panel.className = 'fixed right-4 z-50 w-80 max-w-[90vw] bg-white border rounded-xl shadow-xl hidden sm:bottom-20 bottom-[calc(9rem+env(safe-area-inset-bottom))]';
  panel.innerHTML = `
    <div class="flex items-center justify-between px-3 py-2 border-b">
      <div class="font-semibold">Live Chat</div>
      <button id="chat-close" class="text-sm px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">Close</button>
    </div>
    <div id="chat-messages" class="p-3 h-72 overflow-y-auto space-y-2 bg-gray-50"></div>
    <div class="p-2 border-t">
      <div class="flex items-center gap-2">
        <input id="chat-input" type="text" placeholder="Type your message" class="flex-1 border rounded px-3 py-2" />
        <button id="chat-send" aria-label="Send message" class="shrink-0 px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
            <path d="M8 5l11 7-11 7V5z"/>
          </svg>
        </button>
      </div>
      <div class="mt-2 text-xs text-gray-500">You can chat as guest if not logged in.</div>
    </div>
  `;
  document.body.appendChild(panel);

  const chatBtn = btn;
  const chatClose = panel.querySelector('#chat-close');
  const chatMessages = panel.querySelector('#chat-messages');
  const chatInput = panel.querySelector('#chat-input');
  const chatSendBtn = panel.querySelector('#chat-send');
  const chatBadge = btn.querySelector('#chat-fab-badge');
  // typing indicator element
  const typingEl = document.createElement('div');
  typingEl.id = 'chat-typing';
  typingEl.className = 'px-3 py-1 text-xs text-gray-500 hidden';
  typingEl.textContent = 'Admin is typing…';
  panel.insertBefore(typingEl, panel.querySelector('.p-2.border-t'));

  let sessionId = localStorage.getItem('chat_session_id') || null;
  let userCache = { uid: null, email: null };

  async function ensureSession() {
    // If we already have a session, verify it exists; otherwise create
    if (sessionId) {
      try { const snap = await getDoc(doc(db,'chat_sessions', sessionId)); if (snap.exists()) return sessionId; } catch {}
      sessionId = null;
    }
    const user = auth.currentUser;
    const payload = {
      userId: user ? user.uid : null,
      userEmail: user?.email || null,
      guest: user ? null : { createdAt: new Date().toISOString() },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: null,
      lastFrom: null,
      status: 'open'
    };
    const ref = await addDoc(collection(db,'chat_sessions'), payload);
    sessionId = ref.id;
    localStorage.setItem('chat_session_id', sessionId);
    return sessionId;
  }

  let unsubMsgs = null;
  let initialLoaded = false;
  let unreadCount = 0;
  function setUnread(n){ unreadCount = Math.max(0, n|0); if (chatBadge){ if (unreadCount>0){ chatBadge.textContent=String(unreadCount); chatBadge.classList.remove('hidden'); } else { chatBadge.classList.add('hidden'); } } }
  let unsubSession = null;
  let typingTimer = null;
  async function openChat(){
    panel.classList.remove('hidden');
    panel.classList.add('block');
    const sid = await ensureSession();
    // mark as read for user when opening
    try { await updateDoc(doc(db,'chat_sessions', sid), { userUnread: false, userUnreadCount: 0 }); } catch {}
    setUnread(0);
    // stream session meta for typing indicator
    if (unsubSession) { unsubSession(); unsubSession = null; }
    unsubSession = onSnapshot(doc(db,'chat_sessions', sid), (snap)=>{
      const data = snap.data() || {};
      if (data.adminTyping) typingEl.classList.remove('hidden');
      else typingEl.classList.add('hidden');
    });
    // stream messages
    if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
    const q = query(collection(db,'chat_sessions', sid, 'messages'), orderBy('createdAt','asc'));
    initialLoaded = false;
    unsubMsgs = onSnapshot(q, (snap)=>{
      const panelHidden = panel.classList.contains('hidden');
      chatMessages.innerHTML = '';
      const changes = snap.docChanges();
      snap.forEach(d=>{
        const m = d.data();
        const mine = m.from === 'user' || m.from === userCache.uid; // user side
        const row = document.createElement('div');
        row.className = `flex ${mine ? 'justify-end' : 'justify-start'}`;
        const bubble = document.createElement('div');
        bubble.className = `${mine ? 'bg-blue-600 text-white' : 'bg-white border'} inline-block rounded-2xl px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words`;
        bubble.textContent = m.text || '';
        row.appendChild(bubble);
        chatMessages.appendChild(row);
      });
      // Notify on new admin messages if panel hidden
      if (initialLoaded) {
        changes.forEach(ch=>{
          if (ch.type === 'added') {
            const m = ch.doc.data();
            if (m.from === 'admin' && panelHidden) {
              showToast('New reply from Support. Tap to open.');
              setUnread(unreadCount+1);
            }
          }
        });
      } else {
        initialLoaded = true;
      }
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  function closeChat(){
    panel.classList.add('hidden');
  }

  chatBtn.addEventListener('click', openChat);
  chatClose.addEventListener('click', closeChat);

  async function sendMessage(text){
    const sid = await ensureSession();
    const user = auth.currentUser;
    const msg = {
      text: String(text||'').trim(),
      from: 'user',
      userId: user ? user.uid : null,
      createdAt: serverTimestamp()
    };
    if (!msg.text) return;
    await addDoc(collection(db,'chat_sessions', sid, 'messages'), msg);
    await updateDoc(doc(db,'chat_sessions', sid), {
      updatedAt: serverTimestamp(),
      lastMessage: msg.text,
      lastFrom: 'user',
      adminUnread: true,
      adminUnreadCount: (window.__noop_inc || 0) // placeholder; server will compute increment on security rules if set
    });
  }

  chatInput.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage(chatInput.value).then(()=> chatInput.value='');
    }
  });

  chatSendBtn?.addEventListener('click', (e)=>{
    e.preventDefault();
    const val = (chatInput.value||'').toString();
    if (!val.trim()) return;
    sendMessage(val).then(()=> chatInput.value='');
  });

  chatInput.addEventListener('input', ()=>{
    const has = !!String(chatInput.value||'').trim();
    if (chatSendBtn) chatSendBtn.disabled = !has;
    // user typing indicator with debounce
    ensureSession().then((sid)=>{
      updateDoc(doc(db,'chat_sessions', sid), { userTyping: true }).catch(()=>{});
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(()=>{
        updateDoc(doc(db,'chat_sessions', sid), { userTyping: false }).catch(()=>{});
      }, 1200);
    });
  });
  // initialize disabled state
  if (chatSendBtn) chatSendBtn.disabled = true;

  onAuthStateChanged(auth, (user)=>{
    userCache.uid = user?.uid || null;
    userCache.email = user?.email || null;
  });

  // Simple toast for notifications
  function showToast(text){
    let t = document.getElementById('chat-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'chat-toast';
      t.className = 'fixed left-1/2 -translate-x-1/2 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-[60] bg-gray-900 text-white text-sm px-4 py-2 rounded shadow-lg';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(window.__chat_toast_timer);
    window.__chat_toast_timer = setTimeout(()=> t.classList.add('hidden'), 3000);
    t.onclick = ()=>{ t.classList.add('hidden'); openChat(); };
  }
})();
