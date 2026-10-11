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
import multer from 'multer';
import crypto from 'crypto';
import db, { formatClientId, normalizeEmail, isValidEmail, normalizePhone, isValidPhone, generateCommandeRef } from './database.js';
import { findProduct } from './products.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'acespace_secure_cookie_secret_key_2026';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || PUBLIC_ORIGIN || 'http://localhost:5173';
app.set('trust proxy', 1);
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);

// ─── Middleware
app.use(helmet({ contentSecurityPolicy: false }));
const allowedOriginsList = [PUBLIC_ORIGIN, ALLOWED_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'].filter(Boolean);
app.use(cors({
    origin: (origin, callback) => { if (!origin) return callback(null, true); if (allowedOriginsList.includes(origin)) return callback(null, true); if (!PUBLIC_ORIGIN && process.env.NODE_ENV !== 'production') return callback(null, true); return callback(null, true); },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser(COOKIE_SECRET));

// ─── Uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ─── Rate Limiters
const precommandeLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Trop de requêtes. Veuillez réessayer dans quelques minutes.' } });
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' } });
const uploadLimiter = rateLimit({ windowMs: 15*60*1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Trop de requêtes upload. Réessayez plus tard.' } });

// ─── Image upload : multer + magic bytes validation
function checkMagicBytes(buffer) {
    if (buffer[0]===0xFF&&buffer[1]===0xD8&&buffer[2]===0xFF) return 'image/jpeg';
    if (buffer[0]===0x89&&buffer[1]===0x50&&buffer[2]===0x4E&&buffer[3]===0x47) return 'image/png';
    if (buffer[0]===0x52&&buffer[1]===0x49&&buffer[2]===0x46&&buffer[3]===0x46&&buffer[8]===0x57&&buffer[9]===0x45&&buffer[10]===0x42&&buffer[11]===0x50) return 'image/webp';
    return null;
}
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2*1024*1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg','image/png','image/webp'];
        if (!allowed.includes(file.mimetype)) return cb(new Error('Type MIME non autorisé. JPEG, PNG ou WebP uniquement (SVG interdit).'));
        cb(null, true);
    }
});

// ─── Helpers
function sanitizeCSV(val, isText = false) {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (isText) { return '="' + str.replace(/"/g, '""') + '"'; }
    if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
    return '"' + str.replace(/"/g, '""') + '"';
}

function requireAdmin(req, res, next) {
    const sessionCookie = req.signedCookies.admin_session;
    if (sessionCookie && sessionCookie === 'authenticated_admin') return next();
    return res.status(401).json({ success: false, message: 'Non autorisé. Veuillez vous connecter.' });
}

function validateProductBody(body, isNew = false) {
    const errors = [];
    let parsedSizes = undefined;
    const { name, price, sizes } = body;
    if (isNew || name !== undefined) {
        if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
            errors.push('Le nom doit faire entre 1 et 60 caractères.');
        }
    }
    if (isNew || price !== undefined) {
        const priceNum = parseFloat(price);
        if (isNaN(priceNum) || priceNum <= 0 || priceNum > 100000) {
            errors.push('Le prix doit être un nombre strictement positif (max 100 000).');
        }
    }
    if (isNew || sizes !== undefined) {
        try {
            parsedSizes = Array.isArray(sizes) ? sizes : JSON.parse(sizes);
            if (!Array.isArray(parsedSizes) || parsedSizes.length === 0) throw new Error();
            for (const s of parsedSizes) {
                if (typeof s !== 'string' || s.trim().length === 0 || s.trim().length > 30) {
                    errors.push('Chaque taille doit être une chaîne non vide de 30 car. max.');
                    break;
                }
            }
        } catch {
            errors.push('Les tailles doivent être une liste JSON non vide.');
        }
    }
    return { errors, parsedSizes };
}

// ─── Routes Publiques

/** GET /api/products — produits actifs uniquement, triés par ordre */
app.get('/api/products', (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const rows = db.prepare('SELECT id, name, price, description, sizes, image, featured, ordre FROM products WHERE actif = 1 ORDER BY ordre ASC, id ASC').all();
        const products = rows.map(p => ({ ...p, sizes: JSON.parse(p.sizes || '["Taille unique"]') }));
        return res.json({ success: true, products });
    } catch(error) { console.error('Erreur GET /api/products:', error); return res.status(500).json({ success: false, message: 'Erreur catalogue.' }); }
});

/** GET /api/precommandes/status */
app.get('/api/precommandes/status', (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const rowOuvert = db.prepare("SELECT valeur FROM settings WHERE cle = 'precommandes_ouvertes'").get();
        const rowMsg = db.prepare("SELECT valeur FROM settings WHERE cle = 'message_fermeture'").get();
        return res.json({ ouvert: rowOuvert ? rowOuvert.valeur === '1' : true, message: rowMsg ? rowMsg.valeur : 'Les précommandes sont terminées. Merci !' });
    } catch(error) { console.error('Erreur status:', error); return res.status(500).json({ success: false, message: 'Erreur statut.' }); }
});

/** POST /api/precommande — multi-lignes, transaction unique, statut vérifié */
app.post('/api/precommande', precommandeLimiter, (req, res) => {
    try {
        // 1. Vérification statut des précommandes
        const rowOuvert = db.prepare("SELECT valeur FROM settings WHERE cle = 'precommandes_ouvertes'").get();
        const rowMsg = db.prepare("SELECT valeur FROM settings WHERE cle = 'message_fermeture'").get();
        const isOuvert = rowOuvert ? rowOuvert.valeur === '1' : true;
        if (!isOuvert) return res.status(403).json({ success: false, message: rowMsg ? rowMsg.valeur : 'Les précommandes sont actuellement fermées.' });

        // 2. Validation informations client
        const { nom, email, telephone, consentement, lignes } = req.body;
        const isConsented = consentement === true || consentement === 'true';
        if (!isConsented) return res.status(400).json({ success: false, message: 'Vous devez accepter la politique de confidentialité.' });
        if (!nom || typeof nom !== 'string' || nom.trim().length < 2 || nom.trim().length > 100) {
            return res.status(400).json({ success: false, message: 'Nom et prénom requis (2 à 100 caractères).' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Adresse email invalide.' });
        }
        if (!isValidPhone(telephone)) {
            return res.status(400).json({ success: false, message: 'Numéro de téléphone invalide (8 à 15 chiffres requis).' });
        }

        // 3. Validation des lignes de commande (panier)
        // Rétrocompatibilité : si un produit unique est transmis (ancienne version), on le convertit en 1 ligne
        let lignesToProcess = lignes;
        if (!Array.isArray(lignesToProcess)) {
            if (req.body.produit) {
                lignesToProcess = [{ product_id: req.body.produit, taille: req.body.taille, quantite: req.body.quantite }];
            } else {
                return res.status(400).json({ success: false, message: 'La précommande doit contenir au moins un article.' });
            }
        }

        if (lignesToProcess.length === 0 || lignesToProcess.length > 20) {
            return res.status(400).json({ success: false, message: 'La précommande doit contenir entre 1 et 20 articles.' });
        }

        // Vérification et calcul ligne par ligne
        const verifiedLines = [];
        for (const item of lignesToProcess) {
            const pid = parseInt(item.product_id, 10);
            const productInfo = findProduct(isNaN(pid) ? item.product_id : pid);
            if (!productInfo || productInfo.actif === 0) {
                return res.status(400).json({ success: false, message: 'Un des articles demandés n\'est plus disponible.' });
            }
            const qty = parseInt(item.quantite, 10);
            if (isNaN(qty) || qty < 1 || qty > 10) {
                return res.status(400).json({ success: false, message: 'La quantité de chaque article doit être comprise entre 1 et 10.' });
            }
            const cleanTaille = item.taille ? String(item.taille).trim() : 'Taille unique';
            const allowedSizes = productInfo.sizes || ['Taille unique'];
            if (!allowedSizes.includes(cleanTaille)) {
                return res.status(400).json({ success: false, message: 'Taille "' + cleanTaille + '" non disponible pour "' + productInfo.name + '".' });
            }
            const linePrice = Math.round(productInfo.price * qty * 100) / 100;
            verifiedLines.push({ product: productInfo, taille: cleanTaille, qty, linePrice });
        }

        // 4. Exécution en transaction unique (Tout ou Rien)
        const nowIso = new Date().toISOString();
        const normEmail = normalizeEmail(email);
        const normPhone = normalizePhone(telephone);
        const commandeRef = generateCommandeRef();

        db.transaction(() => {
            // Double-check de statut dans la transaction
            const checkStatus = db.prepare("SELECT valeur FROM settings WHERE cle = 'precommandes_ouvertes'").get();
            if (checkStatus && checkStatus.valeur !== '1') {
                throw new Error('PRECOMMANDES_FERMEES');
            }

            // Trouver ou créer le client
            let client = db.prepare('SELECT id FROM clients WHERE email_normalise = ?').get(normEmail);
            let clientId;
            if (client) {
                clientId = client.id;
                db.prepare('UPDATE clients SET nom = ?, telephone = ?, contact = ? WHERE id = ?').run(nom.trim(), normPhone, normEmail, clientId);
            } else {
                const r = db.prepare('INSERT INTO clients (nom, contact, contact_normalise, email, telephone, email_normalise, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?)').run(nom.trim(), normEmail, normEmail, normEmail, normPhone, normEmail, nowIso);
                clientId = r.lastInsertRowid;
            }

            // Insérer chaque ligne avec la même commande_ref
            const insertLine = db.prepare("INSERT INTO precommandes (client_id, nom, contact, email, telephone, produit, taille, quantite, prix_estime, statut, consentement, date_consentement, date_creation, product_id, commande_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', 1, ?, ?, ?, ?)");
            for (const vl of verifiedLines) {
                insertLine.run(clientId, nom.trim(), normEmail, normEmail, normPhone, vl.product.name, vl.taille, vl.qty, vl.linePrice, nowIso, nowIso, vl.product.id, commandeRef);
            }
        })();

        // Réponse publique : { success: true } uniquement
        return res.status(201).json({ success: true });
    } catch(error) {
        if (error.message === 'PRECOMMANDES_FERMEES') {
            return res.status(403).json({ success: false, message: 'Les précommandes sont actuellement fermées.' });
        }
        console.error('Erreur création précommande:', error);
        return res.status(500).json({ success: false, message: 'Une erreur interne est survenue.' });
    }
});

// ─── Routes Admin Auth
app.post('/api/admin/login', loginLimiter, (req, res) => {
    try {
        const { password } = req.body;
        if (!password || typeof password !== 'string') return res.status(400).json({ success: false, message: 'Mot de passe requis.' });
        if (!bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) return res.status(401).json({ success: false, message: 'Mot de passe incorrect.' });
        const isSecure = Boolean(process.env.PUBLIC_ORIGIN) || process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie('admin_session', 'authenticated_admin', { httpOnly: true, signed: true, sameSite: 'strict', secure: isSecure, maxAge: 24*60*60*1000 });
        return res.json({ success: true, message: 'Connexion réussie.' });
    } catch(error) { console.error('Erreur login admin:', error); return res.status(500).json({ success: false, message: 'Erreur login.' }); }
});
app.post('/api/admin/logout', (req, res) => {
    const isSecure = Boolean(process.env.PUBLIC_ORIGIN) || process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie('admin_session', { httpOnly: true, signed: true, sameSite: 'strict', secure: isSecure });
    return res.json({ success: true, message: 'Déconnexion réussie.' });
});
app.get('/api/admin/check-auth', (req, res) => {
    const sc = req.signedCookies.admin_session;
    if (sc && sc === 'authenticated_admin') return res.json({ authenticated: true });
    return res.status(401).json({ authenticated: false });
});

// ─── Routes Admin Produits
app.get('/api/admin/products', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT id, name, price, description, sizes, image, featured, actif, ordre, date_creation FROM products ORDER BY ordre ASC, id ASC').all();
        return res.json({ success: true, products: rows.map(p => ({ ...p, sizes: JSON.parse(p.sizes || '["Taille unique"]') })) });
    } catch(error) { console.error('Erreur GET /api/admin/products:', error); return res.status(500).json({ success: false, message: 'Erreur produits.' }); }
});

app.post('/api/admin/products', requireAdmin, uploadLimiter, upload.single('image'), (req, res) => {
    try {
        const { errors, parsedSizes } = validateProductBody(req.body, true);
        if (errors.length) return res.status(400).json({ success: false, message: errors.join(' ') });
        let imagePath = null;
        if (req.file) {
            const detectedMime = checkMagicBytes(req.file.buffer);
            if (!detectedMime) return res.status(400).json({ success: false, message: 'Fichier image invalide. JPEG, PNG ou WebP uniquement (SVG interdit).' });
            const ext = detectedMime === 'image/jpeg' ? 'jpg' : detectedMime === 'image/png' ? 'png' : 'webp';
            const filename = crypto.randomUUID() + '.' + ext;
            fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
            imagePath = '/uploads/' + filename;
        }
        const { name, price, description, featured } = req.body;
        const maxOrdre = db.prepare('SELECT COALESCE(MAX(ordre), 0) as m FROM products').get().m;
        const isFeatured = (featured === '1' || featured === 1 || featured === true) ? 1 : 0;
        db.transaction(() => {
            const result = db.prepare("INSERT INTO products (name, price, description, sizes, image, featured, actif, ordre, date_creation) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").run(name.trim(), parseFloat(price), description ? description.trim() : '', JSON.stringify(parsedSizes.map(s => s.trim())), imagePath, isFeatured, maxOrdre + 1, new Date().toISOString());
            if (isFeatured === 1) db.prepare('UPDATE products SET featured = 0 WHERE id != ?').run(result.lastInsertRowid);
        })();
        const allProducts = db.prepare('SELECT id, name, price, description, sizes, image, featured, actif, ordre, date_creation FROM products ORDER BY ordre ASC, id ASC').all().map(p => ({ ...p, sizes: JSON.parse(p.sizes || '["Taille unique"]') }));
        return res.status(201).json({ success: true, products: allProducts });
    } catch(error) { console.error('Erreur POST /api/admin/products:', error); return res.status(500).json({ success: false, message: 'Erreur création produit.' }); }
});

app.patch('/api/admin/products/:id/order', requireAdmin, (req, res) => {
    try {
        const { id } = req.params; const { direction } = req.body;
        if (!['up', 'down'].includes(direction)) return res.status(400).json({ success: false, message: 'Direction invalide (up ou down).' });
        db.transaction(() => {
            const current = db.prepare('SELECT id, ordre FROM products WHERE id = ?').get(id);
            if (!current) return;
            const neighbor = direction === 'up' ? db.prepare('SELECT id, ordre FROM products WHERE ordre < ? ORDER BY ordre DESC LIMIT 1').get(current.ordre) : db.prepare('SELECT id, ordre FROM products WHERE ordre > ? ORDER BY ordre ASC LIMIT 1').get(current.ordre);
            if (!neighbor) return;
            db.prepare('UPDATE products SET ordre = ? WHERE id = ?').run(neighbor.ordre, current.id);
            db.prepare('UPDATE products SET ordre = ? WHERE id = ?').run(current.ordre, neighbor.id);
        })();
        return res.json({ success: true });
    } catch(error) { console.error('Erreur order:', error); return res.status(500).json({ success: false, message: 'Erreur ordre.' }); }
});

app.patch('/api/admin/products/:id', requireAdmin, upload.single('image'), (req, res) => {
    try {
        const { id } = req.params;
        const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!existing) return res.status(404).json({ success: false, message: 'Produit non trouvé.' });
        const { name, price, description, featured, actif, ordre, sizes } = req.body;
        const { errors, parsedSizes } = validateProductBody(req.body, false);
        if (errors.length) return res.status(400).json({ success: false, message: errors.join(' ') });

        let imagePath = existing.image;
        if (req.file) {
            const detectedMime = checkMagicBytes(req.file.buffer);
            if (!detectedMime) return res.status(400).json({ success: false, message: 'Fichier image invalide. JPEG, PNG ou WebP uniquement (SVG interdit).' });
            const ext = detectedMime === 'image/jpeg' ? 'jpg' : detectedMime === 'image/png' ? 'png' : 'webp';
            const filename = crypto.randomUUID() + '.' + ext;
            fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
            if (existing.image && existing.image.startsWith('/uploads/')) { const oldFile = path.join(uploadsDir, path.basename(existing.image)); if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); }
            imagePath = '/uploads/' + filename;
        }

        let newActif = existing.actif;
        if (actif !== undefined) {
            newActif = (actif === '1' || actif === 1 || actif === true) ? 1 : 0;
        }

        let newFeatured = existing.featured;
        if (featured !== undefined) {
            const wantsFeatured = (featured === '1' || featured === 1 || featured === true) ? 1 : 0;
            if (wantsFeatured === 1 && newActif === 0) {
                return res.status(400).json({ success: false, message: 'Seul un produit actif peut être défini comme produit vedette.' });
            }
            newFeatured = wantsFeatured;
        }

        // Règle vedette : si le produit est archivé, il perd immédiatement le statut vedette
        if (newActif === 0) {
            newFeatured = 0;
        }

        db.transaction(() => {
            db.prepare('UPDATE products SET name = ?, price = ?, description = ?, sizes = ?, image = ?, featured = ?, actif = ?, ordre = ? WHERE id = ?').run(
                name !== undefined ? name.trim() : existing.name,
                price !== undefined ? parseFloat(price) : existing.price,
                description !== undefined ? description.trim() : existing.description,
                parsedSizes !== undefined ? JSON.stringify(parsedSizes.map(s => s.trim())) : existing.sizes,
                imagePath,
                newFeatured,
                newActif,
                ordre !== undefined ? parseInt(ordre, 10) : existing.ordre,
                id
            );
            if (newFeatured === 1) db.prepare('UPDATE products SET featured = 0 WHERE id != ?').run(id);
        })();

        const allProducts = db.prepare('SELECT id, name, price, description, sizes, image, featured, actif, ordre, date_creation FROM products ORDER BY ordre ASC, id ASC').all().map(p => ({ ...p, sizes: JSON.parse(p.sizes || '["Taille unique"]') }));
        return res.json({ success: true, products: allProducts });
    } catch(error) { console.error('Erreur PATCH /api/admin/products:', error); return res.status(500).json({ success: false, message: 'Erreur modification produit.' }); }
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!existing) return res.status(404).json({ success: false, message: 'Produit non trouvé.' });
        const linked = db.prepare('SELECT COUNT(*) as c FROM precommandes WHERE product_id = ?').get(id);
        if (linked && linked.c > 0) return res.status(409).json({ success: false, hasOrders: true, orderCount: linked.c, message: 'Ce produit a ' + linked.c + ' précommande(s). Suppression refusée. Vous pouvez l\'archiver (actif = 0).' });
        if (existing.image && existing.image.startsWith('/uploads/')) { const imgFile = path.join(uploadsDir, path.basename(existing.image)); if (fs.existsSync(imgFile)) fs.unlinkSync(imgFile); }
        db.prepare('DELETE FROM products WHERE id = ?').run(id);
        return res.json({ success: true, message: 'Produit supprimé avec succès.' });
    } catch(error) { console.error('Erreur DELETE produit:', error); return res.status(500).json({ success: false, message: 'Erreur suppression produit.' }); }
});

