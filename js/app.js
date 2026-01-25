import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import { initAuthHeader } from './auth.js';
import {
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  runTransaction
} from 'firebase/firestore';

// CART utils (localStorage)
const CART_KEY = 'bazar_cart';
let shippingSettings = null; // { baseFee, extraPerBlock, blockGrams, fallbackFee }

// Prefer a target unit family when rendering (e.g., force liters for liquids)
// Assumes 1kg≈1L and 1000g≈1kg, 1000ml≈1L for display purposes only
function localizeLabelPrefer(lbl, preferred){
  const s = String(lbl||'').trim();
  const pref = String(preferred||'').toLowerCase();
  if (!s) return '';
  const m = s.toLowerCase().replace(/\s+/g,'').match(/^([0-9]*\.?[0-9]+)(kg|g|l|liter|ltr|ml|pc|pcs|piece|pieces|পিস|পিচ|পিছ)?$/);
  if (!m) return localizeLabel(s);
  let val = parseFloat(m[1]);
  let unit = m[2] || '';
  // Normalize Bangla piece unit to 'pc'
  if (unit === 'পিস' || unit === 'পিচ' || unit === 'পিছ' || unit === 'pcs' || unit === 'piece' || unit === 'pieces') unit = 'pc';
  // If preferred is pieces, force unit to pc for numeric labels
  if (pref === 'pc'){
    if (!unit) unit = 'pc';
    return localizeLabel(`${val}${unit}`);
  }
  if (pref === 'l'){
    // Coerce any kg/g to liters for display
    if (unit === 'g'){ val = val/1000; unit = 'l'; }
    else if (unit === 'kg'){ unit = 'l'; }
  } else if (pref === 'kg'){
    // Coerce any l/ml to kilograms for display
    if (unit === 'ml'){ val = val/1000; unit = 'kg'; }
    else if (unit === 'l' || unit === 'liter' || unit === 'ltr'){ unit = 'kg'; }
  }
  const combined = `${val}${unit}`;
  return localizeLabel(combined);
}
let cloudSaveTimer = null;
let allProducts = [];
let currentFilters = { q: '', category: '' };
const DEBUG_PRODUCTS = false;

// Shared cart row template generator (Price / Quantity / Subtotal layout)
function generateCartRowHTML(item, idx) {
  const price = Number(item.price) || 0;
  const qty = Math.max(1, Number(item.qty || 1) || 1);
  const line = price * qty;
  const weightChip = item.weight
    ? ` <span class="inline-block align-middle ml-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]">${item.weight}</span>`
    : '';
  return `
    <div class="relative p-3 rounded-xl border border-gray-100 bg-white shadow-sm" data-idx="${idx}">
      <button class="remove absolute top-2 right-2 text-gray-400 hover:text-red-600" aria-label="Remove item" title="Remove">✕</button>
      <div class="flex items-start gap-3 pr-10">
        <img src="${item.image || ''}" alt="${item.title || ''}" class="w-16 h-16 object-contain bg-white rounded">
        <div class="flex-1 min-w-0">
          <div class="text-[14px] font-medium leading-snug truncate">${item.title || 'Item'}${weightChip}</div>
          <div class="mt-2 space-y-2 text-[13px]">
            <div class="flex items-center justify-between"><span class="text-gray-500">Price</span><span>৳${price.toFixed(2)}</span></div>
            <div class="flex items-center justify-between">
              <span class="text-gray-500">Quantity</span>
              <div class="inline-flex items-center rounded-md border border-gray-200 overflow-hidden text-sm">
                <button aria-label="Decrease quantity" class="qty-dec px-2 h-7 hover:bg-gray-50">−</button>
                <span class="qty-view px-2 select-none">${qty}</span>
                <button aria-label="Increase quantity" class="qty-inc px-2 h-7 hover:bg-gray-50">+</button>
              </div>
            </div>
            <div class="flex items-center justify-between"><span class="text-gray-500">Subtotal</span><span class="font-semibold text-green-700">৳${line.toFixed(2)}</span></div>
          </div>
        </div>
      </div>
    </div>`;
}
// Expose for non-module consumers (e.g., index.html drawer script)
try { window.CartTemplates = Object.assign(window.CartTemplates || {}, { row: generateCartRowHTML }); } catch {}

// Helpers: convert English digits to Bangla and localize unit labels
function toBnDigits(str){
  const map = { '0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯','.':'․' };
  return String(str).replace(/[0-9.]/g, ch => map[ch] ?? ch);
}
function localizeLabel(lbl){
  const s = String(lbl||'').trim();
  if (!s) return '';
  const m = s.toLowerCase().replace(/\s+/g,'').match(/^([0-9]*\.?[0-9]+)(kg|g|l|liter|ltr|ml|milliliter|millilitre|pc|pcs|piece|pieces|পিস|পিচ|পিছ)?$/);
  if (m){
    const numStr = m[1];
    let unit = m[2] || '';
    if (unit === 'পিস' || unit === 'পিচ' || unit === 'পিছ' || unit === 'pcs' || unit === 'piece' || unit === 'pieces') unit = 'pc';
    const val = parseFloat(numStr);
    // Auto-convert: if <1 kg -> grams, if <1 liter -> ml
    if ((unit === 'kg') && val > 0 && val < 1){
      const grams = Math.round(val * 1000);
      return `${toBnDigits(String(grams))} গ্রাম`;
    }
    if ((unit === 'l' || unit === 'liter' || unit === 'ltr') && val > 0 && val < 1){
      const ml = Math.round(val * 1000);
      return `${toBnDigits(String(ml))} মিলি`;
    }
    // Keep original unit, render number nicely
    const pretty = Number.isFinite(val) && Math.abs(val - Math.round(val)) < 1e-9 ? String(Math.round(val)) : String(val);
    const bnNum = toBnDigits(pretty);
    let bnUnit = '';
    if (unit === 'kg') bnUnit = 'কেজি';
    else if (unit === 'g') bnUnit = 'গ্রাম';
    else if (unit === 'l' || unit === 'liter' || unit === 'ltr') bnUnit = 'লিটার';
    else if (unit === 'ml' || unit === 'milliliter' || unit === 'millilitre') bnUnit = 'মিলি';
    else if (unit === 'pc') bnUnit = 'পিস';
    return bnUnit ? `${bnNum} ${bnUnit}` : toBnDigits(s);
  }
  return toBnDigits(s)
    .replace(/\bkg\b/gi,'কেজি')
    .replace(/\bg\b/gi,'গ্রাম')
    .replace(/\b(l|liter|ltr)\b/gi,'লিটার')
    .replace(/\bml\b/gi,'মিলি')
    .replace(/\bpc\b/gi,'পিস');
}

