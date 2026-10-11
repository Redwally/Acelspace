import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db, { normalizeContact, formatClientId } from './database.js';
import { findProduct, PRODUCTS_CATALOG } from './products.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'acespace_secure_cookie_secret_key_2026';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || PUBLIC_ORIGIN || 'http://localhost:5173';

// ─── Reverse Proxy / Tunnel Setup ───────────────────────────────────────────
// Permet de lire l'IP réelle du client et le protocole HTTPS via les en-têtes X-Forwarded-*
app.set('trust proxy', 1);

// Default admin hash for password 'admin123' if not specified in .env
const DEFAULT_HASH = '$2a$10$z7t0x.l15yO/xN7G12f2cOQpZ6Y9E6QOqm7hTjMhCsqmYp0jE3y7G'; // fallback
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false // Allow vite dev proxy and embedded scripts
}));

const allowedOriginsList = [
    PUBLIC_ORIGIN,
    ALLOWED_ORIGIN,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Requêtes same-origin ou sans header Origin (curl, requêtes internes)
        if (!origin) return callback(null, true);
        if (allowedOriginsList.includes(origin) || (PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN)) {
            return callback(null, true);
        }
        if (!PUBLIC_ORIGIN && process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        // Fallback permissif si tunnel avec sous-domaine
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
}));

app.use(express.json({ limit: '50kb' }));
app.use(cookieParser(COOKIE_SECRET));

// Rate Limiters
const precommandeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Max 20 precommandes per IP per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Trop de requêtes. Veuillez réessayer dans quelques minutes.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 login attempts per IP per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' }
});

// Helper: Neutralize and escape CSV values to prevent formula injection
function sanitizeCSV(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    // Neutralize formula injection characters (=, +, -, @, \t, \r)
    if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
}

// Helper: Authentication check
function requireAdmin(req, res, next) {
    const sessionCookie = req.signedCookies.admin_session;
    if (sessionCookie && sessionCookie === 'authenticated_admin') {
        return next();
    }
    return res.status(401).json({ success: false, message: 'Non autorisé. Veuillez vous connecter.' });
}

// ─── Routes Publiques ────────────────────────────────────────────────────────

/**
 * GET /api/precommandes/status
 * Récupère l'état d'ouverture des précommandes et le message de fermeture
 */
app.get('/api/precommandes/status', (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const rowOuvert = db.prepare("SELECT valeur FROM settings WHERE cle = 'precommandes_ouvertes'").get();
        const rowMsg = db.prepare("SELECT valeur FROM settings WHERE cle = 'message_fermeture'").get();
        return res.json({
            ouvert: rowOuvert ? rowOuvert.valeur === '1' : true,
            message: rowMsg ? rowMsg.valeur : 'Les précommandes sont terminées. Merci !'
        });
    } catch (error) {
        console.error('Erreur status precommandes :', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la récupération du statut.' });
    }
});

/**
 * POST /api/precommande
 * Création d'une nouvelle précommande avec attribution automatique de client_id unique
 */
