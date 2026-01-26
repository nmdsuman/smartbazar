import { auth, db } from './firebase-config.js';
import {
  collection,
  addDoc,
  doc,
  serverTimestamp,
  updateDoc,
  getDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  setDoc
} from 'firebase/firestore';

class PaymentsAdmin {
  constructor() {
    this.pendingPayments = [];
    this.paymentsBadge = document.getElementById('payments-badge');
    this.init();
  }

  async init() {
    await this.loadPaymentSettings();
    this.setupEventListeners();
    this.loadPendingPayments();
  }

  async loadPaymentSettings() {
    try {
      const settingsRef = doc(db, 'settings', 'payment');
      const settingsSnap = await getDoc(settingsRef);
      const settings = settingsSnap.exists() ? settingsSnap.data() : {};

      // Load bKash settings
      const bkashEnabled = document.querySelector('input[name="bkash_enabled"]');
      const bkashNumber = document.querySelector('input[name="bkash_number"]');
      const bkashAccountName = document.querySelector('input[name="bkash_account_name"]');
      const bkashInstructions = document.querySelector('textarea[name="bkash_instructions"]');

      if (bkashEnabled) bkashEnabled.checked = settings.bkash?.enabled || false;
      if (bkashNumber) bkashNumber.value = settings.bkash?.number || '';
      if (bkashAccountName) bkashAccountName.value = settings.bkash?.accountName || '';
      if (bkashInstructions) bkashInstructions.value = settings.bkash?.instructions || '';

      // Load COD settings
      const codEnabled = document.querySelector('input[name="cod_enabled"]');
      const codInstructions = document.querySelector('textarea[name="cod_instructions"]');

      if (codEnabled) codEnabled.checked = settings.cod?.enabled || false;
      if (codInstructions) codInstructions.value = settings.cod?.instructions || '';

    } catch (error) {
      console.error('Failed to load payment settings:', error);
    }
  }

  setupEventListeners() {
    // Payment settings form
    const paymentSettingsForm = document.getElementById('payment-settings-form');
    if (paymentSettingsForm) {
      paymentSettingsForm.addEventListener('submit', (e) => this.handlePaymentSettingsSubmit(e));
    }
  }

  async handlePaymentSettingsSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const messageEl = document.getElementById('payment-settings-message');
    
    try {
      const settings = {
        methods: [
          {
            id: 'bkash',
            name: 'bKash',
            type: 'manual',
            enabled: formData.get('bkash_enabled') === 'on',
            config: {
              number: formData.get('bkash_number'),
              accountName: formData.get('bkash_account_name'),
              instructions: formData.get('bkash_instructions') || 'Send money to the bKash number and enter your Transaction ID'
            }
          },
          {
            id: 'cod',
            name: 'Cash on Delivery',
            type: 'cod',
            enabled: formData.get('cod_enabled') === 'on',
            config: {
              instructions: formData.get('cod_instructions') || 'Pay when you receive your order'
            }
          }
        ],
        bkash: {
          enabled: formData.get('bkash_enabled') === 'on',
          number: formData.get('bkash_number'),
          accountName: formData.get('bkash_account_name'),
          instructions: formData.get('bkash_instructions')
        },
        cod: {
          enabled: formData.get('cod_enabled') === 'on',
          instructions: formData.get('cod_instructions')
        },
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, 'settings', 'payment'), settings, { merge: true });