// ─── Routes Admin Précommandes (ATTENTION À L'ORDRE DES ROUTES : STATUS & REF AVANT :ID)

app.get('/api/admin/precommandes', requireAdmin, (req, res) => {
    try {
        const { search, statut, produit } = req.query;
        let query = 'SELECT p.*, c.email as client_email, c.telephone as client_telephone, c.contact_normalise FROM precommandes p LEFT JOIN clients c ON p.client_id = c.id WHERE 1=1';
        const params = [];
        if (statut && statut !== 'all') { query += ' AND p.statut = ?'; params.push(statut); }
        if (produit && produit !== 'all') { query += ' AND p.produit = ?'; params.push(produit); }
        if (search && search.trim()) {
            const trimmed = search.trim();
            const cMatch = trimmed.match(/^c-?(\d+)$/i);
            const numMatch = trimmed.match(/^(\d+)$/);
            if (cMatch) {
                const n = parseInt(cMatch[1], 10);
                query += ' AND (p.client_id = ? OR p.nom LIKE ? OR p.email LIKE ? OR p.telephone LIKE ? OR p.contact LIKE ? OR p.commande_ref LIKE ?)';
                params.push(n, '%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%');
            } else if (numMatch) {
                const n = parseInt(numMatch[1], 10);
                query += ' AND (p.client_id = ? OR p.id = ? OR p.nom LIKE ? OR p.email LIKE ? OR p.telephone LIKE ? OR p.contact LIKE ? OR p.commande_ref LIKE ?)';
                params.push(n, n, '%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%');
            } else {
                query += ' AND (p.nom LIKE ? OR p.email LIKE ? OR p.telephone LIKE ? OR p.contact LIKE ? OR p.commande_ref LIKE ?)';
                params.push('%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%', '%' + trimmed + '%');
            }
        }
        query += ' ORDER BY p.date_creation DESC, p.commande_ref DESC, p.id ASC';
        const rawPrecommandes = db.prepare(query).all(...params);
        const precommandes = rawPrecommandes.map(r => ({ ...r, client_id_formatted: formatClientId(r.client_id) }));
        const allRecords = db.prepare('SELECT client_id, produit, taille, statut, quantite, prix_estime, commande_ref FROM precommandes').all();
        const totalUQ = db.prepare('SELECT COUNT(DISTINCT client_id) as count FROM precommandes').get();
        const uniqueOrders = db.prepare('SELECT COUNT(DISTINCT COALESCE(commande_ref, id)) as count FROM precommandes').get();
        const stats = {
            totalOrders: uniqueOrders ? uniqueOrders.count : allRecords.length,
            totalLines: allRecords.length,
            totalUniqueClients: totalUQ ? totalUQ.count : 0,
            totalRevenue: allRecords.filter(r => r.statut !== 'annulee').reduce((acc, c) => acc + (c.prix_estime || 0), 0),
            byStatus: { en_attente: allRecords.filter(r => r.statut === 'en_attente').length, confirmee: allRecords.filter(r => r.statut === 'confirmee').length, livree: allRecords.filter(r => r.statut === 'livree').length, annulee: allRecords.filter(r => r.statut === 'annulee').length },
            recapByProductSize: db.prepare("SELECT produit, taille, SUM(quantite) as quantite, COUNT(*) as count, SUM(prix_estime) as total_prix FROM precommandes WHERE statut != 'annulee' GROUP BY produit, taille ORDER BY produit ASC, taille ASC").all()
        };
        return res.json({ success: true, precommandes, stats });
    } catch(error) { console.error('Erreur GET precommandes:', error); return res.status(500).json({ success: false, message: 'Erreur données.' }); }
});

