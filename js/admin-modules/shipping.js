import { db } from '../firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

(function(){
  const shippingForm = document.getElementById('shipping-form');
  const shippingMsg = document.getElementById('shipping-message');

  async function loadShipping(){
    if (!shippingForm) return;
    try {
      const ref = doc(db, 'settings', 'shipping');
      const snap = await getDoc(ref);
      const s = snap.exists() ? snap.data() : {};
      shippingForm.fixedFee.value = s.fixedFee ?? '';
      shippingForm.fixedUpToGrams.value = s.fixedUpToGrams ?? '';
      shippingForm.extraPerKg.value = s.extraPerKg ?? '';
      shippingForm.fallbackFee.value = s.fallbackFee ?? '';
    } catch (e) {
      if (shippingMsg) shippingMsg.textContent = 'Failed to load settings: ' + e.message;
    }
  }

  shippingForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    try {
      const payload = {
        fixedFee: Number(shippingForm.fixedFee.value || 0),
        fixedUpToGrams: Number(shippingForm.fixedUpToGrams.value || 0),
        extraPerKg: Number(shippingForm.extraPerKg.value || 0),
        fallbackFee: Number(shippingForm.fallbackFee.value || 0),
        updatedAt: serverTimestamp()
      };
      await setDoc(doc(db, 'settings', 'shipping'), payload, { merge: true });
      shippingMsg.textContent = 'Settings saved.';
      shippingMsg.className = 'text-sm mt-3 text-green-700';
    } catch (e) {
      shippingMsg.textContent = 'Save failed: ' + e.message;
      shippingMsg.className = 'text-sm mt-3 text-red-700';
    }
  });

  function maybeLoad(){ if (location.hash.replace('#','') === 'shipping') loadShipping(); }
  window.addEventListener('hashchange', maybeLoad);
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', maybeLoad, { once: true }); } else { maybeLoad(); }
})();
