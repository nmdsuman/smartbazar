import { auth, db } from './firebase-config.js';
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  runTransaction,
  getDoc
} from 'firebase/firestore';

// Cart elements
const checkoutBtn = document.getElementById('checkout-btn');
const nameInput = document.getElementById('chk-name');
const phoneInput = document.getElementById('chk-phone');
const addressInput = document.getElementById('chk-address');
const bkashDetails = document.getElementById('bkash-payment-details');
const bkashInstructions = document.getElementById('bkash-instructions');
const bkashNumberDisplay = document.getElementById('bkash-number-display');
const bkashTransactionId = document.getElementById('bkash-transaction-id');

// Modal elements
const invModal = document.getElementById('inv-modal');
const invClose = document.getElementById('inv-close');
const invBody = document.getElementById('inv-body');
const invConfirm = document.getElementById('inv-confirm');
const invPrint = document.getElementById('inv-print');

// State
let bkashSettings = null;

// Load bKash settings
async function loadBkashSettings() {
  try {
    const ref = doc(db, 'settings', 'bkash');
    const snap = await getDoc(ref);
    bkashSettings = snap.exists() ? snap.data() : {};
    
    // Update UI with bKash settings
    if (bkashSettings.personalNumber) {
      bkashNumberDisplay.textContent = bkashSettings.personalNumber;
    }
    
    if (bkashSettings.instructions) {
      bkashInstructions.textContent = bkashSettings.instructions;
    } else {
      bkashInstructions.textContent = 'Send money to the bKash number above and enter your transaction ID.';
    }
  } catch (e) {
    console.error('Failed to load bKash settings:', e);
  }
}

// Payment method toggle
document.addEventListener('change', (e) => {
  if (e.target.name === 'payment-method') {
    if (e.target.value === 'bkash') {
      bkashDetails.classList.remove('hidden');
    } else {
      bkashDetails.classList.add('hidden');
      bkashTransactionId.value = '';
    }
  }
});

// Read cart from localStorage
function readCart() {
  try {
    return JSON.parse(localStorage.getItem('bazar_cart')) || [];
  } catch {
    return [];
  }
}

// Calculate delivery fee
function calcDelivery(cart) {
  // Simple delivery calculation - you can modify this based on your shipping settings
  const totalWeight = cart.reduce((sum, item) => {
    // Extract weight from item if available
    const weight = parseFloat(item.weight?.match(/[\d.]+/)?.[0] || 0);
    return sum + (weight * item.qty);
  }, 0);
  
  if (totalWeight === 0) return 0;
  if (totalWeight <= 1) return 40; // Up to 1kg
  if (totalWeight <= 3) return 60; // Up to 3kg
  if (totalWeight <= 5) return 80; // Up to 5kg
  return 100; // Above 5kg
}