/** PATCH /api/admin/precommandes/status — OBLIGATOIREMENT AVANT /:id */
app.patch('/api/admin/precommandes/status', requireAdmin, (req, res) => {
    try {
        const { ouvert, message } = req.body;
        if (typeof ouvert !== 'boolean') {
            return res.status(400).json({ success: false, message: 'Le champ "ouvert" (booléen true/false) est obligatoire.' });
        }
        if (message !== undefined && message !== null) {
            if (typeof message !== 'string' || message.length > 200) {
                return res.status(400).json({ success: false, message: 'Message invalide (max 200 caractères).' });
            }
            if (message.trim().length > 0) {
                db.prepare("INSERT INTO settings (cle, valeur) VALUES ('message_fermeture', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(message.trim());
            }
        }
        db.prepare("INSERT INTO settings (cle, valeur) VALUES ('precommandes_ouvertes', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(ouvert ? '1' : '0');
        const currentMsg = db.prepare("SELECT valeur FROM settings WHERE cle = 'message_fermeture'").get()?.valeur || 'Les précommandes sont terminées. Merci !';
        return res.json({ success: true, ouvert, message: currentMsg });
    } catch(error) { console.error('Erreur PATCH status:', error); return res.status(500).json({ success: false, message: 'Erreur serveur lors de la mise à jour du statut.' }); }
});

/** PATCH /api/admin/precommandes/ref/:commande_ref — mise à jour groupée de tout un panier */
app.patch('/api/admin/precommandes/ref/:commande_ref', requireAdmin, (req, res) => {
    try {
        const { commande_ref } = req.params; const { statut } = req.body;
        if (!['en_attente', 'confirmee', 'livree', 'annulee'].includes(statut)) {
            return res.status(400).json({ success: false, message: 'Statut invalide.' });
        }
        const info = db.prepare('UPDATE precommandes SET statut = ? WHERE commande_ref = ?').run(statut, commande_ref);
        if (info.changes === 0) return res.status(404).json({ success: false, message: 'Aucune commande trouvée pour cette référence.' });
        return res.json({ success: true, message: 'Statut mis à jour pour ' + info.changes + ' article(s).' });
    } catch(error) { console.error('Erreur PATCH commande groupée:', error); return res.status(500).json({ success: false, message: 'Erreur mise à jour.' }); }
});

/** PATCH /api/admin/precommandes/:id — mise à jour ligne individuelle */
app.patch('/api/admin/precommandes/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params; const { statut } = req.body;
        if (!['en_attente', 'confirmee', 'livree', 'annulee'].includes(statut)) return res.status(400).json({ success: false, message: 'Statut invalide.' });
        const info = db.prepare('UPDATE precommandes SET statut = ? WHERE id = ?').run(statut, id);
        if (info.changes === 0) return res.status(404).json({ success: false, message: 'Précommande non trouvée.' });
        return res.json({ success: true, message: 'Statut mis à jour.' });
    } catch(error) { console.error('Erreur PATCH precommande:', error); return res.status(500).json({ success: false, message: 'Erreur mise à jour.' }); }
});

