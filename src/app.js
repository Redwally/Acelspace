import Alpine from 'alpinejs';

// ─── Données produits ────────────────────────────────────────────────────────

const topProduct = {
    id: 'club-shirt',
    name: 'T-shirt',
    price: 30,
    image: '/images/products/acelspace-shirt.jpg',
    description: 'T-shirt au couleur du club et avec votr nom prenom.',
    sizes: ['M', 'L', 'XL', 'XXL']
};

const products = [
    {
        id: 'club-pen',
        name: 'Stylo',
        price: 10,
        image: '/images/products/acelspace-pen.jpg',
        description: 'T-Shirt marron coupe classique avec sérigraphie poitrine officielle.',
        sizes: ['S', 'M', 'L', 'XL']
    },
    {
        id: 'club-mousepad',
        name: 'Tapis de souris',
        price: 18,
        image: '/images/products/acelspace-mousepad.jpg',
        description: 'Tapis de souris avec le logo du club.',
        sizes: ['Taille unique']
    },
    {
        id: 'usb-key',
        name: 'Cle usb',
        price: 15,
        image: '/images/products/acelspace-usb.jpg',
        description: 'Clé USB 32 Go couleurs officielles du club ACELSPACE SPACE.',
        sizes: ['32 GO']
    }
];

// ─── Composant Alpine principal ───────────────────────────────────────────────

Alpine.data('merchApp', () => ({
    topProduct: { ...topProduct },
    products: [...products],

    searchActive: false,
    searchQuery: '',
    isProductModalOpen: false,
    isAboutOpen: false,
    isContactOpen: false,
    activeProduct: null,

    get filteredProducts() {
        if (!this.searchQuery.trim()) return this.products;
        return this.products.filter(p =>
            p.name.toLowerCase().includes(this.searchQuery.toLowerCase())
        );
    },

    openProductModal(product) {
        this.activeProduct = product;
        this.isProductModalOpen = true;
    },

    toggleSearch() {
        this.searchActive = !this.searchActive;
        if (this.searchActive) {
            this.$nextTick(() => {
                if (this.$refs.searchInput) this.$refs.searchInput.focus();
            });
        } else {
            this.searchQuery = '';
        }
    },

    resetView() {
        this.searchQuery = '';
        this.searchActive = false;
    }
}));

// ─── Démarrage Alpine ─────────────────────────────────────────────────────────
Alpine.start();
