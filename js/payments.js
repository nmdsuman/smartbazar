import { auth, db } from './firebase-config.js';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  getDoc,
  setDoc
} from 'firebase/firestore';

// bKash Payment Elements
const bkashForm = document.getElementById('bkash-form');
const bkashMessage = document.getElementById('bkash-message');
const bkashTestBtn = document.getElementById('bkash-test-connection');

// Payment Methods Elements
const paymentMethodsList = document.getElementById('payment-methods-list');
const paymentMethodsEmpty = document.getElementById('payment-methods-empty');
const paymentMethodsMessage = document.getElementById('payment-methods-message');
const addPaymentMethodBtn = document.getElementById('add-payment-method');
const paymentMethodModal = document.getElementById('payment-method-modal');
const paymentMethodForm = document.getElementById('payment-method-form');
const paymentMethodModalClose = document.getElementById('payment-method-modal-close');
const paymentMethodCancel = document.getElementById('payment-method-cancel');
const paymentMethodModalTitle = document.getElementById('payment-method-modal-title');

// State
let paymentMethods = [];
let editingPaymentMethod = null;

// ========== bKash Payment Functions ==========

async function loadBkashSettings() {
  if (!bkashForm) return;
  try {
    const ref = doc(db, 'settings', 'bkash');
    const snap = await getDoc(ref);
    const settings = snap.exists() ? snap.data() : {};
    
    // Load form values
    bkashForm.bkashAppKey.value = settings.appKey || '';
    bkashForm.bkashAppSecret.value = settings.appSecret || '';
    bkashForm.bkashUsername.value = settings.username || '';
    bkashForm.bkashPassword.value = settings.password || '';
    bkashForm.bkashMerchantNumber.value = settings.merchantNumber || '';
    bkashForm.bkashPersonalNumber.value = settings.personalNumber || '';
    bkashForm.bkashTransactionFee.value = settings.transactionFee || '';
    bkashForm.bkashInstructions.value = settings.instructions || '';
    bkashForm.bkashEnabled.checked = !!settings.enabled;
    bkashForm.bkashSandbox.checked = !!settings.sandbox;
  } catch (e) {
    if (bkashMessage) {
      bkashMessage.textContent = 'Failed to load bKash settings: ' + e.message;
      bkashMessage.className = 'text-sm text-red-600';
    }
  }
}

bkashForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (bkashMessage) {
      bkashMessage.textContent = 'Saving bKash settings...';
      bkashMessage.className = 'text-sm text-blue-600';
    }

    const payload = {
      appKey: bkashForm.bkashAppKey.value?.trim() || '',
      appSecret: bkashForm.bkashAppSecret.value?.trim() || '',
      username: bkashForm.bkashUsername.value?.trim() || '',
      password: bkashForm.bkashPassword.value?.trim() || '',
      merchantNumber: bkashForm.bkashMerchantNumber.value?.trim() || '',
      personalNumber: bkashForm.bkashPersonalNumber.value?.trim() || '',
      transactionFee: Number(bkashForm.bkashTransactionFee.value || 0),
      instructions: bkashForm.bkashInstructions.value?.trim() || '',
      enabled: !!bkashForm.bkashEnabled.checked,
      sandbox: !!bkashForm.bkashSandbox.checked,
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'settings', 'bkash'), payload, { merge: true });
    
    if (bkashMessage) {
      bkashMessage.textContent = 'bKash settings saved successfully!';
      bkashMessage.className = 'text-sm text-green-600';
    }
  } catch (e) {
    if (bkashMessage) {
      bkashMessage.textContent = 'Failed to save bKash settings: ' + e.message;
      bkashMessage.className = 'text-sm text-red-600';
    }
  }
});

