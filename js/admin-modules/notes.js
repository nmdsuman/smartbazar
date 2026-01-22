import { auth, db } from '../firebase-config.js';
import { collection, addDoc, deleteDoc, doc, serverTimestamp, getDocs, query, orderBy, where, setDoc } from 'firebase/firestore';

// Notes module: encapsulates all Notes functionality on admin.html
(function(){
  const noteTitleEl = document.getElementById('note-title');
  const noteContentEl = document.getElementById('note-content');
  const noteSaveBtn = document.getElementById('note-save');
  const noteNewBtn = document.getElementById('note-new');
  const noteMsgEl = document.getElementById('note-message');
  const notesListEl = document.getElementById('notes-list');

  let currentNoteId = null;

  function setNoteMessage(text, ok=true){
    if (!noteMsgEl) return;
    noteMsgEl.textContent = text;
    noteMsgEl.className = `text-sm mt-2 ${ok ? 'text-green-700' : 'text-red-700'}`;
  }

  async function loadNotes(){
    if (!notesListEl || !auth.currentUser) return;
    notesListEl.innerHTML = '';
    try {
      const qy = query(collection(db,'notes'), where('uid','==', auth.currentUser.uid), orderBy('updatedAt','desc'));
      const snap = await getDocs(qy);
      const notes = snap.docs.map(d=>({ id: d.id, ...d.data() }));
      renderNotes(notes);
    } catch (e) {
      try {
        const qy2 = query(collection(db,'notes'), where('uid','==', auth.currentUser.uid));
        const snap2 = await getDocs(qy2);
        const notes2 = snap2.docs.map(d=>({ id: d.id, ...d.data() }))
          .sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
        renderNotes(notes2);
      } catch(err){ if (noteMsgEl) { setNoteMessage('Failed to load notes', false); } }
    }
  }

  function renderNotes(items){
    if (!notesListEl) return;
    notesListEl.innerHTML = '';
    if (!Array.isArray(items) || items.length===0){
      const d = document.createElement('div'); d.className='text-gray-500 text-sm'; d.textContent='No notes yet.'; notesListEl.appendChild(d); return;
    }
    const frag = document.createDocumentFragment();
    items.forEach(n=>{
      const row = document.createElement('div');
      row.className = 'border rounded p-2 flex items-start justify-between gap-2';
      const when = n.updatedAt?.toDate ? n.updatedAt.toDate().toLocaleString() : '';
      row.innerHTML = `
        <div class="min-w-0">
          <div class="font-medium truncate">${(n.title||'Untitled')}</div>
          <div class="text-xs text-gray-500 truncate">${when}</div>
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <button class="copy px-2 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200">Copy</button>
          <button class="edit px-2 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700">Edit</button>
          <button class="del px-2 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
        </div>
      `;
      row.querySelector('.copy')?.addEventListener('click', async ()=>{
        try{ await navigator.clipboard.writeText(n.content||''); setNoteMessage('Copied to clipboard'); }catch{ setNoteMessage('Copy failed', false); }
      });
      row.querySelector('.edit')?.addEventListener('click', ()=>{
        currentNoteId = n.id;
        if (noteTitleEl) noteTitleEl.value = n.title||'';
        if (noteContentEl) noteContentEl.value = n.content||'';
        setNoteMessage('Loaded note for editing');
      });
      row.querySelector('.del')?.addEventListener('click', async ()=>{
        try{ await deleteDoc(doc(db,'notes', n.id)); setNoteMessage('Deleted'); loadNotes(); }catch(e){ setNoteMessage('Delete failed: '+e.message, false); }
      });
      frag.appendChild(row);
    });
    notesListEl.appendChild(frag);
  }

  noteSaveBtn?.addEventListener('click', async ()=>{
    if (!auth.currentUser) { setNoteMessage('Not signed in', false); return; }
    const title = (noteTitleEl?.value||'').toString().trim();
    const content = (noteContentEl?.value||'').toString();
    if (!content) { setNoteMessage('Content is empty', false); return; }
    try {
      if (currentNoteId) {
        await setDoc(doc(db,'notes', currentNoteId), { uid: auth.currentUser.uid, title: title||null, content, updatedAt: serverTimestamp() }, { merge: true });
        setNoteMessage('Saved changes');
      } else {
        await addDoc(collection(db,'notes'), { uid: auth.currentUser.uid, title: title||null, content, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        setNoteMessage('Note saved');
      }
      currentNoteId = null;
      loadNotes();
    } catch (e) { setNoteMessage('Save failed: '+e.message, false); }
  });

  noteNewBtn?.addEventListener('click', ()=>{
    currentNoteId = null;
    if (noteTitleEl) noteTitleEl.value='';
    if (noteContentEl) noteContentEl.value='';
    setNoteMessage('Ready for new note');
  });

  function onHash(){
    const id = location.hash.replace('#','');
    if (id === 'notes') { try { loadNotes(); } catch {} }
  }

  try {
    window.addEventListener('hashchange', onHash);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onHash, { once: true });
    } else {
      onHash();
    }
  } catch {}
})();