app.post('/api/precommande', precommandeLimiter, (req, res) => {
    try {
        // Vérification de l'ouverture des précommandes
        const rowOuvert = db.prepare("SELECT valeur FROM settings WHERE cle = 'precommandes_ouvertes'").get();
        const rowMsg = db.prepare("SELECT valeur FROM settings WHERE cle = 'message_fermeture'").get();
        const isOuvert = rowOuvert ? rowOuvert.valeur === '1' : true;
        if (!isOuvert) {
            return res.status(403).json({
                success: false,
                message: rowMsg ? rowMsg.valeur : 'Les précommandes sont actuellement fermées.'
            });
        }

        const { nom, contact, produit, taille, quantite, rgpdConsent } = req.body;

        // Validation stricte du consentement RGPD (doit être explicitement true)
        if (rgpdConsent !== true) {
            return res.status(400).json({
                success: false,
                message: 'Vous devez obligatoirement accepter la politique de confidentialité pour précommander.'
            });
        }

        // Validation Nom
        if (!nom || typeof nom !== 'string' || nom.trim().length < 2 || nom.trim().length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Veuillez renseigner un nom et prénom valide (2 à 100 caractères).'
            });
        }

        // Validation Contact (Email ou Instagram)
        if (!contact || typeof contact !== 'string' || contact.trim().length < 3 || contact.trim().length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Veuillez renseigner un moyen de contact valide (email ou pseudo Instagram).'
            });
        }

        // Validation Produit & Recalcul du prix
        const productInfo = findProduct(produit);
        if (!productInfo) {
            return res.status(400).json({
                success: false,
                message: 'Produit invalide ou non disponible.'
            });
        }

        // Validation Taille
        const cleanTaille = taille ? String(taille).trim() : 'Taille unique';
        const allowedSizes = productInfo.sizes || ['Taille unique'];
        if (!allowedSizes.includes(cleanTaille) && cleanTaille !== 'Taille unique') {
            return res.status(400).json({
                success: false,
                message: `Taille "${cleanTaille}" invalide pour cet article. Tailles autorisées: ${allowedSizes.join(', ')}`
            });
        }

        // Validation Quantité
        const qty = parseInt(quantite, 10);
        if (isNaN(qty) || qty < 1 || qty > 10) {
            return res.status(400).json({
                success: false,
                message: 'La quantité doit être un nombre entier compris entre 1 et 10.'
            });
        }

        // Recalcul sécurisé du prix total
        const prixEstime = Math.round(productInfo.price * qty * 100) / 100;
        const nowIso = new Date().toISOString();
        const normContact = normalizeContact(contact);

        // Transaction atomique : Résolution / création du client unique + insertion précommande
        const orderTransaction = db.transaction(() => {
            let client = db.prepare('SELECT id FROM clients WHERE contact_normalise = ?').get(normContact);
            let clientId;

            if (client) {
                clientId = client.id;
            } else {
                const insertClient = db.prepare(`
                    INSERT INTO clients (nom, contact, contact_normalise, date_creation)
                    VALUES (?, ?, ?, ?)
                `);
                const clientResult = insertClient.run(nom.trim(), contact.trim(), normContact, nowIso);
                clientId = clientResult.lastInsertRowid;
            }

            const insertOrder = db.prepare(`
                INSERT INTO precommandes (client_id, nom, contact, produit, taille, quantite, prix_estime, statut, consentement, date_consentement, date_creation)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'en_attente', 1, ?, ?)
            `);

            insertOrder.run(
                clientId,
                nom.trim(),
                contact.trim(),
                productInfo.name,
                cleanTaille,
                qty,
                prixEstime,
                nowIso,
                nowIso
            );
        });

        orderTransaction();

        // L'ID client n'est JAMAIS renvoyé au visiteur dans la réponse publique
        return res.status(201).json({
            success: true,
            message: 'Votre précommande a été enregistrée avec succès ! Le club vous recontactera rapidement.'
        });

    } catch (error) {
        console.error('Erreur lors de la création de la précommande :', error);
        return res.status(500).json({
            success: false,
            message: 'Une erreur interne est survenue. Veuillez réessayer ultérieurement.'
        });
    }
});

// ─── Routes Admin Authentification ──────────────────────────────────────────

/**
 * POST /api/admin/login
 */