app.delete('/api/admin/precommandes/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const result = db.transaction(() => {
            const order = db.prepare('SELECT client_id FROM precommandes WHERE id = ?').get(id);
            if (!order) return { notFound: true };
            db.prepare('DELETE FROM precommandes WHERE id = ?').run(id);
            if (order.client_id) { const rem = db.prepare('SELECT COUNT(*) as count FROM precommandes WHERE client_id = ?').get(order.client_id); if (!rem || rem.count === 0) db.prepare('DELETE FROM clients WHERE id = ?').run(order.client_id); }
            return { success: true };
        })();
        if (result.notFound) return res.status(404).json({ success: false, message: 'Précommande non trouvée.' });
        return res.json({ success: true, message: 'Précommande supprimée.' });
    } catch(error) { console.error('Erreur DELETE precommande:', error); return res.status(500).json({ success: false, message: 'Erreur suppression.' }); }
});

app.delete('/api/admin/clients/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const result = db.transaction(() => {
            const client = db.prepare('SELECT id, nom FROM clients WHERE id = ?').get(id);
            if (!client) return { notFound: true };
            const del = db.prepare('DELETE FROM precommandes WHERE client_id = ?').run(id);
            db.prepare('DELETE FROM clients WHERE id = ?').run(id);
            return { success: true, clientName: client.nom, count: del.changes };
        })();
        if (result.notFound) return res.status(404).json({ success: false, message: 'Client non trouvé.' });
        return res.json({ success: true, message: 'Client ' + formatClientId(id) + ' (' + result.clientName + ') et ses ' + result.count + ' commande(s) ont été supprimés.' });
    } catch(error) { console.error('Erreur DELETE client RGPD:', error); return res.status(500).json({ success: false, message: 'Erreur suppression client.' }); }
});

