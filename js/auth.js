import { auth } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { db } from './firebase-config.js';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Attach logout to any [data-logout] button across pages
function wireGlobalLogout() {
  const btns = document.querySelectorAll('[data-logout]');
  btns.forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await signOut(auth);
        window.location.href = 'index.html';
      } catch (e) {
        alert('Logout failed: ' + e.message);
      }
    });
  });
}

export function initAuthHeader() {
  wireGlobalLogout();
  const loginLink = document.getElementById('login-link');
  const logoutBtn = document.getElementById('logout-btn');
  const adminLink = document.querySelector('a[href="admin.html"]');

  onAuthStateChanged(auth, (user) => {
    if (loginLink) loginLink.classList.toggle('hidden', !!user);
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !user);
    // Hide admin link for non-admins
    if (adminLink) {
      if (!user) {
        adminLink.classList.add('hidden');
      } else {
        getUserRole(user.uid).then(role => {
          adminLink.classList.toggle('hidden', role !== 'admin');
        }).catch(() => adminLink.classList.add('hidden'));
      }
    }
  });
}

// Protected route: redirect if not logged in
export function requireAuth() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace('login.html');
    }
  });
  wireGlobalLogout();
}

// Admin-only route
export function requireAdmin() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace('login.html');
      return;
    }
    try {
      const role = await getUserRole(user.uid);
      if (role !== 'admin') {
        window.location.replace('index.html');
      }
    } catch {
      window.location.replace('index.html');
    }
  });
  wireGlobalLogout();
}

async function getUserRole(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data()?.role) return snap.data().role;
  return 'user';
}

// Login page script
export function initLoginPage() {
  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');

  onAuthStateChanged(auth, (user) => {
    if (user) {
      // Redirect based on role
      getUserRole(user.uid)
        .then(role => window.location.replace(role === 'admin' ? 'admin.html' : 'index.html'))
        .catch(() => window.location.replace('index.html'));
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const email = data.get('email');
    const password = data.get('password');
    errorBox.classList.add('hidden');
    errorBox.textContent = '';

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const role = await getUserRole(cred.user.uid);
      window.location.replace(role === 'admin' ? 'admin.html' : 'index.html');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
    }
  });
}

// Signup page script
export function initSignupPage() {
  const form = document.getElementById('signup-form');
  const errorBox = document.getElementById('signup-error');

  onAuthStateChanged(auth, (user) => {
    if (user) {
      // Redirect based on role
      getUserRole(user.uid)
        .then(role => window.location.replace(role === 'admin' ? 'admin.html' : 'index.html'))
        .catch(() => window.location.replace('index.html'));
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const email = data.get('email');
    const password = data.get('password');
    errorBox.classList.add('hidden');
    errorBox.textContent = '';

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // Set default role 'user' on first signup
      await setDoc(doc(db, 'users', cred.user.uid), {
        role: 'user',
        email: email
      }, { merge: true });
      window.location.replace('index.html');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
    }
  });
}
