import Alpine from 'alpinejs';

Alpine.data('adminApp', () => ({
    authenticated: false,
    checkingAuth: true,
    password: '',
    loginLoading: false,
    loginError: '',

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

    filterStatut: 'all',
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

    async init() {
        await this.checkAuth();
    },

    showToast(message, type = 'success') {
        if (this.toast.timer) clearTimeout(this.toast.timer);
        this.toast = {
            show: true,
            message,
            type,
            timer: setTimeout(() => {
                this.toast.show = false;
            }, 3500)
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
                    await Promise.all([this.fetchPrecommandes(), this.fetchStatus()]);
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
                await this.fetchPrecommandes();
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
            this.showToast('Déconnexion réussie.');
        }
    },

    async fetchPrecommandes() {
        this.loading = true;
        try {
            const params = new URLSearchParams();
            if (this.filterStatut !== 'all') params.append('statut', this.filterStatut);
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
            }
        } catch (err) {
            console.error('Erreur fetch precommandes :', err);
            this.showToast('Erreur lors du chargement des précommandes.', 'error');
        } finally {
            this.loading = false;
        }
    },

    async updateStatut(order, newStatut) {
        const previousStatut = order.statut;
        order.statut = newStatut; // Optimistic update

        try {
            const res = await fetch(`/api/admin/precommandes/${order.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ statut: newStatut })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                order.statut = previousStatut;
                this.showToast(data.message || 'Échec de mise à jour du statut.', 'error');
            } else {
                this.showToast(`Statut de la commande #${order.id} mis à jour : ${newStatut}`);
                // Refresh stats
                this.fetchPrecommandes();
            }
        } catch (err) {
            console.error('Erreur update statut :', err);
            order.statut = previousStatut;
            this.showToast('Erreur réseau lors de la mise à jour.', 'error');
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
                this.showToast(data.message || 'Erreur lors de la suppression.', 'error');
            } else {
                this.showToast(`Précommande #${this.orderToDelete.id} supprimée.`);
                this.closeDeleteModal();
                await this.fetchPrecommandes();
            }
        } catch (err) {
            console.error('Erreur suppression :', err);
            this.showToast('Erreur réseau lors de la suppression.', 'error');
        } finally {
            this.deleteLoading = false;
        }
    },

    openDeleteClientModal(order) {
        if (!order || !order.client_id) return;
        // Count how many orders this client has in current list
        const clientOrders = this.precommandes.filter(o => o.client_id === order.client_id);
        this.clientToDelete = {
            id: order.client_id,
            nom: order.nom,
            contact: order.contact,
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
                this.showToast(data.message || 'Erreur lors de la suppression du client.', 'error');
            } else {
                this.showToast(data.message || `Client #${this.clientToDelete.formattedId} et ses commandes supprimés.`);
                this.closeDeleteClientModal();
                await this.fetchPrecommandes();
            }
        } catch (err) {
            console.error('Erreur suppression client RGPD :', err);
            this.showToast('Erreur réseau lors de la suppression du client.', 'error');
        } finally {
            this.deleteClientLoading = false;
        }
    },

    confirmToggleStatus() {
        this.confirmToggleModalOpen = true;
    },

    closeConfirmToggleModal() {
        this.confirmToggleModalOpen = false;
    },

    async executeToggleStatus() {
        this.statusLoading = true;
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
                this.showToast(data.message || 'Erreur lors du changement de statut.', 'error');
            } else {
                this.statusOuvert = nextStatus;
                this.showToast(nextStatus ? 'Précommandes ouvertes aux visiteurs.' : 'Précommandes fermées aux visiteurs.');
                this.closeConfirmToggleModal();
                await this.fetchStatus();
            }
        } catch (err) {
            console.error('Erreur toggle statut :', err);
            this.showToast('Erreur réseau lors de la mise à jour.', 'error');
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
                this.showToast(data.message || 'Erreur lors de l\'enregistrement du message.', 'error');
            } else {
                this.showToast('Message de fermeture enregistré.');
                await this.fetchStatus();
            }
        } catch (err) {
            console.error('Erreur save message :', err);
            this.showToast('Erreur réseau lors de l\'enregistrement.', 'error');
        } finally {
            this.statusLoading = false;
        }
    },

    exportCSV() {
        window.location.href = '/api/admin/export';
    },

    exportRecap() {
        const params = new URLSearchParams();
        if (this.filterStatut !== 'all') params.append('statut', this.filterStatut);
        if (this.filterProduit !== 'all') params.append('produit', this.filterProduit);
        const queryString = params.toString() ? `?${params.toString()}` : '';
        window.location.href = `/api/admin/export-recap${queryString}`;
    },

    exportPDF() {
        const params = new URLSearchParams();
        if (this.filterStatut !== 'all') params.append('statut', this.filterStatut);
        if (this.filterProduit !== 'all') params.append('produit', this.filterProduit);
        const queryString = params.toString() ? `?${params.toString()}` : '';
        window.open(`/admin-print.html${queryString}`, '_blank');
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
    }
}));

Alpine.start();