// Inject minimal CSS for cart animations once
let cartAnimStylesInjected = false;
function ensureCartAnimStyles() {
  if (cartAnimStylesInjected) return;
  const css = `
  @keyframes cart-bump { 0%{transform:scale(1)} 30%{transform:scale(1.15)} 100%{transform:scale(1)} }
  #cart-count.bump { animation: cart-bump 300ms ease; }
  .fly-img { position: fixed; z-index: 9999; width: 64px; height: 64px; object-fit: cover; pointer-events: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.2); transition: transform 800ms cubic-bezier(.2,.7,.2,1), opacity 800ms; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  cartAnimStylesInjected = true;
}

function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

 

function writeCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
  // Also persist to cloud for logged-in users (debounced)
  if (auth.currentUser) {
    if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(async () => {
      try {
        await setDoc(doc(db, 'users', auth.currentUser.uid), { cart }, { merge: true });
      } catch (e) {
        console.warn('Cloud cart save failed', e);
      }
    }, 250);
  }
}

export function addToCart(item) {
  const cart = readCart();
  const existing = cart.find(p => p.id === item.id);
  if (existing) {
    // Increment by requested qty (default 1)
    const add = Math.max(1, Number(item.qty || 1) | 0);
    existing.qty = Math.max(1, (existing.qty | 0) + add);
  } else {
    const q = Math.max(1, Number(item.qty || 1) | 0);
    cart.push({ ...item, qty: q });
  }
  writeCart(cart);
}

function bumpCartBadge() {
  const countEl = document.getElementById('cart-count');
  if (!countEl) return;
  countEl.classList.remove('bump');
  // force reflow to restart animation
  // eslint-disable-next-line no-unused-expressions
  countEl.offsetHeight;
  countEl.classList.add('bump');
}

function flyToCartFrom(imgEl) {
  // Prefer bottom nav cart badge on mobile
  const isSmall = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  const bottomBadge = document.getElementById('cart-count-bottom');
  const headerBadge = document.getElementById('cart-count');
  const cartEl = (isSmall && bottomBadge) ? bottomBadge : headerBadge;
  if (!imgEl || !cartEl) return;
  const rect = imgEl.getBoundingClientRect();
  const target = cartEl.getBoundingClientRect();
  const clone = document.createElement('img');
  clone.src = imgEl.src;
  clone.className = 'fly-img';
  clone.style.left = `${rect.left + window.scrollX}px`;
  clone.style.top = `${rect.top + window.scrollY}px`;
  document.body.appendChild(clone);
  const dx = target.left + target.width / 2 - (rect.left + rect.width / 2);
  const dy = target.top + target.height / 2 - (rect.top + rect.height / 2) + window.scrollY;
  requestAnimationFrame(() => {
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`;
    clone.style.opacity = '0.2';
  });
  setTimeout(() => { clone.remove(); }, 900);
}

export function removeFromCart(id) {
  let cart = readCart();
  cart = cart.filter(p => p.id !== id);
  writeCart(cart);
}

export function setQty(id, qty) {
  const cart = readCart();
  const item = cart.find(p => p.id === id);
  if (item) {
    item.qty = Math.max(1, qty | 0);
    writeCart(cart);
  }
}

export function updateCartBadge() {
  const countEl = document.getElementById('cart-count');
  if (!countEl) return;
  const cart = readCart();
  const totalQty = cart.reduce((sum, p) => sum + p.qty, 0);
  countEl.textContent = String(totalQty);
  // Sync bottom nav badge if present
  const bottom = document.getElementById('cart-count-bottom');
  if (bottom) bottom.textContent = String(totalQty);
}

