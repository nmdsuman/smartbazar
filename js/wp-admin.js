import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, orderBy, where, doc, getDoc, setDoc, updateDoc, serverTimestamp, deleteDoc, addDoc } from 'firebase/firestore';

// WordPress Admin Navigation
class WPAdmin {
  constructor() {
    this.currentPage = 'dashboard';
    this.init();
  }

  init() {
    // Check authentication
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.href = 'admin.html';
        return;
      }
      
      // Initialize admin panel
      this.setupNavigation();
      this.loadDashboardData();
      this.setupEventListeners();
    });
  }

  setupNavigation() {
    // Handle menu item clicks
    const menuItems = document.querySelectorAll('.wp-menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.getAttribute('data-page');
        this.navigateToPage(page);
      });
    });

    // Handle hash changes
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.substring(1);
      if (hash) {
        this.navigateToPage(hash);
      }
    });

    // Check initial hash
    const hash = window.location.hash.substring(1);
    if (hash) {
      this.navigateToPage(hash);
    }
  }

  navigateToPage(page) {
    // Update active menu item
    document.querySelectorAll('.wp-menu-item').forEach(item => {
      item.classList.remove('active');
    });
    
    const activeMenuItem = document.querySelector(`[data-page="${page}"]`);
    if (activeMenuItem) {
      activeMenuItem.classList.add('active');
    }

    // Update page content
    document.querySelectorAll('.wp-page-content').forEach(content => {
      content.classList.remove('active');
    });

    const targetPage = document.getElementById(`${page}-page`);
    if (targetPage) {
      targetPage.classList.add('active');
      this.currentPage = page;
      this.loadPageData(page);
    }

    // Update admin bar
    const adminBarPage = document.querySelector('.wp-admin-bar .text-gray-300');
    if (adminBarPage) {
      adminBarPage.textContent = page.charAt(0).toUpperCase() + page.slice(1);
    }

    // Update URL
    window.location.hash = page;
  }

  async loadPageData(page) {
    switch (page) {
      case 'dashboard':
        await this.loadDashboardData();
        break;
      case 'products':
        await this.loadProductsData();
        break;
      case 'products-add':
        await this.loadAddProductPage();
        break;
      case 'orders':
        await this.loadOrdersData();
        break;
      case 'media':
        await this.loadMediaData();
        break;
      case 'chat':
        await this.loadChatData();
        break;
      case 'payments':
        await this.loadPaymentsData();
        break;
      case 'files':
        await this.loadFilesData();
        break;
      case 'notes':
        await this.loadNotesData();
        break;
      case 'plugins':
        await this.loadPluginsData();
        break;
      case 'settings':
        await this.loadSettingsData();
        break;
      default:
        console.log(`Loading ${page} page...`);
    }
  }

  async loadAddProductPage() {
    try {
      // Load categories
      const categoriesQuery = query(collection(db, 'categories'), orderBy('name'));
      const querySnapshot = await getDocs(categoriesQuery);
      
      const categorySelect = document.getElementById('add-category');
      const subcategorySelect = document.getElementById('add-subcategory');
      
      if (categorySelect) {
        categorySelect.innerHTML = '<option value="">Select Category</option>';
        querySnapshot.forEach((doc) => {
          const category = doc.data();
          const option = document.createElement('option');
          option.value = category.name;
          option.textContent = category.name;
          categorySelect.appendChild(option);
        });
      }

      // Setup product form
      this.setupProductForm();
      
      console.log('Add product page loaded successfully');
    } catch (error) {
      console.error('Error loading add product page:', error);
    }
  }

  setupProductForm() {
    const form = document.getElementById('add-product-form');
    if (!form) return;

    // Media library buttons
    const btnImageLibrary = document.getElementById('btn-image-library');
    const btnGalleryLibrary = document.getElementById('btn-gallery-library');
    const btnImageClear = document.getElementById('btn-image-clear');
    const btnGalleryClear = document.getElementById('btn-gallery-clear');
    
    if (btnImageLibrary) {
      btnImageLibrary.addEventListener('click', () => {
        document.getElementById('media-modal').classList.remove('hidden');
      });
    }
    
    if (btnGalleryLibrary) {
      btnGalleryLibrary.addEventListener('click', () => {
        document.getElementById('media-modal').classList.remove('hidden');
      });
    }
    
    if (btnImageClear) {
      btnImageClear.addEventListener('click', () => {
        const imageInput = document.querySelector('input[name="imageUrl"]');
        const previewImage = document.getElementById('add-preview-image');
        const placeholder = document.getElementById('preview-placeholder');
        
        if (imageInput) imageInput.value = '';
        if (previewImage) {
          previewImage.src = '';
          previewImage.classList.add('hidden');
        }
        if (placeholder) placeholder.classList.remove('hidden');
      });
    }
    
    if (btnGalleryClear) {
      btnGalleryClear.addEventListener('click', () => {
        const galleryTextarea = document.querySelector('textarea[name="galleryUrls"]');
        const previewGallery = document.getElementById('add-preview-gallery');
        
        if (galleryTextarea) galleryTextarea.value = '';
        if (previewGallery) previewGallery.innerHTML = '';
      });
    }

    // Variant management
    const variantAddBtn = document.getElementById('variant-add');
    const variantsList = document.getElementById('variants-list');
    
    if (variantAddBtn && variantsList) {
      variantAddBtn.addEventListener('click', () => {
        const variantRow = document.createElement('div');
        variantRow.className = 'grid grid-cols-1 sm:grid-cols-12 gap-4 items-start mb-4 bg-gray-50 p-3 rounded-lg border border-gray-200';
        variantRow.innerHTML = `
          <div class="sm:col-span-4">
            <label class="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Weight Value</label>
            <input type="number" step="0.01" min="0" name="weightValue" placeholder="1" class="wp-input">
          </div>
          <div class="sm:col-span-3">
            <label class="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Unit</label>
            <select name="weightUnit" class="wp-select">
              <option value="kg">kg (Weight)</option>
              <option value="l">L (Liquid)</option>
              <option value="pc">pc (Pieces)</option>
            </select>
          </div>
          <div class="sm:col-span-3">
            <label class="sm:hidden text-xs font-medium text-gray-500 mb-1 block">Price</label>
            <div class="relative">
              <span class="absolute left-3 top-2 text-gray-400">৳</span>
              <input type="number" step="0.01" min="0" name="price" required placeholder="0.00" class="wp-input pl-7 font-semibold text-gray-700">
            </div>
          </div>
          <div class="sm:col-span-2 flex items-center justify-end h-full pt-1">
            <button type="button" onclick="this.parentElement.parentElement.remove()" class="text-red-500 hover:text-red-700">Remove</button>
          </div>
        `;
        variantsList.appendChild(variantRow);
      });
    }

    // Live preview
    this.setupLivePreview();

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.saveProduct(form);
    });
  }

  setupLivePreview() {
    const titleInput = document.querySelector('input[name="title"]');
    const priceInput = document.querySelector('input[name="price"]');
    const weightValueInput = document.querySelector('input[name="weightValue"]');
    const weightUnitSelect = document.querySelector('select[name="weightUnit"]');
    
    const previewTitle = document.getElementById('add-preview-title');
    const previewPrice = document.getElementById('add-preview-price');
    const previewExtra = document.getElementById('add-preview-extra');
    
    const updatePreview = () => {
      if (previewTitle && titleInput) {
        previewTitle.textContent = titleInput.value || 'Product Name';
      }
      
      if (previewPrice && priceInput) {
        previewPrice.textContent = `৳${parseFloat(priceInput.value || 0).toFixed(2)}`;
      }
      
      if (previewExtra && weightValueInput && weightUnitSelect) {
        const weight = weightValueInput.value || '1';
        const unit = weightUnitSelect.value || 'kg';
        previewExtra.textContent = `${weight} ${unit}`;
      }
    };
    
    if (titleInput) titleInput.addEventListener('input', updatePreview);
    if (priceInput) priceInput.addEventListener('input', updatePreview);
    if (weightValueInput) weightValueInput.addEventListener('input', updatePreview);
    if (weightUnitSelect) weightUnitSelect.addEventListener('change', updatePreview);
  }

  async saveProduct(form) {
    try {
      const formData = new FormData(form);
      const product = {
        title: formData.get('title'),
        category: formData.get('category'),
        subcategory: formData.get('subcategory'),
        description: formData.get('description'),
        stock: Number(formData.get('stock')),
        active: formData.get('active') === 'on',
        variants: [],
        createdAt: serverTimestamp()
      };

      // Collect variants
      const weightValues = form.querySelectorAll('input[name="weightValue"]');
      const weightUnits = form.querySelectorAll('select[name="weightUnit"]');
      const prices = form.querySelectorAll('input[name="price"]');
      
      for (let i = 0; i < weightValues.length; i++) {
        if (weightValues[i].value && prices[i].value) {
          product.variants.push({
            weight: Number(weightValues[i].value),
            unit: weightUnits[i].value,
            price: Number(prices[i].value)
          });
        }
      }

      // Save to Firestore
      const productsRef = collection(db, 'products');
      await setDoc(doc(productsRef), product);
      
      this.showNotification('Product added successfully!', 'success');
      form.reset();
      
      // Navigate to products list
      setTimeout(() => {
        this.navigateToPage('products');
      }, 1500);
      
    } catch (error) {
      console.error('Error saving product:', error);
      this.showNotification('Error saving product: ' + error.message, 'error');
    }
  }

  async loadChatData() {
    try {
      // Load chat sessions
      const chatSessions = document.getElementById('chat-sessions');
      if (!chatSessions) return;

      // Mock chat data - replace with real Firebase data
      chatSessions.innerHTML = `
        <div class="p-3 border-b hover:bg-gray-50 cursor-pointer">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium">Customer 1</div>
              <div class="text-sm text-gray-500">Last message...</div>
            </div>
            <span class="text-xs text-gray-400">2m ago</span>
          </div>
        </div>
        <div class="p-3 border-b hover:bg-gray-50 cursor-pointer">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium">Customer 2</div>
              <div class="text-sm text-gray-500">How can I help?</div>
            </div>
            <span class="text-xs text-gray-400">5m ago</span>
          </div>
        </div>
      `;

      // Setup chat functionality
      this.setupChatFunctionality();
      
      console.log('Chat data loaded successfully');
    } catch (error) {
      console.error('Error loading chat data:', error);
    }
  }

  setupChatFunctionality() {
    const chatSendBtn = document.getElementById('chat-send');
    const chatReplyInput = document.getElementById('chat-reply');
    
    if (chatSendBtn && chatReplyInput) {
      chatSendBtn.addEventListener('click', () => {
        const message = chatReplyInput.value.trim();
        if (message) {
          // Send message logic here
          chatReplyInput.value = '';
          this.showNotification('Message sent!', 'success');
        }
      });
      
      chatReplyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          chatSendBtn.click();
        }
      });
    }
  }

  async loadPaymentsData() {
    try {
      // Load pending payments
      const pendingPaymentsList = document.getElementById('pending-payments-list');
      if (!pendingPaymentsList) return;

      // Mock pending payments - replace with real Firebase data
      pendingPaymentsList.innerHTML = `
        <div class="border rounded-lg p-4">
          <div class="flex justify-between items-start">
            <div>
              <div class="font-medium">Order #12345</div>
              <div class="text-sm text-gray-600">bKash Payment</div>
              <div class="text-sm">Transaction ID: 123456789</div>
              <div class="text-sm">Amount: ৳1,250</div>
            </div>
            <div class="flex gap-2">
              <button class="px-3 py-1 bg-green-600 text-white rounded text-sm">Approve</button>
              <button class="px-3 py-1 bg-red-600 text-white rounded text-sm">Reject</button>
            </div>
          </div>
        </div>
      `;

      // Setup payment settings form
      this.setupPaymentSettings();
      
      console.log('Payments data loaded successfully');
    } catch (error) {
      console.error('Error loading payments data:', error);
    }
  }

  setupPaymentSettings() {
    const paymentForm = document.getElementById('payment-settings-form');
    if (paymentForm) {
      paymentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const formData = new FormData(paymentForm);
          const settings = {
            bkash: {
              enabled: formData.get('bkash_enabled') === 'on',
              number: formData.get('bkash_number'),
              accountName: formData.get('bkash_account_name'),
              instructions: formData.get('bkash_instructions')
            },
            cod: {
              enabled: formData.get('cod_enabled') === 'on',
              instructions: formData.get('cod_instructions')
            }
          };

          // Save to Firestore
          const settingsRef = doc(db, 'settings', 'payments');
          await setDoc(settingsRef, settings);
          
          this.showNotification('Payment settings saved!', 'success');
        } catch (error) {
          console.error('Error saving payment settings:', error);
          this.showNotification('Error saving settings: ' + error.message, 'error');
        }
      });
    }
  }

  async loadFilesData() {
    try {
      // Setup file upload
      const uploadBtn = document.getElementById('fm-upload');
      const fileInput = document.getElementById('fm-file');
      
      if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => {
          if (fileInput.files.length > 0) {
            // Upload logic here
            this.showNotification('Files uploaded!', 'success');
          }
        });
      }
      
      console.log('Files data loaded successfully');
    } catch (error) {
      console.error('Error loading files data:', error);
    }
  }

  async loadNotesData() {
    try {
      // Load notes
      const notesList = document.getElementById('notes-list');
      if (notesList) {
        // Mock notes - replace with real Firebase data
        notesList.innerHTML = `
          <div class="p-2 border rounded cursor-pointer hover:bg-gray-50">
            <div class="font-medium">Sample Note</div>
            <div class="text-sm text-gray-500">Click to edit...</div>
          </div>
        `;
      }

      // Setup notes functionality
      this.setupNotesFunctionality();
      
      console.log('Notes data loaded successfully');
    } catch (error) {
      console.error('Error loading notes data:', error);
    }
  }

  setupNotesFunctionality() {
    const saveBtn = document.getElementById('note-save');
    const titleInput = document.getElementById('note-title');
    const contentInput = document.getElementById('note-content');
    
    if (saveBtn && titleInput && contentInput) {
      saveBtn.addEventListener('click', async () => {
        try {
          const note = {
            title: titleInput.value,
            content: contentInput.value,
            createdAt: serverTimestamp()
          };

          // Save to Firestore
          const notesRef = collection(db, 'notes');
          await setDoc(doc(notesRef), note);
          
          this.showNotification('Note saved!', 'success');
          
          // Clear form
          titleInput.value = '';
          contentInput.value = '';
        } catch (error) {
          console.error('Error saving note:', error);
          this.showNotification('Error saving note: ' + error.message, 'error');
        }
      });
    }
  }

  async loadDashboardData() {
    try {
      // Load statistics
      const productsCount = await this.getCollectionCount('products');
      const ordersCount = await this.getCollectionCount('orders');
      const pagesCount = await this.getCollectionCount('pages');
      const postsCount = await this.getCollectionCount('posts');

      // Update "At a Glance" widget
      const glanceItems = document.querySelectorAll('.wp-at-a-glance-item');
      if (glanceItems.length >= 4) {
        glanceItems[0].querySelector('.wp-at-a-glance-count').textContent = productsCount;
        glanceItems[1].querySelector('.wp-at-a-glance-count').textContent = ordersCount;
        glanceItems[2].querySelector('.wp-at-a-glance-count').textContent = pagesCount;
        glanceItems[3].querySelector('.wp-at-a-glance-count').textContent = postsCount;
      }

      console.log('Dashboard data loaded successfully');
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  }

  async loadProductsData() {
    try {
      // Load products from Firestore
      const productsQuery = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(productsQuery);
      
      const productsGrid = document.getElementById('products-grid');
      const productsEmpty = document.getElementById('products-empty');
      
      if (!productsGrid) return;

      if (querySnapshot.empty) {
        productsGrid.innerHTML = '';
        if (productsEmpty) productsEmpty.classList.remove('hidden');
        return;
      }

      if (productsEmpty) productsEmpty.classList.add('hidden');
      
      productsGrid.innerHTML = '';
      
      querySnapshot.forEach((doc) => {
        const product = { id: doc.id, ...doc.data() };
        const productCard = this.createProductCard(product);
        productsGrid.appendChild(productCard);
      });

      console.log('Products data loaded successfully');
    } catch (error) {
      console.error('Error loading products data:', error);
    }
  }

  createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'wp-product-card relative group bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-all duration-200';
    
    // Get first variant price or default
    const price = product.variants && product.variants.length > 0 
      ? `৳${product.variants[0].price}` 
      : '৳0';
    
    // Get main image or placeholder
    const imageUrl = product.image || product.imageUrl || 'https://via.placeholder.com/300x200?text=No+Image';
    
    card.innerHTML = `
      <!-- Product Image -->
      <div class="relative h-48 bg-gray-100 overflow-hidden">
        <img src="${imageUrl}" alt="${product.title}" class="w-full h-full object-cover">
        
        <!-- Hover Overlay -->
        <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div class="flex flex-col gap-2">
            <button class="product-edit bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors" data-id="${product.id}">
              <i class="fas fa-edit mr-2"></i>Edit
            </button>
            <button class="product-view bg-gray-600 text-white px-4 py-2 rounded text-sm hover:bg-gray-700 transition-colors" data-id="${product.id}">
              <i class="fas fa-eye mr-2"></i>View
            </button>
            <button class="product-delete bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 transition-colors" data-id="${product.id}">
              <i class="fas fa-trash mr-2"></i>Delete
            </button>
          </div>
        </div>
        
        <!-- Status Badge -->
        <div class="absolute top-2 right-2">
          <span class="wp-status ${product.active ? 'wp-status-published' : 'wp-status-draft'}">
            ${product.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
      
      <!-- Product Info -->
      <div class="p-4">
        <h3 class="font-semibold text-gray-900 mb-2 line-clamp-2">${product.title}</h3>
        
        <div class="flex items-center justify-between text-sm text-gray-600 mb-2">
          <span class="font-medium text-lg text-gray-900">${price}</span>
          <span>Stock: ${product.stock || 0}</span>
        </div>
        
        <div class="flex items-center justify-between text-xs text-gray-500">
          <span>${product.category || 'No category'}</span>
          <span>${product.variants ? product.variants.length : 0} variants</span>
        </div>
      </div>
      
      <!-- Quick Actions (Always Visible) -->
      <div class="px-4 pb-4 flex gap-2">
        <button class="product-quick-edit flex-1 bg-gray-100 text-gray-700 px-3 py-2 rounded text-sm hover:bg-gray-200 transition-colors" data-id="${product.id}">
          <i class="fas fa-edit mr-1"></i>Quick Edit
        </button>
        <button class="product-quick-view flex-1 bg-gray-100 text-gray-700 px-3 py-2 rounded text-sm hover:bg-gray-200 transition-colors" data-id="${product.id}">
          <i class="fas fa-eye mr-1"></i>View
        </button>
      </div>
    `;
    
    // Add event listeners
    this.setupProductCardEvents(card, product);
    
    return card;
  }

  setupProductCardEvents(card, product) {
    // Edit button
    const editBtn = card.querySelector('.product-edit');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        this.editProduct(product.id);
      });
    }
    
    // Quick edit button
    const quickEditBtn = card.querySelector('.product-quick-edit');
    if (quickEditBtn) {
      quickEditBtn.addEventListener('click', () => {
        this.quickEditProduct(product.id);
      });
    }
    
    // View button
    const viewBtn = card.querySelector('.product-view, .product-quick-view');
    if (viewBtn) {
      viewBtn.addEventListener('click', () => {
        this.viewProduct(product.id);
      });
    }
    
    // Delete button
    const deleteBtn = card.querySelector('.product-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (confirm(`Are you sure you want to delete "${product.title}"?`)) {
          this.deleteProduct(product.id);
        }
      });
    }
  }

  editProduct(productId) {
    // Navigate to edit page
    window.location.hash = `products/edit/${productId}`;
  }

  quickEditProduct(productId) {
    // Open quick edit modal
    this.showNotification('Quick edit feature coming soon!', 'info');
  }

  viewProduct(productId) {
    // Open product view modal
    this.showNotification('Product view feature coming soon!', 'info');
  }

  async deleteProduct(productId) {
    try {
      await deleteDoc(doc(db, 'products', productId));
      this.showNotification('Product deleted successfully!', 'success');
      await this.loadProductsData();
    } catch (error) {
      console.error('Error deleting product:', error);
      this.showNotification('Failed to delete product: ' + error.message, 'error');
    }
  }

  async loadOrdersData() {
    try {
      const ordersQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(ordersQuery);
      
      const tbody = document.getElementById('orders-table-body');
      if (!tbody) return;

      if (querySnapshot.empty) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center py-8 text-gray-500">
              No orders found.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = '';
      querySnapshot.forEach((doc) => {
        const order = doc.data();
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><strong>#${doc.id.substring(0, 8)}</strong></td>
          <td>${new Date(order.createdAt?.toDate || Date.now()).toLocaleDateString()}</td>
          <td>
            <span class="wp-status wp-status-${order.status === 'completed' ? 'published' : order.status === 'cancelled' ? 'draft' : 'pending'}">
              ${order.status || 'pending'}
            </span>
          </td>
          <td>৳${(order.total || 0).toFixed(2)}</td>
          <td>${order.customer?.name || 'Unknown'}</td>
          <td>
            <a href="#orders/view/${doc.id}" class="text-blue-600 hover:underline text-sm">View</a>
          </td>
        `;
        tbody.appendChild(row);
      });

      console.log('Orders data loaded successfully');
    } catch (error) {
      console.error('Error loading orders data:', error);
    }
  }

  async loadMediaData() {
    try {
      // Load media from Firestore
      let snap;
      try {
        const qy = query(collection(db,'media'), orderBy('createdAt','desc'));
        snap = await getDocs(qy);
      } catch(err){
        // Fallback: no index or field issues — read without ordering
        snap = await getDocs(collection(db,'media'));
      }
      
      const allMedia = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
      
      // Sort by createdAt if available
      allMedia.sort((a,b)=> {
        const ta = (a.createdAt?.seconds||0);
        const tb = (b.createdAt?.seconds||0);
        return tb - ta;
      });

      const mediaGrid = document.getElementById('media-grid');
      if (!mediaGrid) return;

      if (allMedia.length === 0) {
        mediaGrid.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500">No images in library</div>';
        return;
      }

      mediaGrid.innerHTML = '';
      allMedia.forEach(m => {
        const card = document.createElement('div');
        card.className = 'relative group cursor-pointer border-2 border-transparent hover:border-blue-400 rounded-lg overflow-hidden transition-all';
        card.innerHTML = `
          <img src="${m.url}" alt="" class="w-full h-24 object-cover">
          <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button class="select-media bg-blue-600 text-white px-3 py-1 rounded text-sm mr-2" data-url="${m.url}">Select</button>
            <button class="delete-media bg-red-600 text-white px-3 py-1 rounded text-sm" data-id="${m.id}">Delete</button>
          </div>
        `;
        mediaGrid.appendChild(card);
      });

      // Setup media selection
      this.setupMediaSelection(allMedia);
      
      // Setup media upload for media page
      this.setupMediaPageUpload();
      
      console.log('Media data loaded successfully');
    } catch (error) {
      console.error('Error loading media data:', error);
    }
  }

  setupMediaPageUpload() {
    const mediaFileInput = document.getElementById('media-file-input');
    const mediaUploadTrigger = document.getElementById('media-upload-trigger');
    const mediaUploadMessage = document.getElementById('media-upload-message');
    
    if (mediaUploadTrigger && mediaFileInput) {
      mediaUploadTrigger.addEventListener('click', () => {
        mediaFileInput.click();
      });
    }
    
    if (mediaFileInput) {
      mediaFileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        try {
          if (mediaUploadMessage) mediaUploadMessage.textContent = 'Uploading...';
          mediaUploadMessage.className = 'mt-4 text-sm text-blue-600';
          
          for (const file of files) {
            const url = await this.uploadImage(file);
            await addDoc(collection(db, 'media'), { 
              url, 
              category: null, 
              createdAt: serverTimestamp(), 
              by: auth.currentUser ? auth.currentUser.uid : null 
            });
          }
          
          if (mediaUploadMessage) {
            mediaUploadMessage.textContent = 'Upload complete!';
            mediaUploadMessage.className = 'mt-4 text-sm text-green-600';
          }
          
          // Clear input
          mediaFileInput.value = '';
          
          // Reload media
          await this.loadMediaData();
          
          // Clear message after 3 seconds
          setTimeout(() => {
            if (mediaUploadMessage) {
              mediaUploadMessage.textContent = '';
              mediaUploadMessage.className = 'mt-4 text-sm';
            }
          }, 3000);
          
        } catch (error) {
          if (mediaUploadMessage) {
            mediaUploadMessage.textContent = 'Upload failed: ' + error.message;
            mediaUploadMessage.className = 'mt-4 text-sm text-red-600';
          }
        }
      });
    }
  }

  setupMediaSelection(allMedia) {
    // Media upload
    const mediaUpload = document.getElementById('media-upload');
    const mediaUploadBtn = document.getElementById('media-upload-btn');
    const mediaMessage = document.getElementById('media-message');
    
    if (mediaUpload && mediaUploadBtn) {
      mediaUpload.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        try {
          if (mediaMessage) mediaMessage.textContent = 'Uploading...';
          mediaUploadBtn.disabled = true;
          
          for (const file of files) {
            const url = await this.uploadImage(file);
            await addDoc(collection(db, 'media'), { 
              url, 
              category: null, 
              createdAt: serverTimestamp(), 
              by: auth.currentUser ? auth.currentUser.uid : null 
            });
          }
          
          if (mediaMessage) mediaMessage.textContent = 'Upload complete!';
          await this.loadMediaData();
        } catch (error) {
          if (mediaMessage) mediaMessage.textContent = 'Upload failed: ' + error.message;
        } finally {
          mediaUploadBtn.disabled = false;
        }
      });
    }

    // Media selection buttons
    document.querySelectorAll('.select-media').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        this.selectMediaImage(url);
      });
    });

    // Media delete buttons
    document.querySelectorAll('.delete-media').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this image?')) return;
        
        const id = btn.dataset.id;
        try {
          await deleteDoc(doc(db, 'media', id));
          this.showNotification('Image deleted', 'success');
          await this.loadMediaData();
        } catch (error) {
          this.showNotification('Delete failed: ' + error.message, 'error');
        }
      });
    });

    // Modal buttons
    const mediaUseMain = document.getElementById('media-use-main');
    const mediaUseGallery = document.getElementById('media-use-gallery');
    const mediaClose = document.getElementById('media-close');
    
    if (mediaUseMain) {
      mediaUseMain.addEventListener('click', () => {
        const selected = document.querySelector('.select-media[data-url].selected');
        if (selected) {
          this.selectMediaImage(selected.dataset.url);
        }
      });
    }

    if (mediaUseGallery) {
      mediaUseGallery.addEventListener('click', () => {
        const selected = document.querySelector('.select-media[data-url].selected');
        if (selected) {
          this.addToGallery(selected.dataset.url);
        }
      });
    }

    if (mediaClose) {
      mediaClose.addEventListener('click', () => {
        document.getElementById('media-modal').classList.add('hidden');
      });
    }
  }

  async uploadImage(file) {
    // ImgBB upload (simplified version)
    const IMGBB_API_KEY = '462884d7f63129dede1b67d612e66ee6';
    
    const formData = new FormData();
    formData.append('image', await this.fileToBase64(file));
    
    const response = await fetch(`https://api.imgbb.com/1/upload?expiration=0&key=${IMGBB_API_KEY}`, {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    if (!result.success) throw new Error('Upload failed');
    
    return result.data.url;
  }

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  selectMediaImage(url) {
    // Set as main image for product
    const imageInput = document.querySelector('input[name="imageUrl"]');
    const previewImage = document.getElementById('add-preview-image');
    const placeholder = document.getElementById('preview-placeholder');
    
    if (imageInput) imageInput.value = url;
    if (previewImage) {
      previewImage.src = url;
      previewImage.classList.remove('hidden');
    }
    if (placeholder) placeholder.classList.add('hidden');
    
    // Close modal
    document.getElementById('media-modal').classList.add('hidden');
    this.showNotification('Image selected', 'success');
  }

  addToGallery(url) {
    // Add to gallery textarea
    const galleryTextarea = document.querySelector('textarea[name="galleryUrls"]');
    if (galleryTextarea) {
      const currentUrls = galleryTextarea.value ? galleryTextarea.value.split(',') : [];
      currentUrls.push(url);
      galleryTextarea.value = currentUrls.join(',');
    }
    
    // Update gallery preview
    this.updateGalleryPreview();
    
    // Close modal
    document.getElementById('media-modal').classList.add('hidden');
    this.showNotification('Added to gallery', 'success');
  }

  updateGalleryPreview() {
    const galleryTextarea = document.querySelector('textarea[name="galleryUrls"]');
    const previewGallery = document.getElementById('add-preview-gallery');
    
    if (!galleryTextarea || !previewGallery) return;
    
    const urls = galleryTextarea.value ? galleryTextarea.value.split(',') : [];
    previewGallery.innerHTML = '';
    
    urls.forEach(url => {
      const img = document.createElement('img');
      img.src = url.trim();
      img.className = 'w-full h-full object-cover rounded';
      previewGallery.appendChild(img);
    });
  }

  async loadSettingsData() {
    console.log('Loading settings data...');
    // Settings section will be implemented in next step
  }

  async getCollectionCount(collectionName) {
    try {
      const querySnapshot = await getDocs(collection(db, collectionName));
      return querySnapshot.size;
    } catch (error) {
      console.error(`Error getting ${collectionName} count:`, error);
      return 0;
    }
  }

  setupEventListeners() {
    // Quick draft functionality
    const quickDraftSave = document.querySelector('.wp-quick-draft-save');
    if (quickDraftSave) {
      quickDraftSave.addEventListener('click', () => {
        const title = document.querySelector('.wp-quick-draft-title')?.value;
        const content = document.querySelector('.wp-quick-draft-content-textarea')?.value;
        
        if (title || content) {
          alert('Quick draft saved! (This is a demo - actual saving would be implemented)');
          // Clear form
          if (document.querySelector('.wp-quick-draft-title')) {
            document.querySelector('.wp-quick-draft-title').value = '';
          }
          if (document.querySelector('.wp-quick-draft-content-textarea')) {
            document.querySelector('.wp-quick-draft-content-textarea').value = '';
          }
        }
      });
    }

    // Search functionality
    const searchInputs = document.querySelectorAll('.wp-search-input');
    searchInputs.forEach(input => {
      input.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        this.handleSearch(searchTerm);
      });
    });

    // Admin bar links
    const adminBarLinks = document.querySelectorAll('.wp-admin-bar a');
    adminBarLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (href === 'index.html') {
          // Allow navigation to main site
          return;
        }
        if (href && href.startsWith('#')) {
          e.preventDefault();
          const page = href.substring(1);
          this.navigateToPage(page);
        }
      });
    });

    // Tab functionality
    this.setupTabs();

    // Media upload functionality
    this.setupMediaUpload();

    // Settings save functionality
    this.setupSettingsSave();
  }

  setupTabs() {
    const tabButtons = document.querySelectorAll('.wp-tab');
    const tabContents = document.querySelectorAll('.wp-tab-content');

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab');
        
        // Remove active class from all tabs and contents
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        // Add active class to clicked tab and corresponding content
        button.classList.add('active');
        const targetContent = document.getElementById(`${targetTab}-tab`);
        if (targetContent) {
          targetContent.classList.add('active');
        }
      });
    });
  }

  setupMediaUpload() {
    const fileInput = document.getElementById('media-file-input');
    const mediaPreview = document.getElementById('media-preview');
    
    if (fileInput && mediaPreview) {
      fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        
        files.forEach(file => {
          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            
            reader.onload = (e) => {
              const mediaItem = document.createElement('div');
              mediaItem.className = 'wp-media-item';
              mediaItem.innerHTML = `
                <img src="${e.target.result}" alt="${file.name}">
                <button class="remove-btn" onclick="this.parentElement.remove()">×</button>
              `;
              mediaPreview.appendChild(mediaItem);
            };
            
            reader.readAsDataURL(file);
          }
        });
      });
    }
  }

  setupSettingsSave() {
    const saveButtons = document.querySelectorAll('.wp-button');
    saveButtons.forEach(button => {
      if (button.textContent.includes('Save Changes')) {
        button.addEventListener('click', () => {
          this.saveSettings();
        });
      }
    });
  }

  async saveSettings() {
    try {
      const settings = {
        siteTitle: document.getElementById('site-title')?.value || 'Bazar',
        siteTagline: document.getElementById('site-tagline')?.value || 'Your Trusted E-commerce Platform',
        adminEmail: document.getElementById('admin-email')?.value || 'admin@bazar.com',
        timezone: document.getElementById('timezone')?.value || 'UTC+6',
        dateFormat: document.getElementById('date-format')?.value || 'Y-m-d',
        shipping: {
          baseFee: Number(document.getElementById('base-fee')?.value || 50),
          extraPerBlock: Number(document.getElementById('extra-per-block')?.value || 20),
          blockGrams: Number(document.getElementById('block-grams')?.value || 500),
          fallbackFee: Number(document.getElementById('fallback-fee')?.value || 60)
        },
        payment: {
          bkash: {
            enabled: document.getElementById('bkash-enabled')?.checked || false,
            number: document.getElementById('bkash-number')?.value || '01312345678',
            instructions: document.getElementById('bkash-instructions')?.value || 'Send money to the bKash number above and enter the transaction ID.'
          },
          nagad: {
            enabled: document.getElementById('nagad-enabled')?.checked || false,
            number: document.getElementById('nagad-number')?.value || '01701234567',
            instructions: document.getElementById('nagad-instructions')?.value || 'Send money to the Nagad number above and enter the transaction ID.'
          }
        },
        email: {
          fromEmail: document.getElementById('from-email')?.value || 'noreply@bazar.com',
          fromName: document.getElementById('from-name')?.value || 'Bazar',
          smtpHost: document.getElementById('smtp-host')?.value || '',
          smtpPort: Number(document.getElementById('smtp-port')?.value || 587)
        }
      };

      // Save to Firestore
      const settingsRef = doc(db, 'settings', 'site');
      await setDoc(settingsRef, settings);
      
      // Show success message
      this.showNotification('Settings saved successfully!', 'success');
      
      console.log('Settings saved:', settings);
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showNotification('Error saving settings: ' + error.message, 'error');
    }
  }

  showNotification(message, type = 'success') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `wp-notification ${type}`;
    notification.innerHTML = `
      <p>${message}</p>
    `;
    
    // Insert at the top of content area
    const contentArea = document.querySelector('.wp-content-area');
    if (contentArea) {
      contentArea.insertBefore(notification, contentArea.firstChild);
      
      // Auto-remove after 3 seconds
      setTimeout(() => {
        notification.remove();
      }, 3000);
    }
  }

  handleSearch(searchTerm) {
    console.log(`Searching for: ${searchTerm}`);
    // Search functionality will be implemented based on current page
    // For now, just log the search term
  }
}

// Initialize WordPress Admin when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new WPAdmin();
});

// Export for potential use in other files
window.WPAdmin = WPAdmin;
