import { db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { addToCart, updateCartBadge } from './app.js';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

// Helper: Normalize options safely
function normalizeOptions(raw){
  try {
    if (Array.isArray(raw)) {
      // Filter out invalid options
      return raw.filter(o => o && (o.label || o.weight) && (o.price !== undefined && o.price !== null))
        .map(o => ({
          label: String(o.label || o.weight || '').trim(),
          price: Number(o.price),
          weightGrams: (typeof o.weightGrams === 'number' ? o.weightGrams : undefined)
        }));
    }
    // Handle single object or legacy formats (rare)
    if (raw && typeof raw === 'object') {
      if ((raw.label || raw.weight) && (raw.price !== undefined)) {
        return [{ label: String(raw.label || raw.weight), price: Number(raw.price) }];
      }
    }
  } catch (e) { console.error('Error normalizing options', e); }
  return [];
}

function getParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

// Helper: Localize Units (Bangla support)
function localizeLabel(lbl){
  const s = String(lbl||'').trim();
  const map = { '0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯' };
  
  // Basic digit conversion
  const toBn = (n) => String(n).replace(/[0-9]/g, c => map[c] || c);
  
  // Match number + unit
  const m = s.toLowerCase().match(/^([0-9]*\.?[0-9]+)\s*(kg|g|l|liter|ltr|ml|pc|pcs|piece|pieces)$/);
  if (m) {
    let val = parseFloat(m[1]);
    let unit = m[2];
    
    // Normalize units
    if (['liter','ltr'].includes(unit)) unit = 'l';
    if (['pcs','piece','pieces'].includes(unit)) unit = 'pc';

    // Auto convert small fractional kg/l to g/ml for display
    if (unit === 'kg' && val < 1) { val *= 1000; unit = 'g'; }
    if (unit === 'l' && val < 1) { val *= 1000; unit = 'ml'; }

    const bnVal = toBn(val);
    let bnUnit = unit;
    
    switch(unit) {
      case 'kg': bnUnit = 'কেজি'; break;
      case 'g': bnUnit = 'গ্রাম'; break;
      case 'l': bnUnit = 'লিটার'; break;
      case 'ml': bnUnit = 'মিলি'; break;
      case 'pc': bnUnit = 'পিস'; break;
    }
    return `${bnVal} ${bnUnit}`;
  }
  // Fallback text replacement
  return s.replace(/kg/gi,'কেজি').replace(/ltr|liter/gi,'লিটার').replace(/pc/gi,'পিস');
}

async function loadProduct(id) {
  const ref = doc(db, 'products', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Product not found');
  return { id: snap.id, data: snap.data() };
}

async function loadRelated(category, excludeId) {
  if (!category) return [];
  try {
    const qy = query(
      collection(db, 'products'),
      where('category', '==', category)
    );
    const snap = await getDocs(qy);
    return snap.docs
      .map(d => ({ id: d.id, data: d.data() }))
      .filter(p => p.id !== excludeId && p.data.active !== false)
      .slice(0, 4); // Limit to 4 related items
  } catch { return []; }
}

function renderRelated(list) {
  const section = document.getElementById('related-section');
  const grid = document.getElementById('related-grid');
  if (!grid) return;
  
  if (!list || list.length === 0) {
    section?.classList.add('hidden');
    return;
  }
  section?.classList.remove('hidden');
  grid.innerHTML = list.map(({ id, data: d }) => `
    <a href="productfullview.html?id=${encodeURIComponent(id)}" class="block border border-gray-200 rounded-xl bg-white overflow-hidden hover:shadow-md transition-shadow group">
      <div class="aspect-square bg-white p-2 flex items-center justify-center">
        <img src="${d.image}" alt="${d.title}" class="w-full h-full object-contain group-hover:scale-105 transition-transform">
      </div>
      <div class="p-3">
        <h3 class="text-sm font-medium text-gray-800 line-clamp-2 mb-1 group-hover:text-blue-600">${d.title}</h3>
        <div class="font-bold text-blue-600 text-sm">৳${Number(d.price).toFixed(2)}</div>
      </div>
    </a>
  `).join('');
}

async function main() {
  initAuthHeader();
  updateCartBadge();
  const id = getParam('id');
  
  if (!id) {
    window.location.replace('index.html');
    return;
  }

  try {
    const { id: pid, data: p } = await loadProduct(id);
    
    // 1. Elements
    const img = document.getElementById('pv-image');
    const thumbsContainer = document.getElementById('pv-thumbs');
    const title = document.getElementById('pv-title');
    const meta = document.getElementById('pv-meta');
    const catTag = document.getElementById('pv-cat-tag');
    const price = document.getElementById('pv-price');
    const stockEl = document.getElementById('pv-stock');
    const desc = document.getElementById('pv-desc');
    const addBtn = document.getElementById('pv-add');
    const buyBtn = document.getElementById('pv-buy-now');
    const optWrap = document.getElementById('pv-options');
    const qtyMinus = document.getElementById('pv-qty-minus');
    const qtyPlus = document.getElementById('pv-qty-plus');
    const qtyView = document.getElementById('pv-qty-view');

    // 2. Render Basic Info
    if (img) img.src = p.image || '';
    if (title) title.textContent = p.title || 'Product Name';
    if (catTag && p.category) {
      catTag.textContent = p.category;
      catTag.classList.remove('hidden');
    }
    
    // Meta: Weight / Size
    const metaBits = [];
    if (p.weight) metaBits.push(p.weight);
    if (p.size) metaBits.push(p.size);
    if (meta) meta.textContent = metaBits.join(' · ');

    if (desc) desc.innerHTML = (p.description || 'No description available.').replace(/\n/g, '<br>');

    // 3. Render Gallery Thumbs
    if (thumbsContainer) {
      const allImages = [p.image, ...(Array.isArray(p.images) ? p.images : [])].filter(Boolean).slice(0, 5); // Limit 5
      if (allImages.length > 1) {
        thumbsContainer.innerHTML = allImages.map((url, i) => `
          <button class="flex-shrink-0 w-16 h-16 border rounded-lg overflow-hidden ${i===0?'ring-2 ring-blue-600 border-transparent':''} focus:outline-none hover:opacity-80 transition-opacity snap-start scroll-ml-2" onclick="document.getElementById('pv-image').src='${url}'; this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('ring-2','ring-blue-600','border-transparent')); this.classList.add('ring-2','ring-blue-600','border-transparent');">
            <img src="${url}" class="w-full h-full object-cover bg-white">
          </button>
        `).join('');
      } else {
        thumbsContainer.classList.add('hidden');
      }
    }

    // 4. Handle Variants & Pricing
    let opts = normalizeOptions(p.options);
    
    // If no variants, but we have a base price, we treat base as default
    // If variants exist, we ensure a "Default" or base variant is included if not explicitly in list
    // (Logic from admin panel ensures base variant is handled, but let's be safe)
    
    // Check if base variant should be added to options list
    const basePrice = Number(p.price);
    const hasOptions = opts.length > 0;
    
    // If we have options, we want to make sure the user selects one.
    // If 'base' variant isn't in options but exists physically, we usually add it.
    // However, clean logic: if opts exist, use them. If not, use base.
    
    let currentPrice = basePrice;
    let selectedOptIndex = hasOptions ? 0 : null; // Default to first option if variants exist

    // If options exist, check if we need to prepend base (if unique) - Optional
    // For simplicity, we trust the admin panel's data.
    
    if (hasOptions) {
      // Set initial price range or first option price
      const prices = opts.map(o => o.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      
      // Initially show the selected option price (index 0)
      currentPrice = opts[0].price;
      if (price) price.textContent = currentPrice.toFixed(2);
      
      // Render Options Pills
      optWrap.classList.remove('hidden');
      optWrap.innerHTML = `
        <label class="block text-sm font-medium text-gray-700 mb-2">Select Variant</label>
        <div class="flex flex-wrap gap-2">
          ${opts.map((o, i) => `
            <button type="button" data-idx="${i}" class="pv-opt-btn px-4 py-2 text-sm font-medium border rounded-lg transition-all ${i===0 ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600'}">
              ${localizeLabel(o.label)} <span class="text-xs opacity-75 ml-1">(৳${o.price})</span>
            </button>
          `).join('')}
        </div>
      `;

      // Option Click Handler
      optWrap.querySelectorAll('.pv-opt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          // Visual update
          optWrap.querySelectorAll('.pv-opt-btn').forEach(b => {
            b.classList.remove('border-blue-600', 'bg-blue-50', 'text-blue-700', 'ring-1', 'ring-blue-600');
            b.classList.add('border-gray-200', 'text-gray-600');
          });
          btn.classList.remove('border-gray-200', 'text-gray-600');
          btn.classList.add('border-blue-600', 'bg-blue-50', 'text-blue-700', 'ring-1', 'ring-blue-600');

          // Logic update
          selectedOptIndex = Number(btn.getAttribute('data-idx'));
          currentPrice = opts[selectedOptIndex].price;
          if (price) {
            // Animate price change
            price.style.opacity = '0.5';
            setTimeout(() => {
              price.textContent = currentPrice.toFixed(2);
              price.style.opacity = '1';
            }, 150);
          }
        });
      });

    } else {
      // No variants, just base price
      if (price) price.textContent = basePrice.toFixed(2);
      optWrap.classList.add('hidden');
    }

    // 5. Stock Status
    const stock = Number(p.stock || 0);
    const isOut = stock <= 0;
    if (stockEl) {
      if (isOut) {
        stockEl.textContent = 'Out of Stock';
        stockEl.className = 'text-sm font-bold px-3 py-1 rounded-full bg-red-100 text-red-600';
      } else {
        stockEl.textContent = 'In Stock';
        stockEl.className = 'text-sm font-medium px-3 py-1 rounded-full bg-green-100 text-green-700';
      }
    }

    // 6. Quantity Logic
    let qty = 1;
    function updateQtyUI() {
      if (qtyView) qtyView.textContent = qty;
    }
    if (qtyMinus) qtyMinus.addEventListener('click', () => { qty = Math.max(1, qty - 1); updateQtyUI(); });
    if (qtyPlus) qtyPlus.addEventListener('click', () => { qty = Math.max(1, qty + 1); updateQtyUI(); });

    // 7. Add to Cart Logic
    const handleAddToCart = (redirect = false) => {
      if (isOut) return;
      
      let finalPrice = currentPrice;
      let finalTitle = p.title;
      let finalId = pid;
      let weightInfo = p.weight || '';

      if (hasOptions && selectedOptIndex !== null) {
        const opt = opts[selectedOptIndex];
        finalPrice = opt.price;
        // Unique ID for cart: ID__VariantLabel
        finalId = `${pid}__${opt.label}`;
        weightInfo = localizeLabel(opt.label);
      } else if (hasOptions && selectedOptIndex === null) {
         alert('Please select a variant option.');
         return;
      }

      // Add to cart function from app.js
      addToCart({
        id: finalId,
        title: finalTitle,
        price: finalPrice,
        image: p.image,
        weight: weightInfo,
        qty: qty
      });

      // Visual Feedback
      if (redirect) {
        // "Buy Now" -> Redirect to Cart Page
        window.location.href = 'cart.html';
      } else {
        // "Add to Cart" -> Show badge animation, stay on page
        updateCartBadge();
        const btn = document.getElementById('pv-add');
        if (btn) {
            const oldText = btn.textContent;
            btn.textContent = 'Added!';
            btn.classList.add('bg-green-600', 'border-green-600', 'text-white');
            btn.classList.remove('bg-white', 'text-blue-700');
            setTimeout(() => {
                btn.textContent = oldText;
                btn.classList.remove('bg-green-600', 'border-green-600', 'text-white');
                btn.classList.add('bg-white', 'text-blue-700');
            }, 1500);
        }
      }
    };

    if (addBtn) {
      addBtn.disabled = isOut;
      if (isOut) {
         addBtn.classList.add('opacity-50', 'cursor-not-allowed');
         addBtn.textContent = 'Unavailable';
      } else {
         addBtn.addEventListener('click', () => handleAddToCart(false));
      }
    }

    if (buyBtn) {
      buyBtn.disabled = isOut;
      if (isOut) {
         buyBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
         buyBtn.addEventListener('click', () => handleAddToCart(true));
      }
    }

    // 8. Load Related Products
    const related = await loadRelated(p.category || '', pid);
    renderRelated(related);

  } catch (e) {
    console.error(e);
    // document.body.innerHTML = '<div class="p-10 text-center">Product not found or error loading details. <a href="index.html" class="text-blue-600 underline">Go Home</a></div>';
  }
}

// Start
main();
