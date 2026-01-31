import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, orderBy, where, doc, getDoc } from 'firebase/firestore';

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
      case 'orders':
        await this.loadOrdersData();
        break;
      case 'media':
        await this.loadMediaData();
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
      const productsQuery = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(productsQuery);
      
      const tbody = document.getElementById('products-table-body');
      if (!tbody) return;

      if (querySnapshot.empty) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center py-8 text-gray-500">
              No products found. <a href="#products/new" class="text-blue-600 hover:underline">Add your first product</a>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = '';
      querySnapshot.forEach((doc) => {
        const product = doc.data();
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><input type="checkbox" class="w-4 h-4"></td>
          <td>
            <div class="flex items-center gap-3">
              ${product.image ? `<img src="${product.image}" alt="${product.title}" class="w-10 h-10 object-cover rounded">` : '<div class="w-10 h-10 bg-gray-200 rounded flex items-center justify-center text-gray-500 text-xs">No img</div>'}
              <div>
                <div class="font-semibold">${product.title || 'Untitled Product'}</div>
                <div class="text-xs text-gray-500">SKU: ${product.sku || 'N/A'}</div>
              </div>
            </div>
          </td>
          <td>৳${(product.price || 0).toFixed(2)}</td>
          <td>${product.stock || 0}</td>
          <td>
            <span class="wp-status wp-status-${product.status === 'published' ? 'published' : 'draft'}">
              ${product.status || 'draft'}
            </span>
          </td>
          <td>${new Date(product.createdAt?.toDate || Date.now()).toLocaleDateString()}</td>
        `;
        tbody.appendChild(row);
      });

      console.log('Products data loaded successfully');
    } catch (error) {
      console.error('Error loading products data:', error);
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
    console.log('Loading media data...');
    // Media library will be implemented in next step
  }

  async loadPluginsData() {
    console.log('Loading plugins data...');
    // Plugins section will be implemented in next step
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