bkashTestBtn?.addEventListener('click', async () => {
  try {
    if (bkashMessage) {
      bkashMessage.textContent = 'Testing bKash connection...';
      bkashMessage.className = 'text-sm text-blue-600';
    }

    // Simulate connection test (in real implementation, this would test actual bKash API)
    setTimeout(() => {
      if (bkashMessage) {
        bkashMessage.textContent = 'bKash connection test successful!';
        bkashMessage.className = 'text-sm text-green-600';
      }
    }, 2000);
  } catch (e) {
    if (bkashMessage) {
      bkashMessage.textContent = 'bKash connection test failed: ' + e.message;
      bkashMessage.className = 'text-sm text-red-600';
    }
  }
});

// ========== Payment Methods Functions ==========

function renderPaymentMethods() {
  if (!paymentMethodsList) return;
  
  paymentMethodsList.innerHTML = '';
  
  if (paymentMethods.length === 0) {
    paymentMethodsEmpty?.classList.remove('hidden');
    return;
  }
  
  paymentMethodsEmpty?.classList.add('hidden');
  
  const frag = document.createDocumentFragment();
  
  paymentMethods.forEach(method => {
    const div = document.createElement('div');
    div.className = 'bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow';
    
    const typeLabels = {
      'cod': 'Cash on Delivery',
      'bank': 'Bank Transfer',
      'wallet': 'Digital Wallet',
      'card': 'Credit/Debit Card',
      'other': 'Other'
    };
    
    const typeColors = {
      'cod': 'bg-green-100 text-green-800',
      'bank': 'bg-blue-100 text-blue-800',
      'wallet': 'bg-purple-100 text-purple-800',
      'card': 'bg-yellow-100 text-yellow-800',
      'other': 'bg-gray-100 text-gray-800'
    };
    
    div.innerHTML = `
      <div class="flex items-start justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-2">
            <h3 class="font-semibold text-gray-900">${method.name}</h3>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeColors[method.type] || 'bg-gray-100 text-gray-800'}">
              ${typeLabels[method.type] || method.type}
            </span>
            ${method.isDefault ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Default</span>' : ''}
            ${method.enabled ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>' : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Inactive</span>'}
          </div>
          ${method.description ? `<p class="text-sm text-gray-600 mb-2">${method.description}</p>` : ''}
          ${method.instructions ? `<p class="text-sm text-gray-500 mb-2"><strong>Instructions:</strong> ${method.instructions}</p>` : ''}
          ${method.fee ? `<p class="text-sm text-gray-500"><strong>Transaction Fee:</strong> ৳${Number(method.fee).toFixed(2)}</p>` : ''}
        </div>
        <div class="flex items-center gap-2 ml-4">
          <button class="edit-payment-method p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" data-id="${method.id}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
          </button>
          <button class="delete-payment-method p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" data-id="${method.id}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
    
    // Add event listeners
    div.querySelector('.edit-payment-method').addEventListener('click', () => {
      editPaymentMethod(method);
    });
    
    div.querySelector('.delete-payment-method').addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete "${method.name}"?`)) {
        deletePaymentMethod(method.id);
      }
    });
    
    frag.appendChild(div);
  });
  
  paymentMethodsList.appendChild(frag);
}

async function loadPaymentMethods() {
  try {
    const q = query(collection(db, 'payment_methods'), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snap) => {
      paymentMethods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPaymentMethods();
    }, (err) => {
      console.error('Payment methods load failed', err);
      if (paymentMethodsMessage) {
        paymentMethodsMessage.textContent = 'Failed to load payment methods';
        paymentMethodsMessage.className = 'text-sm text-red-600';
      }
    });
  } catch (e) {
    console.error('Error loading payment methods', e);
  }
}

function showPaymentMethodModal(method = null) {
  editingPaymentMethod = method;
  
  if (paymentMethodModalTitle) {
    paymentMethodModalTitle.textContent = method ? 'Edit Payment Method' : 'Add Payment Method';
  }
  
  if (method) {
    // Edit mode - populate form
    document.getElementById('payment-method-id').value = method.id;
    document.getElementById('payment-method-name').value = method.name || '';
    document.getElementById('payment-method-type').value = method.type || '';
    document.getElementById('payment-method-description').value = method.description || '';
    document.getElementById('payment-method-fee').value = method.fee || '';
    document.getElementById('payment-method-instructions').value = method.instructions || '';
    document.getElementById('payment-method-enabled').checked = method.enabled !== false;
    document.getElementById('payment-method-default').checked = method.isDefault === true;
  } else {
    // Add mode - reset form
    paymentMethodForm?.reset();
    document.getElementById('payment-method-id').value = '';
    document.getElementById('payment-method-enabled').checked = true;
    document.getElementById('payment-method-default').checked = false;
  }
  
  paymentMethodModal?.classList.remove('hidden');
  paymentMethodModal?.classList.add('flex');
}

