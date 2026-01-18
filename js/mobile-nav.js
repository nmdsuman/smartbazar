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

    // Determine active route
    const map = {
      home: ['/', '/index.html'],
      cart: ['/cart.html'],
      orders: ['/orders.html', '/view.html'],
      account: ['/profile.html','/login.html','/signup.html']
    };
    const path = location.pathname.toLowerCase();

    function isActive(key){
      return (map[key]||[]).some(s => path.endsWith(s));
    }

    nav.querySelectorAll('a').forEach(a => {
      const key = a.getAttribute('data-key');
      if (isActive(key)) {
        a.classList.add('text-rose-600', 'font-semibold');
        a.querySelector('.icon')?.classList.add('scale-110');
        a.querySelector('.icon')?.classList.add('transition');
      }
    });
  } catch {}
})();
