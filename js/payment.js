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
  getDocs
} from 'firebase/firestore';

class PaymentGateway {
  constructor() {
    this.paymentMethods = [];
    this.currentOrder = null;
    this.init();
  }

  async init() {
    await this.loadPaymentMethods();
    this.setupEventListeners();
  }

  async loadPaymentMethods() {
    try {
      const settingsRef = doc(db, 'settings', 'payment');
      const settingsSnap = await getDoc(settingsRef);
      const settings = settingsSnap.exists() ? settingsSnap.data() : {};
      
      this.paymentMethods = settings.methods || [
        {
          id: 'bkash',
          name: 'bKash',
          type: 'manual',
          enabled: true,
          config: {
            number: '',
            instructions: 'Send money to the bKash number and enter your Transaction ID'
          }
        },
        {
          id: 'cod',
          name: 'Cash on Delivery',
          type: 'cod',
          enabled: true,
          config: {
            instructions: 'Pay when you receive your order'
          }
        }
      ];
    } catch (error) {
      console.error('Failed to load payment methods:', error);
      this.paymentMethods = [];
    }
  }

  setupEventListeners() {
    // Payment method selection
    document.addEventListener('change', (e) => {
      if (e.target.name === 'payment_method') {
        this.showPaymentDetails(e.target.value);
      }
    });

    // Payment form submission
    const paymentForm = document.getElementById('payment-form');
    if (paymentForm) {
      paymentForm.addEventListener('submit', (e) => this.handlePaymentSubmit(e));
    }
  }

  showPaymentDetails(methodId) {
    const method = this.paymentMethods.find(m => m.id === methodId);
    if (!method) return;

    const detailsContainer = document.getElementById('payment-details');
    if (!detailsContainer) return;

    if (method.type === 'manual') {
      detailsContainer.innerHTML = `
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 class="font-semibold text-blue-900 mb-2">${method.name} Payment</h4>
          <div class="text-sm text-blue-800 space-y-2">
            <p><strong>bKash Number:</strong> <span class="font-mono">${method.config.number || 'Admin will configure'}</span></p>
            <p><strong>Instructions:</strong> ${method.config.instructions}</p>
          </div>
          <div class="mt-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Transaction ID (TRX)</label>
            <input type="text" name="transaction_id" required 
                   class="w-full border-gray-300 rounded-lg px-3 py-2"
                   placeholder="Enter your bKash Transaction ID">
          </div>
          <div class="mt-3">
            <label class="block text-sm font-medium text-gray-700 mb-1">Sender Number</label>
            <input type="text" name="sender_number" required 
                   class="w-full border-gray-300 rounded-lg px-3 py-2"
                   placeholder="Your bKash number">
          </div>
        </div>
      `;
    } else if (method.type === 'cod') {
      detailsContainer.innerHTML = `
        <div class="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 class="font-semibold text-green-900 mb-2">${method.name}</h4>
          <p class="text-sm text-green-800">${method.config.instructions}</p>
          <div class="mt-3 text-sm text-gray-600">
            <p>• Payment will be collected when your order is delivered</p>
            <p>• Please keep exact amount ready</p>
          </div>
        </div>
      `;
    } else {
      detailsContainer.innerHTML = '';
    }
  }

  renderPaymentMethods() {
    const container = document.getElementById('payment-methods');
    if (!container) return;

    const enabledMethods = this.paymentMethods.filter(m => m.enabled);
    
    container.innerHTML = enabledMethods.map(method => `
      <label class="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
        <input type="radio" name="payment_method" value="${method.id}" 
               class="mr-3" required>
        <div class="flex-1">
          <div class="font-medium">${method.name}</div>
          ${method.type === 'cod' ? '<div class="text-sm text-gray-500">Pay on delivery</div>' : ''}
          ${method.type === 'manual' ? '<div class="text-sm text-gray-500">Manual verification</div>' : ''}
        </div>
      </label>
    `).join('');
  }

  async handlePaymentSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const paymentMethod = formData.get('payment_method');
    const orderId = formData.get('order_id');
    
    if (!paymentMethod || !orderId) {
      alert('Please select a payment method');
      return;
    }

    const method = this.paymentMethods.find(m => m.id === paymentMethod);
    if (!method) {
      alert('Invalid payment method');
      return;
    }

    try {
      let paymentData = {
        orderId: orderId,
        method: paymentMethod,
        methodName: method.name,
        status: method.type === 'cod' ? 'pending' : 'pending_verification',
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || null
      };

      if (method.type === 'manual') {
        const transactionId = formData.get('transaction_id');
        const senderNumber = formData.get('sender_number');
        
        if (!transactionId || !senderNumber) {
          alert('Please provide both Transaction ID and Sender number');
          return;
        }

        paymentData.transactionId = transactionId;
        paymentData.senderNumber = senderNumber;
      }

      // Save payment record
      const paymentRef = await addDoc(collection(db, 'payments'), paymentData);

      // Update order with payment info
      await updateDoc(doc(db, 'orders', orderId), {
        paymentId: paymentRef.id,
        paymentMethod: paymentMethod,
        paymentStatus: paymentData.status,
        updatedAt: serverTimestamp()
      });

      // Show success message
      this.showPaymentSuccess(method, paymentData);

      // Reset form
      e.target.reset();
      document.getElementById('payment-details').innerHTML = '';

    } catch (error) {
      console.error('Payment processing error:', error);
      alert('Payment processing failed. Please try again.');
    }
  }

  showPaymentSuccess(method, paymentData) {
    const successContainer = document.getElementById('payment-success');
    if (!successContainer) return;

    if (method.type === 'cod') {
      successContainer.innerHTML = `
        <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
          <h4 class="font-bold">Order Placed Successfully!</h4>
          <p class="text-sm">Your order has been placed. Please pay ${paymentData.amount || 'the total amount'} when your order is delivered.</p>
        </div>
      `;
    } else if (method.type === 'manual') {
      successContainer.innerHTML = `
        <div class="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
          <h4 class="font-bold">Payment Submitted for Verification!</h4>
          <p class="text-sm">Your payment details have been submitted. We will verify your transaction and process your order shortly.</p>
          <p class="text-sm mt-1"><strong>Transaction ID:</strong> ${paymentData.transactionId}</p>
        </div>
      `;
    }
  }

  // Admin methods for payment management
  async getPendingPayments() {
    try {
      const q = query(
        collection(db, 'payments'),
        where('status', '==', 'pending_verification'),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error fetching pending payments:', error);
      return [];
    }
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

      return true;
    } catch (error) {
      console.error('Error verifying payment:', error);
      throw error;
    }
  }
}

// Initialize payment gateway
const paymentGateway = new PaymentGateway();

// Export for use in other modules
window.PaymentGateway = PaymentGateway;
window.paymentGateway = paymentGateway;
