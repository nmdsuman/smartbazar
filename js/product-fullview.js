import { db } from './firebase-config.js';
import { initAuthHeader } from './auth.js';
import { addToCart, updateCartBadge } from './app.js';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

// Minimal helpers (mirror app.js) for label localization including 'pc'
function toBnDigits(str){ const map = { '0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯','.':'․' }; return String(str).replace(/[0-9.]/g, ch => map[ch] ?? ch); }
function localizeLabel(lbl){
  const s = String(lbl||'').trim(); if (!s) return '';
  const m = s.toLowerCase().replace(/\s+/g,'').match(/^([0-9]*\.?[0-9]+)(kg|g|l|liter|ltr|ml|milliliter|millilitre|pc|পিস)?$/);
  if (m){
    const numStr = m[1]; let unit = m[2] || ''; const val = parseFloat(numStr);
    if (unit === 'পিস') unit = 'pc';
    if ((unit === 'kg') && val > 0 && val < 1){ const grams = Math.round(val * 1000); return `${toBnDigits(String(grams))} গ্রাম`; }
    if ((unit === 'l' || unit === 'liter' || unit === 'ltr') && val > 0 && val < 1){ const ml = Math.round(val * 1000); return `${toBnDigits(String(ml))} মিলি`; }
    const pretty = Number.isFinite(val) && Math.abs(val - Math.round(val)) < 1e-9 ? String(Math.round(val)) : String(val);
    const bnNum = toBnDigits(pretty); let bnUnit = '';
    if (unit === 'kg') bnUnit = 'কেজি'; else if (unit === 'g') bnUnit = 'গ্রাম'; else if (unit === 'l' || unit === 'liter' || unit === 'ltr') bnUnit = 'লিটার'; else if (unit === 'ml' || unit === 'milliliter' || unit === 'millilitre') bnUnit = 'মিলি'; else if (unit === 'pc') bnUnit = 'পিস';
    return bnUnit ? `${bnNum} ${bnUnit}` : toBnDigits(s);
  }
  return toBnDigits(s).replace(/\bkg\b/gi,'কেজি').replace(/\bg\b/gi,'গ্রাম').replace(/\b(l|liter|ltr)\b/gi,'লিটার').replace(/\bml\b/gi,'মিলি').replace(/\bpc\b/gi,'পিস');
}
function localizeLabelPrefer(lbl, preferred){
  const s = String(lbl||'').trim(); const pref = String(preferred||'').toLowerCase(); if (!s) return '';
  const m = s.toLowerCase().replace(/\s+/g,'').match(/^([0-9]*\.?[0-9]+)(kg|g|l|liter|ltr|ml|pc|পিস)?$/); if (!m) return localizeLabel(s);
  let val = parseFloat(m[1]); let unit = m[2] || '';
  if (unit === 'পিস') unit = 'pc';
  if (pref === 'pc'){ if (!unit) unit = 'pc'; return localizeLabel(`${val}${unit}`); }
  if (pref === 'l'){ if (unit === 'g'){ val = val/1000; unit = 'l'; } else if (unit === 'kg'){ unit = 'l'; } }
  else if (pref === 'kg'){ if (unit === 'ml'){ val = val/1000; unit = 'kg'; } else if (unit === 'l' || unit === 'liter' || unit === 'ltr'){ unit = 'kg'; } }
  return localizeLabel(`${val}${unit}`);
}

function normalizeOptions(raw){
  try {
    if (Array.isArray(raw)) return raw.filter(o=> o && (o.label || o.weight) && (o.price !== undefined && o.price !== null)).map(o=>({ label:o.label||o.weight||'', price:o.price, weightGrams: (typeof o.weightGrams==='number'? o.weightGrams: undefined) }));
    if (typeof raw === 'string'){ const parsed = JSON.parse(raw); return normalizeOptions(parsed); }
    if (raw && typeof raw === 'object'){
      if ((raw.label || raw.weight) && (raw.price !== undefined && raw.price !== null)) return [ { label: raw.label || raw.weight || '', price: raw.price, weightGrams: (typeof raw.weightGrams==='number'? raw.weightGrams: undefined) } ];
      const out = []; Object.keys(raw).forEach(k=>{ const v = raw[k]; if (v && typeof v === 'object'){ const lbl = v.label || v.weight || ''; const pr = v.price; if (lbl && pr !== undefined && pr !== null) out.push({ label: lbl, price: pr, weightGrams: (typeof v.weightGrams==='number'? v.weightGrams: undefined) }); } else if (typeof v === 'number') { out.push({ label: k, price: v }); } }); return out;
    }
  } catch {}
  return [];
}

function getParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

async function loadProduct(id) {
  const ref = doc(db, 'products', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Product not found');
  return { id: snap.id, data: snap.data() };
}

async function loadRelated(category, excludeId) {
  if (!category) return [];
  const qy = query(
    collection(db, 'products'),
    where('category', '==', category)
  );
  const snap = await getDocs(qy);
  return snap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .filter(p => p.id !== excludeId && p.data.active !== false)
    .slice(0, 8);
}

function renderRelated(list) {
  const grid = document.getElementById('related-grid');
  const empty = document.getElementById('related-empty');
  if (!grid) return;
  grid.innerHTML = '';
  if (!list || list.length === 0) {
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  const frag = document.createDocumentFragment();
  list.forEach(({ id, data: d }) => {
    const card = document.createElement('a');
    card.href = `productfullview.html?id=${encodeURIComponent(id)}`;
    card.className = 'border rounded bg-white overflow-hidden block hover:shadow';
    card.innerHTML = `
      <img src="${d.image}" alt="${d.title}" class="h-36 w-full object-contain bg-white">
      <div class="p-2">
        <div class="text-sm font-medium line-clamp-1">${d.title}</div>
        <div class="text-sm text-blue-700">৳${Number(d.price).toFixed(2)}</div>
      </div>
    `;
    frag.appendChild(card);
  });
  grid.appendChild(frag);
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
    // Populate main
    const img = document.getElementById('pv-image');
    const thumbs = document.getElementById('pv-thumbs');
    const title = document.getElementById('pv-title');
    const meta = document.getElementById('pv-meta');
    const price = document.getElementById('pv-price');
    const stockEl = document.getElementById('pv-stock');
    const desc = document.getElementById('pv-desc');
    const addBtn = document.getElementById('pv-add');
    const optWrap = document.getElementById('pv-options');
    const qtyMinus = document.getElementById('pv-qty-minus');
    const qtyPlus = document.getElementById('pv-qty-plus');
    const qtyView = document.getElementById('pv-qty-view');

    if (img) img.src = p.image || '';
    if (title) title.textContent = p.title || 'Product';
    const metaBits = [];
    if (p.category) metaBits.push(p.category);
    if (p.weight) metaBits.push(p.weight);
    if (p.size) metaBits.push(p.size);
    if (meta) meta.textContent = metaBits.join(' · ');
    if (price) price.textContent = Number(p.price || 0).toFixed(2);
    const stock = Number(p.stock || 0);
    if (stockEl) {
      if (stock > 0) {
        stockEl.textContent = `In stock: ${stock}`;
        stockEl.className = 'text-sm mb-4 text-green-700';
      } else {
        stockEl.textContent = 'Out of stock';
        stockEl.className = 'text-sm mb-4 text-red-600';
      }
    }
    if (desc) desc.textContent = p.description || '';

    // Build thumbnails (main image + gallery images)
    if (thumbs) {
      thumbs.innerHTML = '';
      const list = [p.image].concat(Array.isArray(p.images) ? p.images : []).filter(Boolean).slice(0,6);
      const frag = document.createDocumentFragment();
      list.forEach((url, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'border rounded overflow-hidden focus:outline-none focus:ring hover:opacity-90';
        b.innerHTML = `<img src="${url}" alt="thumb ${idx+1}" class="w-full h-14 object-contain bg-white">`;
        b.addEventListener('click', ()=>{ if (img) img.src = url; });
        frag.appendChild(b);
      });
      thumbs.appendChild(frag);
    }
    // Build options if present
    let opts = normalizeOptions(p.options);
    // Include base variant for compatibility
    try {
      const basePrice = Number(p.price);
      const baseLabel = String(p.weight || p.size || '').trim();
      const validBase = Number.isFinite(basePrice);
      if (validBase) {
        const exists = opts.some(o => String(o.label || o.weight || '').trim().toLowerCase() === baseLabel.toLowerCase());
        if (!exists) opts = [{ label: baseLabel || 'ডিফল্ট', price: basePrice }, ...opts];
      }
    } catch {}
    const hasOptions = Array.isArray(opts) && opts.length > 0;
    // Preferred unit
    let preferredUnit = '';
    try { const mPref = String(p.weight||'').toLowerCase().match(/(kg|g|l|liter|ltr|ml|pc|পিস)/); if (mPref){ const hit = mPref[1]; preferredUnit = (hit === 'liter' || hit === 'ltr') ? 'l' : (hit === 'পিস' ? 'pc' : hit); } } catch {}
    try { const anyPc = Array.isArray(opts) && opts.some(o => { const s = String(o.label||o.weight||'').trim(); return /pc$/i.test(s) || /পিস$/.test(s); }); if (anyPc) preferredUnit = 'pc'; } catch {}
    // Heuristic: if multiple option labels are numeric-only (no unit), treat as pieces
    try {
      if ((!preferredUnit || preferredUnit === 'kg') && Array.isArray(opts)){
        const labels = opts.map(o => String(o.label||o.weight||'').trim());
        const numOnly = labels.filter(s => /^\d+(?:\.\d+)?$/.test(s)).length;
        const withUnits = labels.filter(s => /(kg|g|l|liter|ltr|ml)$/i.test(s)).length;
        if (numOnly >= 2 && withUnits === 0) preferredUnit = 'pc';
      }
    } catch {}
    function fmt(raw){ const s = String(raw||'').trim(); const numOnly = /^\d*\.?\d+$/.test(s); return numOnly && preferredUnit ? localizeLabelPrefer(`${s}${preferredUnit}`, preferredUnit) : localizeLabelPrefer(s, preferredUnit); }
    // Initial price display (min-max)
    if (hasOptions && price){ const listP = opts.map(o=> Number(o.price ?? p.price)).filter(Number.isFinite); if (listP.length){ const minP = Math.min(...listP); const maxP = Math.max(...listP); price.textContent = (minP===maxP)? minP.toFixed(2) : `${minP.toFixed(2)} - ${maxP.toFixed(2)}`; } }

    // Quantity
    let qty = 1; if (qtyView) qtyView.textContent = String(qty);
    qtyMinus && qtyMinus.addEventListener('click', ()=>{ qty = Math.max(1, qty-1); if (qtyView) qtyView.textContent = String(qty); });
    qtyPlus && qtyPlus.addEventListener('click', ()=>{ qty = Math.max(1, qty+1); if (qtyView) qtyView.textContent = String(qty); });

    // Options UI
    let selectedIdx = hasOptions ? 0 : null;
    if (optWrap){
      if (hasOptions){
        optWrap.classList.remove('hidden');
        optWrap.innerHTML = `<div class="text-sm text-gray-600 mb-1">Choose an option</div>
          <div class="flex flex-wrap gap-2">${opts.map((o,i)=>`<button type="button" data-idx="${i}" class="pv-pill px-3 py-1.5 rounded border border-gray-200 text-sm">${fmt(o.label||o.weight||'')}</button>`).join('')}</div>`;
        const pills = optWrap.querySelectorAll('.pv-pill');
        function refresh(){ pills.forEach((el,i)=>{ if (i===selectedIdx){ el.classList.remove('border-gray-200'); el.classList.add('bg-green-600','text-white','border-green-600'); } else { el.classList.remove('bg-green-600','text-white','border-green-600'); el.classList.add('border-gray-200'); } }); }
        refresh();
        pills.forEach(btn=> btn.addEventListener('click', ()=>{ selectedIdx = Number(btn.getAttribute('data-idx')||'0'); refresh(); try { const sel = opts[selectedIdx]; const pr = Number(sel.price ?? p.price); if (Number.isFinite(pr) && price) price.textContent = pr.toFixed(2); } catch {} }));
      } else { optWrap.classList.add('hidden'); optWrap.innerHTML=''; }
    }

    const out = stock <= 0;
    if (addBtn) {
      addBtn.disabled = out;
      addBtn.textContent = out ? 'Unavailable' : (hasOptions ? 'Add To Cart' : 'Add to Cart');
      addBtn.addEventListener('click', () => {
        if (hasOptions && selectedIdx === null) return;
        const opt = hasOptions ? (opts[selectedIdx] || {}) : {};
        const weightDisp = hasOptions ? fmt(opt.label || opt.weight || p.weight || '') : (p.weight || '');
        const priceUse = Number(hasOptions ? (opt.price ?? p.price) : p.price);
        addToCart({ id: hasOptions ? `${pid}__${opt.label||opt.weight||'opt'}` : pid, title: p.title, price: priceUse, image: p.image, weight: weightDisp, qty });
      });
    }

    // Related
    const related = await loadRelated(p.category || '', pid);
    renderRelated(related);
  } catch (e) {
    alert('Failed to load product: ' + e.message);
    window.location.replace('index.html');
  }
}

main();
