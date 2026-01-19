import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, setDoc, getDoc, doc, collection, serverTimestamp, onSnapshot, query, orderBy, updateDoc } from 'firebase/firestore';

(function initChatWidget(){
  if (window.__chatWidgetInit) return; window.__chatWidgetInit = true;
  // Build floating button
  const btn = document.createElement('button');
  btn.id = 'chat-fab';
  btn.className = 'fixed bottom-4 right-4 z-50 bg-blue-600 text-white rounded-full shadow-lg w-12 h-12 flex items-center justify-center hover:bg-blue-700';
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6"><path d="M7.5 8.25h9m-9 3h6.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-3.75 0a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z"/></svg>';
  document.body.appendChild(btn);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'chat-panel';
  panel.className = 'fixed bottom-20 right-4 z-50 w-80 max-w-[90vw] bg-white border rounded-xl shadow-xl hidden';
  panel.innerHTML = `
    <div class="flex items-center justify-between px-3 py-2 border-b">
      <div class="font-semibold">Live Chat</div>
      <button id="chat-close" class="text-sm px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">Close</button>
    </div>
    <div id="chat-messages" class="p-3 h-72 overflow-y-auto space-y-2 bg-gray-50"></div>
    <div class="p-2 border-t">
      <input id="chat-input" type="text" placeholder="Type your message" class="w-full border rounded px-3 py-2" />
      <div class="mt-2 text-xs text-gray-500">You can chat as guest if not logged in.</div>
    </div>
  `;
  document.body.appendChild(panel);

  const chatBtn = btn;
  const chatClose = panel.querySelector('#chat-close');
  const chatMessages = panel.querySelector('#chat-messages');
  const chatInput = panel.querySelector('#chat-input');

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
  async function openChat(){
    panel.classList.remove('hidden');
    panel.classList.add('block');
    const sid = await ensureSession();
    // stream messages
    if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
    const q = query(collection(db,'chat_sessions', sid, 'messages'), orderBy('createdAt','asc'));
    unsubMsgs = onSnapshot(q, (snap)=>{
      chatMessages.innerHTML = '';
      snap.forEach(d=>{
        const m = d.data();
        const mine = m.from === 'user' || m.from === userCache.uid; // user side
        const div = document.createElement('div');
        div.className = `max-w-[85%] ${mine?'ml-auto bg-blue-600 text-white':'mr-auto bg-white border'} rounded px-3 py-2 text-sm`;
        div.textContent = m.text || '';
        chatMessages.appendChild(div);
      });
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
      lastFrom: 'user'
    });
  }

  chatInput.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage(chatInput.value).then(()=> chatInput.value='');
    }
  });

  onAuthStateChanged(auth, (user)=>{
    userCache.uid = user?.uid || null;
    userCache.email = user?.email || null;
  });
})();
