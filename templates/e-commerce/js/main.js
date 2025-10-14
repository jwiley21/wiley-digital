// Apex Store E-commerce Demo - Shared JavaScript
// This file contains shared functionality across all e-commerce template pages

// Global variables
let cart = JSON.parse(localStorage.getItem('apex-cart')) || [];
let wishlist = JSON.parse(localStorage.getItem('apex-wishlist')) || [];

// Sample products data (would typically come from a database)
const sampleProducts = {
    'headphones': { id: 'headphones', name: 'Premium Headphones', price: 199, category: 'electronics' },
    'watch': { id: 'watch', name: 'Smart Watch', price: 299, category: 'electronics' },
    'backpack': { id: 'backpack', name: 'Travel Backpack', price: 79, category: 'fashion' },
    'coffee': { id: 'coffee', name: 'Coffee Maker', price: 449, category: 'home' },
    'speaker': { id: 'speaker', name: 'Wireless Speaker', price: 129, category: 'electronics' },
    'jacket': { id: 'jacket', name: 'Designer Jacket', price: 199, category: 'fashion' }
};

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    updateCartUI();
    initializeLucideIcons();
    
    // Add cart persistence
    window.addEventListener('beforeunload', function() {
        localStorage.setItem('apex-cart', JSON.stringify(cart));
        localStorage.setItem('apex-wishlist', JSON.stringify(wishlist));
    });
});

// Initialize Lucide icons
function initializeLucideIcons() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
}

// Cart functionality
function addToCart(productId, customProduct = null) {
    let product;
    
    if (customProduct) {
        product = customProduct;
    } else if (sampleProducts[productId]) {
        product = sampleProducts[productId];
    } else {
        console.error('Product not found:', productId);
        return;
    }
    
    cart.push({ ...product, cartId: Date.now() + Math.random() });
    updateCartUI();
    showCartAnimation();
    
    // Show success message
    showNotification(`${product.name} added to cart!`, 'success');
}

function removeFromCart(cartId) {
    cart = cart.filter(item => item.cartId !== cartId);
    updateCartUI();
    showNotification('Item removed from cart', 'info');
}

function updateCartUI() {
    const cartCount = document.getElementById('cart-count');
    const cartItems = document.getElementById('cart-items');
    const cartTotal = document.getElementById('cart-total');
    
    if (cartCount) {
        cartCount.textContent = cart.length;
    }
    
    if (cartItems) {
        cartItems.innerHTML = '';
        cart.forEach(item => {
            const cartItem = document.createElement('div');
            cartItem.className = 'flex justify-between items-center p-3 glass rounded-lg mb-2';
            cartItem.innerHTML = `
                <div class="flex-1">
                    <h4 class="text-white font-medium">${item.name}</h4>
                    <p class="text-gray-400 text-sm">$${item.price}</p>
                </div>
                <button onclick="removeFromCart('${item.cartId}')" class="text-red-400 hover:text-red-300 ml-2">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            `;
            cartItems.appendChild(cartItem);
        });
        
        initializeLucideIcons();
    }
    
    if (cartTotal) {
        const total = cart.reduce((sum, item) => sum + item.price, 0);
        cartTotal.textContent = `$${total.toFixed(2)}`;
    }
}

function toggleCart() {
    const sidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('cart-overlay');
    
    if (sidebar && overlay) {
        if (sidebar.classList.contains('translate-x-full')) {
            sidebar.classList.remove('translate-x-full');
            overlay.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        } else {
            sidebar.classList.add('translate-x-full');
            overlay.classList.add('hidden');
            document.body.style.overflow = 'auto';
        }
    }
}

function showCartAnimation() {
    const cartIcon = document.querySelector('#cart-count')?.parentElement;
    if (cartIcon) {
        cartIcon.classList.add('cart-bounce');
        setTimeout(() => cartIcon.classList.remove('cart-bounce'), 300);
    }
}

// Wishlist functionality
function addToWishlist(productId, customProduct = null) {
    let product;
    
    if (customProduct) {
        product = customProduct;
    } else if (sampleProducts[productId]) {
        product = sampleProducts[productId];
    } else {
        console.error('Product not found:', productId);
        return;
    }
    
    // Check if already in wishlist
    if (wishlist.find(item => item.id === product.id)) {
        showNotification('Item already in wishlist', 'info');
        return;
    }
    
    wishlist.push(product);
    showNotification(`${product.name} added to wishlist!`, 'success');
}

function removeFromWishlist(productId) {
    wishlist = wishlist.filter(item => item.id !== productId);
    showNotification('Item removed from wishlist', 'info');
}

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `fixed top-20 right-4 z-50 p-4 rounded-lg shadow-lg transform translate-x-full transition-transform duration-300 ${
        type === 'success' ? 'bg-green-600' : 
        type === 'error' ? 'bg-red-600' : 
        'bg-blue-600'
    } text-white`;
    
    notification.innerHTML = `
        <div class="flex items-center space-x-2">
            <i data-lucide="${type === 'success' ? 'check' : type === 'error' ? 'x' : 'info'}" class="w-5 h-5"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    initializeLucideIcons();
    
    // Animate in
    setTimeout(() => notification.classList.remove('translate-x-full'), 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.classList.add('translate-x-full');
        setTimeout(() => document.body.removeChild(notification), 300);
    }, 3000);
}

// Search functionality
function handleSearch(query) {
    // This would typically search products from a database
    console.log('Searching for:', query);
    showNotification(`Searching for: ${query}`, 'info');
}

// Newsletter subscription
function subscribeNewsletter(email) {
    if (!email || !email.includes('@')) {
        showNotification('Please enter a valid email address', 'error');
        return;
    }
    
    // Simulate API call
    setTimeout(() => {
        showNotification('Successfully subscribed to newsletter!', 'success');
    }, 1000);
}

// Mobile menu functionality
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

// Checkout simulation
function proceedToCheckout() {
    if (cart.length === 0) {
        showNotification('Your cart is empty', 'error');
        return;
    }
    
    const total = cart.reduce((sum, item) => sum + item.price, 0);
    showNotification(`Proceeding to checkout with ${cart.length} items ($${total.toFixed(2)})`, 'success');
    
    // In a real app, this would redirect to checkout page
    setTimeout(() => {
        if (confirm('This is a demo. Clear cart to simulate successful purchase?')) {
            cart = [];
            updateCartUI();
            toggleCart();
            showNotification('Demo purchase completed!', 'success');
        }
    }, 1500);
}

// Export functions for global use
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.toggleCart = toggleCart;
window.addToWishlist = addToWishlist;
window.removeFromWishlist = removeFromWishlist;
window.toggleMobileMenu = toggleMobileMenu;
window.proceedToCheckout = proceedToCheckout;
window.handleSearch = handleSearch;
window.subscribeNewsletter = subscribeNewsletter;