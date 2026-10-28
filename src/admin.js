import Alpine from 'alpinejs';

Alpine.data('adminApp', () => ({
    authenticated: false,
    checkingAuth: true,
    password: '',
    loginLoading: false,
    loginError: '',

    // Active navigation tab
    activeTab: 'precommandes', // 'precommandes' | 'catalogue'

    precommandes: [],
    stats: {
        totalOrders: 0,
        totalUniqueClients: 0,
        totalRevenue: 0,
        byStatus: { en_attente: 0, confirmee: 0, livree: 0, annulee: 0 },
        recapByProductSize: []
    },

    // Pre-orders Open / Closed setting
    statusOuvert: true,
    messageFermeture: 'Les précommandes sont terminées. Merci !',
    statusLoading: false,
    confirmToggleModalOpen: false,
    statusToggleError: '',

    filterStatut: 'all',
    orderStatuses: [
        { value: 'EN_ATTENTE_PAIEMENT', label: 'En attente de paiement' },
        { value: 'PAYE', label: 'Payé' },
        { value: 'EN_COMMANDE', label: 'En commande fournisseur' },
        { value: 'PRET_AU_LOCAL', label: 'Prêt au local' },
        { value: 'REMIS', label: 'Remis au client' },
        { value: 'ANNULE', label: 'Annulé' }
    ],
    filterProduit: 'all',
    searchQuery: '',
    loading: false,

    deleteModalOpen: false,
    orderToDelete: null,
    deleteLoading: false,

    // Client Delete Modal (RGPD Right to Erasure)
    deleteClientModalOpen: false,
    clientToDelete: null,
    deleteClientLoading: false,

    // ─── Catalogue Produits State ─────────────────────────────────────────────
    products: [],
    productsLoading: false,
    logoUploading: false,
    productModalOpen: false,
    productSaving: false,
    productFormError: '',
    sizeInput: '',
    productForm: {
        id: null,
        name: '',
        price: '',
        description: '',
        sizes: ['Taille unique'],
        featured: false,
        requires_customization: false,
        customization_fields: '',
        allow_no_customization: true,
        actif: 1,
        imageFile: null,
        imagePreview: null,
        currentImage: null,
        image_url_2: '',
        imageUrl2FileName: '',
        detail_table_image: '',
        detailTableImageFileName: ''
    },

    // Delete Product Modal
    deleteProductModalOpen: false,
    productToDelete: null,
    deleteProductLoading: false,
    deleteProductError: '',
    deleteProductHasOrders: false,
    deleteProductOrderCount: 0,

    // ─── Prix Dégressifs / Grilles Tarifaires State ───────────────────────────
    priceTiersModalOpen: false,
    priceTiersProduct: null,
    priceTiers: [],
    priceTiersCurrentPrice: null,
    priceTiersHistory: [],
    priceTiersLoading: false,
    priceTiersUploading: false,
    priceTiersError: '',

    toast: {
        show: false,
        message: '',
        type: 'success',
        timer: null
    },

    formatClientId(id) {
        if (id === null || id === undefined || isNaN(Number(id))) return '-';
        return `C-${String(id).padStart(3, '0')}`;
    },

    formatPrice(price) {
        if (price === null || price === undefined) return 'Prix non disponible';
        return `${Number(price).toFixed(2).replace('.', ',')} €`;
    },

    hasPersonalization(value) {
        if (typeof value !== 'string') return false;
        const normalized = value.trim().toLowerCase();
        return normalized !== '' && normalized !== 'null' && normalized !== 'undefined';
    },

    async init() {
        await Promise.all([this.checkAuth(), this.loadSiteLogo()]);
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

    showToast(message, type = 'success') {
        if (this.toast.timer) clearTimeout(this.toast.timer);
        this.toast = {
            show: true,
            message,
            type,
            timer: setTimeout(() => {
                this.toast.show = false;
            }, type === 'error' ? 5000 : 3500)
        };
    },

    async fetchStatus() {
        try {
            const res = await fetch('/api/precommandes/status', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                this.statusOuvert = Boolean(data.ouvert);
                if (data.message) {
                    this.messageFermeture = data.message;
                }
            }
        } catch (err) {
            console.error('Erreur récupération statut :', err);
        }
    },

    async checkAuth() {
        this.checkingAuth = true;
        try {
            const res = await fetch('/api/admin/check-auth');
            if (res.ok) {
                const data = await res.json();
                if (data.authenticated) {
                    this.authenticated = true;
                    await Promise.all([this.fetchPrecommandes(), this.fetchStatus(), this.fetchProducts()]);
                }
            } else {
                this.authenticated = false;
            }
        } catch (err) {
            console.error('Erreur vérification auth :', err);
            this.authenticated = false;
        } finally {
            this.checkingAuth = false;
        }
    },

    async login() {
        if (!this.password) {
            this.loginError = 'Veuillez saisir votre mot de passe.';
            return;
        }

        this.loginLoading = true;
        this.loginError = '';

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: this.password })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                this.loginError = data.message || 'Mot de passe incorrect.';
            } else {
                this.authenticated = true;
                this.password = '';
                this.showToast('Connexion réussie !');
                await Promise.all([this.fetchPrecommandes(), this.fetchStatus(), this.fetchProducts()]);
            }
        } catch (err) {
            console.error('Erreur login :', err);
            this.loginError = 'Erreur réseau. Impossible de joindre le serveur.';
        } finally {
            this.loginLoading = false;
        }
    },

    async logout() {
        try {
            await fetch('/api/admin/logout', { method: 'POST' });
        } catch (err) {
            console.error('Erreur logout :', err);
        } finally {
            this.authenticated = false;
            this.precommandes = [];
            this.products = [];
            this.showToast('Déconnexion réussie.');
        }
    },

    async fetchPrecommandes() {
        this.loading = true;
        try {
            const params = new URLSearchParams();
            if (this.filterStatut !== 'all') params.append('status', this.filterStatut);
            if (this.filterProduit !== 'all') params.append('produit', this.filterProduit);
            if (this.searchQuery.trim()) params.append('search', this.searchQuery.trim());

            const url = `/api/admin/precommandes?${params.toString()}`;
            const res = await fetch(url);

            if (res.status === 401) {
                this.authenticated = false;
                return;
            }

            const data = await res.json();
            if (data.success) {
                this.precommandes = data.precommandes || [];
                if (data.stats) {
                    this.stats = data.stats;
                }
            } else {
                this.showToast(`[${res.status}] ${data.message || 'Erreur chargement précommandes.'}`, 'error');
            }
        } catch (err) {
            console.error('Erreur fetch precommandes :', err);
            this.showToast(`Erreur réseau précommandes : ${err.message}`, 'error');
        } finally {
            this.loading = false;
        }
    },

    get groupedOrders() {
        const groups = [];
        const map = new Map();
        for (const order of this.precommandes) {
            const ref = order.commande_ref || ('CMD-' + String(order.id).padStart(4, '0'));
            if (!map.has(ref)) {
                const group = {
                    commande_ref: ref,
                    client_id: order.client_id,
                    nom: order.nom,
                    email: order.email || order.contact || '-',
                    telephone: order.telephone || '-',
                    date_creation: order.date_creation,
                    date_consentement: order.date_consentement,
                    lines: [],
                    totalPrice: 0,
                    totalQty: 0,
                    commonOrderStatus: order.status
                };
                map.set(ref, group);
                groups.push(group);
            }
            const g = map.get(ref);
            g.lines.push(order);
            g.totalPrice = Math.round((g.totalPrice + (Number(order.prix_estime) || 0)) * 100) / 100;
            g.totalQty += (Number(order.quantite) || 0);
            if (g.commonOrderStatus !== order.status) {
                g.commonOrderStatus = 'mixed';
            }
        }
        return groups;
    },

    async updateOrderStatus(order, newStatus) {
        const previousStatus = order.status;
        order.status = newStatus;

        try {
            const res = await fetch(`/api/admin/precommandes/${order.id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                order.status = previousStatus;
                this.showToast(`[${res.status}] ${data.message || 'Échec de mise à jour du statut.'}`, 'error');
            } else {
                this.showToast(`Statut de l'article mis à jour : ${data.status_label}`);
                await this.fetchPrecommandes();
            }
        } catch (err) {
            console.error('Erreur update statut :', err);
            order.status = previousStatus;
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        }
    },

    async updateAllOrderStatuses(order, event) {
        const newStatus = event.target.value;
        if (!newStatus) return;

        const relatedLines = this.precommandes.filter(line => order.commande_ref
            ? line.commande_ref === order.commande_ref
            : line.id === order.id);
        const previousStatuses = relatedLines.map(line => line.status);
        relatedLines.forEach(line => { line.status = newStatus; });

        try {
            const res = await fetch(`/api/admin/precommandes/${order.id}/status-all`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                relatedLines.forEach((line, index) => { line.status = previousStatuses[index]; });
                this.showToast(`[${res.status}] ${data.message || 'Échec de mise à jour groupée.'}`, 'error');
            } else {
                this.showToast(`Statut mis à jour pour ${data.updated_lines} article(s) : ${data.status_label}`);
                await this.fetchPrecommandes();
            }
        } catch (err) {
            console.error('Erreur update statut de toute la commande :', err);
            relatedLines.forEach((line, index) => { line.status = previousStatuses[index]; });
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        }
    },

    openDeleteModal(order) {
        this.orderToDelete = order;
        this.deleteModalOpen = true;
    },

    closeDeleteModal() {
        this.deleteModalOpen = false;
        this.orderToDelete = null;
    },

    async deleteOrder() {
        if (!this.orderToDelete) return;

        this.deleteLoading = true;
        try {
            const res = await fetch(`/api/admin/precommandes/${this.orderToDelete.id}`, {
                method: 'DELETE'
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                this.showToast(`[${res.status}] ${data.message || 'Erreur lors de la suppression.'}`, 'error');
            } else {
                this.showToast(`Précommande #${this.orderToDelete.id} supprimée.`);
                this.closeDeleteModal();
            }
        } catch (err) {
            console.error('Erreur suppression :', err);
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        } finally {
            this.deleteLoading = false;
            await this.fetchPrecommandes();
        }
    },

    openDeleteClientModal(order) {
        if (!order || !order.client_id) return;
        const clientOrders = this.precommandes.filter(o => o.client_id === order.client_id);
        this.clientToDelete = {
            id: order.client_id,
            nom: order.nom,
            email: order.email || order.contact || '-',
            telephone: order.telephone || '-',
            formattedId: this.formatClientId(order.client_id),
            count: clientOrders.length || 1
        };
        this.deleteClientModalOpen = true;
    },

    closeDeleteClientModal() {
        this.deleteClientModalOpen = false;
        this.clientToDelete = null;
    },

    async deleteClient() {
        if (!this.clientToDelete) return;

        this.deleteClientLoading = true;
        try {
            const res = await fetch(`/api/admin/clients/${this.clientToDelete.id}`, {
                method: 'DELETE'
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                this.showToast(`[${res.status}] ${data.message || 'Erreur lors de la suppression du client.'}`, 'error');
            } else {
                this.showToast(data.message || `Client #${this.clientToDelete.formattedId} et ses commandes supprimés.`);
                this.closeDeleteClientModal();
            }
        } catch (err) {
            console.error('Erreur suppression client RGPD :', err);
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        } finally {
            this.deleteClientLoading = false;
            await this.fetchPrecommandes();
        }
    },

    confirmToggleStatus() {
        this.statusToggleError = '';
        this.confirmToggleModalOpen = true;
    },

    closeConfirmToggleModal() {
        this.confirmToggleModalOpen = false;
        this.statusToggleError = '';
    },

    async executeToggleStatus() {
        this.statusLoading = true;
        this.statusToggleError = '';
        try {
            const nextStatus = !this.statusOuvert;
            const res = await fetch('/api/admin/precommandes/status', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ouvert: nextStatus,
                    message: this.messageFermeture
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                this.statusToggleError = `[${res.status}] ${data.message || 'Erreur lors du changement de statut.'}`;
                this.showToast(this.statusToggleError, 'error');
            } else {
                this.statusOuvert = Boolean(data.ouvert !== undefined ? data.ouvert : nextStatus);
                if (data.message !== undefined) this.messageFermeture = data.message;
                this.showToast(this.statusOuvert ? 'Précommandes ouvertes aux visiteurs.' : 'Précommandes fermées aux visiteurs.');
                await this.fetchStatus();
                this.closeConfirmToggleModal();
            }
        } catch (err) {
            console.error('Erreur toggle statut :', err);
            this.statusToggleError = `Erreur réseau : ${err.message}`;
            this.showToast(this.statusToggleError, 'error');
        } finally {
            this.statusLoading = false;
        }
    },

    async saveMessage() {
        if (!this.messageFermeture || !this.messageFermeture.trim()) {
            this.showToast('Le message de fermeture ne peut pas être vide.', 'error');
            return;
        }
        if (this.messageFermeture.length > 200) {
            this.showToast('Le message ne doit pas dépasser 200 caractères.', 'error');
            return;
        }

        this.statusLoading = true;
        try {
            const res = await fetch('/api/admin/precommandes/status', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ouvert: this.statusOuvert,
                    message: this.messageFermeture.trim()
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                this.showToast(`[${res.status}] ${data.message || 'Erreur lors de l\'enregistrement du message.'}`, 'error');
            } else {
                this.showToast('Message de fermeture enregistré.');
                await this.fetchStatus();
            }
        } catch (err) {
            console.error('Erreur save message :', err);
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        } finally {
            this.statusLoading = false;
        }
    },

    // ─── Catalogue Produits Methods ───────────────────────────────────────────

    async fetchProducts() {
        this.productsLoading = true;
        try {
            const res = await fetch('/api/admin/products');
            if (res.status === 401) {
                this.authenticated = false;
                return;
            }
            const data = await res.json();
            if (data.success) {
                this.products = data.products || [];
            } else {
                this.showToast(`[${res.status}] ${data.message || 'Erreur lors du chargement des produits.'}`, 'error');
            }
        } catch (err) {
            console.error('Erreur chargement catalogue admin :', err);
            this.showToast(`Erreur réseau catalogue : ${err.message}`, 'error');
        } finally {
            this.productsLoading = false;
        }
    },

    previewLogo(event) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file) return;

        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            input.value = '';
            this.showToast('Format invalide. Choisissez une image JPEG, PNG ou WebP.', 'error');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            input.value = '';
            this.showToast('Le logo ne doit pas dépasser 2 Mo.', 'error');
            return;
        }

        const preview = document.getElementById('logoPreview');
        if (preview) {
            if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
            const objectUrl = URL.createObjectURL(file);
            preview.dataset.objectUrl = objectUrl;
            preview.src = objectUrl;
        }
    },

    openProductModal(product = null) {
        this.productFormError = '';
        this.sizeInput = '';
        if (product) {
            this.productForm = {
                id: product.id,
                name: product.name,
                price: product.price,
                description: product.description || '',
                sizes: Array.isArray(product.sizes) && product.sizes.length > 0 ? [...product.sizes] : ['Taille unique'],
                featured: product.featured === 1,
                requires_customization: product.requires_customization === 1,
                customization_fields: product.customization_fields || '',
                allow_no_customization: product.allow_no_customization === 1,
                actif: product.actif,
                imageFile: null,
                imagePreview: null,
                currentImage: product.image || null,
                image_url_2: product.image_url_2 || '',
                imageUrl2FileName: '',
                detail_table_image: product.detail_table_image || '',
                detailTableImageFileName: ''
            };
        } else {
            this.productForm = {
                id: null,
                name: '',
                price: '',
                description: '',
                sizes: ['Taille unique'],
                featured: false,
                requires_customization: false,
                customization_fields: '',
                allow_no_customization: true,
                actif: 1,
                imageFile: null,
                imagePreview: null,
                currentImage: null,
                image_url_2: '',
                imageUrl2FileName: '',
                detail_table_image: '',
                detailTableImageFileName: ''
            };
        }
        this.productModalOpen = true;
    },

    onProductCustomizationToggle() {
        if (!this.productForm.requires_customization) {
            this.productForm.customization_fields = '';
        }
    },

    closeProductModal() {
        this.productModalOpen = false;
        this.productFormError = '';
    },

    addSize() {
        const val = this.sizeInput.trim();
        if (!val) return;
        if (val.length > 30) {
            this.productFormError = 'Une taille ne doit pas dépasser 30 caractères.';
            return;
        }
        if (!this.productForm.sizes.includes(val)) {
            this.productForm.sizes.push(val);
        }
        this.sizeInput = '';
        this.productFormError = '';
    },

    removeSize(index) {
        this.productForm.sizes.splice(index, 1);
        if (this.productForm.sizes.length === 0) {
            this.productForm.sizes.push('Taille unique');
        }
    },

    handleImageSelect(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            this.productFormError = 'Image trop volumineuse (max 2 Mo).';
            return;
        }

        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowed.includes(file.type)) {
            this.productFormError = 'Format image invalide. JPEG, PNG ou WebP uniquement (SVG interdit).';
            return;
        }

        this.productForm.imageFile = file;
        this.productForm.imagePreview = URL.createObjectURL(file);
        this.productFormError = '';
    },

    async handleImageUpload(event, targetField = 'image') {
        const input = event.target;
        const file = input.files && input.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            this.productFormError = 'Image trop volumineuse (max 2 Mo).';
            input.value = '';
            return;
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            this.productFormError = 'Format image invalide. JPEG, PNG ou WebP uniquement (SVG interdit).';
            input.value = '';
            return;
        }
        if (!['image', 'image_url_2', 'detail_table_image'].includes(targetField)) {
            this.productFormError = 'Champ de destination de l’image invalide.';
            input.value = '';
            return;
        }
        if (targetField === 'image_url_2') {
            this.productForm.imageUrl2FileName = file.name;
        } else if (targetField === 'detail_table_image') {
            this.productForm.detailTableImageFileName = file.name;
        }

        const formData = new FormData();
        formData.append('image', file);
        try {
            const response = await fetch('/api/admin/upload', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok || !data.success || typeof data.url !== 'string') {
                this.productFormError = data.message || 'Erreur lors du téléversement de l’image.';
                if (targetField === 'image_url_2') this.productForm.imageUrl2FileName = '';
                if (targetField === 'detail_table_image') this.productForm.detailTableImageFileName = '';
                return;
            }
            this.productForm[targetField] = data.url;
            this.productFormError = '';
        } catch (error) {
            console.error('Erreur téléversement image produit :', error);
            this.productFormError = `Erreur réseau : ${error.message}`;
            if (targetField === 'image_url_2') this.productForm.imageUrl2FileName = '';
            if (targetField === 'detail_table_image') this.productForm.detailTableImageFileName = '';
        } finally {
            input.value = '';
        }
    },

    async saveProduct() {
        this.productFormError = '';

        if (!this.productForm.name || !this.productForm.name.trim()) {
            this.productFormError = 'Le nom du produit est obligatoire (1 à 60 caractères).';
            return;
        }
        if (this.productForm.name.trim().length > 60) {
            this.productFormError = 'Le nom ne doit pas dépasser 60 caractères.';
            return;
        }

        const priceNum = parseFloat(this.productForm.price);
        if (isNaN(priceNum) || priceNum <= 0 || priceNum > 100000) {
            this.productFormError = 'Le prix doit être un nombre strictly supérieur à 0 (max 100 000).';
            return;
        }

        if (!this.productForm.sizes || this.productForm.sizes.length === 0) {
            this.productFormError = 'Au moins une taille est requise (ou "Taille unique").';
            return;
        }
        const customizationFields = (this.productForm.customization_fields || '').trim();
        if (this.productForm.requires_customization && !customizationFields) {
            this.productFormError = 'Indiquez les informations de personnalisation à demander au client.';
            return;
        }
        if (customizationFields.length > 120) {
            this.productFormError = 'Le libellé ne doit pas dépasser 120 caractères.';
            return;
        }

        this.productSaving = true;

        try {
            const formData = new FormData();
            formData.append('name', this.productForm.name.trim());
            formData.append('price', priceNum);
            formData.append('description', (this.productForm.description || '').trim());
            formData.append('sizes', JSON.stringify(this.productForm.sizes));
            formData.append('featured', this.productForm.featured ? '1' : '0');
            formData.append('requires_customization', this.productForm.requires_customization ? '1' : '0');
            formData.append('customization_fields', this.productForm.requires_customization ? customizationFields : '');
            formData.append('allow_no_customization', this.productForm.allow_no_customization ? '1' : '0');
            formData.append('image_url_2', (this.productForm.image_url_2 || '').trim());
            formData.append('detail_table_image', (this.productForm.detail_table_image || '').trim());
            if (this.productForm.imageFile) {
                formData.append('image', this.productForm.imageFile);
            }

            const url = this.productForm.id
                ? `/api/admin/products/${this.productForm.id}`
                : '/api/admin/products';
            const method = this.productForm.id ? 'PATCH' : 'POST';

            const res = await fetch(url, {
                method,
                body: formData
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                this.productFormError = `[${res.status}] ${data.message || 'Erreur lors de l\'enregistrement du produit.'}`;
            } else {
                this.closeProductModal();
                this.showToast(this.productForm.id ? 'Produit modifié avec succès !' : 'Nouveau produit ajouté !');
            }
        } catch (err) {
            console.error('Erreur enregistrement produit :', err);
            this.productFormError = `Erreur réseau : ${err.message}`;
        } finally {
            this.productSaving = false;
            await this.fetchProducts();
        }
    },

    async toggleActif(product) {
        try {
            const newActif = product.actif === 1 ? 0 : 1;
            const res = await fetch(`/api/admin/products/${product.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actif: newActif })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                this.showToast(`[${res.status}] ${data.message || 'Erreur lors du changement de statut.'}`, 'error');
            } else {
                this.showToast(`Produit "${product.name}" ${newActif === 1 ? 'réactivé' : 'archivé'}.`);
            }
        } catch (err) {
            console.error('Erreur toggle actif :', err);
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        } finally {
            await this.fetchProducts();
        }
    },

    async toggleFeatured(product) {
        try {
            const newFeatured = product.featured === 1 ? 0 : 1;
            const res = await fetch(`/api/admin/products/${product.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ featured: newFeatured })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                this.showToast(`[${res.status}] ${data.message || 'Erreur lors de la mise en vedette.'}`, 'error');
            } else {
                this.showToast(newFeatured === 1 ? `"${product.name}" est maintenant le produit vedette.` : 'Produit vedette retiré.');
            }
        } catch (err) {
            console.error('Erreur toggle vedette :', err);
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        } finally {
            await this.fetchProducts();
        }
    },

    async moveProductOrder(product, direction) {
        try {
            const res = await fetch(`/api/admin/products/${product.id}/order`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ direction })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                this.showToast(`[${res.status}] ${data.message || 'Erreur déplacement ordre.'}`, 'error');
            }
        } catch (err) {
            console.error('Erreur ordre :', err);
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        } finally {
            await this.fetchProducts();
        }
    },

    async uploadLogo() {
        if (this.logoUploading) return;

        const input = document.getElementById('logoFileInput');
        const file = input?.files?.[0];
        if (!file) {
            this.showToast('Sélectionnez un fichier logo avant de continuer.', 'error');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            this.showToast('Image trop volumineuse (max 2 Mo).', 'error');
            return;
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            this.showToast('Format invalide. JPEG, PNG ou WebP uniquement.', 'error');
            return;
        }

        this.logoUploading = true;
        const formData = new FormData();
        formData.append('logo', file);
        try {
            const res = await fetch('/api/admin/logo', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || !data.success) {
                this.showToast(data.message || 'Erreur upload logo.', 'error');
            } else {
                const preview = document.getElementById('logoPreview');
                if (preview?.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
                if (preview) {
                    delete preview.dataset.objectUrl;
                    preview.src = `/api/logo/image?t=${Date.now()}`;
                }
                await this.loadSiteLogo();
                input.value = '';
                this.showToast('Logo mis à jour !');
            }
        } catch (err) {
            console.error('Erreur upload logo :', err);
            this.showToast(`Erreur réseau : ${err.message}`, 'error');
        } finally {
            this.logoUploading = false;
        }
    },

    openDeleteProductModal(product) {
        this.productToDelete = product;
        this.deleteProductError = '';
        this.deleteProductHasOrders = false;
        this.deleteProductOrderCount = 0;
        this.deleteProductModalOpen = true;
    },

    closeDeleteProductModal() {
        this.deleteProductModalOpen = false;
        this.productToDelete = null;
        this.deleteProductError = '';
        this.deleteProductHasOrders = false;
    },

    async deleteProduct() {
        if (!this.productToDelete) return;
        this.deleteProductLoading = true;
        this.deleteProductError = '';
        try {
            const res = await fetch(`/api/admin/products/${this.productToDelete.id}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.status === 409) {
                this.deleteProductHasOrders = true;
                this.deleteProductOrderCount = data.orderCount || 1;
                this.deleteProductError = data.message || 'Ce produit est lié à des précommandes et ne peut pas être supprimé.';
            } else if (!res.ok || !data.success) {
                this.deleteProductError = `[${res.status}] ${data.message || 'Erreur lors de la suppression.'}`;
            } else {
                this.showToast('Produit et image supprimés avec succès.');
                this.closeDeleteProductModal();
            }
        } catch (err) {
            console.error('Erreur suppression produit :', err);
            this.deleteProductError = `Erreur réseau : ${err.message}`;
        } finally {
            this.deleteProductLoading = false;
            await this.fetchProducts();
        }
    },

    async archiveProductInstead() {
        if (!this.productToDelete) return;
        const target = this.productToDelete;
        this.closeDeleteProductModal();
        await this.toggleActif(target);
    },

    // ─── Prix Dégressifs Methods ──────────────────────────────────────────────

    downloadTiersTemplate() {
        window.location.href = '/api/admin/price-tiers/template';
    },

    async openPriceTiersModal(product) {
        if (!product) return;
        this.priceTiersProduct = product;
        this.priceTiersError = '';
        this.priceTiersLoading = true;
        this.priceTiersModalOpen = true;

        try {
            const res = await fetch(`/api/admin/price-tiers/${product.id}`);
            const data = await res.json();

            if (!res.ok || !data.success) {
                this.priceTiersError = data.message || 'Erreur lors de la récupération de la grille tarifaire.';
            } else {
                this.priceTiers = data.tiers || [];
                this.priceTiersCurrentPrice = data.current_price;
                this.priceTiersHistory = data.history || [];
            }
        } catch (err) {
            console.error('Erreur openPriceTiersModal :', err);
            this.priceTiersError = `Erreur réseau : ${err.message}`;
        } finally {
            this.priceTiersLoading = false;
        }
    },

    closePriceTiersModal() {
        this.priceTiersModalOpen = false;
        this.priceTiersProduct = null;
        this.priceTiers = [];
        this.priceTiersCurrentPrice = null;
        this.priceTiersHistory = [];
        this.priceTiersError = '';
    },

    async uploadTiersFile(event) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file) return;

        if (!this.priceTiersProduct) return;

        this.priceTiersUploading = true;
        this.priceTiersError = '';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`/api/admin/price-tiers/${this.priceTiersProduct.id}`, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                this.priceTiersError = data.message || 'Erreur lors de l\'envoi du fichier XLSX.';
            } else {
                this.showToast(data.message || 'Grille tarifaire mise à jour !');
                this.priceTiers = data.tiers || [];
                this.priceTiersCurrentPrice = data.current_price;
                await this.openPriceTiersModal(this.priceTiersProduct);
            }
        } catch (err) {
            console.error('Erreur uploadTiersFile :', err);
            this.priceTiersError = `Erreur réseau : ${err.message}`;
        } finally {
            this.priceTiersUploading = false;
            input.value = '';
        }
    },

    exportCSV() {
        window.location.href = '/api/admin/export';
    },

    exportRecap() {
        window.location.href = '/api/admin/export-recap';
    },

    exportPDF() {
        window.open('/admin-print.html', '_blank');
    },

    formatDate(isoString) {
        if (!isoString) return '-';
        try {
            const d = new Date(isoString);
            return d.toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return isoString;
        }
    },

    getStatutLabel(statut) {
        const map = {
            'en_attente': 'En attente',
            'confirmee': 'Confirmée',
            'livree': 'Livrée',
            'annulee': 'Annulée'
        };
        return map[statut] || statut;
    },

    getStatutBadgeClass(statut) {
        const map = {
            'en_attente': 'bg-amber-100 text-amber-900 border-amber-900',
            'confirmee': 'bg-sky-100 text-sky-900 border-sky-900',
            'livree': 'bg-emerald-100 text-emerald-900 border-emerald-900',
            'annulee': 'bg-red-100 text-red-900 border-red-900'
        };
        return map[statut] || 'bg-slate-100 text-slate-900 border-slate-900';
    },

    getOrderStatusLabel(status) {
        return this.orderStatuses.find(item => item.value === status)?.label || 'En attente de paiement';
    },

    getStatusColorClasses(status) {
        const map = {
            '': 'bg-white text-slate-800 border-slate-300',
            EN_ATTENTE_PAIEMENT: 'bg-slate-200 text-slate-800 border-slate-400 font-medium',
            PAYE: 'bg-emerald-100 text-emerald-800 border-emerald-400 font-medium',
            EN_COMMANDE: 'bg-amber-100 text-amber-800 border-amber-400 font-medium',
            PRET_AU_LOCAL: 'bg-sky-100 text-sky-800 border-sky-400 font-medium',
            REMIS: 'bg-green-200 text-green-900 border-green-500 font-medium',
            ANNULE: 'bg-rose-100 text-rose-800 border-rose-400 font-medium'
        };
        return map[status] || map[''];
    },

    getOrderStatusBadgeClass(status) {
        const map = {
            EN_ATTENTE_PAIEMENT: 'bg-amber-100 text-amber-900 border-amber-800',
            PAYE: 'bg-emerald-100 text-emerald-900 border-emerald-800',
            EN_COMMANDE: 'bg-sky-100 text-sky-900 border-sky-800',
            PRET_AU_LOCAL: 'bg-indigo-100 text-indigo-900 border-indigo-800',
            REMIS: 'bg-slate-200 text-slate-900 border-slate-600',
            ANNULE: 'bg-red-100 text-red-900 border-red-800'
        };
        return map[status] || map.EN_ATTENTE_PAIEMENT;
    }
}));

Alpine.start();