// Render products on index.html
function drawProducts() {
  const grid = document.getElementById('products-grid');
  const empty = document.getElementById('empty-state');
  if (!grid) return;

  if (DEBUG_PRODUCTS) {
    try { console.debug('[Products] total loaded:', allProducts.length); } catch {}
  }
  const list = allProducts
    .filter(p => (p.data.active === false ? false : true))
    .filter(p => {
      const sel = String(currentFilters.category || '').trim().toLowerCase();
      if (!sel) return true;
      const cat = String(p.data.category || '').trim().toLowerCase();
      const sub = String(p.data.subcategory || '').trim().toLowerCase();
      return cat === sel || sub === sel;
    })
    .filter(p => {
      const q = currentFilters.q.trim().toLowerCase();
      if (!q) return true;
      const hay = `${p.data.title} ${p.data.description || ''} ${p.data.category || ''}`.toLowerCase();
      return hay.includes(q);
    });

  // Debug panel disabled per request
  let dbg = document.getElementById('product-debug');

  // Summaries
  const total = allProducts.length;
  const onlyActive = allProducts.filter(p => (p.data.active === false ? false : true));
  const activeCount = onlyActive.length;
  const cat = String(currentFilters.category || '').trim().toLowerCase();
  const excludedByCat = onlyActive.filter(p => {
    if (!cat) return false;
    const pc = String(p.data.category||'').trim().toLowerCase();
    const ps = String(p.data.subcategory||'').trim().toLowerCase();
    return !(pc === cat || ps === cat);
  }).length;
  const q = (currentFilters.q || '').trim().toLowerCase();
  const excludedByQuery = onlyActive.filter(p => {
    if (!q) return false;
    const hay = `${p.data.title} ${p.data.description || ''} ${p.data.category || ''}`.toLowerCase();
    return !hay.includes(q);
  }).length;

  const frag = document.createDocumentFragment();
  if (list.length === 0) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
    if (dbg) {
      dbg.classList.remove('hidden');
      dbg.innerHTML = `
        <div><strong>নোটিশ:</strong> কোনো প্রোডাক্ট দেখানো যাচ্ছে না।</div>
        <div class="mt-1">মোট: ${total}, Active: ${activeCount}, ক্যাটাগরিতে বাদ: ${excludedByCat}, সার্চে বাদ: ${excludedByQuery}</div>
        <div class="mt-1">ফিল্টার ক্লিয়ার করে আবার চেষ্টা করুন।</div>
      `;
    }
    if (DEBUG_PRODUCTS) {
      try {
        const info = { query: currentFilters.q, category: currentFilters.category, total: allProducts.length, shown: list.length };
        console.warn('[Products] nothing to show after filters', info);
        if (empty) empty.textContent = `No products available (filters applied).`;
      } catch {}
    }
    return;
  }
  empty?.classList.add('hidden');
  grid.innerHTML = '';
  // helper to normalize options in case they are saved as object map or JSON string
  function normalizeOptions(raw){
    try {
      if (Array.isArray(raw)) {
        return raw.filter(o=> o && (o.label || o.weight) && (o.price !== undefined && o.price !== null));
      }
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        return normalizeOptions(parsed);
      }
      if (raw && typeof raw === 'object'){
        // If it looks like a single option object
        if ((raw.label || raw.weight) && (raw.price !== undefined && raw.price !== null)){
          return [ { label: raw.label || raw.weight || '', price: raw.price } ];
        }
        // Object map of label -> price or index -> {label, price}
        const out = [];
        Object.keys(raw).forEach(k=>{
          const v = raw[k];
          if (v && typeof v === 'object'){
            const lbl = v.label || v.weight || '';
            const pr = v.price;
            if (lbl && pr !== undefined && pr !== null) out.push({ label: lbl, price: pr });
          } else if (typeof v === 'number') {
            out.push({ label: k, price: v });
          }
        });
        return out;
      }
    } catch {}
    return [];
  }

  list.forEach(({ id, data: d }) => {
      if (d.active === false) return; // hide inactive
      const card = document.createElement('div');
      card.className = 'relative border border-gray-200 rounded-lg bg-white overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow';
      const stock = Number(d.stock || 0);
      const out = stock <= 0;
      let opts = normalizeOptions(d.options);
      // Ensure base product (price + weight/size) is also treated as a variant for backward compatibility
      try {
        const basePrice = Number(d.price);
        const baseLabel = String(d.weight || d.size || '').trim();
        const validBase = Number.isFinite(basePrice);
        if (validBase) {
          const exists = opts.some(o => String(o.label || o.weight || '').trim().toLowerCase() === baseLabel.toLowerCase());
          if (!exists) {
            opts = [{ label: baseLabel || 'ডিফল্ট', price: basePrice }, ...opts];
          }
        }
      } catch {}
      // Do not mutate original labels; we'll render using preferred unit dynamically
      const hasOptions = Array.isArray(opts) && opts.length > 0;
      const hasSingleOption = Array.isArray(opts) && opts.length === 1;
      // Derive preferred unit from base weight for consistent rendering
      let preferredUnit = '';
      try {
        const mPref = String(d.weight||'').toLowerCase().match(/(kg|g|l|liter|ltr|ml|pc|pcs|piece|pieces|পিস|পিচ|পিছ)/);
        if (mPref){
          const hit = mPref[1];
          preferredUnit = (hit === 'liter' || hit === 'ltr') ? 'l' : (/^(পিস|পিচ|পিছ|pcs|piece|pieces)$/.test(hit) ? 'pc' : hit);
        }
      } catch {}
      // If any option label is in pieces, prefer 'pc' for numeric-only labels
      try {
        const anyPc = Array.isArray(opts) && opts.some(o => {
          const s = String(o.label||o.weight||'').trim();
          return /(pc|pcs|piece|pieces)$/i.test(s) || /(পিস|পিচ|পিছ)$/.test(s);
        });
        if (anyPc) preferredUnit = 'pc';
      } catch {}
      // Heuristic: if multiple option labels are numeric-only (no unit), and none have weight units, assume pieces
      try {
        if (!preferredUnit || preferredUnit === 'kg'){
          const labels = Array.isArray(opts) ? opts.map(o => String(o.label||o.weight||'').trim()) : [];
          const numOnly = labels.filter(s => /^\d+(?:\.\d+)?$/.test(s)).length;
          const withUnits = labels.filter(s => /(kg|g|l|liter|ltr|ml)$/i.test(s)).length;
          if (numOnly >= 2 && withUnits === 0) preferredUnit = 'pc';
        }
      } catch {}
      // Heuristic improvement: if we have mixed labeled 'pc' and unlabeled numeric-only, still treat numeric-only as pc
      // Also count withUnits including 'pc' and Bangla piece words
      // Helper to format a raw option label into preferred-unit Bangla label
      function formatVariantLabel(raw){
        const s = String(raw||'').trim();
        const numericOnly = /^\d*\.?\d+$/.test(s);
        // If preferred is pieces, coerce any numeric(+foreign unit) to pieces for display
        if (preferredUnit === 'pc'){
          // Match numeric + (English or Bangla) units and coerce to pieces for display
          const m = s.toLowerCase().replace(/\s+/g,'').match(/^([0-9]*\.?[0-9]+)(kg|g|l|liter|ltr|ml|কেজি|গ্রাম|লিটার|মিলি|পিস|পিচ|পিছ)?$/);
          if (numericOnly || m){
            const val = numericOnly ? s : (m ? m[1] : s);
            return localizeLabelPrefer(`${val}pc`, 'pc');
          }
        }
        if (numericOnly && preferredUnit){
          return localizeLabelPrefer(`${s}${preferredUnit}`, preferredUnit);
        }
        return localizeLabelPrefer(s, preferredUnit);
      }
      if (DEBUG_PRODUCTS) {
        try {
          const rawType = d.options === null ? 'null' : Array.isArray(d.options) ? 'array' : typeof d.options;
          console.debug('[Product]', { id, title: d.title, active: d.active !== false, rawType, raw: d.options, normalizedCount: opts.length, hasOptions });
        } catch {}
      }
      // Compute initial price display: base price or min–max from options
      let priceDisplayHtml = '';
      if (hasOptions) {
        const priceList = opts
          .map(o => Number(o.price ?? d.price))
          .filter(v => Number.isFinite(v));
        if (priceList.length > 0) {
          const minP = Math.min(...priceList);
          const maxP = Math.max(...priceList);
          priceDisplayHtml = (minP === maxP)
            ? `৳${minP.toFixed(2)}`
            : `৳${minP.toFixed(2)} - ৳${maxP.toFixed(2)}`;
        } else {
          priceDisplayHtml = `৳${Number(d.price).toFixed(2)}`;
        }
      } else {
        priceDisplayHtml = `৳${Number(d.price).toFixed(2)}`;
      }
      // Reserve space for the bottom action bar on all cards to prevent overlap on mobile
      const bodyPad = 'pb-14';
      card.innerHTML = `
        ${out ? '<span class="absolute top-2 left-2 text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white">Out of stock</span>' : ''}
        <a href="productfullview.html?id=${encodeURIComponent(id)}" class="block bg-white">
          <img src="${d.image}" alt="${d.title}" class="h-56 w-full object-contain">
        </a>
        <div class="p-2 ${bodyPad} flex-1 flex flex-col">
          <h3 class="font-semibold text-[15px] mb-0.5 leading-snug line-clamp-2"><a href="productfullview.html?id=${encodeURIComponent(id)}" class="hover:text-blue-700">${d.title}</a></h3>
          <div class="flex items-center justify-between mt-1">
            <div class="price-view text-orange-600 font-bold text-sm">${priceDisplayHtml}</div>
            <span></span>
          </div>
          ${hasOptions && !hasSingleOption ? `
          <div class="mt-2 flex flex-wrap gap-1" data-opt-inline>
            ${opts.map((o,i)=>`
              <button type="button" data-idx="${i}" class="opt-inline-pill inline-flex items-center text-xs border border-gray-200 rounded px-2 py-1 hover:border-blue-400">
                <span>${formatVariantLabel(o.label || o.weight || '')}</span>
              </button>
            `).join('')}
          </div>
          ` : ''}
        </div>
        <div class="action-bar absolute bottom-2 left-2 right-2 z-10">
          ${hasOptions ? `
          <div class="bar flex items-center gap-1 w-full rounded-full bg-green-600 text-white overflow-hidden shadow">
            <div class="qty-inline shrink-0">
              <div class="inline-flex items-center">
                <button class="qty-dec px-2 h-9 hover:bg-green-700" aria-label="Decrease">−</button>
                <span class="qty-view px-2 select-none">1</span>
                <button class="qty-inc px-2 h-9 hover:bg-green-700" aria-label="Increase">+</button>
              </div>
            </div>
            <div class="separator w-1.5 h-5 bg-white/20 rounded-sm"></div>
            <button class="add-to-cart flex-1 h-9 flex items-center justify-center text-white px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.98] transition" aria-label="Add to cart">
              <span class="btn-label text-[12px] font-medium whitespace-nowrap sm:hidden">Add</span>
              <span class="btn-label hidden sm:inline text-[13px] font-medium whitespace-nowrap">Add To Cart</span>
            </button>
          </div>
          ` : `
          <div class="bar flex items-center gap-1 w-full rounded-full bg-green-600 text-white overflow-hidden shadow">
            <div class="qty-inline shrink-0">
              <div class="inline-flex items-center">
                <button class="qty-dec px-2 h-9 hover:bg-green-700" aria-label="Decrease">−</button>
                <span class="qty-view px-2 select-none">1</span>
                <button class="qty-inc px-2 h-9 hover:bg-green-700" aria-label="Increase">+</button>
              </div>
            </div>
            <div class="separator w-1.5 h-5 bg-white/20 rounded-sm"></div>
            <button class="add-to-cart flex-1 h-9 flex items-center justify-center text-white px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.98] transition" aria-label="Add to cart">
              <span class="btn-label text-[12px] font-medium whitespace-nowrap sm:hidden">Add</span>
              <span class="btn-label hidden sm:inline text-[13px] font-medium whitespace-nowrap">Add To Cart</span>
            </button>
          </div>
          `}
        </div>
      `;
      // Always append the card first so rendering never breaks
      frag.appendChild(card);
      if (!out) {
        try {
          const btn = card.querySelector('.add-to-cart');
          const imgEl = card.querySelector('img');
          const priceEl = card.querySelector('.price-view');
          // Inline options selection
          if (hasOptions){
            const pills = card.querySelectorAll('.opt-inline-pill');
            const labelSpan = btn.querySelector('.btn-label');
            const qtyWrap = card.querySelector('.qty-inline');
            const qtyView = card.querySelector('.qty-view');
            const decBtn = card.querySelector('.qty-dec');
            const incBtn = card.querySelector('.qty-inc');
            let selectedOpt = null;
            let qty = 1;
            
            // Auto-select single option only
            if (hasSingleOption) {
              selectedOpt = 0; // Auto-select the first (and only) option
              // Update price to show single option price
              try {
                const opt = opts[selectedOpt] || {};
                const selPrice = Number(opt.price ?? d.price);
                if (priceEl && Number.isFinite(selPrice)) priceEl.textContent = `৳${selPrice.toFixed(2)}`;
              } catch {}
              // Show quantity selector immediately
              if (qtyWrap) qtyWrap.classList.remove('hidden');
            }
            
            function refreshPillStyles(){
              pills.forEach(p=>{
                const idx = Number(p.getAttribute('data-idx')||'-1');
                if (selectedOpt === idx){
                  p.classList.remove('border-gray-200');
                  p.classList.add('border-green-600','bg-green-600','text-white');
                } else {
                  p.classList.remove('border-green-600','bg-green-600','text-white');
                  p.classList.add('border-gray-200');
                }
              });
            }
            
            // Initialize pill styles only for single option products
            if (hasSingleOption) {
              refreshPillStyles();
            }
            
            pills.forEach(p=>{
              p.addEventListener('click', ()=>{
                selectedOpt = Number(p.getAttribute('data-idx')||'0');
                btn.setAttribute('aria-label','Add to cart');
                if (labelSpan) labelSpan.textContent = 'Add To Cart';
                btn.classList.remove('px-3'); btn.classList.add('px-3');
                if (qtyWrap) qtyWrap.classList.remove('hidden');
                qty = 1; if (qtyView) qtyView.textContent = '1';
                // Update the main price to the selected option's price
                try {
                  const opt = opts[selectedOpt] || {};
                  const selPrice = Number(opt.price ?? d.price);
                  if (priceEl && Number.isFinite(selPrice)) priceEl.textContent = `৳${selPrice.toFixed(2)}`;
                } catch {}
                refreshPillStyles();
              });
            });
            // Qty listeners
            if (decBtn) decBtn.addEventListener('click', ()=>{ qty = Math.max(1, qty-1); if (qtyView) qtyView.textContent = String(qty); });
            if (incBtn) incBtn.addEventListener('click', ()=>{ qty = Math.max(1, qty+1); if (qtyView) qtyView.textContent = String(qty); });
            btn.addEventListener('click', () => {
              // For single option, selectedOpt is already set to 0
              // For multi-variant, require selection first
              if (selectedOpt === null){
                // Show visual feedback that selection is required
                btn.classList.add('ring-2','ring-blue-400');
                setTimeout(()=>btn.classList.remove('ring-2','ring-blue-400'), 600);
                return;
              }
              const opt = opts[selectedOpt] || {};
              const weightDisp = formatVariantLabel(opt.label || opt.weight || d.weight || '');
              addToCart({ id: `${id}__${opt.label||opt.weight||'opt'}`, title: d.title, price: Number((opt.price ?? d.price)), image: d.image, weight: weightDisp, qty });
              bumpCartBadge();
              flyToCartFrom(imgEl);
            });
            return; // skip default
          }
          // Simple product qty handling
          let qty = 1;
          const qtyView = card.querySelector('.qty-view');
          const decBtn = card.querySelector('.qty-dec');
          const incBtn = card.querySelector('.qty-inc');
          if (decBtn) decBtn.addEventListener('click', ()=>{ qty = Math.max(1, qty-1); if (qtyView) qtyView.textContent = String(qty); });
          if (incBtn) incBtn.addEventListener('click', ()=>{ qty = Math.max(1, qty+1); if (qtyView) qtyView.textContent = String(qty); });
          btn.addEventListener('click', () => {
            addToCart({ id, title: d.title, price: Number(d.price), image: d.image, weight: d.weight || '', qty });
            bumpCartBadge();
            flyToCartFrom(imgEl);
          });
        } catch (err) {
          // Surface a gentle hint in debug panel if available
          const dbg = document.getElementById('product-debug');
          if (dbg) {
            dbg.classList.remove('hidden');
            const prev = dbg.innerHTML;
            dbg.innerHTML = prev + `<div class="mt-1">“${d.title}” কার্ড ইন্টারঅ্যাকশন লোডে সমস্যা: ${String(err&&err.message||err).slice(0,120)}</div>`;
          }
        }
      }
    });
  grid.appendChild(frag);

  // Show quick hints even when items are shown
  if (dbg) {
    const shown = list.length;
    // Find variant issues for visible items
    const variantIssues = list
      .map(p => ({ id: p.id, data: p.data }))
      .map(({id, data}) => {
        const optsN = normalizeOptions(data.options);
        return { id, title: data.title || id, hasRaw: !!data.options, normalized: Array.isArray(optsN) ? optsN.length : 0 };
      })
      .filter(x => x.hasRaw && x.normalized === 0)
      .slice(0,3);
    const warnHtml = variantIssues.length > 0
      ? `<div class="mt-1">কিছু প্রোডাক্টের ভ্যারিয়েন্ট ডেটা ঠিক নয় (উদাহরণ: ${variantIssues.map(v=>`“${v.title}”`).join(', ')}).</div>`
      : '';
    dbg.classList.remove('hidden');
    dbg.innerHTML = `
      <div>দেখানো হয়েছে: ${shown}/${activeCount}. সার্চ/ক্যাটাগরি বদলালে ভিউ বদলাবে।</div>
      ${warnHtml}
    `;
  }
}