// Enhanced checkout with payment options
checkoutBtn?.addEventListener('click', async () => {
  const cart = readCart();
  if (cart.length === 0) return;
  
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const delivery = calcDelivery(cart);
  const name = nameInput ? nameInput.value.trim() : '';
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const address = addressInput ? addressInput.value.trim() : '';
  
  // Get selected payment method
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value || 'cod';
  
  // Validation
  if (!name || !phone || !address) {
    [nameInput, phoneInput, addressInput].forEach(el => el && el.classList.add('ring-1','ring-red-400'));
    alert('Please fill in all required fields');
    return;
  }
  
  // Additional validation for bKash
  if (paymentMethod === 'bkash') {
    if (!bkashTransactionId?.value?.trim()) {
      bkashTransactionId.classList.add('ring-1','ring-red-400');
      alert('Please enter bKash Transaction ID');
      return;
    }
    if (!bkashSettings?.personalNumber) {
      alert('bKash payment is not configured. Please contact admin.');
      return;
    }
  }
  
  [nameInput, phoneInput, addressInput, bkashTransactionId].forEach(el => el && el.classList.remove('ring-1','ring-red-400'));

  // Persist profile locally
  try {
    localStorage.setItem('profile_name', name);
    localStorage.setItem('profile_phone', phone);
    localStorage.setItem('profile_address', address);
  } catch {}

  // Build invoice preview HTML
  const rows = cart.map(i => `
    <tr class="border-b last:border-0">
      <td class="p-3">
        <div class="flex items-center gap-3">
          <img src="${i.image}" alt="${i.title}" class="w-12 h-12 object-contain bg-white rounded border"/>
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">${i.title}</div>
            ${i.weight?`<div class="text-xs text-gray-500">${i.weight}</div>`:''}
          </div>
        </div>
      </td>
      <td class="p-3 text-right align-middle">${i.qty}</td>
      <td class="p-3 text-right align-middle">৳${Number(i.price).toFixed(2)}</td>
      <td class="p-3 text-right align-middle font-medium">৳${(i.qty*i.price).toFixed(2)}</td>
    </tr>`).join('');
    
  const paymentInfo = paymentMethod === 'bkash' ? `
    <div class="mb-3 p-3 bg-purple-50 rounded border border-purple-200">
      <div class="font-medium text-purple-800 mb-1">bKash Payment Details</div>
      <div class="text-sm text-gray-700">
        <div><strong>bKash Number:</strong> ${bkashSettings.personalNumber}</div>
        <div><strong>Transaction ID:</strong> ${bkashTransactionId.value}</div>
      </div>
    </div>
  ` : '';
  
  invBody.innerHTML = `
    ${paymentInfo}
    <div class="mb-3 p-3 bg-gray-50 rounded border text-sm text-gray-700">
      <div class="font-medium mb-0.5">Customer</div>
      <div>${name} · ${phone}</div>
      <div class="truncate">${address}</div>
      <div class="mt-1"><strong>Payment Method:</strong> ${paymentMethod === 'cod' ? 'Cash on Delivery' : 'bKash'}</div>
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
      ${paymentMethod === 'bkash' && bkashSettings.transactionFee ? 
        `<div class="flex items-center justify-between text-gray-700"><span>bKash Fee</span><span class="font-medium">৳${bkashSettings.transactionFee.toFixed(2)}</span></div>` : ''
      }
      <div class="flex items-center justify-between text-base mt-1">
        <span class="font-semibold">Grand Total</span>
        <span class="inline-flex items-center justify-center font-semibold bg-green-600 text-white px-3 py-1 rounded-full">
          ৳${(subtotal + delivery + (paymentMethod === 'bkash' && bkashSettings.transactionFee ? bkashSettings.transactionFee : 0)).toFixed(2)}
        </span>
      </div>
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
      
      // Place order atomically
      const ordersCol = collection(db, 'orders');
      const newOrderRef = doc(ordersCol);
      const newOrderId = newOrderRef.id;
      
      await runTransaction(db, async (tx) => {
        // Validate and decrement stock
        const writePlan = [];
        for (const it of cart) {
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
        
        // Perform stock updates
        writePlan.forEach(({ ref, newStock }) => {
          tx.update(ref, { stock: newStock });
        });
        
        // Create order document
        const totalAmount = subtotal + delivery + (paymentMethod === 'bkash' && bkashSettings.transactionFee ? bkashSettings.transactionFee : 0);
        
        tx.set(newOrderRef, {
          items: cart,
          subtotal,
          delivery,
          total: totalAmount,
          transactionFee: paymentMethod === 'bkash' && bkashSettings.transactionFee ? bkashSettings.transactionFee : 0,
          currency: 'BDT',
          userId: auth.currentUser ? auth.currentUser.uid : null,
          customer: { name, phone, address },
          paymentMethod: paymentMethod,
          paymentDetails: paymentMethod === 'bkash' ? {
            transactionId: bkashTransactionId.value,
            bkashNumber: bkashSettings.personalNumber,
            status: 'pending_verification'
          } : null,
          status: paymentMethod === 'cod' ? 'Pending' : 'Payment Pending',
          createdAt: serverTimestamp()
        });
      });
      
      localStorage.removeItem('bazar_cart');
      invModal.classList.add('hidden'); 
      invModal.classList.remove('flex');
      
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

invPrint?.addEventListener('click', () => {
  window.print();
});

// Initialize
loadBkashSettings();

// Export for use in other modules
window.CartCheckout = {
  loadBkashSettings,
  calcDelivery
};
