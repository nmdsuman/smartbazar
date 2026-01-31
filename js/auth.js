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
  const adminLink = document.querySelector('a[href="wp-admin.html"]');
  const nav = document.querySelector('header nav');

  // Apply Site Settings (title, logo, favicon) across pages
  (async function applySiteSettings(){
    try {
      // Pre-clear brand/contact to avoid demo flash before settings load
      const header = document.querySelector('header');
      const brandPre = header ? header.querySelector('a[href="index.html"]') : null;
      if (brandPre) { brandPre.textContent = ''; brandPre.classList.add('invisible'); }
      const ce = document.getElementById('contact-email');
      const cp = document.getElementById('contact-phone');
      if (ce) { ce.textContent = ''; ce.removeAttribute('href'); ce.classList.add('hidden'); }
      if (cp) { cp.textContent = ''; cp.removeAttribute('href'); cp.classList.add('hidden'); }

      const ref = doc(db, 'settings', 'site');
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const s = snap.data() || {};
      // Brand text or logo in header (replace the first brand anchor inside header)
      const brand = header ? header.querySelector('a[href="index.html"]') : null;
      if (brand) {
        if (s.logo) {
          brand.innerHTML = `<img src="${s.logo}" alt="${s.title||'Site'}" class="h-12 md:h-14 object-contain">`;
        } else if (s.title) {
          brand.textContent = s.title;
        }
        brand.classList.remove('invisible');
      }
      // Document title: preserve page suffix after '—' if present
      if (s.title) {
        const orig = document.title || '';
        const parts = orig.split('—');
        if (parts.length > 1) {
          document.title = `${s.title} — ${parts.slice(1).join('—').trim()}`;
        } else {
          document.title = s.title;
        }
      }
      // Favicon
      if (s.favicon) {
        let link = document.querySelector('link[rel="icon"]');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = s.favicon;
      }
      // Contact details in footer (if present on this page)
      if (s.email) {
        const el = document.getElementById('contact-email');
        if (el) { el.textContent = s.email; el.setAttribute('href', `mailto:${s.email}`); el.classList.remove('hidden'); }
      }
      if (s.phone) {
        const el = document.getElementById('contact-phone');
        if (el) { el.textContent = s.phone; el.setAttribute('href', `tel:${s.phone.replace(/\s+/g,'')}`); el.classList.remove('hidden'); }
      }

      // Announcement Marquee (below header)
      try {
        // remove existing if any
        const old = document.getElementById('site-marquee'); if (old) old.remove();
        const enable = !!s.marqueeEnabled && typeof s.marqueeText === 'string' && s.marqueeText.trim().length > 0;
        if (enable) {
          // inject keyframes once
          if (!document.getElementById('site-marquee-style')) {
            const style = document.createElement('style');
            style.id = 'site-marquee-style';
            style.textContent = `@keyframes sb_marquee { 0% { transform: translateX(100%);} 100%{ transform: translateX(-100%);} }`;
            document.head.appendChild(style);
          }
          const bar = document.createElement('div');
          bar.id = 'site-marquee';
          bar.className = 'w-full bg-blue-600 text-white text-sm';
          const inner = document.createElement('div');
          inner.className = 'max-w-6xl mx-auto px-4';
          // container for scrolling
          const track = document.createElement('div');
          track.className = 'overflow-hidden whitespace-nowrap';
          const text = document.createElement('div');
          text.className = 'inline-block py-2';
          text.style.animation = 'sb_marquee 20s linear infinite';
          text.textContent = s.marqueeText.trim();
          track.appendChild(text);
          inner.appendChild(track);
          bar.appendChild(inner);
          const headerEl = document.querySelector('header');
          if (headerEl && headerEl.parentNode) {
            headerEl.parentNode.insertBefore(bar, headerEl.nextSibling);
          } else {
            document.body.insertBefore(bar, document.body.firstChild);
          }
        }
      } catch {}
    } catch {}
  })();

  // Ensure a compact user menu exists (My Account icon with dropdown)
  let menuHost = document.getElementById('user-menu');
  if (!menuHost && nav) {
    menuHost = document.createElement('div');
    menuHost.id = 'user-menu';
    menuHost.className = 'relative';
    menuHost.innerHTML = `
      <button id="user-menu-btn" aria-label="My account" aria-haspopup="menu" aria-expanded="false" class="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center select-none">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-gray-700">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.118a7.5 7.5 0 0 1 15 0A17.933 17.933 0 0 1 12 21.75c-2.69 0-5.251-.586-7.5-1.632Z" />
        </svg>
      </button>
      <div id="user-menu-panel" class="absolute right-0 mt-2 w-44 bg-white border rounded shadow-lg hidden">
        <a href="profile.html" class="block px-3 py-2 text-sm hover:bg-gray-50">Profile</a>
        <a href="orders.html" class="block px-3 py-2 text-sm hover:bg-gray-50">Orders</a>
        <button data-logout class="w-full text-left block px-3 py-2 text-sm hover:bg-gray-50">Logout</button>
      </div>
    `;
    nav.appendChild(menuHost);

    const btn = menuHost.querySelector('#user-menu-btn');
    const panel = menuHost.querySelector('#user-menu-panel');
    function closeMenu(){ if (panel) { panel.classList.add('hidden'); btn?.setAttribute('aria-expanded','false'); } }
    function toggleMenu(){ if (panel) { panel.classList.toggle('hidden'); btn?.setAttribute('aria-expanded', panel.classList.contains('hidden') ? 'false' : 'true'); } }
    btn?.addEventListener('click', (e)=>{ e.stopPropagation(); toggleMenu(); });
    document.addEventListener('click', (e)=>{ if (!menuHost.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeMenu(); });
    // Rewire logout for menu button too
    wireGlobalLogout();
  }

  onAuthStateChanged(auth, (user) => {
    if (loginLink) loginLink.classList.toggle('hidden', !!user);
    // Always hide standalone logout when compact menu exists
    if (logoutBtn) logoutBtn.classList.add('hidden');
    // Hide standalone Profile/Orders links when using the compact menu (for cleaner header)
    const profileLink = document.querySelector('a[href="profile.html"]');
    const ordersLink = document.querySelector('a[href="orders.html"]');
    const compactMenu = document.getElementById('user-menu');
    const useCompact = !!compactMenu && !!user;
    if (profileLink) profileLink.classList.toggle('hidden', useCompact);
    if (ordersLink) ordersLink.classList.toggle('hidden', useCompact);
    if (compactMenu) compactMenu.classList.toggle('hidden', !user);
    // If logged out, hide header links except Login
    if (!user) {
      try {
        const navEl = document.querySelector('header nav');
        if (navEl) {
          const links = [
            'a[href="orders.html"]',
            'a[href="profile.html"]',
            'a[href="cart.html"]',
            'a[href="wp-admin.html"]',
            '#user-menu'
          ];
          links.forEach(sel => {
            const el = navEl.querySelector(sel);
            if (el) el.classList.add('hidden');
          });
        }
      } catch {}
    }
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
        .then(role => window.location.replace(role === 'admin' ? 'wp-admin.html' : 'index.html'))
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
      window.location.replace(role === 'admin' ? 'wp-admin.html' : 'index.html');
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
        .then(role => window.location.replace(role === 'admin' ? 'wp-admin.html' : 'index.html'))
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
