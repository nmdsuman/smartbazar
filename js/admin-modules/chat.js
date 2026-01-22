import { auth, db } from '../firebase-config.js';
import { collection, addDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, getDocs } from 'firebase/firestore';

(function(){
  // Elements
  const chatBadge = document.getElementById('chat-badge');
  const chatSessionsEl = document.getElementById('chat-sessions');
  const chatCountEl = document.getElementById('chat-count');
  const chatMessagesEl = document.getElementById('chat-messages-admin');
  const chatMetaEl = document.getElementById('chat-meta');
  const chatReplyInput = document.getElementById('chat-reply');
  const chatSendBtn = document.getElementById('chat-send');

  // State
  let sessions = [];
  let selectedId = null;
  let typingTimer = null;

  function setSendEnabled(){
    const has = !!String(chatReplyInput?.value||'').trim();
    if (chatSendBtn) chatSendBtn.disabled = !has || !selectedId;
  }

  function renderSessions(){
    if (!chatSessionsEl) return;
    chatSessionsEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    sessions.forEach(s => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'w-full text-left p-2 hover:bg-gray-50 flex items-start justify-between';
      row.innerHTML = `
        <div class="min-w-0">
          <div class="font-medium truncate">${s.data.name || s.data.customer?.name || 'Visitor'}</div>
          <div class="text-xs text-gray-500 truncate">${s.data.lastText || ''}</div>
        </div>
        <span class="text-xs text-gray-400">${s.data.status || ''}</span>`;
      row.addEventListener('click', ()=> selectSession(s.id, s.data));
      frag.appendChild(row);
    });
    chatSessionsEl.appendChild(frag);
    if (chatCountEl) chatCountEl.textContent = sessions.length ? String(sessions.length) : '';
    if (chatBadge) {
      const unread = sessions.filter(x=> x.data.unreadAdmin === true).length;
      if (unread > 0) { chatBadge.textContent = String(unread); chatBadge.classList.remove('hidden'); }
      else { chatBadge.textContent = '0'; chatBadge.classList.add('hidden'); }
    }
  }

  function subscribeSessions(){
    if (!chatSessionsEl) return;
    try {
      const qy = query(collection(db,'chat_sessions'), orderBy('updatedAt','desc'));
      onSnapshot(qy, (snap)=>{
        sessions = snap.docs.map(d=>({ id: d.id, data: d.data() }));
        renderSessions();
      });
    } catch {}
  }

  let unsubMessages = null;
  function selectSession(id, data){
    selectedId = id;
    if (chatMetaEl) chatMetaEl.textContent = data?.name ? `Chat with ${data.name}` : `Session ${id.slice(-6)}`;
    if (chatMessagesEl) chatMessagesEl.innerHTML = '';
    unsubMessages?.();
    try {
      const qy = query(collection(db, 'chat_sessions', id, 'messages'), orderBy('createdAt','asc'));
      unsubMessages = onSnapshot(qy, (snap)=>{
        renderMessages(snap.docs.map(d=> d.data()));
      });
      setSendEnabled();
      // mark as read for admin
      try { updateDoc(doc(db,'chat_sessions', id), { unreadAdmin: false }); } catch {}
    } catch {}
  }

  function renderMessages(items){
    if (!chatMessagesEl) return;
    chatMessagesEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.forEach(m => {
      const wrap = document.createElement('div');
      const isAdmin = (m.by || '') === 'admin';
      wrap.className = `max-w-[85%] ${isAdmin? 'ml-auto bg-blue-600 text-white':'bg-white'} rounded px-3 py-2 text-sm shadow`;
      wrap.textContent = m.text || '';
      frag.appendChild(wrap);
    });
    chatMessagesEl.appendChild(frag);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  async function sendReply(){
    if (!selectedId) return;
    const text = String(chatReplyInput?.value||'').trim();
    if (!text) return;
    try {
      chatSendBtn?.setAttribute('disabled','');
      await addDoc(collection(db,'chat_sessions', selectedId, 'messages'), {
        text,
        by: 'admin',
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db,'chat_sessions', selectedId), { lastText: text, updatedAt: serverTimestamp(), unreadUser: true });
      if (chatReplyInput) chatReplyInput.value = '';
      setSendEnabled();
    } catch {}
    finally { chatSendBtn?.removeAttribute('disabled'); }
  }

  // typing indicator
  chatReplyInput?.addEventListener('input', ()=>{
    setSendEnabled();
    const cur = selectedId; if (!cur) return;
    try { updateDoc(doc(db,'chat_sessions', cur), { adminTyping: true }); } catch {}
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(()=>{ try { updateDoc(doc(db,'chat_sessions', cur), { adminTyping: false }); } catch {} }, 1200);
  });

  chatReplyInput?.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  });
  chatSendBtn?.addEventListener('click', sendReply);

  function maybeStart(){ if (location.hash.replace('#','') === 'chat') subscribeSessions(); }
  window.addEventListener('hashchange', maybeStart);
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', maybeStart, { once: true }); } else { maybeStart(); }
})();