      if (messageEl) {
        messageEl.textContent = 'Payment settings saved successfully!';
        messageEl.className = 'mt-3 text-sm text-green-700';
      }

    } catch (error) {
      console.error('Failed to save payment settings:', error);
      if (messageEl) {
        messageEl.textContent = 'Failed to save payment settings: ' + error.message;
        messageEl.className = 'mt-3 text-sm text-red-700';
      }
    }
  }

  async loadPendingPayments() {
    try {
      const q = query(
        collection(db, 'payments'),
        where('status', '==', 'pending_verification'),
        orderBy('createdAt', 'desc')
      );

      onSnapshot(q, (snapshot) => {
        this.pendingPayments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        this.renderPendingPayments();
        this.updatePaymentsBadge();
      }, (error) => {
        console.error('Error loading pending payments:', error);
      });

    } catch (error) {
      console.error('Error setting up pending payments listener:', error);
    }
  }

  renderPendingPayments() {
    const container = document.getElementById('pending-payments-list');
    const emptyContainer = document.getElementById('no-pending-payments');

    if (!container) return;

    if (this.pendingPayments.length === 0) {
      container.innerHTML = '';
      if (emptyContainer) emptyContainer.classList.remove('hidden');
      return;
    }

    if (emptyContainer) emptyContainer.classList.add('hidden');

    container.innerHTML = this.pendingPayments.map(payment => `
      <div class="border rounded-lg p-4 bg-yellow-50 border-yellow-200">
        <div class="flex justify-between items-start mb-3">
          <div>
            <h4 class="font-semibold text-gray-900">Payment #${payment.id.slice(-6)}</h4>
            <p class="text-sm text-gray-600">Order #${payment.orderId?.slice(-6) || 'Unknown'}</p>
            <p class="text-sm text-gray-500">
              ${payment.createdAt?.toDate ? payment.createdAt.toDate().toLocaleString() : 'Unknown date'}
            </p>
          </div>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            Pending Verification
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <p class="text-sm font-medium text-gray-700">Payment Method</p>
            <p class="text-sm text-gray-900">${payment.methodName || 'Unknown'}</p>
          </div>
          ${payment.transactionId ? `
            <div>
              <p class="text-sm font-medium text-gray-700">Transaction ID</p>
              <p class="text-sm font-mono text-gray-900">${payment.transactionId}</p>
            </div>
          ` : ''}
          ${payment.senderNumber ? `
            <div>
              <p class="text-sm font-medium text-gray-700">Sender Number</p>
              <p class="text-sm text-gray-900">${payment.senderNumber}</p>
            </div>
          ` : ''}
          ${payment.userId ? `
            <div>
              <p class="text-sm font-medium text-gray-700">User ID</p>
              <p class="text-sm text-gray-900">${payment.userId}</p>
            </div>
          ` : ''}
        </div>

        <div class="flex gap-2">
          <button onclick="window.paymentsAdmin.verifyPayment('${payment.id}', true)" 
                  class="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
            Verify & Approve
          </button>
          <button onclick="window.paymentsAdmin.verifyPayment('${payment.id}', false)" 
                  class="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">
            Reject
          </button>
          <button onclick="window.location.href='view.html?id=${payment.orderId}'" 
                  class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            View Order
          </button>
        </div>
      </div>
    `).join('');
  }

  async verifyPayment(paymentId, verified = true) {
    try {
      const paymentRef = doc(db, 'payments', paymentId);
      const paymentSnap = await getDoc(paymentRef);
      
      if (!paymentSnap.exists()) {
        throw new Error('Payment not found');
      }

      const payment = paymentSnap.data();
      const newStatus = verified ? 'verified' : 'rejected';
      
      // Update payment status
      await updateDoc(paymentRef, {
        status: newStatus,
        verifiedAt: serverTimestamp(),
        verifiedBy: auth.currentUser?.uid || null
      });

      // Update corresponding order
      if (payment.orderId) {
        await updateDoc(doc(db, 'orders', payment.orderId), {
          paymentStatus: newStatus,
          updatedAt: serverTimestamp()
        });
      }

      // Show success message
      alert(verified ? 'Payment verified and approved successfully!' : 'Payment rejected');

    } catch (error) {
      console.error('Error verifying payment:', error);
      alert('Failed to verify payment: ' + error.message);
    }
  }

  updatePaymentsBadge() {
    if (this.paymentsBadge) {
      const count = this.pendingPayments.length;
      if (count > 0) {
        this.paymentsBadge.textContent = count;
        this.paymentsBadge.classList.remove('hidden');
      } else {
        this.paymentsBadge.classList.add('hidden');
      }
    }
  }
}

// Initialize payments admin when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.paymentsAdmin = new PaymentsAdmin();
});

// Export for use in other modules
window.PaymentsAdmin = PaymentsAdmin;