app.post('/api/admin/login', loginLimiter, (req, res) => {
    try {
        const { password } = req.body;
        if (!password || typeof password !== 'string') {
            return res.status(400).json({ success: false, message: 'Mot de passe requis.' });
        }

        const isMatch = bcrypt.compareSync(password, ADMIN_PASSWORD_HASH);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Mot de passe incorrect.' });
        }

        // Set secure HTTP-only signed session cookie (compatible HTTPS tunnel / production)
        const isSecure = Boolean(process.env.PUBLIC_ORIGIN) || process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie('admin_session', 'authenticated_admin', {
            httpOnly: true,
            signed: true,
            sameSite: 'strict',
            secure: isSecure,
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        return res.json({ success: true, message: 'Connexion réussie.' });
    } catch (error) {
        console.error('Erreur login admin :', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la connexion.' });
    }
});

/**
 * POST /api/admin/logout
 */
app.post('/api/admin/logout', (req, res) => {
    const isSecure = Boolean(process.env.PUBLIC_ORIGIN) || process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie('admin_session', {
        httpOnly: true,
        signed: true,
        sameSite: 'strict',
        secure: isSecure
    });
    return res.json({ success: true, message: 'Déconnexion réussie.' });
});

/**
 * GET /api/admin/check-auth
 */
app.get('/api/admin/check-auth', (req, res) => {
    const sessionCookie = req.signedCookies.admin_session;
    if (sessionCookie && sessionCookie === 'authenticated_admin') {
        return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
});

// ─── Routes Admin Protégées ─────────────────────────────────────────────────

/**
 * GET /api/admin/precommandes
 * Liste des précommandes avec recherche (supportant format C-001 / ID), filtres et statistiques
 */
app.get('/api/admin/precommandes', requireAdmin, (req, res) => {
    try {
        const { search, statut, produit } = req.query;

        let query = `
            SELECT p.*, c.contact_normalise
            FROM precommandes p
            LEFT JOIN clients c ON p.client_id = c.id
            WHERE 1=1
        `;
        const params = [];

        if (statut && statut !== 'all') {
            query += ' AND p.statut = ?';
            params.push(statut);
        }

        if (produit && produit !== 'all') {
            query += ' AND p.produit = ?';
            params.push(produit);
        }

        if (search && search.trim()) {
            const trimmed = search.trim();
            const cMatch = trimmed.match(/^c-?(\d+)$/i);
            const numMatch = trimmed.match(/^(\d+)$/);

            if (cMatch) {
                const idNum = parseInt(cMatch[1], 10);
                query += ' AND (p.client_id = ? OR p.nom LIKE ? OR p.contact LIKE ?)';
                params.push(idNum, `%${trimmed}%`, `%${trimmed}%`);
            } else if (numMatch) {
                const idNum = parseInt(numMatch[1], 10);
                query += ' AND (p.client_id = ? OR p.id = ? OR p.nom LIKE ? OR p.contact LIKE ?)';
                params.push(idNum, idNum, `%${trimmed}%`, `%${trimmed}%`);
            } else {
                query += ' AND (p.nom LIKE ? OR p.contact LIKE ?)';
                const term = `%${trimmed}%`;
                params.push(term, term);
            }
        }

        query += ' ORDER BY p.date_creation DESC';

        const rawPrecommandes = db.prepare(query).all(...params);
        const precommandes = rawPrecommandes.map(r => ({
            ...r,
            client_id_formatted: formatClientId(r.client_id)
        }));

        // Calculate summary statistics over ALL records
        const allRecords = db.prepare('SELECT client_id, produit, taille, statut, quantite, prix_estime FROM precommandes').all();
        const totalUniqueClientsRow = db.prepare('SELECT COUNT(DISTINCT client_id) as count FROM precommandes').get();

        const stats = {
            totalOrders: allRecords.length,
            totalUniqueClients: totalUniqueClientsRow ? totalUniqueClientsRow.count : 0,
            totalRevenue: allRecords.filter(r => r.statut !== 'annulee').reduce((acc, curr) => acc + (curr.prix_estime || 0), 0),
            byStatus: {
                en_attente: allRecords.filter(r => r.statut === 'en_attente').length,
                confirmee: allRecords.filter(r => r.statut === 'confirmee').length,
                livree: allRecords.filter(r => r.statut === 'livree').length,
                annulee: allRecords.filter(r => r.statut === 'annulee').length
            },
            recapByProductSize: []
        };

        // Group active orders (excluding 'annulee') by produit + taille
        const recapRows = db.prepare(`
            SELECT produit, taille, SUM(quantite) as quantite, COUNT(*) as count, SUM(prix_estime) as total_prix
            FROM precommandes
            WHERE statut != 'annulee'
            GROUP BY produit, taille
            ORDER BY produit ASC, taille ASC
        `).all();

        stats.recapByProductSize = recapRows;

        return res.json({
            success: true,
            precommandes,
            stats
        });
    } catch (error) {
        console.error('Erreur récupération précommandes :', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la récupération des données.' });
    }
});

/**
 * PATCH /api/admin/precommandes/:id
 * Mise à jour du statut d'une précommande
 */
app.patch('/api/admin/precommandes/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { statut } = req.body;

        const validStatuts = ['en_attente', 'confirmee', 'livree', 'annulee'];
        if (!validStatuts.includes(statut)) {
            return res.status(400).json({
                success: false,
                message: `Statut invalide. Statuts valides: ${validStatuts.join(', ')}`
            });
        }

        const updateStmt = db.prepare('UPDATE precommandes SET statut = ? WHERE id = ?');
        const info = updateStmt.run(statut, id);

        if (info.changes === 0) {
            return res.status(404).json({ success: false, message: 'Précommande non trouvée.' });
        }

        return res.json({ success: true, message: 'Statut mis à jour avec succès.' });
    } catch (error) {
        console.error('Erreur mise à jour précommande :', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour.' });
    }
});

/**
 * DELETE /api/admin/precommandes/:id
 * Suppression d'une précommande + nettoyage du client orphelin si aucune autre commande
 */
app.delete('/api/admin/precommandes/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;

        const deleteTx = db.transaction(() => {
            const order = db.prepare('SELECT client_id FROM precommandes WHERE id = ?').get(id);
            if (!order) return { notFound: true };

            const clientId = order.client_id;
            db.prepare('DELETE FROM precommandes WHERE id = ?').run(id);

            // Si la dernière précommande d'un client est supprimée, supprimer aussi le client
            if (clientId) {
                const remaining = db.prepare('SELECT COUNT(*) as count FROM precommandes WHERE client_id = ?').get(clientId);
                if (!remaining || remaining.count === 0) {
                    db.prepare('DELETE FROM clients WHERE id = ?').run(clientId);
                }
            }
            return { success: true };
        });

        const result = deleteTx();
        if (result.notFound) {
            return res.status(404).json({ success: false, message: 'Précommande non trouvée.' });
        }

        return res.json({ success: true, message: 'Précommande supprimée avec succès.' });
    } catch (error) {
        console.error('Erreur suppression précommande :', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la suppression.' });
    }
});

/**
 * DELETE /api/admin/clients/:id
 * Droit à l'effacement RGPD : Supprime le client ET toutes ses précommandes
 */
app.delete('/api/admin/clients/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;

        const deleteClientTx = db.transaction(() => {
            const client = db.prepare('SELECT id, nom FROM clients WHERE id = ?').get(id);
            if (!client) return { notFound: true };

            const deletedOrders = db.prepare('DELETE FROM precommandes WHERE client_id = ?').run(id);
            db.prepare('DELETE FROM clients WHERE id = ?').run(id);

            return { success: true, clientName: client.nom, count: deletedOrders.changes };
        });

        const result = deleteClientTx();
        if (result.notFound) {
            return res.status(404).json({ success: false, message: 'Client non trouvé.' });
        }

        return res.json({
            success: true,
            message: `Client ${formatClientId(id)} (${result.clientName}) et ses ${result.count} commande(s) ont été définitivement supprimés.`
        });
    } catch (error) {
        console.error('Erreur suppression client RGPD :', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la suppression du client.' });
    }
});

/**
 * GET /api/admin/export
 * Export complet des précommandes au format CSV (avec Client ID, RGPD et protection anti-injection)
 */
app.get('/api/admin/export', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM precommandes ORDER BY date_creation DESC').all();

        // CSV Header
        const headers = [
            'ID Commande',
            'Client ID',
            'Date',
            'Nom',
            'Contact',
            'Produit',
            'Taille',
            'Quantite',
            'Prix Estime ($)',
            'Statut',
            'Consentement RGPD',
            'Date Consentement'
        ];

        const csvLines = [
            headers.map(sanitizeCSV).join(';')
        ];

        rows.forEach(r => {
            const formattedDate = r.date_creation ? new Date(r.date_creation).toLocaleString('fr-FR') : '-';
            const formattedConsentDate = r.date_consentement ? new Date(r.date_consentement).toLocaleString('fr-FR') : formattedDate;
            const line = [
                r.id,
                formatClientId(r.client_id),
                formattedDate,
                r.nom,
                r.contact,
                r.produit,
                r.taille,
                r.quantite,
                r.prix_estime,
                r.statut,
                r.consentement === 1 ? 'Oui' : 'Non',
                formattedConsentDate
            ].map(sanitizeCSV).join(';');
            csvLines.push(line);
        });

        const csvContent = '\uFEFF' + csvLines.join('\r\n'); // UTF-8 BOM for Excel FR
        const filename = `precommandes-acelspace-${new Date().toISOString().slice(0, 10)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csvContent);
    } catch (error) {
        console.error('Erreur export CSV :', error);
        return res.status(500).json({ success: false, message: "Erreur lors de l'export CSV." });
    }
});

/**
 * GET /api/admin/export-recap
 * Export groupé par Produit + Taille (hors annulées, avec ligne TOTAL)
 */
app.get('/api/admin/export-recap', requireAdmin, (req, res) => {
    try {
        const { statut, produit } = req.query;

        let query = `
            SELECT produit, taille, SUM(quantite) as quantite_totale, COUNT(*) as nombre_commandes, SUM(prix_estime) as total_estime
            FROM precommandes
            WHERE 1=1
        `;
        const params = [];

        if (statut && statut !== 'all') {
            query += ' AND statut = ?';
            params.push(statut);
        } else {
            query += " AND statut != 'annulee'";
        }

        if (produit && produit !== 'all') {
            query += ' AND produit = ?';
            params.push(produit);
        }

        query += ' GROUP BY produit, taille ORDER BY produit ASC, taille ASC';

        const rows = db.prepare(query).all(...params);

        const headers = ['Produit', 'Taille', 'Quantite Totale', 'Nombre de Commandes', 'Total Estime ($)'];

        const csvLines = [
            headers.map(sanitizeCSV).join(';')
        ];

        let grandTotalQty = 0;
        let grandTotalOrders = 0;
        let grandTotalEstime = 0;

        rows.forEach(r => {
            grandTotalQty += r.quantite_totale || 0;
            grandTotalOrders += r.nombre_commandes || 0;
            grandTotalEstime += r.total_estime || 0;

            const line = [
                r.produit,
                r.taille,
                r.quantite_totale,
                r.nombre_commandes,
                r.total_estime
            ].map(sanitizeCSV).join(';');
            csvLines.push(line);
        });

        // Ligne TOTAL à la fin
        const totalLine = [
            'TOTAL GENERAL',
            'Toutes tailles',
            grandTotalQty,
            grandTotalOrders,
            Math.round(grandTotalEstime * 100) / 100
        ].map(sanitizeCSV).join(';');
        csvLines.push(totalLine);

        const csvContent = '\uFEFF' + csvLines.join('\r\n'); // UTF-8 BOM for Excel FR
        const filename = `recap-precommandes-acelspace-${new Date().toISOString().slice(0, 10)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csvContent);
    } catch (error) {
        console.error('Erreur export recap CSV :', error);
        return res.status(500).json({ success: false, message: "Erreur lors de l'export du récapitulatif." });
    }
});