app.get('/api/admin/export', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM precommandes ORDER BY date_creation DESC, commande_ref DESC, id ASC').all();
        const headers = ['ID Ligne', 'Réf. Commande', 'Client ID', 'Date', 'Nom', 'Email', 'Téléphone', 'Produit', 'Taille', 'Quantite', 'Prix Estime', 'Statut', 'Consentement RGPD', 'Date Consentement'];
        const csvLines = [headers.map(h => sanitizeCSV(h)).join(';')];
        rows.forEach(r => {
            const fd = r.date_creation ? new Date(r.date_creation).toLocaleString('fr-FR') : '-';
            const fcd = r.date_consentement ? new Date(r.date_consentement).toLocaleString('fr-FR') : fd;
            const emailVal = r.email || r.contact || '-';
            const telVal = r.telephone || '-';
            const refVal = r.commande_ref || ('CMD-' + r.id);
            csvLines.push([r.id, refVal, formatClientId(r.client_id), fd, r.nom, sanitizeCSV(emailVal), sanitizeCSV(telVal, true), r.produit, r.taille, r.quantite, r.prix_estime, r.statut, r.consentement === 1 ? 'Oui' : 'Non', fcd].map((val, idx) => (idx === 5 || idx === 6 ? val : sanitizeCSV(val))).join(';'));
        });
        const filename = 'precommandes-acelspace-' + new Date().toISOString().slice(0, 10) + '.csv';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        return res.send('\uFEFF' + csvLines.join('\r\n'));
    } catch(error) { console.error('Erreur export CSV:', error); return res.status(500).json({ success: false, message: 'Erreur export CSV.' }); }
});

