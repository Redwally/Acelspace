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
    isTrackingModalOpen: false,
    cookieConsentSaved: false,
    cookiePreferencesOpen: false,
    cookiePreferencesError: '',
    cookiePreferences: { essential: true, analytics: false },
    trackingEmail: '',
    trackingCode: '',
    trackingReference: '',
    trackingCodeSent: false,
    trackingResults: [],
    trackingLoading: false,
    trackingError: '',
    trackingNotice: '',
    trackingSearched: false,
    trackingSteps: [
        { index: 1, status: 'EN_ATTENTE_PAIEMENT', label: 'En attente de paiement' },
        { index: 2, status: 'PAYE', label: 'Payé' },
        { index: 3, status: 'EN_COMMANDE', label: 'En commande chez le fournisseur' },
        { index: 4, status: 'PRET_AU_LOCAL', label: 'Prêt au local' },
        { index: 5, status: 'REMIS', label: 'Remis au client' }
    ],
    activeProduct: null,
    currentImageIndex: 0,
    lightboxOpen: false,
    lightboxImage: '',
    lightboxImage2: '',
    currentLightboxIndex: 0,

    // Sélections dans la modale produit
    selectedTaille: 'Taille unique',
    selectedQuantite: 1,
    noCustomization: false,
    justAddedFeedback: false,
    justAddedTimer: null,

    // État du statut des précommandes (ouvert/fermé)
    preorderStatus: {
        ouvert: true,
        message: ''
    },

    // ─── Panier de Précommande ───────────────────────────────────────────────
    cart: [],
    isCartModalOpen: false,
    cartStep: 1, // 1: Récap, 2: Informations, 3: Confirmation
    cartWarning: '',
    cartError: '',
    cartSubmitting: false,

    // Informations client (Étape 2) — formulaire complet parent+enfant
    rememberInfo: false,
    customerInfo: {
        notify_price_drops: false,
        // Parent (obligatoire)
        parent_prenom: '',
        parent_nom: '',
        parent_email: '',
        parent_telephone: '',
        // Enfant (prénom+nom obligatoires)
        enfant_prenom: '',
        enfant_nom: '',
        enfant_email: '',
        enfant_telephone: '',
        // Personnalisation USB
        usb_prenom: '',
        usb_nom: '',
        // Personnalisation T-shirt
        tshirt_prenom: '',
        tshirt_nom: '',
        tshirt_taille: '',
        personnalisation: '',
        // Remarques libres
        remarques: '',
    },
    rgpdConsent: false,

    async init() {
        this.loadCookiePreferences();
        this.loadCartFromStorage();
        this.loadSavedCustomerInfo();
        await Promise.all([
            this.loadPreorderStatus(),
            this.loadSiteLogo(),
            this.loadCatalog()
        ]);
        this.validateCartAgainstCatalog();
    },

    async loadSiteLogo() {
        try {
            const response = await fetch('/api/logo', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data.success || typeof data.url !== 'string') {
                throw new Error('Réponse logo invalide.');
            }

            const logoUrl = new URL(data.url, window.location.origin);
            logoUrl.searchParams.set('t', Date.now().toString());
            const absoluteLogoUrl = logoUrl.href;
            const favicon = document.getElementById('dynamic-favicon');
            if (favicon) {
                favicon.href = absoluteLogoUrl;
                const extension = logoUrl.pathname.split('.').pop()?.toLowerCase();
                const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' };
                if (extension && mimeTypes[extension]) favicon.type = mimeTypes[extension];
            }
            const appleIcon = document.getElementById('dynamic-apple-icon');
            if (appleIcon) appleIcon.href = absoluteLogoUrl;
            const ogImage = document.getElementById('og-image');
            if (ogImage) ogImage.content = absoluteLogoUrl;
        } catch (error) {
            console.error('Erreur récupération du logo du site :', error);
        }
    },

    // ─── Helper Formateur de Prix ────────────────────────────────────────────
    formatPrice(price) {
        if (price === null || price === undefined) return 'Prix non disponible';
        return `${Number(price).toFixed(2).replace('.', ',')} €`;
    },

    loadCookiePreferences() {
        try {
            const saved = localStorage.getItem('acelspace-cookie-preferences');
            if (!saved) return;
            const preferences = JSON.parse(saved);
            if (preferences && typeof preferences.analytics === 'boolean') {
                this.cookiePreferences = { essential: true, analytics: preferences.analytics };
                this.cookieConsentSaved = true;
            }
        } catch (error) {
            console.error('Impossible de lire les préférences de cookies :', error);
            this.cookiePreferencesError = 'Impossible de lire vos préférences de confidentialité.';
        }
    },

    saveCookiePreferences(analytics) {
        this.cookiePreferences = { essential: true, analytics };
        try {
            localStorage.setItem('acelspace-cookie-preferences', JSON.stringify(this.cookiePreferences));
            this.cookieConsentSaved = true;
            this.cookiePreferencesOpen = false;
            this.cookiePreferencesError = '';
        } catch (error) {
            console.error('Impossible d’enregistrer les préférences de cookies :', error);
            this.cookieConsentSaved = false;
            this.cookiePreferencesError = 'Impossible d’enregistrer votre choix dans ce navigateur. Vérifiez ses paramètres de stockage.';
        }
    },

    openCookiePreferences() {
        this.cookiePreferencesOpen = true;
    },

    getCookiePreferences() {
        return this.cookiePreferences;
    },

    openTrackingModal() {
        this.trackingEmail = '';
        this.trackingCode = '';
        this.trackingReference = '';
        this.trackingCodeSent = false;
        this.trackingResults = [];
        this.trackingError = '';
        this.trackingNotice = '';
        this.trackingSearched = false;
        this.isTrackingModalOpen = true;
    },

    async requestTrackingCode() {
        this.trackingError = '';
        this.trackingNotice = '';
        this.trackingResults = [];
        this.trackingSearched = false;
        const email = this.trackingEmail.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
            this.trackingError = 'Saisissez l’adresse e-mail utilisée pour la commande.';
            return;
        }

        this.trackingLoading = true;
        try {
            const response = await fetch('/api/precommandes/suivi/code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                this.trackingError = data.message || 'Impossible de demander un code de suivi.';
                return;
            }
            this.trackingCodeSent = true;
            this.trackingNotice = data.message || 'Si une commande correspond à cette adresse, un code vient d’être envoyé.';
        } catch (error) {
            console.error('Erreur demande code suivi commande :', error);
            this.trackingError = 'Impossible de contacter le serveur. Vérifiez votre connexion.';
        } finally {
            this.trackingLoading = false;
        }
    },

    async trackOrder() {
        this.trackingError = '';
        this.trackingNotice = '';
        this.trackingResults = [];
        this.trackingSearched = false;
        const email = this.trackingEmail.trim();
        const code = this.trackingCode.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
            this.trackingError = 'Saisissez l’adresse e-mail et le code à 6 chiffres reçu.';
            return;
        }

        this.trackingLoading = true;
        try {
            const response = await fetch('/api/precommandes/suivi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code, reference: this.trackingReference.trim() })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                this.trackingError = data.message || 'Impossible de rechercher les commandes.';
                return;
            }
            this.trackingResults = data.commandes || [];
            this.trackingSearched = true;
        } catch (error) {
            console.error('Erreur recherche suivi commande :', error);
            this.trackingError = 'Impossible de contacter le serveur. Vérifiez votre connexion.';
        } finally {
            this.trackingLoading = false;
        }
    },

    trackingStatusLabel(status) {
        return {
            EN_ATTENTE_PAIEMENT: 'En attente de paiement',
            PAYE: 'Payé',
            EN_COMMANDE: 'En commande chez le fournisseur',
            PRET_AU_LOCAL: 'Prêt au local',
            REMIS: 'Remis au client'
        }[status] || status;
    },

    trackingStatusClass(status) {
        return {
            en_attente: 'bg-amber-100 text-amber-950 border-amber-800',
            confirmee: 'bg-sky-100 text-sky-950 border-sky-800',
            livree: 'bg-emerald-100 text-emerald-950 border-emerald-800',
            annulee: 'bg-red-100 text-red-950 border-red-800'
        }[status] || 'bg-slate-100 text-slate-900 border-slate-700';
    },

    formatTrackingDate(date) {
        if (!date) return '-';
        const parsed = new Date(date);
        return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString('fr-FR');
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
        this.currentImageIndex = 0;
        this.selectedTaille = (product.sizes && product.sizes.length > 0) ? product.sizes[0] : 'Taille unique';
        this.selectedQuantite = 1;
        this.noCustomization = false;
        this.justAddedFeedback = false;
        this.isProductModalOpen = true;
    },

    openLightbox(img1, img2 = null, initialIndex = 0) {
        this.lightboxImage = img1 || '';
        this.lightboxImage2 = img2 || '';
        this.currentLightboxIndex = this.lightboxImage2 && initialIndex === 1 ? 1 : 0;
        this.lightboxOpen = true;
    },

    closeLightbox() {
        this.lightboxOpen = false;
    },

    toggleLightboxImage() {
        if (this.lightboxImage2) {
            this.currentLightboxIndex = this.currentLightboxIndex === 0 ? 1 : 0;
        }
    },

    // ─── Gestion du Panier (localStorage) ───────────────────────────────────
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
                    this.customerInfo.parent_prenom = parsed.parent_prenom || '';
                    this.customerInfo.parent_nom = parsed.parent_nom || '';
                    this.customerInfo.parent_email = parsed.parent_email || '';
                    this.customerInfo.parent_telephone = parsed.parent_telephone || '';
                    this.rememberInfo = false;
                }
            }
        } catch (e) {
            console.warn('Erreur lecture user info localStorage :', e);
        }
    },

    // Validation du panier par rapport au catalogue actif et disponibilité du prix
    validateCartAgainstCatalog() {
        if (!this.allProductsList || this.allProductsList.length === 0) return;

        let removedCount = 0;
        let priceNullCount = 0;
        const validCart = [];

        for (const item of this.cart) {
            const prod = this.allProductsList.find(p => p.id === item.product_id);
            if (!prod) {
                removedCount++;
                continue;
            }
            if (prod.price === null) {
                priceNullCount++;
                continue;
            }
            let taille = item.taille;
            const legacyNoCustomization = taille === 'SANS PERSONNALISATION';
            if (legacyNoCustomization) {
                taille = prod.sizes?.find(size => size !== 'SANS PERSONNALISATION') || 'Taille unique';
            }
            if (prod.sizes && prod.sizes.length > 0 && !prod.sizes.includes(taille)) {
                taille = prod.sizes[0];
            }
            validCart.push({
                product_id: item.product_id,
                taille: taille,
                quantite: Math.max(1, Math.min(10, parseInt(item.quantite, 10) || 1)),
                noCustomization: Boolean(
                    (item.noCustomization || legacyNoCustomization)
                    && Number(prod.requires_customization) === 1
                    && Number(prod.allow_no_customization) === 1
                )
            });
        }

        if (removedCount > 0 || priceNullCount > 0) {
            const totalRemoved = removedCount + priceNullCount;
            this.cartWarning = `${totalRemoved} article(s) de votre précommande n'étaient plus disponibles ou n'ont pas de prix fixé et ont été retirés.`;
        }
        this.cart = validCart;
        this.saveCartToStorage();
    },

    addToCart(product) {
        if (!this.preorderStatus.ouvert) return;
        if (!product || product.price === null) return;

        const qty = parseInt(this.selectedQuantite, 10);
        if (isNaN(qty) || qty < 1 || qty > 10) {
            return;
        }

        const taille = this.selectedTaille || 'Taille unique';
        const noCustomization = Boolean(
            this.noCustomization
            && Number(product.requires_customization) === 1
            && Number(product.allow_no_customization) === 1
        );

        const existingIndex = this.cart.findIndex(i =>
            i.product_id === product.id && i.taille === taille && Boolean(i.noCustomization) === noCustomization
        );

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
                quantite: qty,
                noCustomization
            });
        }

        this.saveCartToStorage();

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
                price: null,
                image: '',
                sizes: ['Taille unique']
            };
            const qty = parseInt(item.quantite, 10) || 1;
            const unitPrice = product.current_price ?? product.price;
            const linePrice = unitPrice !== null ? Math.round(unitPrice * qty * 100) / 100 : 0;
            return {
                index,
                product_id: item.product_id,
                taille: item.taille,
                noCustomization: item.noCustomization === true,
                quantite: qty,
                name: product.name,
                requiresCustomization: Number(product.requires_customization) === 1,
                unitPrice: unitPrice,
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

        const personnalisation = this.cartRequiresCustomization
            ? (this.customerInfo.personnalisation || '').trim()
            : '';
        if (this.cartRequiresCustomization && !personnalisation) {
            this.cartError = 'Veuillez renseigner la personnalisation obligatoire pour votre panier.';
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const phoneRegex = /^\+?[0-9\s.\-_()]+$/;

        // ── Validation Parent
        const parentPrenom = (this.customerInfo.parent_prenom || '').trim();
        const parentNom = (this.customerInfo.parent_nom || '').trim();
        if (!parentPrenom || !parentNom) {
            this.cartError = 'Veuillez saisir le prénom et nom du parent.';
            return;
        }
        const parentEmail = (this.customerInfo.parent_email || '').trim().toLowerCase();
        if (!parentEmail || !emailRegex.test(parentEmail)) {
            this.cartError = 'Veuillez saisir une adresse email valide pour le parent.';
            return;
        }
        const parentTel = (this.customerInfo.parent_telephone || '').trim();
        const parentTelDigits = parentTel.replace(/\D/g, '');
        if (!parentTel || !phoneRegex.test(parentTel) || parentTelDigits.length < 8 || parentTelDigits.length > 15) {
            this.cartError = 'Veuillez saisir un numéro de téléphone valide pour le parent.';
            return;
        }

        // ── Validation Enfant
        const enfantPrenom = (this.customerInfo.enfant_prenom || '').trim();
        const enfantNom = (this.customerInfo.enfant_nom || '').trim();
        if (!enfantPrenom || !enfantNom) {
            this.cartError = "Veuillez saisir le prénom et nom de l'enfant.";
            return;
        }

        // ── Validation personnalisation selon types des produits dans le panier
        const cartProductTypes = this.cart.map(item => {
            const p = this.getProductDetails(item.product_id);
            return p ? (p.type || p.product_type || '') : '';
        });
        const hasUsb = cartProductTypes.some(t => t === 'usb');
        const hasTshirt = cartProductTypes.some(t => t === 'tshirt');

        if (hasUsb) {
            if (!this.customerInfo.usb_prenom.trim() || !this.customerInfo.usb_nom.trim()) {
                this.cartError = 'Veuillez remplir les champs de gravure USB (prénom et nom).';
                return;
            }
        }
        if (hasTshirt) {
            if (!this.customerInfo.tshirt_prenom.trim() || !this.customerInfo.tshirt_nom.trim() || !this.customerInfo.tshirt_taille) {
                this.cartError = 'Veuillez remplir les champs de personnalisation T-shirt (prénom, nom et taille).';
                return;
            }
        }

        if (!this.rgpdConsent) {
            this.cartError = 'Vous devez cocher la case de consentement RGPD pour valider votre précommande.';
            return;
        }

        this.cartSubmitting = true;

        try {
            const payload = {
                parent_prenom: parentPrenom,
                parent_nom: parentNom,
                parent_email: parentEmail,
                parent_telephone: parentTel,
                enfant_prenom: enfantPrenom,
                enfant_nom: enfantNom,
                enfant_email: (this.customerInfo.enfant_email || '').trim(),
                enfant_telephone: (this.customerInfo.enfant_telephone || '').trim(),
                usb_prenom: (this.customerInfo.usb_prenom || '').trim(),
                usb_nom: (this.customerInfo.usb_nom || '').trim(),
                tshirt_prenom: (this.customerInfo.tshirt_prenom || '').trim(),
                tshirt_nom: (this.customerInfo.tshirt_nom || '').trim(),
                tshirt_taille: (this.customerInfo.tshirt_taille || '').trim(),
                personnalisation,
                remarques: (this.customerInfo.remarques || '').trim(),
                notify_price_drops: this.customerInfo.notify_price_drops === true,
                consentement: true,
                lignes: this.cart.map(item => {
                    const product = this.getProductDetails(item.product_id);
                    const isCustomizable = product
                        && (product.customizable === 1
                            || product.customizable === true
                            || Number(product.requires_customization) === 1)
                        && item.noCustomization !== true;
                    return {
                        product_id: item.product_id,
                        taille: item.taille,
                        quantite: parseInt(item.quantite, 10),
                        noCustomization: item.noCustomization === true,
                        personalization: isCustomizable ? personnalisation : null
                    };
                })
            };

            const response = await fetch('/api/precommande', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                this.cartError = data.message || 'Une erreur est survenue lors de la précommande.';
                if (response.status === 403) {
                    this.preorderStatus.ouvert = false;
                    if (data.message) this.preorderStatus.message = data.message;
                }
                return;
            }

            this.loadCatalog();

            try {
                if (this.rememberInfo) {
                    localStorage.setItem('acelspaces_user_info', JSON.stringify({
                        parent_prenom: parentPrenom,
                        parent_nom: parentNom,
                        parent_email: parentEmail,
                        parent_telephone: parentTel,
                    }));
                } else {
                    localStorage.removeItem('acelspaces_user_info');
                }
            } catch (e) {
                console.warn('Erreur persistence localStorage info :', e);
            }

            this.clearCart();
            this.rgpdConsent = false;
            this.customerInfo.enfant_prenom = '';
            this.customerInfo.enfant_nom = '';
            this.customerInfo.enfant_email = '';
            this.customerInfo.enfant_telephone = '';
            this.customerInfo.usb_prenom = '';
            this.customerInfo.usb_nom = '';
            this.customerInfo.tshirt_prenom = '';
            this.customerInfo.tshirt_nom = '';
            this.customerInfo.tshirt_taille = '';
            this.customerInfo.personnalisation = '';
            this.customerInfo.remarques = '';
            this.customerInfo.notify_price_drops = false;
            this.cartStep = 3;
        } catch (err) {
            console.error('Erreur réseau soumission précommande :', err);
            this.cartError = 'Impossible de contacter le serveur. Vérifiez votre connexion.';
        } finally {
            this.cartSubmitting = false;
        }
    },

    get cartHasUsb() {
        return this.cart.some(item => {
            const p = this.getProductDetails(item.product_id);
            return p && (p.type === 'usb' || p.product_type === 'usb');
        });
    },
    get cartHasTshirt() {
        return this.cart.some(item => {
            const p = this.getProductDetails(item.product_id);
            return p && (p.type === 'tshirt' || p.product_type === 'tshirt');
        });
    },
    get cartRequiresCustomization() {
        return this.cart.some(item => {
            const product = this.getProductDetails(item.product_id);
            return product
                && Number(product.requires_customization) === 1
                && item.noCustomization !== true;
        });
    },
    get cartCustomizationFields() {
        const fields = new Set();
        for (const item of this.cart) {
            const product = this.getProductDetails(item.product_id);
            if (!product || Number(product.requires_customization) !== 1 || item.noCustomization === true) continue;
            const label = (product.customization_fields || '').trim();
            if (label) fields.add(label);
        }
        return [...fields].join(' / ') || 'Informations à personnaliser';
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