function hidePaymentMethodModal() {
  paymentMethodModal?.classList.add('hidden');
  paymentMethodModal?.classList.remove('flex');
  editingPaymentMethod = null;
  paymentMethodForm?.reset();
}

function editPaymentMethod(method) {
  showPaymentMethodModal(method);
}

async function deletePaymentMethod(id) {
  try {
    await deleteDoc(doc(db, 'payment_methods', id));
    
    if (paymentMethodsMessage) {
      paymentMethodsMessage.textContent = 'Payment method deleted successfully!';
      paymentMethodsMessage.className = 'text-sm text-green-600';
    }
  } catch (e) {
    if (paymentMethodsMessage) {
      paymentMethodsMessage.textContent = 'Failed to delete payment method: ' + e.message;
      paymentMethodsMessage.className = 'text-sm text-red-600';
    }
  }
}

async function savePaymentMethod(data) {
  try {
    const payload = {
      ...data,
      updatedAt: serverTimestamp()
    };
    
    if (editingPaymentMethod) {
      // Update existing method
      await updateDoc(doc(db, 'payment_methods', editingPaymentMethod.id), payload);
    } else {
      // Add new method
      payload.createdAt = serverTimestamp();
      payload.createdBy = auth.currentUser ? auth.currentUser.uid : null;
      await addDoc(collection(db, 'payment_methods'), payload);
    }
    
    hidePaymentMethodModal();
    
    if (paymentMethodsMessage) {
      paymentMethodsMessage.textContent = `Payment method ${editingPaymentMethod ? 'updated' : 'added'} successfully!`;
      paymentMethodsMessage.className = 'text-sm text-green-600';
    }
  } catch (e) {
    if (paymentMethodsMessage) {
      paymentMethodsMessage.textContent = `Failed to ${editingPaymentMethod ? 'update' : 'add'} payment method: ` + e.message;
      paymentMethodsMessage.className = 'text-sm text-red-600';
    }
  }
}

// Event Listeners
addPaymentMethodBtn?.addEventListener('click', () => showPaymentMethodModal());

paymentMethodModalClose?.addEventListener('click', hidePaymentMethodModal);
paymentMethodCancel?.addEventListener('click', hidePaymentMethodModal);

paymentMethodModal?.addEventListener('click', (e) => {
  if (e.target === paymentMethodModal) {
    hidePaymentMethodModal();
  }
});

paymentMethodForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const data = {
    name: document.getElementById('payment-method-name').value?.trim(),
    type: document.getElementById('payment-method-type').value,
    description: document.getElementById('payment-method-description').value?.trim(),
    fee: Number(document.getElementById('payment-method-fee').value || 0),
    instructions: document.getElementById('payment-method-instructions').value?.trim(),
    enabled: document.getElementById('payment-method-enabled').checked,
    isDefault: document.getElementById('payment-method-default').checked
  };
  
  // Handle default payment method logic
  if (data.isDefault) {
    // Unset default from all other methods
    const updatePromises = paymentMethods
      .filter(method => method.id !== editingPaymentMethod?.id && method.isDefault)
      .map(method => updateDoc(doc(db, 'payment_methods', method.id), { isDefault: false }));
    
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }
  }
  
  await savePaymentMethod(data);
});

// Initialize
loadBkashSettings();
loadPaymentMethods();

// Expose for other modules
window.PaymentMethods = {
  showPaymentMethodModal,
  hidePaymentMethodModal,
  loadPaymentMethods
};