async function loadProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  try {
    let snap = null;
    try {
      const qy = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
      snap = await getDocs(qy);
    } catch (e1) {
      // Fallback without orderBy (some docs may not have createdAt or rules might block ordering)
      try {
        snap = await getDocs(collection(db, 'products'));
        const dbg = document.getElementById('product-debug');
        if (dbg) {
          dbg.classList.remove('hidden');
          dbg.innerHTML = `<div class="text-sm">নোটিশ: createdAt দিয়ে সাজানো যায়নি, তাই সাধারণভাবে লোড করা হয়েছে। কারণ: ${String(e1&&e1.message||e1).slice(0,140)}</div>`;
        }
      } catch (e2) {
        throw e2;
      }
    }
    allProducts = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    populateCategories();
    drawProducts();
  } catch (e) {
    const empty = document.getElementById('empty-state');
    console.error('Failed to load products', e);
    empty?.classList.remove('hidden');
    if (empty) empty.textContent = 'Failed to load products.';
    const dbg = document.getElementById('product-debug');
    if (dbg) {
      dbg.classList.remove('hidden');
      dbg.innerHTML = `<div class="text-sm">প্রোডাক্ট লোড করা যায়নি: ${String(e&&e.message||e).slice(0,200)}</div>`;
    }
  }
}

