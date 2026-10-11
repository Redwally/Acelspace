import Alpine from 'alpinejs';

// ─── Composant Alpine principal (Boutique & Panier de Précommande) ───────────

Alpine.data('merchApp', () => ({
    topProduct: null,
    products: [],
    allProductsList: [],
    catalogLoading: true,
    catalogError: null,

    // Navigation & Modals annexes
    searchActive: false,
    searchQuery: '',
    isProductModalOpen: false,
    isAboutOpen: false,
    isContactOpen: false,
    isPrivacyModalOpen: false,
    activeProduct: null,

    // Sélections dans la modale produit
    selectedTaille: 'Taille unique',
    selectedQuantite: 1,
    justAddedFeedback: false,
    justAddedTimer: null,

    // État du statut des précommandes (ouvert/fermé)
    preorderStatus: {
        ouvert: true,
        message: ''
    },

    // ─── Panier de Précommande ───────────────────────────────────────────────
    // cart: [{ product_id, taille, quantite }] (Aucune donnée personnelle ici)
    cart: [],
    isCartModalOpen: false,
    cartStep: 1, // 1: Récap, 2: Informations, 3: Confirmation
    cartWarning: '',
    cartError: '',
    cartSubmitting: false,

    // Informations client (Étape 2)
    rememberInfo: false,
    customerInfo: {
        nom: '',
        email: '',
        telephone: ''
    },
    rgpdConsent: false,

    async init() {
        this.loadCartFromStorage();
        this.loadSavedCustomerInfo();
        await Promise.all([
            this.loadPreorderStatus(),
            this.loadCatalog()
        ]);
        this.validateCartAgainstCatalog();
    },

    // ─── Statut Ouvert/Fermé ─────────────────────────────────────────────────
    async loadPreorderStatus() {
        try {
            const res = await fetch('/api/precommandes/status', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                this.preorderStatus = {
                    ouvert: Boolean(data.ouvert),
                    message: data.message || ''
                };
            }
        } catch (err) {
            console.error('Erreur chargement statut précommandes :', err);
        }
    },

    // ─── Catalogue Produits ──────────────────────────────────────────────────
    async loadCatalog() {
        this.catalogLoading = true;
        this.catalogError = null;
        try {
            const response = await fetch('/api/products');
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Erreur lors du chargement du catalogue.');
            }
            const all = data.products || [];
            this.allProductsList = all;

            const featured = all.find(p => p.featured === 1);
            if (featured) {
                this.topProduct = featured;
                this.products = all.filter(p => p.id !== featured.id);
            } else if (all.length > 0) {
                this.topProduct = all[0];
                this.products = all.slice(1);
            } else {
                this.topProduct = null;
                this.products = [];
            }
        } catch (err) {
            console.error('Erreur réseau catalogue :', err);
            this.catalogError = 'Impossible de charger le catalogue. Veuillez réessayer plus tard.';
        } finally {
            this.catalogLoading = false;
        }
    },

    get filteredProducts() {
        if (!this.searchQuery.trim()) return this.products;
        return this.products.filter(p =>
            p.name.toLowerCase().includes(this.searchQuery.toLowerCase())
        );
    },

    // ─── Modale Produit ──────────────────────────────────────────────────────
    openProductModal(product) {
        if (!product) return;
        this.activeProduct = product;
        this.selectedTaille = (product.sizes && product.sizes.length > 0) ? product.sizes[0] : 'Taille unique';
        this.selectedQuantite = 1;
        this.justAddedFeedback = false;
        this.isProductModalOpen = true;
    },

    // ─── Gestion du Panier (localStorage avec try/catch) ─────────────────────
    loadCartFromStorage() {
        try {
            const raw = localStorage.getItem('acelspaces_cart');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.cart = parsed;
                }
            }
        } catch (e) {
            console.warn('Erreur lecture panier localStorage :', e);
            this.cart = [];
        }
    },

    saveCartToStorage() {
        try {
            localStorage.setItem('acelspaces_cart', JSON.stringify(this.cart));
        } catch (e) {
            console.warn('Erreur sauvegarde panier localStorage :', e);
        }
    },

    loadSavedCustomerInfo() {
        try {
            const saved = localStorage.getItem('acelspaces_user_info');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object') {
                    this.customerInfo.nom = parsed.nom || '';
                    this.customerInfo.email = parsed.email || '';
                    this.customerInfo.telephone = parsed.telephone || '';
                    // Case décochée par défaut selon la consigne stricte
                    this.rememberInfo = false;
                }
            }
        } catch (e) {
            console.warn('Erreur lecture user info localStorage :', e);
        }
    },

    // Validation du panier par rapport au catalogue actif
    validateCartAgainstCatalog() {
        if (!this.allProductsList || this.allProductsList.length === 0) return;

        let removedCount = 0;
        const validCart = [];

        for (const item of this.cart) {
            // Le endpoint public ne renvoie que les produits actifs, sans champ `actif`.
            // Un produit archivé disparaît donc simplement de cette liste.
            const prod = this.allProductsList.find(p => p.id === item.product_id);
            if (!prod) {
                removedCount++;
                continue;
            }
            // S'assurer que la taille existe toujours pour ce produit
            let taille = item.taille;
            if (prod.sizes && prod.sizes.length > 0 && !prod.sizes.includes(taille)) {
                taille = prod.sizes[0];
            }
            validCart.push({
                product_id: item.product_id,
                taille: taille,
                quantite: Math.max(1, Math.min(10, parseInt(item.quantite, 10) || 1))
            });
        }

        if (removedCount > 0) {
            this.cartWarning = `${removedCount} article(s) de votre précommande n'étaient plus disponibles et ont été retirés.`;
            this.cart = validCart;
            this.saveCartToStorage();
        }
    },

    addToCart(product) {
        if (!this.preorderStatus.ouvert) return;
        if (!product) return;

        const qty = parseInt(this.selectedQuantite, 10);
        if (isNaN(qty) || qty < 1 || qty > 10) {
            return;
        }

        const taille = this.selectedTaille || 'Taille unique';

        // Vérifier si la même ligne (même produit + même taille) existe déjà
        const existingIndex = this.cart.findIndex(i => i.product_id === product.id && i.taille === taille);

        if (existingIndex > -1) {
            const currentQty = this.cart[existingIndex].quantite;
            this.cart[existingIndex].quantite = Math.min(10, currentQty + qty);
        } else {
            if (this.cart.length >= 20) {
                alert('Votre précommande a atteint la limite de 20 articles distincts.');
                return;
            }
            this.cart.push({
                product_id: product.id,
                taille: taille,
                quantite: qty
            });
        }

        this.saveCartToStorage();

        // Feedback visuel après ajout
        this.justAddedFeedback = true;
        if (this.justAddedTimer) clearTimeout(this.justAddedTimer);
        this.justAddedTimer = setTimeout(() => {
            this.justAddedFeedback = false;
        }, 2500);
    },

    updateCartQty(index, newQty) {
        const q = parseInt(newQty, 10);
        if (isNaN(q) || q < 1) {
            this.removeFromCart(index);
            return;
        }
        if (this.cart[index]) {
            this.cart[index].quantite = Math.min(10, Math.max(1, q));
            this.saveCartToStorage();
        }
    },

    updateCartSize(index, newSize) {
        if (this.cart[index] && newSize) {
            this.cart[index].taille = newSize;
            this.saveCartToStorage();
        }
    },

    removeFromCart(index) {
        if (index >= 0 && index < this.cart.length) {
            this.cart.splice(index, 1);
            this.saveCartToStorage();
        }
    },

    clearCart() {
        this.cart = [];
        this.saveCartToStorage();
    },

    get cartCount() {
        return this.cart.reduce((sum, item) => sum + (parseInt(item.quantite, 10) || 0), 0);
    },

    getProductDetails(productId) {
        return this.allProductsList.find(p => p.id === productId) || null;
    },

    get detailedCartItems() {
        return this.cart.map((item, index) => {
            const product = this.getProductDetails(item.product_id) || {
                name: 'Produit indisponible',
                price: 0,
                image: '',
                sizes: ['Taille unique']
            };
            const qty = parseInt(item.quantite, 10) || 1;
            const linePrice = Math.round(product.price * qty * 100) / 100;
            return {
                index,
                product_id: item.product_id,
                taille: item.taille,
                quantite: qty,
                name: product.name,
                unitPrice: product.price,
                linePrice: linePrice,
                image: product.image,
                availableSizes: product.sizes || ['Taille unique']
            };
        });
    },

    get cartTotal() {
        const total = this.detailedCartItems.reduce((acc, item) => acc + item.linePrice, 0);
        return Math.round(total * 100) / 100;
    },

    // ─── Modal Panier Navigation ─────────────────────────────────────────────
    openCartModal() {
        this.validateCartAgainstCatalog();
        this.cartStep = 1;
        this.cartError = '';
        this.isCartModalOpen = true;
    },

    closeCartModal() {
        this.isCartModalOpen = false;
        if (this.cartStep === 3) {
            this.cartStep = 1;
        }
    },

    goToCartStep(target) {
        this.cartError = '';
        if (target === 2 && this.cart.length === 0) {
            this.cartError = 'Votre panier de précommande est vide.';
            return;
        }
        this.cartStep = target;
    },

    // ─── Soumission de la Précommande Multi-produits ─────────────────────────
    async submitCartPrecommande() {
        this.cartError = '';

        if (this.cart.length === 0) {
            this.cartError = 'Votre panier est vide.';
            return;
        }

        // Validation Nom
        const cleanNom = (this.customerInfo.nom || '').trim();
        if (cleanNom.length < 2) {
            this.cartError = 'Veuillez saisir votre nom et prénom (au moins 2 caractères).';
            return;
        }

        // Validation Email
        const cleanEmail = (this.customerInfo.email || '').trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!cleanEmail || !emailRegex.test(cleanEmail)) {
            this.cartError = 'Veuillez saisir une adresse email valide.';
            return;
        }

        // Validation Téléphone (8 à 15 chiffres)
        const rawPhone = (this.customerInfo.telephone || '').trim();
        const phoneDigits = rawPhone.replace(/\D/g, '');
        const phoneRegex = /^\+?[0-9\s.\-_()]+$/;
        if (!rawPhone || !phoneRegex.test(rawPhone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
            this.cartError = 'Veuillez saisir un numéro de téléphone valide (8 à 15 chiffres).';
            return;
        }

        if (!this.rgpdConsent) {
            this.cartError = 'Vous devez cocher la case de consentement RGPD pour valider votre précommande.';
            return;
        }

        this.cartSubmitting = true;

        try {
            const payload = {
                nom: cleanNom,
                email: cleanEmail,
                telephone: rawPhone,
                consentement: true,
                lignes: this.cart.map(item => ({
                    product_id: item.product_id,
                    taille: item.taille,
                    quantite: parseInt(item.quantite, 10)
                }))
            };

            const response = await fetch('/api/precommande', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                this.cartError = data.message || 'Une erreur est survenue lors de la précommande.';
                // Si les précommandes ont été fermées entre temps
                if (data.precommandesFermees) {
                    this.preorderStatus.ouvert = false;
                    if (data.message) this.preorderStatus.message = data.message;
                }
                return;
            }

            // Gestion de l'option "Se souvenir de mes infos sur cet appareil"
            try {
                if (this.rememberInfo) {
                    // Seulement nom, email, téléphone — JAMAIS le consentement
                    localStorage.setItem('acelspaces_user_info', JSON.stringify({
                        nom: cleanNom,
                        email: cleanEmail,
                        telephone: rawPhone
                    }));
                } else {
                    localStorage.removeItem('acelspaces_user_info');
                }
            } catch (e) {
                console.warn('Erreur persistence localStorage info :', e);
            }

            // Succès : vider le panier
            this.clearCart();
            this.rgpdConsent = false;
            this.cartStep = 3; // Confirmation
        } catch (err) {
            console.error('Erreur réseau soumission précommande :', err);
            this.cartError = 'Impossible de contacter le serveur. Vérifiez votre connexion.';
        } finally {
            this.cartSubmitting = false;
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
