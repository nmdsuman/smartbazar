// Inject a mobile bottom navigation bar and highlight the active tab
(function(){
  try {
    // Do not render on admin pages
    const p = location.pathname.toLowerCase();
    if (p.includes('admin.html')) return;

    const nav = document.createElement('nav');
    nav.id = 'mobile-bottom-nav';
    nav.className = 'md:hidden fixed bottom-0 inset-x-0 bg-white border-t z-40';
    nav.innerHTML = `
      <div class="grid grid-cols-4 text-xs text-gray-600">
        <a href="index.html" data-key="home" class="flex flex-col items-center justify-center py-2 gap-0.5">
          <span class="icon" aria-hidden="true">🏠</span>
          <span>Home</span>
        </a>
        <a href="orders.html" data-key="orders" class="flex flex-col items-center justify-center py-2 gap-0.5">
          <span class="icon" aria-hidden="true">🧾</span>
          <span>Orders</span>
        </a>
        <a href="cart.html" data-key="cart" class="flex flex-col items-center justify-center py-2 gap-0.5 relative">
          <span class="icon" aria-hidden="true">🛒</span>
          <span>Cart</span>
          <span id="cart-count-bottom" class="absolute top-1 right-[22%] inline-flex items-center justify-center text-[10px] rounded-full bg-red-600 text-white min-w-[18px] h-[18px] px-1">0</span>
        </a>
        <a href="profile.html" data-key="account" class="flex flex-col items-center justify-center py-2 gap-0.5">
          <span class="icon" aria-hidden="true">👤</span>
          <span>Account</span>
        </a>
      </div>
    `;
    document.body.appendChild(nav);
    // Add safe bottom padding so content isn't hidden behind the bar on small screens
    try { document.body.classList.add('pb-16'); } catch {}
    // Initial cart badge from localStorage
    try {
      const raw = localStorage.getItem('bazar_cart') || '[]';
      const arr = JSON.parse(raw);
      const total = Array.isArray(arr) ? arr.reduce((s, i) => s + Number(i?.qty || 0), 0) : 0;
      const bottom = document.getElementById('cart-count-bottom');
      if (bottom) bottom.textContent = String(total);
    } catch {}

    // Determine active route (robust to subpaths, query params)
    const href = location.href.toLowerCase();
    const path = location.pathname.toLowerCase();
    function activeKey(){
      if (href.includes('cart')) return 'cart';
      if (href.includes('orders') || href.includes('view.html')) return 'orders';
      if (href.includes('profile') || href.includes('login') || href.includes('signup')) return 'account';
      // default home: index.html or root
      if (path === '/' || path.endsWith('/index.html')) return 'home';
      return 'home';
    }
    const keyNow = activeKey();

    // Reset and mark only one as active
    nav.querySelectorAll('a').forEach(a => {
      a.classList.remove('text-rose-600','font-semibold');
      a.querySelector('.icon')?.classList.remove('scale-110');
      a.querySelector('.icon')?.classList.add('transition');
    });
    const activeEl = nav.querySelector(`a[data-key="${keyNow}"]`);
    if (activeEl) {
      activeEl.classList.add('text-rose-600','font-semibold');
      activeEl.querySelector('.icon')?.classList.add('scale-110');
    }

    // Hide header Cart/My Account links on small screens (use bottom nav instead)
    try {
      const isSmall = window.matchMedia('(max-width: 767px)').matches;
      if (isSmall) {
        const header = document.querySelector('header nav');
        if (header) {
          const cartLink = header.querySelector('a[href="cart.html"]');
          const profileLink = header.querySelector('a[href="profile.html"]');
          const compactMenu = header.querySelector('#user-menu');
          if (cartLink) cartLink.classList.add('hidden');
          if (profileLink) profileLink.classList.add('hidden');
          if (compactMenu) compactMenu.classList.add('hidden');
        }
      }
    } catch {}
  } catch {}
})();