app.get('/api/admin/export-recap', requireAdmin, (req, res) => {
    try {
        const { statut, produit } = req.query;
        let query = "SELECT produit, taille, SUM(quantite) as quantite_totale, COUNT(*) as nombre_commandes, SUM(prix_estime) as total_estime FROM precommandes WHERE 1=1";
        const params = [];
        if (statut && statut !== 'all') { query += ' AND statut = ?'; params.push(statut); } else { query += " AND statut != 'annulee'"; }
        if (produit && produit !== 'all') { query += ' AND produit = ?'; params.push(produit); }
        query += ' GROUP BY produit, taille ORDER BY produit ASC, taille ASC';
        const rows = db.prepare(query).all(...params);
        const headers = ['Produit', 'Taille', 'Quantite Totale', 'Nombre Commandes', 'Total Estime'];
        const csvLines = [headers.map(h => sanitizeCSV(h)).join(';')];
        let gQty = 0, gOrd = 0, gEst = 0;
        rows.forEach(r => { gQty += r.quantite_totale || 0; gOrd += r.nombre_commandes || 0; gEst += r.total_estime || 0; csvLines.push([r.produit, r.taille, r.quantite_totale, r.nombre_commandes, r.total_estime].map(v => sanitizeCSV(v)).join(';')); });
        csvLines.push(['TOTAL GENERAL', 'Toutes tailles', gQty, gOrd, Math.round(gEst * 100) / 100].map(v => sanitizeCSV(v)).join(';'));
        const filename = 'recap-precommandes-acelspace-' + new Date().toISOString().slice(0, 10) + '.csv';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        return res.send('\uFEFF' + csvLines.join('\r\n'));
    } catch(error) { console.error('Erreur export recap:', error); return res.status(500).json({ success: false, message: 'Erreur export recap.' }); }
});

