import Alpine from 'alpinejs';

// ─── Données produits ────────────────────────────────────────────────────────

const topProduct = {
    id: 'club-shirt',
    name: 'T-shirt',
    price: 30,
    image: '/images/products/acelspace-shirt.jpg',
    description: 'T-shirt aux couleurs du club, avec votre nom et prénom.',
    sizes: ['M', 'L', 'XL', 'XXL']
};

const products = [
    {
        id: 'club-pen',
        name: 'Stylo',
        price: 10,
        image: '/images/products/acelspace-pen.jpg',
        description: 'Stylo officiel aux couleurs du club ACELSPACE.',
        sizes: ['S', 'M', 'L', 'XL']
    },
    {
        id: 'club-mousepad',
        name: 'Tapis de souris',
        price: 18,
        image: '/images/products/acelspace-mousepad.jpg',
        description: 'Tapis de souris avec le logo officiel du club ACELSPACE.',
        sizes: ['Taille unique']
    },
    {
        id: 'usb-key',
        name: 'Cle usb',
        price: 15,
        image: '/images/products/acelspace-usb.jpg',
        description: 'Clé USB 32 Go aux couleurs officielles du club ACELSPACE.',
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
    isPrivacyModalOpen: false,
    activeProduct: null,

    // Modal multi-step state (1: Fiche produit, 2: Formulaire, 3: Confirmation)
    step: 1,

    // Pre-order form state
    orderForm: {
        nom: '',
        contact: '',
        taille: 'Taille unique',
        quantite: 1,
        rgpdConsent: false
    },
    orderSubmitting: false,
    orderSuccess: null,
    orderError: null,

    get filteredProducts() {
        if (!this.searchQuery.trim()) return this.products;
        return this.products.filter(p =>
            p.name.toLowerCase().includes(this.searchQuery.toLowerCase())
        );
    },

    get estimatedTotalPrice() {
        if (!this.activeProduct) return 0;
        const qty = parseInt(this.orderForm.quantite, 10) || 1;
        return Math.round(this.activeProduct.price * qty * 100) / 100;
    },

    openProductModal(product) {
        this.activeProduct = product;
        this.step = 1;
        this.orderSuccess = null;
        this.orderError = null;
        this.orderSubmitting = false;
        this.orderForm = {
            nom: '',
            contact: '',
            taille: (product.sizes && product.sizes.length > 0) ? product.sizes[0] : 'Taille unique',
            quantite: 1,
            rgpdConsent: false
        };
        this.isProductModalOpen = true;
    },

    goToStep(targetStep) {
        this.orderError = null;
        this.step = targetStep;
    },

    async submitPrecommande() {
        this.orderError = null;

        // Validation client
        if (!this.orderForm.nom.trim() || this.orderForm.nom.trim().length < 2) {
            this.orderError = 'Veuillez saisir votre nom et prénom (au moins 2 caractères).';
            return;
        }

        if (!this.orderForm.contact.trim() || this.orderForm.contact.trim().length < 3) {
            this.orderError = 'Veuillez indiquer un moyen de contact (email ou pseudo Instagram).';
            return;
        }

        const qty = parseInt(this.orderForm.quantite, 10);
        if (isNaN(qty) || qty < 1 || qty > 10) {
            this.orderError = 'La quantité doit être comprise entre 1 et 10.';
            return;
        }

        if (!this.orderForm.rgpdConsent) {
            this.orderError = 'Vous devez cocher la case de consentement RGPD pour valider la précommande.';
            return;
        }

        this.orderSubmitting = true;

        try {
            const payload = {
                nom: this.orderForm.nom.trim(),
                contact: this.orderForm.contact.trim(),
                produit: this.activeProduct.id,
                taille: this.orderForm.taille,
                quantite: qty,
                rgpdConsent: true
            };

            const response = await fetch('/api/precommande', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                this.orderError = data.message || 'Une erreur est survenue lors de la précommande.';
            } else {
                this.orderSuccess = data.message || 'Votre précommande a été enregistrée avec succès ! Le club vous recontactera.';
                // Pass to step 3 (Confirmation)
                this.step = 3;
                // Reset fields
                this.orderForm.nom = '';
                this.orderForm.contact = '';
                this.orderForm.quantite = 1;
                this.orderForm.rgpdConsent = false;
            }
        } catch (err) {
            console.error('Erreur réseau précommande :', err);
            this.orderError = 'Impossible de joindre le serveur. Vérifiez votre connexion.';
        } finally {
            this.orderSubmitting = false;
        }
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