function populateCategories() {
  const select = document.getElementById('category-filter');
  if (!select) return;
  const cats = Array.from(new Set(allProducts.map(p => (p.data.category || '').trim()).filter(Boolean))).sort();
  select.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function setupFilters() {
  const search = document.getElementById('search-input');
  const cat = document.getElementById('category-filter');
  const btn = document.getElementById('search-btn');
  if (search) {
    search.addEventListener('input', () => {
      currentFilters.q = search.value || '';
      drawProducts();
    });
    // Pressing Enter will trigger Search button if present
    search.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btn) btn.click(); else drawProducts();
      }
    });
  }
  if (cat) {
    cat.addEventListener('change', () => {
      currentFilters.category = cat.value || '';
      drawProducts();
    });
  }
  if (btn) {
    btn.addEventListener('click', () => {
      const v = search ? (search.value || '') : '';
      currentFilters.q = v;
      drawProducts();
    });
  }
}

function hideHomeLinkOnHome() {
  // If current page is index (either / or /index.html), hide any nav link that points to home
  const path = window.location.pathname;
  const onHome = path === '/' || path.endsWith('/index.html');
  if (!onHome) return;
  const navLinks = document.querySelectorAll('header nav a');
  navLinks.forEach(a => {
    try {
      const url = new URL(a.getAttribute('href'), window.location.origin);
      const p = url.pathname;
      if (p === '/' || p.endsWith('/index.html')) {
        a.classList.add('hidden');
      }
    } catch {}
  });
}

