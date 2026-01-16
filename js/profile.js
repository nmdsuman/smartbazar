import { auth, db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { doc, getDoc, setDoc } from 'firebase/firestore';

(function init() {
  initAuthHeader();
  const form = document.getElementById('profile-form');
  const msg = document.getElementById('profile-message');

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.replace('login.html');
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const p = snap.exists() ? snap.data() : {};
      form.name.value = p.name || '';
      form.phone.value = p.phone || '';
      form.address.value = p.address || '';
    } catch (e) {
      msg.textContent = 'Failed to load profile: ' + e.message;
      msg.className = 'text-sm mt-3 text-red-700';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        name: form.name.value.trim(),
        phone: form.phone.value.trim(),
        address: form.address.value.trim()
      }, { merge: true });
      msg.textContent = 'Profile saved.';
      msg.className = 'text-sm mt-3 text-green-700';
    } catch (e) {
      msg.textContent = 'Save failed: ' + e.message;
      msg.className = 'text-sm mt-3 text-red-700';
    }
  });
})();