/**
 * PATCH /api/admin/precommandes/status
 * Activer ou désactiver les précommandes et configurer le message de fermeture
 */
app.patch('/api/admin/precommandes/status', requireAdmin, (req, res) => {
    try {
        const { ouvert, message } = req.body;
        if (typeof ouvert !== 'boolean') {
            return res.status(400).json({ success: false, message: 'Champ "ouvert" (booléen) requis.' });
        }
        if (message !== undefined) {
            if (typeof message !== 'string' || message.trim().length === 0 || message.length > 200) {
                return res.status(400).json({ success: false, message: 'Message invalide (1 à 200 caractères).' });
            }
            db.prepare("INSERT INTO settings (cle, valeur) VALUES ('message_fermeture', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(message.trim());
        }
        db.prepare("INSERT INTO settings (cle, valeur) VALUES ('precommandes_ouvertes', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(ouvert ? '1' : '0');

        return res.json({ success: true, message: 'Statut des précommandes mis à jour avec succès.' });
    } catch (error) {
        console.error('Erreur mise à jour statut :', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du statut.' });
    }
});

/**
 * GET /api/admin/print-data
 * Données groupées par client_id pour l'impression de la liste de remise (exclusion annulees, aucun contact/email sur papier)
 */
app.get('/api/admin/print-data', requireAdmin, (req, res) => {
    try {
        const { statut, produit } = req.query;

        let query = `
            SELECT p.id, p.client_id, p.nom, p.produit, p.taille, p.quantite, p.prix_estime, p.statut, p.date_creation,
                   c.nom as client_nom
            FROM precommandes p
            LEFT JOIN clients c ON p.client_id = c.id
            WHERE p.statut != 'annulee'
        `;
        const params = [];

        if (statut && statut !== 'all') {
            query += ' AND p.statut = ?';
            params.push(statut);
        }

        if (produit && produit !== 'all') {
            query += ' AND p.produit = ?';
            params.push(produit);
        }

        query += ' ORDER BY COALESCE(c.nom, p.nom) ASC, p.date_creation ASC';

        const rows = db.prepare(query).all(...params);

        // Regroupement par client_id (ou fallback)
        const clientMap = new Map();

        rows.forEach(r => {
            const key = r.client_id ? `client_${r.client_id}` : `legacy_${(r.nom || '').trim().toLowerCase()}`;
            const displayName = (r.client_nom || r.nom || 'CLIENT').trim().toUpperCase();

            if (!clientMap.has(key)) {
                clientMap.set(key, {
                    clientId: r.client_id,
                    clientIdFormatted: formatClientId(r.client_id),
                    nom: displayName,
                    itemsMap: new Map(),
                    total: 0
                });
            }

            const clientData = clientMap.get(key);
            clientData.total += Number(r.prix_estime) || 0;

            const itemKey = `${r.produit}:::${r.taille || 'Taille unique'}`;
            if (!clientData.itemsMap.has(itemKey)) {
                clientData.itemsMap.set(itemKey, {
                    produit: r.produit,
                    taille: r.taille || 'Taille unique',
                    quantite: 0
                });
            }
            clientData.itemsMap.get(itemKey).quantite += Number(r.quantite) || 0;
        });

        const persons = [];
        let grandTotalAmount = 0;

        for (const clientData of clientMap.values()) {
            const commandeParts = [];
            for (const item of clientData.itemsMap.values()) {
                const hasSize = item.taille && item.taille !== 'Taille unique';
                const label = hasSize ? `${item.produit} ${item.taille}` : item.produit;
                commandeParts.push(`${label} ×${item.quantite}`);
            }

            const personTotal = Math.round(clientData.total * 100) / 100;
            grandTotalAmount += personTotal;

            persons.push({
                clientId: clientData.clientId,
                clientIdFormatted: clientData.clientIdFormatted,
                nom: clientData.nom,
                commande: commandeParts.join(', ') || '-',
                total: personTotal
            });
        }

        // Tri alphabétique strict par nom
        persons.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
        grandTotalAmount = Math.round(grandTotalAmount * 100) / 100;

        const printDate = new Date().toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        return res.json({
            success: true,
            data: {
                persons,
                totalPersons: persons.length,
                grandTotalAmount,
                printDate
            }
        });
    } catch (error) {
        console.error('Erreur récupération print-data :', error);
        return res.status(500).json({ success: false, message: 'Erreur lors du chargement des données pour impression.' });
    }
});

// ─── Production Static Serving ──────────────────────────────────────────────
const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));

    app.get('/admin', (req, res) => {
        res.sendFile(path.join(distPath, 'admin.html'));
    });
    app.get('/admin.html', (req, res) => {
        res.sendFile(path.join(distPath, 'admin.html'));
    });
    app.get('/admin-print', (req, res) => {
        res.sendFile(path.join(distPath, 'admin-print.html'));
    });
    app.get('/admin-print.html', (req, res) => {
        res.sendFile(path.join(distPath, 'admin-print.html'));
    });

    // Fallback for SPA/MPA routes in Express 5
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api')) {
            return res.sendFile(path.join(distPath, 'index.html'));
        }
        next();
    });
}

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Serveur API ACELSPACE démarré sur http://localhost:${PORT}`);
});

export default app;