app.get('/api/admin/print-data', requireAdmin, (req, res) => {
    try {
        const { statut, produit } = req.query;
        let query = "SELECT p.id, p.client_id, p.nom, p.produit, p.taille, p.quantite, p.prix_estime, p.statut, p.date_creation, c.nom as client_nom FROM precommandes p LEFT JOIN clients c ON p.client_id = c.id WHERE p.statut != 'annulee'";
        const params = [];
        if (statut && statut !== 'all') { query += ' AND p.statut = ?'; params.push(statut); }
        if (produit && produit !== 'all') { query += ' AND p.produit = ?'; params.push(produit); }
        query += ' ORDER BY COALESCE(c.nom, p.nom) ASC, p.date_creation ASC';
        const rows = db.prepare(query).all(...params);
        const clientMap = new Map();
        rows.forEach(r => {
            const key = r.client_id ? 'client_' + r.client_id : 'legacy_' + (r.nom || '').trim().toLowerCase();
            const displayName = (r.client_nom || r.nom || 'CLIENT').trim().toUpperCase();
            if (!clientMap.has(key)) clientMap.set(key, { clientId: r.client_id, clientIdFormatted: formatClientId(r.client_id), nom: displayName, itemsMap: new Map(), total: 0 });
            const cd = clientMap.get(key);
            cd.total += Number(r.prix_estime) || 0;
            const itemKey = r.produit + ':::' + (r.taille || 'Taille unique');
            if (!cd.itemsMap.has(itemKey)) cd.itemsMap.set(itemKey, { produit: r.produit, taille: r.taille || 'Taille unique', quantite: 0 });
            cd.itemsMap.get(itemKey).quantite += Number(r.quantite) || 0;
        });
        const persons = []; let grandTotal = 0;
        for (const cd of clientMap.values()) {
            const parts = [];
            for (const item of cd.itemsMap.values()) {
                const hasSize = item.taille && item.taille !== 'Taille unique';
                parts.push(item.produit + (hasSize ? ' ' + item.taille : '') + ' x' + item.quantite);
            }
            const t = Math.round(cd.total * 100) / 100;
            grandTotal += t;
            persons.push({ clientId: cd.clientId, clientIdFormatted: cd.clientIdFormatted, nom: cd.nom, commande: parts.join(', ') || '-', total: t });
        }
        persons.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
        const printDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return res.json({ success: true, data: { persons, totalPersons: persons.length, grandTotalAmount: Math.round(grandTotal * 100) / 100, printDate } });
    } catch(error) { console.error('Erreur print-data:', error); return res.status(500).json({ success: false, message: 'Erreur impression.' }); }
});

// ─── Production Static Serving
const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('/admin', (req, res) => res.sendFile(path.join(distPath, 'admin.html')));
    app.get('/admin.html', (req, res) => res.sendFile(path.join(distPath, 'admin.html')));
    app.get('/admin-print', (req, res) => res.sendFile(path.join(distPath, 'admin-print.html')));
    app.get('/admin-print.html', (req, res) => res.sendFile(path.join(distPath, 'admin-print.html')));
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) return res.sendFile(path.join(distPath, 'index.html'));
        next();
    });
}

// Multer error handler
app.use((err, req, res, next) => {
    if (err) {
        if (err.message && err.message.includes('File too large')) return res.status(400).json({ success: false, message: 'Fichier trop volumineux (2 Mo max).' });
        if (err.message && (err.message.includes('MIME') || err.code === 'LIMIT_UNEXPECTED_FILE')) return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
});

app.listen(PORT, () => {
    console.log('Serveur API ACELSPACE démarré sur http://localhost:' + PORT);
});

export default app;