// Render cart page
export async function renderCartPage() {
  initAuthHeader();
  updateCartBadge();

  const itemsEl = document.getElementById('cart-items');
  const emptyEl = document.getElementById('cart-empty');
  const summaryEl = document.getElementById('cart-summary');
  const totalEl = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('checkout-btn');
  const nameInput = document.getElementById('chk-name');
  const phoneInput = document.getElementById('chk-phone');
  const addressInput = document.getElementById('chk-address');
  const deliveryEl = document.getElementById('delivery-fee');
  const grandTotalEl = document.getElementById('grand-total');
  // Invoice modal elements
  const invModal = document.getElementById('inv-modal');
  const invBody = document.getElementById('inv-body');
  const invClose = document.getElementById('inv-close');
  const invConfirm = document.getElementById('inv-confirm');

  if (!itemsEl) return;

  function parseWeightToGrams(w) {
    if (!w) return 0;
    const s = String(w).trim().toLowerCase();
    const m = s.match(/([0-9]*\.?[0-9]+)\s*(kg|g|l|liter|ltr|ml)?/);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    const unit = m[2] || 'g';
    // Treat liter as kilogram equivalent for delivery: 1L == 1kg
    if (unit === 'kg' || unit === 'l' || unit === 'liter' || unit === 'ltr') {
      return Math.round(val * 1000);
    }
    return Math.round(val);
  }

  function calcDelivery(cart) {
    const cfg = shippingSettings || { fixedFee: 60, fixedUpToGrams: 1000, extraPerKg: 30, fallbackFee: 80 };
    const totalGrams = cart.reduce((sum, i) => sum + parseWeightToGrams(i.weight) * i.qty, 0);
    // Fixed fee always applies
    const fixedUpTo = Number(cfg.fixedUpToGrams || 0);
    const base = Number(cfg.fixedFee || 0);
    const extraPerKg = Number(cfg.extraPerKg || 0);
    if (totalGrams <= 0) return base;
    if (fixedUpTo > 0 && totalGrams <= fixedUpTo) return base;
    const overGrams = Math.max(0, totalGrams - fixedUpTo);
    const extraKgBlocks = Math.ceil(overGrams / 1000);
    return base + extraKgBlocks * extraPerKg;
  }

  async function loadProfile() {
    try {
      if (!auth.currentUser) return;
      const ref = doc(db, 'users', auth.currentUser.uid);
      const snap = await getDoc(ref);
      const p = snap.exists() ? snap.data() : {};
      if (nameInput && p.name) nameInput.value = p.name;
      if (phoneInput && p.phone) phoneInput.value = p.phone;
      if (addressInput && p.address) addressInput.value = p.address;
    } catch {}
  }

  async function loadShippingSettings() {
    try {
      const ref = doc(db, 'settings', 'shipping');
      const snap = await getDoc(ref);
      if (snap.exists()) shippingSettings = snap.data();
    } catch {}
  }

  function refresh() {
    const raw = localStorage.getItem(CART_KEY);
    console.debug('Cart raw localStorage', raw);
    const cart = readCart();
    console.debug('Parsed cart items', cart);
    itemsEl.innerHTML = '';
    if (cart.length === 0) {
      emptyEl.classList.remove('hidden');
      summaryEl.classList.add('hidden');
      totalEl.textContent = '৳0.00';
      if (deliveryEl) deliveryEl.textContent = '৳0.00';
      if (grandTotalEl) grandTotalEl.textContent = '৳0.00';
      return;
    }
    emptyEl.classList.add('hidden');
    summaryEl.classList.remove('hidden');

    let total = 0;
    cart.forEach(item => {
      const row = document.createElement('div');
      row.className = 'relative p-3 rounded-xl border border-gray-100 bg-white shadow-sm';
      const itemTotal = item.price * item.qty;
      total += itemTotal;
      const weightChip = item.weight ? ` <span class=\"inline-block align-middle ml-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]\">${item.weight}</span>` : '';
      row.innerHTML = `
        <button class="remove absolute top-2 right-2 text-gray-400 hover:text-red-600" aria-label="Remove item" title="Remove">✕</button>
        <div class="flex items-start gap-3 pr-10">
          <img src="${item.image}" alt="${item.title}" class="w-16 h-16 object-contain bg-white rounded">
          <div class="flex-1 min-w-0">
            <div class="text-[14px] font-medium leading-snug truncate">${item.title}${weightChip}</div>
            <div class="mt-2 space-y-2 text-[13px]">
              <div class="flex items-center justify-between"><span class="text-gray-500">Price</span><span>৳${item.price.toFixed(2)}</span></div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500">Quantity</span>
                <div class="inline-flex items-center rounded-md border border-gray-200 overflow-hidden text-sm">
                  <button aria-label="Decrease quantity" class="qty-dec px-2 h-7 hover:bg-gray-50">−</button>
                  <span class="qty-view px-2 select-none">${item.qty}</span>
                  <button aria-label="Increase quantity" class="qty-inc px-2 h-7 hover:bg-gray-50">+</button>
                </div>
              </div>
              <div class="flex items-center justify-between"><span class="text-gray-500">Subtotal</span><span class="font-semibold text-green-700">৳${itemTotal.toFixed(2)}</span></div>
            </div>
          </div>
        </div>
      `;
      const decBtn = row.querySelector('.qty-dec');
      const incBtn = row.querySelector('.qty-inc');
      decBtn.addEventListener('click', () => {
        const next = Math.max(1, (item.qty | 0) - 1);
        setQty(item.id, next);
        refresh();
      });
      incBtn.addEventListener('click', () => {
        const next = (item.qty | 0) + 1;
        setQty(item.id, next);
        refresh();
      });
      row.querySelector('.remove').addEventListener('click', () => {
        removeFromCart(item.id);
        refresh();
      });
      itemsEl.appendChild(row);
    });
    totalEl.textContent = `৳${total.toFixed(2)}`;
    const delivery = calcDelivery(cart);
    if (deliveryEl) deliveryEl.textContent = `৳${delivery.toFixed(2)}`;
    if (grandTotalEl) grandTotalEl.textContent = `৳${(total + delivery).toFixed(2)}`;
  }

  checkoutBtn?.addEventListener('click', async () => {
    const cart = readCart();
    if (cart.length === 0) return;
    const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    const delivery = calcDelivery(cart);
    const name = nameInput ? nameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const address = addressInput ? addressInput.value.trim() : '';
    if (!name || !phone || !address) {
      // Simple inline validation styling
      [nameInput, phoneInput, addressInput].forEach(el => el && el.classList.add('ring-1','ring-red-400'));
      return;
    }
    [nameInput, phoneInput, addressInput].forEach(el => el && el.classList.remove('ring-1','ring-red-400'));

    // Persist profile locally for quick checkout from drawer
    try {
      localStorage.setItem('profile_name', name);
      localStorage.setItem('profile_phone', phone);
      localStorage.setItem('profile_address', address);
    } catch {}

    // Build invoice preview HTML (polished)
    const rows = cart.map(i => `
      <tr class="border-b last:border-0">
        <td class="p-3">
          <div class="flex items-center gap-3">
            <img src="${i.image}" alt="${i.title}" class="w-12 h-12 object-contain bg-white rounded border"/>
            <div class="min-w-0">
              <div class="text-sm font-medium truncate">${i.title}</div>
              ${i.weight?`<div class=\"text-xs text-gray-500\">${i.weight}</div>`:''}
            </div>
          </div>
        </td>
        <td class="p-3 text-right align-middle">${i.qty}</td>
        <td class="p-3 text-right align-middle">৳${Number(i.price).toFixed(2)}</td>
        <td class="p-3 text-right align-middle font-medium">৳${(i.qty*i.price).toFixed(2)}</td>
      </tr>`).join('');
    invBody.innerHTML = `
      <div class="mb-3 p-3 bg-gray-50 rounded border text-sm text-gray-700">
        <div class="font-medium mb-0.5">Customer</div>
        <div>${name} · ${phone}</div>
        <div class="truncate">${address}</div>
      </div>
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-gray-600">
          <tr>
            <th class="text-left p-3">Product</th>
            <th class="text-right p-3">Qty</th>
            <th class="text-right p-3">Price</th>
            <th class="text-right p-3">Total</th>
          </tr>
        </thead>
        <tbody class="divide-y">${rows}</tbody>
      </table>
      <div class="mt-4 p-3 rounded border bg-white grid gap-1 text-sm">
        <div class="flex items-center justify-between text-gray-700"><span>Subtotal</span><span class="font-medium">৳${subtotal.toFixed(2)}</span></div>
        <div class="flex items-center justify-between text-gray-700"><span>Delivery</span><span class="font-medium">৳${delivery.toFixed(2)}</span></div>
        <div class="flex items-center justify-between text-base mt-1"><span class="font-semibold">Grand Total</span><span class="inline-flex items-center justify-center font-semibold bg-green-600 text-white px-3 py-1 rounded-full">৳${(subtotal+delivery).toFixed(2)}</span></div>
      </div>
      <div class="mt-2 text-xs text-gray-500">Please review your order details before confirmation.</div>
    `;
    // Show modal
    invModal?.classList.remove('hidden');
    invModal?.classList.add('flex');

    // Wire confirm once per open
    const onConfirm = async () => {
      try {
        // Save/merge profile
        if (auth.currentUser) {
          await setDoc(doc(db, 'users', auth.currentUser.uid), { name, phone, address }, { merge: true });
        }
        // Place order atomically: validate and decrement stock, then create order
        const ordersCol = collection(db, 'orders');
        const newOrderRef = doc(ordersCol);
        const newOrderId = newOrderRef.id;
        await runTransaction(db, async (tx) => {
          // 1) Read all product docs first (no writes yet)
          const writePlan = [];
          for (const it of cart) {
            // Support variant cart IDs like `${productId}__${variantLabel}` by extracting base product ID
            const baseId = String(it.id || '').split('__')[0] || String(it.id || '');
            const prodRef = doc(db, 'products', baseId);
            const snap = await tx.get(prodRef);
            if (!snap.exists()) throw new Error(`Product not found: ${it.title || it.id}`);
            const data = snap.data() || {};
            const currentStock = Number(data.stock || 0);
            const need = Number(it.qty || 0);
            if (!Number.isFinite(need) || need <= 0) throw new Error('Invalid quantity');
            if (currentStock < need) throw new Error(`Insufficient stock for ${data.title || it.title || 'item'}`);
            writePlan.push({ ref: prodRef, newStock: currentStock - need });
          }
          // 2) Perform all writes after all reads
          writePlan.forEach(({ ref, newStock }) => {
            tx.update(ref, { stock: newStock });
          });
          // 3) Create order document
          tx.set(newOrderRef, {
            items: cart,
            subtotal,
            delivery,
            total: subtotal + delivery,
            currency: 'BDT',
            userId: auth.currentUser ? auth.currentUser.uid : null,
            customer: { name, phone, address },
            status: 'Pending',
            createdAt: serverTimestamp()
          });
        });
        localStorage.removeItem(CART_KEY);
        updateCartBadge();
        invModal.classList.add('hidden'); invModal.classList.remove('flex');
        // Redirect to orders with success flag
        window.location.href = `orders.html?placed=${encodeURIComponent(newOrderId)}`;
      } catch (e) {
        alert('Failed to place order: ' + e.message);
      } finally {
        invConfirm?.removeEventListener('click', onConfirm);
      }
    };
    invConfirm?.addEventListener('click', onConfirm);
  });

  invClose?.addEventListener('click', () => {
    invModal?.classList.add('hidden');
    invModal?.classList.remove('flex');
  });

  await loadShippingSettings();
  refresh();
  loadProfile();

  // If opened with ?quick=1 and profile is present, auto open summary
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('quick') === '1' && checkoutBtn) {
      const hasProfile = (nameInput && nameInput.value.trim() && phoneInput && phoneInput.value.trim() && addressInput && addressInput.value.trim());
      if (hasProfile) setTimeout(()=>checkoutBtn.click(), 0);
    }
  } catch {}
}

// Initialize header + home
(function init() {
  initAuthHeader();
  updateCartBadge();
  ensureCartAnimStyles();
  setupFilters();
  hideHomeLinkOnHome();
  loadProducts();
})();

// ===== Options Modal (weight/size variants) =====
function openOptionsModal({ id, data, imgEl }){
  let host = document.getElementById('opt-modal');
  if (!host) return;
  const body = host.querySelector('#opt-body');
  const addBtn = host.querySelector('#opt-add');
  const closeBtn = host.querySelector('#opt-close');
  const minusBtn = host.querySelector('#opt-minus');
  const plusBtn = host.querySelector('#opt-plus');
  const qtyView = host.querySelector('#opt-qty-view');
  const options = Array.isArray(data.options) ? data.options : [];

  // Build pill list (buttons)
  const optsHtml = options.map((o,i)=>`
    <button data-idx="${i}" class="opt-pill inline-flex items-center justify-between w-full border rounded px-3 py-2 text-sm">
      <span>${o.label || o.weight || ''}</span>
      <span class="font-semibold">৳${Number(o.price ?? data.price).toFixed(2)}</span>
    </button>
  `).join('');

  body.innerHTML = `
    <div class="flex items-center gap-3">
      <img src="${data.image}" alt="${data.title}" class="w-16 h-16 object-contain bg-white border rounded"/>
      <div>
        <div class="font-medium">${data.title}</div>
        <div class="text-xs text-gray-600">Choose an option</div>
      </div>
    </div>
    <div class="mt-3 grid gap-2">${optsHtml}</div>
  `;

  // Local state
  let selectedIdx = 0;
  let qty = 1;
  if (qtyView) qtyView.textContent = String(qty);

  // Style helpers
  function refreshPills(){
    body.querySelectorAll('.opt-pill').forEach((el, i)=>{
      if (i === selectedIdx){
        el.classList.remove('border-gray-200');
        el.classList.add('bg-green-600','text-white','border-green-600');
      } else {
        el.classList.remove('bg-green-600','text-white','border-green-600');
        el.classList.add('border-gray-200');
      }
    });
  }
  refreshPills();
  body.querySelectorAll('.opt-pill').forEach(btn=>{
    btn.addEventListener('click', ()=>{ selectedIdx = Number(btn.getAttribute('data-idx')||'0'); refreshPills(); });
  });

  minusBtn && minusBtn.addEventListener('click', ()=>{ qty = Math.max(1, qty-1); if (qtyView) qtyView.textContent = String(qty); });
  plusBtn && plusBtn.addEventListener('click', ()=>{ qty = Math.max(1, qty+1); if (qtyView) qtyView.textContent = String(qty); });

  const cleanup = ()=>{
    addBtn.onclick=null; closeBtn.onclick=null;
    minusBtn && (minusBtn.onclick=null); plusBtn && (plusBtn.onclick=null);
    host.classList.add('hidden'); host.classList.remove('flex');
  };
  closeBtn.onclick = cleanup;
  addBtn.onclick = ()=>{
    const idx = Number.isFinite(selectedIdx) ? selectedIdx : 0;
    const opt = options[idx] || {};
    addToCart({ id: `${id}__${opt.label||opt.weight||'opt'}`, title: data.title, price: Number((opt.price ?? data.price)), image: data.image, weight: opt.label || opt.weight || data.weight || '', qty });
    bumpCartBadge();
    flyToCartFrom(imgEl);
    cleanup();
  };
  host.classList.remove('hidden');
  host.classList.add('flex');
}
