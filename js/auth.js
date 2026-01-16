import { auth } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth';

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

  onAuthStateChanged(auth, (user) => {
    if (loginLink) loginLink.classList.toggle('hidden', !!user);
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !user);
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

// Login page script
export function initLoginPage() {
  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');

  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.location.replace('admin.html');
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
      await signInWithEmailAndPassword(auth, email, password);
      window.location.replace('admin.html');
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
      window.location.replace('admin.html');
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
      await createUserWithEmailAndPassword(auth, email, password);
      window.location.replace('admin.html');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
    }
  });
}
