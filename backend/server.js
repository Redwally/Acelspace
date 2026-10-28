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
import XLSX from 'xlsx';
import db, { formatClientId, normalizeEmail, isValidEmail, normalizePhone, isValidPhone, generateCommandeRef, getCurrentPrice, getClientsForProduct, purgeExpiredPersonalData } from './database.js';
import { findProduct, getMaxPrice, getTierProgress } from './products.js';
import nodemailer from 'nodemailer';
import { scheduleBackups } from './backup.js';

function cleanPersonalization(value) {
    if (typeof value !== 'string') return '';
    const cleaned = value.trim();
    return cleaned && !['null', 'undefined'].includes(cleaned.toLowerCase()) ? cleaned : '';
}

// ─── Nodemailer : transporter Gmail (configuré via .env)
function createMailTransporter() {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });
}

async function sendConfirmationEmail({ to, commandeRef, parentNom, enfantNom, lignes, total }) {
    const transporter = createMailTransporter();
    if (!transporter) return { sent: false, reason: 'Email non configuré' };
    try {
        const lignesHtml = lignes.map(vl => `
            <tr>
                <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${vl.product.name}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${vl.taille}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${vl.qty}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${vl.linePrice.toFixed(2).replace('.', ',')} €</td>
            </tr>`).join('');

        const html = `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#bce0ec;margin:0;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#f6f3eb;border:2.5px solid #111827;border-radius:8px;overflow:hidden">
    <div style="background:#111827;padding:20px 24px">
        <h1 style="color:#f6f3eb;font-weight:900;font-size:22px;margin:0;text-transform:uppercase;letter-spacing:-0.5px">AcelSpace</h1>
        <p style="color:#bce0ec;font-size:12px;margin:4px 0 0;font-weight:700;text-transform:uppercase">Confirmation de précommande</p>
    </div>
    <div style="padding:24px">
        <p style="font-size:13px;color:#334155;font-weight:700">Bonjour <strong>${parentNom}</strong>,</p>
        <p style="font-size:13px;color:#334155">Votre précommande a bien été enregistrée. Le club vous recontactera dès que vos articles seront prêts.</p>
        <div style="background:#fff;border:2px solid #111827;border-radius:6px;padding:12px;margin:16px 0">
            <p style="font-size:10px;font-weight:900;text-transform:uppercase;color:#6b7280;margin:0 0 6px">Référence commande</p>
            <p style="font-size:16px;font-weight:900;color:#111827;margin:0;letter-spacing:1px">${commandeRef}</p>
        </div>
        ${enfantNom ? `<p style="font-size:12px;color:#334155;font-weight:700">Enfant concerné : <strong>${enfantNom}</strong></p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px">
            <thead>
                <tr style="background:#111827;color:#f6f3eb">
                    <th style="padding:8px;text-align:left;font-weight:900;text-transform:uppercase;font-size:10px">Article</th>
                    <th style="padding:8px;text-align:center;font-weight:900;text-transform:uppercase;font-size:10px">Taille</th>
                    <th style="padding:8px;text-align:center;font-weight:900;text-transform:uppercase;font-size:10px">Qté</th>
                    <th style="padding:8px;text-align:right;font-weight:900;text-transform:uppercase;font-size:10px">Prix</th>
                </tr>
            </thead>
            <tbody>${lignesHtml}</tbody>
        </table>
        <div style="text-align:right;margin-top:8px;padding-top:8px;border-top:2px solid #111827">
            <span style="font-weight:900;font-size:15px;color:#111827">Total estimé : ${total.toFixed(2).replace('.', ',')} €</span>
        </div>
        <div style="background:#fff3cd;border:2px solid #111827;border-radius:6px;padding:12px;margin-top:16px;font-size:12px;color:#334155;font-weight:700">
            ⚠️ Ce total est indicatif. Le paiement s'effectue directement auprès du club avant la commande passée. Vous serez contacté par email ou par téléphone pour finaliser le paiement.
        </div>
        <p style="font-size:11px;color:#6b7280;margin-top:16px">Pour annuler, envoyez un email à <strong>${process.env.GMAIL_USER}</strong> en indiquant votre référence commande.</p>
    </div>
    <div style="background:#111827;padding:12px 24px;text-align:center">
        <p style="color:#6b7280;font-size:10px;font-weight:700;margin:0;text-transform:uppercase">© 2026 AcelSpace — Paiement hors ligne</p>
    </div>
</div>
</body></html>`;

        await transporter.sendMail({
            from: `"AcelSpace Boutique" <${process.env.GMAIL_USER}>`,
            to,
            subject: `Précommande AcelSpace — ${commandeRef}`,
            html,
        });
        return { sent: true };
    } catch (err) {
        console.error('Erreur envoi email confirmation:', err.message);
        return { sent: false, reason: err.message };
    }
}

// ─── Email : changement de palier tarifaire
async function sendTierChangeEmail(product_id, old_price, new_price) {
    if (!(new_price < old_price)) return;

    const transporter = createMailTransporter();
    if (!transporter) return;

    const product = db.prepare('SELECT name FROM products WHERE id = ?').get(product_id);
    if (!product) return;

    const emails = getClientsForProduct(product_id);
    if (!emails.length) return;

    const current = getCurrentPrice(product_id);
    if (!current) return;

    for (const email of emails) {
        const row = db.prepare(`
            SELECT SUM(quantite) as qty
            FROM precommandes
            WHERE product_id = ? AND email = ? AND statut != 'annulee'
        `).get(product_id, email);
        const qty = row?.qty || 0;
        const newTotal = Math.round(new_price * qty * 100) / 100;
        const direction = new_price < old_price ? '📉 Bonne nouvelle' : '📈 Mise à jour';

        const html = `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#bce0ec;margin:0;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#f6f3eb;border:2.5px solid #111827;border-radius:8px;overflow:hidden">
    <div style="background:#111827;padding:20px 24px">
        <h1 style="color:#f6f3eb;font-weight:900;font-size:22px;margin:0;text-transform:uppercase;letter-spacing:-0.5px">AcelSpace</h1>
        <p style="color:#bce0ec;font-size:12px;margin:4px 0 0;font-weight:700;text-transform:uppercase">Changement de prix — ${product.name}</p>
    </div>
    <div style="padding:24px">
        <p style="font-size:13px;color:#334155;font-weight:700">${direction} : le prix unitaire de <strong>${product.name}</strong> vient de changer.</p>
        <div style="background:#fff;border:2px solid #111827;border-radius:6px;padding:16px;margin:16px 0;text-align:center">
            <p style="margin:0 0 8px;font-size:11px;font-weight:900;text-transform:uppercase;color:#6b7280">Ancien prix</p>
            <p style="margin:0 0 16px;font-size:22px;font-weight:900;color:#6b7280;text-decoration:line-through">${old_price.toFixed(2).replace('.', ',')} €</p>
            <p style="margin:0 0 8px;font-size:11px;font-weight:900;text-transform:uppercase;color:#111827">Nouveau prix</p>
            <p style="margin:0;font-size:28px;font-weight:900;color:#111827">${new_price.toFixed(2).replace('.', ',')} €</p>
        </div>
        ${qty > 0 ? `
        <div style="background:#e8f5e9;border:2px solid #111827;border-radius:6px;padding:12px;margin:16px 0;font-size:13px;color:#334155">
            <strong>Votre commande :</strong> ${qty} × ${new_price.toFixed(2).replace('.', ',')} € = <strong>${newTotal.toFixed(2).replace('.', ',')} €</strong>
        </div>` : ''}
        <p style="font-size:11px;color:#6b7280;margin-top:16px">Ce prix est estimatif. Le paiement s'effectue auprès du club lors de la remise des articles.</p>
    </div>
    <div style="background:#111827;padding:12px 24px;text-align:center">
        <p style="color:#6b7280;font-size:10px;font-weight:700;margin:0;text-transform:uppercase">© 2026 AcelSpace — Paiement hors ligne</p>
    </div>
</div>
</body></html>`;

        try {
            await transporter.sendMail({
                from: `"AcelSpace Boutique" <${process.env.GMAIL_USER}>`,
                to: email,
                subject: `AcelSpace — Nouveau prix pour ${product.name}`,
                html,
            });
        } catch (err) {
            console.error(`Email tier change (${email}):`, err.message);
        }
    }

    // Anti-doublon : enregistrer l'envoi pour ce palier
    db.prepare('INSERT INTO tier_notifications_sent (product_id, tier_id, sent_at) VALUES (?, ?, ?)')
        .run(product_id, current.tier_id, new Date().toISOString());
}

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
if (!COOKIE_SECRET || COOKIE_SECRET.length < 32) {
    throw new Error('COOKIE_SECRET must be configured with at least 32 random characters.');
}
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
if (!ADMIN_PASSWORD_HASH || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(ADMIN_PASSWORD_HASH)) {
    throw new Error('ADMIN_PASSWORD_HASH must be configured with a valid bcrypt hash.');
}
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN;
if (process.env.NODE_ENV === 'production' && !PUBLIC_ORIGIN) {
    throw new Error('PUBLIC_ORIGIN must be configured in production.');
}
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || PUBLIC_ORIGIN || 'http://localhost:5173';
app.set('trust proxy', 1);

// ─── Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://placehold.co'],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'", "'unsafe-eval'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        }
    }
}));
const localOrigins = process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedOriginsList = [PUBLIC_ORIGIN, ALLOWED_ORIGIN, ...localOrigins].filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOriginsList.includes(origin)) return callback(null, true);
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser(COOKIE_SECRET));

function isSafeInputValue(value, depth = 0) {
    if (depth > 6) return false;
    if (typeof value === 'string') return value.length <= 5000 && !value.includes('\0');
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 100 && value.every(item => isSafeInputValue(item, depth + 1));
    if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;

    const keys = Object.keys(value);
    return keys.length <= 100 && keys.every(key =>
        key.length <= 100
        && !['__proto__', 'prototype', 'constructor'].includes(key)
        && isSafeInputValue(value[key], depth + 1)
    );
}

app.use('/api', (req, res, next) => {
    const queryEntries = Object.entries(req.query);
    if (queryEntries.length > 30
        || queryEntries.some(([key, value]) => key.length > 100 || typeof value !== 'string' || value.length > 1000)) {
        return res.status(400).json({ success: false, message: 'Paramètres de requête invalides.' });
    }
    if (req.body !== undefined
        && (!req.body || Array.isArray(req.body) || Object.getPrototypeOf(req.body) !== Object.prototype || !isSafeInputValue(req.body))) {
        return res.status(400).json({ success: false, message: 'Corps de requête invalide.' });
    }
    return next();
});

function isAllowedRequestOrigin(req) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    const source = origin || referer;
    if (!source) return false;
    try {
        return allowedOriginsList.includes(new URL(source).origin);
    } catch {
        return false;
    }
}

app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !isAllowedRequestOrigin(req)) {
        return res.status(403).json({ success: false, message: 'Origine invalide pour cette opération.' });
    }
    return next();
});

// ─── Uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, { dotfiles: 'deny', index: false }));

// ─── Rate Limiters
const precommandeLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Trop de requêtes. Veuillez réessayer dans quelques minutes.' } });
const otpLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Trop de requêtes de suivi. Réessayez dans 15 minutes.' } });
const trackingChallenges = new Map();
const trackingLocks = new Map();
const adminSessions = new Map();
const ADMIN_SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' } });
const uploadLimiter = rateLimit({ windowMs: 15*60*1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Trop de requêtes upload. Réessayez plus tard.' } });

// ─── Image upload : multer + magic bytes validation
function checkMagicBytes(buffer) {
    if (buffer[0]===0xFF&&buffer[1]===0xD8&&buffer[2]===0xFF) return 'image/jpeg';
    if (buffer[0]===0x89&&buffer[1]===0x50&&buffer[2]===0x4E&&buffer[3]===0x47) return 'image/png';
    if (buffer[0]===0x52&&buffer[1]===0x49&&buffer[2]===0x46&&buffer[3]===0x46&&buffer[8]===0x57&&buffer[9]===0x45&&buffer[10]===0x42&&buffer[11]===0x50) return 'image/webp';
    return null;
}

// ─── XLSX upload : multer config séparée
function checkXlsxMagicBytes(buffer) {
    // ZIP/OOXML magic bytes : PK\x03\x04
    return buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2*1024*1024, fields: 30, fieldSize: 10*1024, parts: 32 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg','image/png','image/webp'];
        if (!allowed.includes(file.mimetype)) return cb(new Error('Type MIME non autorisé. JPEG, PNG ou WebP uniquement (SVG interdit).'));
        cb(null, true);
    }
});

const uploadXlsx = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500*1024, fields: 30, fieldSize: 10*1024, parts: 32 }, // 500 Ko max
    fileFilter: (req, file, cb) => {
        const allowed = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.xlsx') return cb(new Error('Extension invalide. Fichier .xlsx uniquement.'));
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
    const session = getAdminSession(req);
    if (session) {
        req.session = session;
        return next();
    }
    return res.status(401).json({ success: false, message: 'Non autorisé. Veuillez vous connecter.' });
}

function getAdminSession(req) {
    const token = req.signedCookies?.admin_session;
    if (typeof token !== 'string') return null;
    const expiresAt = adminSessions.get(token);
    if (!expiresAt) return null;
    if (expiresAt <= Date.now()) {
        adminSessions.delete(token);
        return null;
    }
    return { admin: true, expiresAt };
}

function isPositiveIntegerParam(value) {
    return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function getProductUploadPath(imageUrl) {
    const match = typeof imageUrl === 'string'
        ? imageUrl.match(/^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp))$/i)
        : null;
    if (!match) return null;
    const resolvedPath = path.resolve(uploadsDir, match[1]);
    return resolvedPath.startsWith(uploadsDir + path.sep) ? resolvedPath : null;
}

function getLogoUploadPath(imageUrl) {
    const match = typeof imageUrl === 'string'
        ? imageUrl.match(/^\/uploads\/(logo-custom\.(?:jpg|png|webp))$/)
        : null;
    return match ? path.resolve(uploadsDir, match[1]) : null;
}

function hasInvalidTextFields(body, fieldLimits) {
    return Object.entries(fieldLimits).some(([field, maxLength]) =>
        body[field] !== undefined
        && (typeof body[field] !== 'string' || body[field].length > maxLength)
    );
}

const ORDER_STATUSES = [
    { value: 'EN_ATTENTE_PAIEMENT', label: 'En attente de paiement' },
    { value: 'PAYE', label: 'Payé' },
    { value: 'EN_COMMANDE', label: 'En commande fournisseur' },
    { value: 'PRET_AU_LOCAL', label: 'Prêt au local' },
    { value: 'REMIS', label: 'Remis au client' },
    { value: 'ANNULE', label: 'Annulé' }
];
const ORDER_STATUS_LABELS = Object.fromEntries(ORDER_STATUSES.map(status => [status.value, status.label]));

function validateProductBody(body, isNew = false) {
    const errors = [];
    let parsedSizes = undefined;
    let customizationFields = undefined;
    const { name, price, sizes } = body;
    if (body.description !== undefined
        && (typeof body.description !== 'string' || body.description.length > 2000)) {
        errors.push('La description doit être un texte de 2000 caractères maximum.');
    }
    if (body.image_url_2 !== undefined
        && (typeof body.image_url_2 !== 'string' || body.image_url_2.trim().length > 1000)) {
        errors.push('La seconde image doit être une URL de 1000 caractères maximum.');
    }
    if (body.detail_table_image !== undefined
        && (typeof body.detail_table_image !== 'string' || body.detail_table_image.trim().length > 1000)) {
        errors.push('L’image du guide des tailles doit être une URL de 1000 caractères maximum.');
    }
    const allowNoCustomizationFlag = body.allow_no_customization;
    if (allowNoCustomizationFlag !== undefined
        && ![0, 1, '0', '1', true, false].includes(allowNoCustomizationFlag)) {
        errors.push('Le champ "Autoriser sans personnalisation" doit valoir 0 ou 1.');
    }
    for (const flag of ['featured', 'actif']) {
        if (body[flag] !== undefined && ![0, 1, '0', '1', true, false].includes(body[flag])) {
            errors.push(`Le champ "${flag}" doit valoir 0 ou 1.`);
        }
    }
    const customizationFlag = body.requires_customization;
    if (customizationFlag !== undefined && ![0, 1, '0', '1', true, false].includes(customizationFlag)) {
        errors.push('Le champ "Personnalisation obligatoire" doit valoir 0 ou 1.');
    }
    if (body.customization_fields !== undefined) {
        if (typeof body.customization_fields !== 'string') {
            errors.push('Les champs de personnalisation doivent être du texte.');
        } else {
            customizationFields = body.customization_fields.trim();
            if (customizationFields.length > 120) {
                errors.push('Le libellé des champs de personnalisation ne peut pas dépasser 120 caractères.');
            }
        }
    }
    const requiresCustomization = customizationFlag === true || customizationFlag === 1 || customizationFlag === '1';
    if ((isNew && requiresCustomization) || (customizationFlag !== undefined && requiresCustomization)) {
        const fields = customizationFields ?? (typeof body.customization_fields === 'string' ? body.customization_fields.trim() : '');
        if (!fields) errors.push('Précisez les champs que le client doit remplir pour la personnalisation.');
    }
    if (isNew || name !== undefined) {
        if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
            errors.push('Le nom doit faire entre 1 et 60 caractères.');
        }
    }
    if (isNew || price !== undefined) {
        const priceNum = typeof price === 'number' || typeof price === 'string' ? Number(price) : NaN;
        if (!Number.isFinite(priceNum) || priceNum <= 0 || priceNum > 100000) {
            errors.push('Le prix doit être un nombre strictement positif (max 100 000).');
        }
    }
    if (body.ordre !== undefined) {
        const ordre = typeof body.ordre === 'number' || typeof body.ordre === 'string' ? Number(body.ordre) : NaN;
        if (!Number.isSafeInteger(ordre) || ordre < 0) errors.push('L’ordre doit être un entier positif.');
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

/** GET /api/products — produits actifs + prix dynamique si grille définie */
app.get('/api/products', (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const rows = db.prepare('SELECT id, name, price, description, sizes, image, image_url_2, detail_table_image, featured, ordre, requires_customization, customization_fields, allow_no_customization FROM products WHERE actif = 1 ORDER BY ordre ASC, id ASC').all();
        const products = rows.map(p => {
            const priceInfo = getCurrentPrice(p.id);
            return {
                ...p,
                sizes: JSON.parse(p.sizes || '["Taille unique"]'),
                // Si grille définie → prix dynamique ; si pas de grille → prix fixe du produit
                price: priceInfo !== null ? priceInfo.unit_price : p.price,
                max_price: getMaxPrice(p.id, p.price),
                current_price: priceInfo !== null ? priceInfo.unit_price : p.price,
                has_price_tiers: priceInfo !== null,
                price_tier: priceInfo ? { tier_id: priceInfo.tier_id, qty_total: priceInfo.qty_total } : null,
                ...getTierProgress(p.id),
            };
        });
        return res.json({ success: true, products });
    } catch(error) {
        console.error('Erreur GET /api/products:', error);
        return res.status(500).json({ success: false, message: 'Erreur catalogue.' });
    }
});

/** GET /api/precommandes/status */
app.get('/api/precommandes/status', (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const rowOuvert = db.prepare("SELECT valeur FROM settings WHERE cle = 'precommandes_ouvertes'").get();
        const rowMsg = db.prepare("SELECT valeur FROM settings WHERE cle = 'message_fermeture'").get();
        return res.json({ ouvert: rowOuvert ? rowOuvert.valeur === '1' : true, message: rowMsg ? rowMsg.valeur : 'Les précommandes sont terminées. Merci !' });
    } catch(error) {
        console.error('Erreur status:', error);
        return res.status(500).json({ success: false, message: 'Erreur statut.' });
    }
});

app.post('/api/precommandes/suivi/code', otpLimiter, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        if (typeof req.body?.email !== 'string' || req.body.email.length > 254) {
            return res.status(400).json({ success: false, message: 'Saisissez une adresse e-mail valide.' });
        }
        const email = normalizeEmail(req.body.email);
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Saisissez une adresse e-mail valide.' });
        }
        const transporter = createMailTransporter();
        if (!transporter) {
            return res.status(503).json({ success: false, message: 'Le suivi par e-mail est temporairement indisponible.' });
        }
        const now = Date.now();
        for (const [key, challenge] of trackingChallenges) {
            if (challenge.expiresAt <= now) trackingChallenges.delete(key);
        }
        for (const [key, attemptState] of trackingLocks) {
            if (attemptState.windowExpiresAt <= now) trackingLocks.delete(key);
        }
        const attemptState = trackingLocks.get(email);
        if (attemptState?.lockedUntil > now) {
            return res.json({ success: true, message: 'Si une commande correspond à cette adresse, un code vient d’être envoyé.' });
        }
        const existingChallenge = trackingChallenges.get(email);
        if (existingChallenge && existingChallenge.resendAfter > now) {
            return res.json({ success: true, message: 'Si une commande correspond à cette adresse, un code vient d’être envoyé.' });
        }

        if (trackingChallenges.size >= 10000 && !existingChallenge) {
            return res.json({ success: true, message: 'Si une commande correspond à cette adresse, un code vient d’être envoyé.' });
        }
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        const challenge = {
            digest: crypto.createHash('sha256').update(code).digest(),
            expiresAt: now + 10 * 60 * 1000,
            resendAfter: now + 60 * 1000
        };
        trackingChallenges.set(email, challenge);

        const hasOrders = db.prepare('SELECT 1 FROM precommandes WHERE LOWER(email) = ? OR LOWER(contact) = ? LIMIT 1').get(email, email);
        if (hasOrders) {
            try {
                await transporter.sendMail({
                    from: `"AcelSpace Boutique" <${process.env.GMAIL_USER}>`,
                    to: email,
                    subject: 'Votre code de suivi AcelSpace',
                    text: `Votre code de vérification est ${code}. Il expire dans 10 minutes.`,
                    html: `<p>Votre code de vérification pour le suivi de commande AcelSpace est :</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>Ce code expire dans 10 minutes. Si vous n'avez pas demandé ce code, ignorez cet e-mail.</p>`
                });
            } catch (error) {
                trackingChallenges.delete(email);
                console.error('Erreur envoi code suivi commande:', error.message);
            }
        }
        return res.json({ success: true, message: 'Si une commande correspond à cette adresse, un code vient d’être envoyé.' });
    } catch (error) {
        console.error('Erreur POST code suivi commande:', error);
        return res.status(500).json({ success: false, message: 'Impossible de demander un code de suivi.' });
    }
});

app.post('/api/precommandes/suivi', otpLimiter, (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        if (typeof req.body?.email !== 'string' || req.body.email.length > 254) {
            return res.status(400).json({ success: false, message: 'Adresse e-mail ou code invalide.' });
        }
        const email = normalizeEmail(req.body.email);
        const code = req.body?.code;
        const referenceValue = req.body?.reference;
        if (referenceValue !== undefined && typeof referenceValue !== 'string') {
            return res.status(400).json({ success: false, message: 'La référence de commande est invalide.' });
        }
        const reference = (referenceValue || '').trim().toUpperCase();
        if (!isValidEmail(email) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ success: false, message: 'Adresse e-mail ou code invalide.' });
        }
        if (reference && !/^CMD-[A-Z0-9-]{1,40}$/.test(reference)) {
            return res.status(400).json({ success: false, message: 'La référence de commande est invalide.' });
        }

        const now = Date.now();
        const attemptState = trackingLocks.get(email);
        if (attemptState?.lockedUntil > now) {
            return res.status(401).json({ success: false, message: 'Code invalide ou expiré. Demandez un nouveau code.' });
        }
        const challenge = trackingChallenges.get(email);
        if (!challenge || challenge.expiresAt <= now) {
            trackingChallenges.delete(email);
            return res.status(401).json({ success: false, message: 'Code invalide ou expiré. Demandez un nouveau code.' });
        }
        const suppliedDigest = crypto.createHash('sha256').update(code).digest();
        if (!crypto.timingSafeEqual(challenge.digest, suppliedDigest)) {
            const state = attemptState?.windowExpiresAt > now
                ? attemptState
                : { attempts: 0, windowExpiresAt: now + 15 * 60 * 1000, lockedUntil: 0 };
            state.attempts += 1;
            if (state.attempts >= 5) {
                trackingChallenges.delete(email);
                state.windowExpiresAt = now + 15 * 60 * 1000;
                state.lockedUntil = state.windowExpiresAt;
            }
            trackingLocks.set(email, state);
            return res.status(401).json({ success: false, message: 'Code invalide ou expiré. Demandez un nouveau code.' });
        }
        trackingChallenges.delete(email);
        trackingLocks.delete(email);

        const rows = reference
            ? db.prepare(`
                SELECT commande_ref, id, produit, taille, quantite, statut, status, date_creation, product_id
                FROM precommandes
                WHERE (LOWER(email) = ? OR LOWER(contact) = ?)
                  AND (UPPER(commande_ref) = ? OR (commande_ref IS NULL AND ? = 'CMD-' || printf('%04d', id)))
                ORDER BY date_creation ASC, id ASC
                LIMIT 100
            `).all(email, email, reference, reference)
            : db.prepare(`
                SELECT commande_ref, id, produit, taille, quantite, statut, status, date_creation, product_id
                FROM precommandes
                WHERE LOWER(email) = ? OR LOWER(contact) = ?
                ORDER BY date_creation DESC, id DESC
                LIMIT 100
            `).all(email, email);

        const commandes = rows.map(row => {
            const productId = row.product_id
                || db.prepare('SELECT id FROM products WHERE LOWER(name) = LOWER(?) ORDER BY actif DESC, id ASC LIMIT 1').get(row.produit)?.id;
            const product = productId
                ? db.prepare('SELECT price FROM products WHERE id = ?').get(productId)
                : null;
            const currentPrice = productId ? getCurrentPrice(productId) : null;

            return {
                reference: row.commande_ref || `CMD-${String(row.id).padStart(4, '0')}`,
                produit: row.produit,
                taille: row.taille,
                quantite: row.quantite,
                statut: row.statut,
                status: Object.hasOwn(ORDER_STATUS_LABELS, row.status) ? row.status : 'EN_ATTENTE_PAIEMENT',
                status_label: Object.hasOwn(ORDER_STATUS_LABELS, row.status)
                    ? ORDER_STATUS_LABELS[row.status]
                    : ORDER_STATUS_LABELS.EN_ATTENTE_PAIEMENT,
                progress_index: Math.max(1, ORDER_STATUSES.findIndex(status => status.value === row.status) + 1),
                date_creation: row.date_creation,
                max_price: product ? getMaxPrice(productId, product.price) : null,
                current_price: product ? (currentPrice?.unit_price ?? product.price) : null
            };
        });
        return res.json({ success: true, commandes });
    } catch (error) {
        console.error('Erreur POST /api/precommandes/suivi:', error);
        return res.status(500).json({ success: false, message: 'Impossible de rechercher les précommandes.' });
    }
});

/** POST /api/precommande — multi-lignes, transaction unique, prix dégressifs */
app.post('/api/precommande', precommandeLimiter, (req, res) => {
    try {
        if (hasInvalidTextFields(req.body, {
            nom: 100, email: 254, telephone: 30,
            parent_prenom: 50, parent_nom: 50, parent_email: 254, parent_telephone: 30,
            enfant_prenom: 50, enfant_nom: 50, enfant_email: 254, enfant_telephone: 30,
            personnalisation: 100, remarques: 1000, usb_prenom: 50, usb_nom: 50,
            tshirt_prenom: 50, tshirt_nom: 50, tshirt_taille: 30,
            produit: 60, taille: 30
        })) {
            return res.status(400).json({ success: false, message: 'Un ou plusieurs champs texte sont invalides ou trop longs.' });
        }
        if (req.body.notify_price_drops !== undefined && typeof req.body.notify_price_drops !== 'boolean') {
            return res.status(400).json({ success: false, message: 'Le choix des notifications est invalide.' });
        }
        // 1. Vérification statut des précommandes
        const rowOuvert = db.prepare("SELECT valeur FROM settings WHERE cle = 'precommandes_ouvertes'").get();
        const rowMsg = db.prepare("SELECT valeur FROM settings WHERE cle = 'message_fermeture'").get();
        const isOuvert = rowOuvert ? rowOuvert.valeur === '1' : true;
        if (!isOuvert) return res.status(403).json({ success: false, message: rowMsg ? rowMsg.valeur : 'Les précommandes sont actuellement fermées.' });

        // 2. Validation informations client
        const {
            nom, email, telephone, consentement, lignes,
            parent_prenom, parent_nom, parent_email, parent_telephone,
            enfant_prenom, enfant_nom, enfant_email, enfant_telephone,
            personnalisation,
            remarques,
            usb_prenom, usb_nom,
            tshirt_prenom, tshirt_nom, tshirt_taille,
            notify_price_drops,
        } = req.body;
        const notifyPriceDrops = notify_price_drops === true ? 1 : 0;

        if (personnalisation !== undefined && personnalisation !== null && typeof personnalisation !== 'string') {
            return res.status(400).json({ success: false, message: 'La personnalisation doit être un texte.' });
        }
        const personnalisationClean = (personnalisation || '').trim();
        if (personnalisationClean.length > 100) {
            return res.status(400).json({ success: false, message: 'La personnalisation ne peut pas dépasser 100 caractères.' });
        }

        const isConsented = consentement === true || consentement === 'true';
        if (!isConsented) return res.status(400).json({ success: false, message: 'Vous devez accepter la politique de confidentialité.' });

        const resolvedNom = (parent_prenom && parent_nom)
            ? `${parent_prenom.trim()} ${parent_nom.trim()}`
            : (nom || '').trim();
        const resolvedEmail = parent_email ? parent_email.trim() : (email || '').trim();
        const resolvedTelephone = parent_telephone ? parent_telephone.trim() : (telephone || '').trim();

        if (!resolvedNom || resolvedNom.length < 2 || resolvedNom.length > 100) {
            return res.status(400).json({ success: false, message: 'Prénom et nom du parent requis (2 à 100 caractères).' });
        }
        if (!isValidEmail(resolvedEmail)) {
            return res.status(400).json({ success: false, message: 'Adresse email du parent invalide.' });
        }
        if (!isValidPhone(resolvedTelephone)) {
            return res.status(400).json({ success: false, message: 'Numéro de téléphone du parent invalide (8 à 15 chiffres requis).' });
        }
        if ((enfant_email && !isValidEmail(enfant_email.trim()))
            || (enfant_telephone && !isValidPhone(enfant_telephone.trim()))) {
            return res.status(400).json({ success: false, message: 'Les coordonnées de l’enfant sont invalides.' });
        }

        const enfantPrenomClean = (enfant_prenom || '').trim();
        const enfantNomClean = (enfant_nom || '').trim();
        if (!enfantPrenomClean || !enfantNomClean) {
            return res.status(400).json({ success: false, message: 'Prénom et nom de l\'enfant requis.' });
        }

        // 3. Validation des lignes de commande
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

        // Snapshot des paliers AVANT insertion (pour détecter les changements après)
        const tierSnapshotBefore = new Map();

        // Vérification et calcul ligne par ligne
        const verifiedLines = [];
        for (const item of lignesToProcess) {
            if (!item || typeof item !== 'object' || Array.isArray(item)
                || (typeof item.product_id !== 'string' && typeof item.product_id !== 'number')
                || (typeof item.product_id === 'string' && item.product_id.length > 60)
                || (item.taille !== undefined && typeof item.taille !== 'string')
                || (item.personalization !== undefined && item.personalization !== null
                    && (typeof item.personalization !== 'string' || item.personalization.length > 100))
                || (item.noCustomization !== undefined && typeof item.noCustomization !== 'boolean')) {
                return res.status(400).json({ success: false, message: 'Une ligne de précommande est invalide.' });
            }
            const pid = typeof item.product_id === 'number' ? item.product_id : Number(item.product_id);
            const productInfo = findProduct(Number.isSafeInteger(pid) && pid > 0 ? pid : item.product_id);
            if (!productInfo || productInfo.actif === 0) {
                return res.status(400).json({ success: false, message: 'Un des articles demandés n\'est plus disponible.' });
            }
            const qty = typeof item.quantite === 'number' || typeof item.quantite === 'string' ? Number(item.quantite) : NaN;
            if (!Number.isSafeInteger(qty) || qty < 1 || qty > 10) {
                return res.status(400).json({ success: false, message: 'La quantité de chaque article doit être comprise entre 1 et 10.' });
            }
            const cleanTaille = item.taille ? item.taille.trim() : 'Taille unique';
            const allowedSizes = productInfo.sizes || ['Taille unique'];
            if (!allowedSizes.includes(cleanTaille)) {
                return res.status(400).json({ success: false, message: 'Taille "' + cleanTaille + '" non disponible pour "' + productInfo.name + '".' });
            }
            const noCustomization = item.noCustomization === true;
            if (noCustomization && (Number(productInfo.requires_customization) !== 1 || Number(productInfo.allow_no_customization) !== 1)) {
                return res.status(400).json({ success: false, message: 'L’option sans personnalisation n’est pas disponible pour cet article.' });
            }

            // Prix dynamique selon grille dégressive
            const priceInfo = getCurrentPrice(productInfo.id);
            const unitPrice = priceInfo !== null ? priceInfo.unit_price : productInfo.price;
            const linePrice = Math.round(unitPrice * qty * 100) / 100;

            // Snapshot du palier avant insertion (une seule fois par produit)
            if (!tierSnapshotBefore.has(productInfo.id)) {
                tierSnapshotBefore.set(productInfo.id, {
                    tier_id: priceInfo ? priceInfo.tier_id : null,
                    unit_price: unitPrice,
                });
            }

            const isCustomizable = Number(productInfo.requires_customization) === 1;
            const itemPersonalization = item.personalization === undefined
                ? cleanPersonalization(personnalisationClean)
                : cleanPersonalization(item.personalization);
            const linePersonalization = isCustomizable && !noCustomization
                ? itemPersonalization
                : '';

            verifiedLines.push({
                product: productInfo,
                taille: cleanTaille,
                noCustomization,
                personnalisation: linePersonalization,
                qty,
                linePrice,
                unitPrice
            });
        }

        if (verifiedLines.some(line => Number(line.product.requires_customization) === 1 && line.noCustomization !== true && !line.personnalisation)) {
            return res.status(400).json({ success: false, message: 'Une personnalisation est obligatoire pour un ou plusieurs produits de votre panier.' });
        }

        // 3b. Remarques consolidées
        const remarquesParts = [];
        remarquesParts.push(`[ENFANT] ${enfantPrenomClean} ${enfantNomClean}`);
        if (enfant_email && enfant_email.trim()) remarquesParts.push(`Email enfant: ${enfant_email.trim()}`);
        if (enfant_telephone && enfant_telephone.trim()) remarquesParts.push(`Tél enfant: ${enfant_telephone.trim()}`);
        if (usb_prenom && usb_nom) remarquesParts.push(`[GRAVURE USB] ${usb_prenom.trim()} ${usb_nom.trim()}`);
        if (tshirt_prenom && tshirt_nom) {
            const tshirtLine = `[MARQUAGE TSHIRT] ${tshirt_prenom.trim()} ${tshirt_nom.trim()}${tshirt_taille ? ' / Taille: ' + tshirt_taille.trim() : ''}`;
            remarquesParts.push(tshirtLine);
        }
        if (remarques && remarques.trim()) remarquesParts.push(`[REMARQUES] ${remarques.trim()}`);
        const remarquesConsolidees = remarquesParts.join('\n');

        // 4. Transaction unique
        const nowIso = new Date().toISOString();
        const normEmail = normalizeEmail(resolvedEmail);
        const normPhone = normalizePhone(resolvedTelephone);
        const commandeRef = generateCommandeRef();

        db.transaction(() => {
            const checkStatus = db.prepare("SELECT valeur FROM settings WHERE cle = 'precommandes_ouvertes'").get();
            if (checkStatus && checkStatus.valeur !== '1') throw new Error('PRECOMMANDES_FERMEES');

            let client = db.prepare('SELECT id FROM clients WHERE email_normalise = ?').get(normEmail);
            let clientId;
            if (client) {
                clientId = client.id;
                db.prepare('UPDATE clients SET nom = ?, telephone = ?, contact = ? WHERE id = ?').run(resolvedNom, normPhone, normEmail, clientId);
            } else {
                const r = db.prepare('INSERT INTO clients (nom, contact, contact_normalise, email, telephone, email_normalise, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?)').run(resolvedNom, normEmail, normEmail, normEmail, normPhone, normEmail, nowIso);
                clientId = r.lastInsertRowid;
            }

            const insertLine = db.prepare("INSERT INTO precommandes (client_id, nom, contact, email, telephone, produit, taille, quantite, prix_estime, statut, consentement, date_consentement, date_creation, product_id, commande_ref, remarques, personnalisation, notify_price_drops, no_customization, student_first_name, student_last_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            for (const vl of verifiedLines) {
                insertLine.run(clientId, resolvedNom, normEmail, normEmail, normPhone, vl.product.name, vl.taille, vl.qty, vl.linePrice, nowIso, nowIso, vl.product.id, commandeRef, remarquesConsolidees, vl.personnalisation || null, notifyPriceDrops, vl.noCustomization ? 1 : 0, enfantPrenomClean, enfantNomClean);
            }
        })();

        // 5. Détecter les changements de palier et notifier (non bloquant)
        ;(async () => {
            const productIds = [...new Set(verifiedLines.map(vl => vl.product.id))];
            for (const pid of productIds) {
                const before = tierSnapshotBefore.get(pid);
                if (!before || before.tier_id === null) continue; // pas de grille → pas de notif

                const after = getCurrentPrice(pid);
                if (!after) continue;

                if (after.tier_id !== before.tier_id && after.unit_price < before.unit_price) {
                    // Vérifier anti-doublon
                    const alreadySent = db.prepare('SELECT id FROM tier_notifications_sent WHERE product_id = ? AND tier_id = ?').get(pid, after.tier_id);
                    if (!alreadySent) {
                        await sendTierChangeEmail(pid, before.unit_price, after.unit_price);
                    }
                }
            }
        })().catch(err => console.error('Erreur notification palier:', err));

        // 6. Notifications non bloquantes
        const totalEstime = verifiedLines.reduce((acc, vl) => acc + vl.linePrice, 0);
        fetch('https://ntfy.sh/acelspace-orders', {
            method: 'POST',
            body: `Montant : ${totalEstime} €\nParent : ${resolvedNom}\nEnfant : ${enfantPrenomClean} ${enfantNomClean}\nContact : ${normEmail}`,
            headers: {
                'Title': 'Nouvelle commande AcelSpace !',
                'Tags': 'moneybag,shopping_cart,tada'
            }
        }).then(response => {
            if (!response.ok) {
                console.error(`Erreur d'envoi NTFY: HTTP ${response.status}`);
            }
        }).catch(err => console.error('Erreur d’envoi NTFY:', err));

        sendConfirmationEmail({
            to: normEmail,
            commandeRef,
            parentNom: resolvedNom,
            enfantNom: enfantPrenomClean && enfantNomClean ? `${enfantPrenomClean} ${enfantNomClean}` : null,
            lignes: verifiedLines,
            total: totalEstime,
        }).catch(err => console.error('Email non bloquant:', err));

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
        const password = req.body?.password;
        if (typeof password !== 'string' || password.length < 1 || password.length > 200) {
            return res.status(400).json({ success: false, message: 'Mot de passe requis.' });
        }
        if (!bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) return res.status(401).json({ success: false, message: 'Mot de passe incorrect.' });
        const now = Date.now();
        for (const [token, expiresAt] of adminSessions) {
            if (expiresAt <= now) adminSessions.delete(token);
        }
        if (adminSessions.size >= 1000) {
            return res.status(503).json({ success: false, message: 'Trop de sessions administrateur actives. Réessayez plus tard.' });
        }
        const sessionToken = crypto.randomBytes(32).toString('hex');
        adminSessions.set(sessionToken, now + ADMIN_SESSION_DURATION_MS);
        const isSecure = Boolean(process.env.PUBLIC_ORIGIN) || process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie('admin_session', sessionToken, { httpOnly: true, signed: true, sameSite: 'strict', secure: isSecure, maxAge: ADMIN_SESSION_DURATION_MS });
        return res.json({ success: true, message: 'Connexion réussie.' });
    } catch(error) { console.error('Erreur login admin:', error); return res.status(500).json({ success: false, message: 'Erreur login.' }); }
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
    adminSessions.delete(req.signedCookies.admin_session);
    const isSecure = Boolean(process.env.PUBLIC_ORIGIN) || process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie('admin_session', { httpOnly: true, signed: true, sameSite: 'strict', secure: isSecure });
    return res.json({ success: true, message: 'Déconnexion réussie.' });
});

app.get('/api/admin/check-auth', (req, res) => {
    const session = getAdminSession(req);
    if (session) {
        req.session = session;
        return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
});

// ─── Routes Admin Produits
app.get('/api/admin/products', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT id, name, price, description, sizes, image, image_url_2, detail_table_image, featured, actif, ordre, date_creation, requires_customization, customization_fields, allow_no_customization FROM products ORDER BY ordre ASC, id ASC').all();
        return res.json({ success: true, products: rows.map(p => ({ ...p, sizes: JSON.parse(p.sizes || '["Taille unique"]') })) });
    } catch(error) { console.error('Erreur GET /api/admin/products:', error); return res.status(500).json({ success: false, message: 'Erreur produits.' }); }
});

app.post('/api/admin/upload', requireAdmin, uploadLimiter, upload.single('image'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier image reçu.' });
        const detectedMime = checkMagicBytes(req.file.buffer);
        if (!detectedMime) {
            return res.status(400).json({ success: false, message: 'Fichier image invalide. JPEG, PNG ou WebP uniquement (SVG interdit).' });
        }
        const ext = detectedMime === 'image/jpeg' ? 'jpg' : detectedMime === 'image/png' ? 'png' : 'webp';
        const filename = crypto.randomUUID() + '.' + ext;
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
        return res.json({ success: true, url: '/uploads/' + filename });
    } catch (error) {
        console.error('Erreur upload image produit:', error);
        return res.status(500).json({ success: false, message: 'Erreur lors du téléversement de l’image.' });
    }
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
        const imageUrl2 = req.body.image_url_2?.trim() || null;
        const detailTableImage = req.body.detail_table_image?.trim() || null;
        const maxOrdre = db.prepare('SELECT COALESCE(MAX(ordre), 0) as m FROM products').get().m;
        const isFeatured = (featured === '1' || featured === 1 || featured === true) ? 1 : 0;
        const requiresCustomization = (req.body.requires_customization === '1' || req.body.requires_customization === 1 || req.body.requires_customization === true) ? 1 : 0;
        const allowNoCustomization = req.body.allow_no_customization === undefined
            ? 1
            : (req.body.allow_no_customization === '1' || req.body.allow_no_customization === 1 || req.body.allow_no_customization === true) ? 1 : 0;
        const customizationFields = requiresCustomization ? req.body.customization_fields.trim() : '';
        db.transaction(() => {
            const result = db.prepare("INSERT INTO products (name, price, description, sizes, image, image_url_2, detail_table_image, featured, actif, ordre, date_creation, requires_customization, customization_fields, allow_no_customization) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)").run(name.trim(), parseFloat(price), description ? description.trim() : '', JSON.stringify(parsedSizes.map(s => s.trim())), imagePath, imageUrl2, detailTableImage, isFeatured, maxOrdre + 1, new Date().toISOString(), requiresCustomization, customizationFields, allowNoCustomization);
            if (isFeatured === 1) db.prepare('UPDATE products SET featured = 0 WHERE id != ?').run(result.lastInsertRowid);
        })();
        const allProducts = db.prepare('SELECT id, name, price, description, sizes, image, image_url_2, detail_table_image, featured, actif, ordre, date_creation, requires_customization, customization_fields, allow_no_customization FROM products ORDER BY ordre ASC, id ASC').all().map(p => ({ ...p, sizes: JSON.parse(p.sizes || '["Taille unique"]') }));
        return res.status(201).json({ success: true, products: allProducts });
    } catch(error) { console.error('Erreur POST /api/admin/products:', error); return res.status(500).json({ success: false, message: 'Erreur création produit.' }); }
});

app.patch('/api/admin/products/:id/order', requireAdmin, (req, res) => {
    try {
        const { id } = req.params; const { direction } = req.body;
        if (!isPositiveIntegerParam(id)) return res.status(400).json({ success: false, message: 'Identifiant produit invalide.' });
        if (!['up', 'down'].includes(direction)) return res.status(400).json({ success: false, message: 'Direction invalide (up ou down).' });
        db.transaction(() => {
            const current = db.prepare('SELECT id, ordre FROM products WHERE id = ?').get(id);
            if (!current) return;
            const neighbor = direction === 'up'
                ? db.prepare('SELECT id, ordre FROM products WHERE ordre < ? ORDER BY ordre DESC LIMIT 1').get(current.ordre)
                : db.prepare('SELECT id, ordre FROM products WHERE ordre > ? ORDER BY ordre ASC LIMIT 1').get(current.ordre);
            if (!neighbor) return;
            db.prepare('UPDATE products SET ordre = ? WHERE id = ?').run(neighbor.ordre, current.id);
            db.prepare('UPDATE products SET ordre = ? WHERE id = ?').run(current.ordre, neighbor.id);
        })();
        return res.json({ success: true });
    } catch(error) { console.error('Erreur order:', error); return res.status(500).json({ success: false, message: 'Erreur ordre.' }); }
});

const updateProduct = (req, res) => {
    try {
        const { id } = req.params;
        if (!isPositiveIntegerParam(id)) return res.status(400).json({ success: false, message: 'Identifiant produit invalide.' });
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
            const oldFile = getProductUploadPath(existing.image);
            if (oldFile && fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
            imagePath = '/uploads/' + filename;
        }

        let newActif = existing.actif;
        if (actif !== undefined) newActif = (actif === '1' || actif === 1 || actif === true) ? 1 : 0;

        let newFeatured = existing.featured;
        if (featured !== undefined) {
            const wantsFeatured = (featured === '1' || featured === 1 || featured === true) ? 1 : 0;
            if (wantsFeatured === 1 && newActif === 0) {
                return res.status(400).json({ success: false, message: 'Seul un produit actif peut être défini comme produit vedette.' });
            }
            newFeatured = wantsFeatured;
        }
        if (newActif === 0) newFeatured = 0;

        const requiresCustomization = req.body.requires_customization === undefined
            ? existing.requires_customization
            : (req.body.requires_customization === '1' || req.body.requires_customization === 1 || req.body.requires_customization === true) ? 1 : 0;
        const allowNoCustomization = req.body.allow_no_customization === undefined
            ? existing.allow_no_customization
            : (req.body.allow_no_customization === '1' || req.body.allow_no_customization === 1 || req.body.allow_no_customization === true) ? 1 : 0;
        const customizationFields = requiresCustomization
            ? (req.body.customization_fields === undefined ? (existing.customization_fields || '') : req.body.customization_fields.trim())
            : '';
        const imageUrl2 = req.body.image_url_2 === undefined
            ? existing.image_url_2
            : (req.body.image_url_2.trim() || null);
        const detailTableImage = req.body.detail_table_image === undefined
            ? existing.detail_table_image
            : (req.body.detail_table_image.trim() || null);
        if (requiresCustomization && !customizationFields) {
            return res.status(400).json({ success: false, message: 'Précisez les champs que le client doit remplir pour la personnalisation.' });
        }

        db.transaction(() => {
            db.prepare('UPDATE products SET name = ?, price = ?, description = ?, sizes = ?, image = ?, image_url_2 = ?, detail_table_image = ?, featured = ?, actif = ?, ordre = ?, requires_customization = ?, customization_fields = ?, allow_no_customization = ? WHERE id = ?').run(
                name !== undefined ? name.trim() : existing.name,
                price !== undefined ? parseFloat(price) : existing.price,
                description !== undefined ? description.trim() : existing.description,
                parsedSizes !== undefined ? JSON.stringify(parsedSizes.map(s => s.trim())) : existing.sizes,
                imagePath, imageUrl2, detailTableImage, newFeatured, newActif,
                ordre !== undefined ? parseInt(ordre, 10) : existing.ordre,
                requiresCustomization,
                customizationFields,
                allowNoCustomization,
                id
            );
            if (newFeatured === 1) db.prepare('UPDATE products SET featured = 0 WHERE id != ?').run(id);
        })();

        const allProducts = db.prepare('SELECT id, name, price, description, sizes, image, image_url_2, detail_table_image, featured, actif, ordre, date_creation, requires_customization, customization_fields, allow_no_customization FROM products ORDER BY ordre ASC, id ASC').all().map(p => ({ ...p, sizes: JSON.parse(p.sizes || '["Taille unique"]') }));
        return res.json({ success: true, products: allProducts });
    } catch(error) { console.error('Erreur modification produit:', error); return res.status(500).json({ success: false, message: 'Erreur modification produit.' }); }
};

app.patch('/api/admin/products/:id', requireAdmin, upload.single('image'), updateProduct);
app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), updateProduct);

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        if (!isPositiveIntegerParam(id)) return res.status(400).json({ success: false, message: 'Identifiant produit invalide.' });
        const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        if (!existing) return res.status(404).json({ success: false, message: 'Produit non trouvé.' });
        const linked = db.prepare('SELECT COUNT(*) as c FROM precommandes WHERE product_id = ?').get(id);
        if (linked && linked.c > 0) return res.status(409).json({ success: false, hasOrders: true, orderCount: linked.c, message: 'Ce produit a ' + linked.c + ' précommande(s). Suppression refusée. Vous pouvez l\'archiver (actif = 0).' });
        const uploadedImages = [existing.image, existing.image_url_2, existing.detail_table_image]
            .map(getProductUploadPath)
            .filter(Boolean);

        db.transaction(() => {
            db.prepare('DELETE FROM price_tiers WHERE product_id = ?').run(id);
            db.prepare('DELETE FROM price_tier_history WHERE product_id = ?').run(id);
            db.prepare('DELETE FROM tier_notifications_sent WHERE product_id = ?').run(id);
            db.prepare('DELETE FROM products WHERE id = ?').run(id);
        })();

        for (const imagePath of uploadedImages) {
            if (!fs.existsSync(imagePath)) continue;
            try {
                fs.unlinkSync(imagePath);
            } catch (error) {
                console.error(`Impossible de supprimer le fichier image ${path.basename(imagePath)} :`, error);
            }
        }
        return res.json({ success: true, message: 'Produit supprimé avec succès.' });
    } catch(error) { console.error('Erreur DELETE produit:', error); return res.status(500).json({ success: false, message: 'Erreur suppression produit.' }); }
});

// ─── Routes Admin Précommandes (STATUS & REF AVANT :id)

app.get('/api/admin/precommandes', requireAdmin, (req, res) => {
    try {
        const { search, statut, status, produit } = req.query;
        if ((search !== undefined && search.length > 120)
            || (produit !== undefined && produit.length > 100)
            || (statut !== undefined && !['all', 'en_attente', 'confirmee', 'livree', 'annulee'].includes(statut))
            || (status !== undefined && status !== 'all' && !Object.hasOwn(ORDER_STATUS_LABELS, status))) {
            return res.status(400).json({ success: false, message: 'Filtres de recherche invalides.' });
        }
        let query = 'SELECT p.*, c.email as client_email, c.telephone as client_telephone, c.contact_normalise, pr.requires_customization as product_requires_customization FROM precommandes p LEFT JOIN clients c ON p.client_id = c.id LEFT JOIN products pr ON pr.id = p.product_id WHERE 1=1';
        const params = [];
        if (status && status !== 'all') {
            if (!Object.hasOwn(ORDER_STATUS_LABELS, status)) return res.status(400).json({ success: false, message: 'Filtre de statut invalide.' });
            query += ' AND p.status = ?';
            params.push(status);
        } else if (statut && statut !== 'all') {
            query += ' AND p.statut = ?';
            params.push(statut);
        }
        if (produit && produit !== 'all') { query += ' AND p.produit = ?'; params.push(produit); }
        if (search && search.trim()) {
            const trimmed = search.trim();
            const cMatch = trimmed.match(/^c-?(\d+)$/i);
            const numMatch = trimmed.match(/^(\d+)$/);
            if (cMatch) {
                const n = parseInt(cMatch[1], 10);
                query += ' AND (p.client_id = ? OR p.nom LIKE ? OR p.email LIKE ? OR p.telephone LIKE ? OR p.contact LIKE ? OR p.commande_ref LIKE ?)';
                params.push(n, '%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%');
            } else if (numMatch) {
                const n = parseInt(numMatch[1], 10);
                query += ' AND (p.client_id = ? OR p.id = ? OR p.nom LIKE ? OR p.email LIKE ? OR p.telephone LIKE ? OR p.contact LIKE ? OR p.commande_ref LIKE ?)';
                params.push(n, n, '%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%');
            } else {
                query += ' AND (p.nom LIKE ? OR p.email LIKE ? OR p.telephone LIKE ? OR p.contact LIKE ? OR p.commande_ref LIKE ?)';
                params.push('%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%', '%'+trimmed+'%');
            }
        }
        query += ' ORDER BY p.date_creation DESC, p.commande_ref DESC, p.id ASC';
        const rawPrecommandes = db.prepare(query).all(...params);
        const precommandes = rawPrecommandes.map(r => ({
            ...r,
            personnalisation: Number(r.product_requires_customization) === 1 && Number(r.no_customization) !== 1
                ? cleanPersonalization(r.personnalisation)
                : '',
            client_id_formatted: formatClientId(r.client_id)
        }));
        const allRecords = db.prepare('SELECT client_id, produit, taille, statut, status, quantite, prix_estime, commande_ref FROM precommandes').all();
        const totalUQ = db.prepare('SELECT COUNT(DISTINCT client_id) as count FROM precommandes').get();
        const uniqueOrders = db.prepare('SELECT COUNT(DISTINCT COALESCE(commande_ref, id)) as count FROM precommandes').get();
        const activeRecords = allRecords.filter(r => !['ANNULE', 'ANNULÉ'].includes(String(r.status || '').trim().toUpperCase()));
        const stats = {
            totalOrders: uniqueOrders ? uniqueOrders.count : allRecords.length,
            totalLines: allRecords.length,
            totalUniqueClients: totalUQ ? totalUQ.count : 0,
            totalRevenue: activeRecords.reduce((acc, c) => acc + (Number(c.prix_estime) || 0), 0),
            byStatus: {
                en_attente: allRecords.filter(r => r.status === 'EN_ATTENTE_PAIEMENT' || r.status === 'EN_COMMANDE').length,
                confirmee: allRecords.filter(r => r.status === 'PAYE' || r.status === 'PRET_AU_LOCAL').length,
                livree: allRecords.filter(r => r.status === 'REMIS').length,
                annulee: allRecords.filter(r => r.status === 'ANNULE' || r.statut === 'annulee').length
            },
            recapByProductSize: db.prepare("SELECT produit, taille, SUM(quantite) as quantite, COUNT(*) as count, SUM(prix_estime) as total_prix FROM precommandes WHERE COALESCE(UPPER(TRIM(status)), '') NOT IN ('ANNULE', 'ANNULÉ') GROUP BY produit, taille ORDER BY produit ASC, taille ASC").all()
        };
        return res.json({ success: true, precommandes, stats });
    } catch(error) { console.error('Erreur GET precommandes:', error); return res.status(500).json({ success: false, message: 'Erreur données.' }); }
});

app.patch('/api/admin/precommandes/status', requireAdmin, (req, res) => {
    try {
        const { ouvert, message } = req.body;
        if (typeof ouvert !== 'boolean') return res.status(400).json({ success: false, message: 'Le champ "ouvert" (booléen true/false) est obligatoire.' });
        if (message !== undefined && message !== null) {
            if (typeof message !== 'string' || message.length > 200) return res.status(400).json({ success: false, message: 'Message invalide (max 200 caractères).' });
            if (message.trim().length > 0) db.prepare("INSERT INTO settings (cle, valeur) VALUES ('message_fermeture', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(message.trim());
        }
        db.prepare("INSERT INTO settings (cle, valeur) VALUES ('precommandes_ouvertes', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(ouvert ? '1' : '0');
        const currentMsg = db.prepare("SELECT valeur FROM settings WHERE cle = 'message_fermeture'").get()?.valeur || 'Les précommandes sont terminées. Merci !';
        return res.json({ success: true, ouvert, message: currentMsg });
    } catch(error) { console.error('Erreur PATCH status:', error); return res.status(500).json({ success: false, message: 'Erreur serveur lors de la mise à jour du statut.' }); }
});

app.patch('/api/admin/precommandes/:id/status', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!isPositiveIntegerParam(id) || !Object.hasOwn(ORDER_STATUS_LABELS, status)) {
            return res.status(400).json({ success: false, message: 'Commande ou statut invalide.' });
        }
        const result = db.prepare('UPDATE precommandes SET status = ? WHERE id = ?').run(status, Number(id));
        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: 'Commande introuvable.' });
        }
        return res.json({
            success: true,
            status,
            status_label: ORDER_STATUS_LABELS[status],
            updated_lines: result.changes,
            message: 'Statut de l’article mis à jour.'
        });
    } catch (error) {
        console.error('Erreur PATCH statut avancé précommande:', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du statut.' });
    }
});

app.patch('/api/admin/precommandes/:id/status-all', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!isPositiveIntegerParam(id) || !Object.hasOwn(ORDER_STATUS_LABELS, status)) {
            return res.status(400).json({ success: false, message: 'Commande ou statut invalide.' });
        }

        const result = db.transaction(() => {
            const order = db.prepare('SELECT commande_ref FROM precommandes WHERE id = ?').get(Number(id));
            if (!order) return { changes: 0 };
            return order.commande_ref
                ? db.prepare('UPDATE precommandes SET status = ? WHERE commande_ref = ?').run(status, order.commande_ref)
                : db.prepare('UPDATE precommandes SET status = ? WHERE id = ?').run(status, Number(id));
        })();
        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: 'Commande introuvable.' });
        }

        return res.json({
            success: true,
            status,
            status_label: ORDER_STATUS_LABELS[status],
            updated_lines: result.changes,
            message: 'Statut de toute la commande mis à jour.'
        });
    } catch (error) {
        console.error('Erreur PATCH statut global précommande:', error);
        return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du statut de la commande.' });
    }
});

app.patch('/api/admin/precommandes/ref/:commande_ref', requireAdmin, (req, res) => {
    try {
        const { commande_ref } = req.params; const { statut } = req.body;
        if (!/^CMD-[A-Z0-9-]{1,40}$/i.test(commande_ref) || !['en_attente', 'confirmee', 'livree', 'annulee'].includes(statut)) return res.status(400).json({ success: false, message: 'Référence ou statut invalide.' });
        const info = db.prepare('UPDATE precommandes SET statut = ? WHERE commande_ref = ?').run(statut, commande_ref);
        if (info.changes === 0) return res.status(404).json({ success: false, message: 'Aucune commande trouvée pour cette référence.' });
        return res.json({ success: true, message: 'Statut mis à jour pour ' + info.changes + ' article(s).' });
    } catch(error) { console.error('Erreur PATCH commande groupée:', error); return res.status(500).json({ success: false, message: 'Erreur mise à jour.' }); }
});

app.patch('/api/admin/precommandes/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params; const { statut } = req.body;
        if (!isPositiveIntegerParam(id) || !['en_attente', 'confirmee', 'livree', 'annulee'].includes(statut)) return res.status(400).json({ success: false, message: 'Commande ou statut invalide.' });
        const info = db.prepare('UPDATE precommandes SET statut = ? WHERE id = ?').run(statut, id);
        if (info.changes === 0) return res.status(404).json({ success: false, message: 'Précommande non trouvée.' });
        return res.json({ success: true, message: 'Statut mis à jour.' });
    } catch(error) { console.error('Erreur PATCH precommande:', error); return res.status(500).json({ success: false, message: 'Erreur mise à jour.' }); }
});

app.delete('/api/admin/precommandes/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        if (!isPositiveIntegerParam(id)) return res.status(400).json({ success: false, message: 'Identifiant précommande invalide.' });
        const result = db.transaction(() => {
            const order = db.prepare('SELECT client_id FROM precommandes WHERE id = ?').get(id);
            if (!order) return { notFound: true };
            db.prepare('DELETE FROM precommandes WHERE id = ?').run(id);
            if (order.client_id) {
                const rem = db.prepare('SELECT COUNT(*) as count FROM precommandes WHERE client_id = ?').get(order.client_id);
                if (!rem || rem.count === 0) db.prepare('DELETE FROM clients WHERE id = ?').run(order.client_id);
            }
            return { success: true };
        })();
        if (result.notFound) return res.status(404).json({ success: false, message: 'Précommande non trouvée.' });
        return res.json({ success: true, message: 'Précommande supprimée.' });
    } catch(error) { console.error('Erreur DELETE precommande:', error); return res.status(500).json({ success: false, message: 'Erreur suppression.' }); }
});

app.delete('/api/admin/clients/:id', requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        if (!isPositiveIntegerParam(id)) return res.status(400).json({ success: false, message: 'Identifiant client invalide.' });
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
        const rows = db.prepare("SELECT p.*, pr.requires_customization as product_requires_customization FROM precommandes p LEFT JOIN products pr ON pr.id = p.product_id WHERE COALESCE(UPPER(TRIM(p.status)), '') NOT IN ('ANNULE', 'ANNULÉ') ORDER BY p.date_creation DESC, p.commande_ref DESC, p.id ASC").all();
        const headers = ['ID Ligne', 'Réf. Commande', 'Client ID', 'Date', 'Nom', 'Prénom enfant', 'Nom enfant', 'Email', 'Téléphone', 'Produit', 'Taille', 'Quantite', 'Prix Estime', 'Statut', 'Consentement RGPD', 'Date Consentement', 'Remarques', 'Personnalisation'];
        const csvLines = [headers.map(h => sanitizeCSV(h)).join(';')];
        rows.forEach(r => {
            const fd = r.date_creation ? new Date(r.date_creation).toLocaleString('fr-FR') : '-';
            const fcd = r.date_consentement ? new Date(r.date_consentement).toLocaleString('fr-FR') : fd;
            const emailVal = r.email || r.contact || '-';
            const telVal = r.telephone || '-';
            const refVal = r.commande_ref || ('CMD-' + r.id);
            const personnalisation = Number(r.product_requires_customization) === 1 && Number(r.no_customization) !== 1
                ? cleanPersonalization(r.personnalisation)
                : '';
            csvLines.push([r.id, refVal, formatClientId(r.client_id), fd, r.nom, r.student_first_name || '', r.student_last_name || '', sanitizeCSV(emailVal), sanitizeCSV(telVal, true), r.produit, r.taille, r.quantite, r.prix_estime, ORDER_STATUS_LABELS[r.status] || r.status, r.consentement === 1 ? 'Oui' : 'Non', fcd, sanitizeCSV(r.remarques || '', true), sanitizeCSV(personnalisation, true)].map((val, idx) => (idx === 7 || idx === 8 || idx === 16 || idx === 17 ? val : sanitizeCSV(val))).join(';'));
        });
        const filename = 'precommandes-acelspace-' + new Date().toISOString().slice(0, 10) + '.csv';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        return res.send('\uFEFF' + csvLines.join('\r\n'));
    } catch(error) { console.error('Erreur export CSV:', error); return res.status(500).json({ success: false, message: 'Erreur export CSV.' }); }
});

app.get('/api/admin/export-recap', requireAdmin, (req, res) => {
    try {
        let query = "SELECT produit, taille, SUM(quantite) as quantite_totale, COUNT(*) as nombre_commandes, SUM(prix_estime) as total_estime FROM precommandes WHERE COALESCE(UPPER(TRIM(status)), '') NOT IN ('ANNULE', 'ANNULÉ')";
        query += ' GROUP BY produit, taille ORDER BY produit ASC, taille ASC';
        const rows = db.prepare(query).all();
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
        let query = "SELECT p.id, p.client_id, p.nom, p.produit, p.taille, p.quantite, p.prix_estime, p.statut, p.status, p.date_creation, p.personnalisation, p.no_customization, p.student_first_name, p.student_last_name, pr.requires_customization as product_requires_customization, c.nom as client_nom FROM precommandes p LEFT JOIN clients c ON p.client_id = c.id LEFT JOIN products pr ON pr.id = p.product_id WHERE COALESCE(UPPER(TRIM(p.status)), '') NOT IN ('ANNULE', 'ANNULÉ')";
        query += ' ORDER BY COALESCE(c.nom, p.nom) ASC, p.date_creation ASC';
        const rows = db.prepare(query).all();
        const clientMap = new Map();
        rows.forEach(r => {
            const key = r.client_id ? 'client_' + r.client_id : 'legacy_' + (r.nom || '').trim().toLowerCase();
            const displayName = (r.client_nom || r.nom || 'CLIENT').trim().toUpperCase();
            if (!clientMap.has(key)) clientMap.set(key, { clientId: r.client_id, clientIdFormatted: formatClientId(r.client_id), nom: displayName, children: new Set(), itemsMap: new Map(), total: 0 });
            const cd = clientMap.get(key);
            cd.total += Number(r.prix_estime) || 0;
            const studentName = [r.student_first_name, r.student_last_name].filter(Boolean).join(' ').trim();
            if (studentName) cd.children.add(studentName);
            const personnalisation = Number(r.product_requires_customization) === 1 && Number(r.no_customization) !== 1
                ? cleanPersonalization(r.personnalisation)
                : '';
            const itemKey = JSON.stringify([r.produit, r.taille || 'Taille unique', personnalisation]);
            if (!cd.itemsMap.has(itemKey)) cd.itemsMap.set(itemKey, { produit: r.produit, taille: r.taille || 'Taille unique', personnalisation, quantite: 0 });
            cd.itemsMap.get(itemKey).quantite += Number(r.quantite) || 0;
        });
        const persons = []; let grandTotal = 0;
        for (const cd of clientMap.values()) {
            const parts = [];
            for (const item of cd.itemsMap.values()) {
                const hasSize = item.taille && item.taille !== 'Taille unique';
                parts.push(item.produit + (hasSize ? ' ' + item.taille : '') + ' x' + item.quantite + (item.personnalisation ? ' — Perso : ' + item.personnalisation : ''));
            }
            const t = Math.round(cd.total * 100) / 100;
            grandTotal += t;
            persons.push({
                clientId: cd.clientId,
                clientIdFormatted: cd.clientIdFormatted,
                nom: cd.nom,
                enfants: [...cd.children].join(', '),
                commande: parts.join('\n') || '-',
                total: t
            });
        }
        persons.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
        const printDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return res.json({ success: true, data: { persons, totalPersons: persons.length, grandTotalAmount: Math.round(grandTotal * 100) / 100, printDate } });
    } catch(error) { console.error('Erreur print-data:', error); return res.status(500).json({ success: false, message: 'Erreur impression.' }); }
});

// ─── Routes Admin Prix Dégressifs

/**
 * GET /api/admin/price-tiers/template
 * Génère et retourne un XLSX template avec 2 lignes d'exemple
 */
app.get('/api/admin/price-tiers/template', requireAdmin, (req, res) => {
    try {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['quantite_min', 'quantite_max', 'prix_unitaire'],
            [1, 49, 12.00],
            [50, '', 10.00],
        ]);
        // Largeurs colonnes
        ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Paliers');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="template-paliers.xlsx"');
        return res.send(buffer);
    } catch(error) {
        console.error('Erreur génération template XLSX:', error);
        return res.status(500).json({ success: false, message: 'Erreur génération template.' });
    }
});

/**
 * GET /api/admin/price-tiers/:product_id
 * Retourne la grille actuelle, le palier actif, la qté totale et l'historique
 */
app.get('/api/admin/price-tiers/:product_id', requireAdmin, (req, res) => {
    try {
        if (!isPositiveIntegerParam(req.params.product_id)) return res.status(400).json({ success: false, message: 'product_id invalide.' });
        const product_id = Number(req.params.product_id);

        const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(product_id);
        if (!product) return res.status(404).json({ success: false, message: 'Produit non trouvé.' });

        const tiers = db.prepare('SELECT * FROM price_tiers WHERE product_id = ? ORDER BY qty_min ASC').all(product_id);
        const history = db.prepare('SELECT id, uploaded_at, tiers_json FROM price_tier_history WHERE product_id = ? ORDER BY uploaded_at DESC LIMIT 10').all(product_id);
        const currentPrice = getCurrentPrice(product_id);

        return res.json({
            success: true,
            product,
            tiers,
            current_price: currentPrice,
            history: history.map(h => ({ ...h, tiers: JSON.parse(h.tiers_json) })),
        });
    } catch(error) {
        console.error('Erreur GET price-tiers:', error);
        return res.status(500).json({ success: false, message: 'Erreur récupération grille.' });
    }
});

/**
 * POST /api/admin/price-tiers/:product_id
 * Upload XLSX → parse → valide → remplace la grille + snapshot historique + notif si palier change
 */
app.post('/api/admin/price-tiers/:product_id', requireAdmin, uploadLimiter, uploadXlsx.single('file'), (req, res) => {
    try {
        if (!isPositiveIntegerParam(req.params.product_id)) return res.status(400).json({ success: false, message: 'product_id invalide.' });
        const product_id = Number(req.params.product_id);

        const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(product_id);
        if (!product) return res.status(404).json({ success: false, message: 'Produit non trouvé.' });

        if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier reçu.' });

        // Vérification magic bytes ZIP/OOXML
        if (!checkXlsxMagicBytes(req.file.buffer)) {
            return res.status(400).json({ success: false, message: 'Fichier invalide. Le fichier doit être un vrai .xlsx (format OOXML).' });
        }

        // Parse XLSX
        let wb;
        try {
            wb = XLSX.read(req.file.buffer, { type: 'buffer', sheetRows: 1000 });
        } catch(e) {
            return res.status(400).json({ success: false, message: 'Impossible de lire le fichier XLSX.' });
        }

        const sheetName = wb.SheetNames[0];
        if (!sheetName) return res.status(400).json({ success: false, message: 'Le fichier XLSX ne contient aucune feuille.' });

        const worksheet = wb.Sheets[sheetName];
        const fullRange = worksheet['!fullref'] || worksheet['!ref'] || 'A1:A1';
        if (XLSX.utils.decode_range(fullRange).e.r > 999) {
            return res.status(400).json({ success: false, message: 'La grille ne peut pas contenir plus de 999 paliers.' });
        }
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });

        if (!rows.length) {
            return res.status(400).json({ success: false, message: 'La feuille est vide ou ne contient que des entêtes.' });
        }
        if (rows.length > 999) {
            return res.status(400).json({ success: false, message: 'La grille ne peut pas contenir plus de 999 paliers.' });
        }

        // Normalisation des clés (insensible à la casse et aux espaces)
        const normalize = (key) => String(key).toLowerCase().replace(/\s+/g, '_').replace(/[éèê]/g, 'e');
        const normalizedRows = rows.map(row => {
            const out = {};
            for (const [k, v] of Object.entries(row)) out[normalize(k)] = v;
            return out;
        });

        // Colonnes attendues
        const COL_MIN = 'quantite_min';
        const COL_MAX = 'quantite_max';
        const COL_PRICE = 'prix_unitaire';

        // Vérifier que les colonnes existent
        const firstRow = normalizedRows[0];
        if (!(COL_MIN in firstRow) || !(COL_PRICE in firstRow)) {
            return res.status(400).json({ success: false, message: 'Colonnes manquantes. Le fichier doit contenir : quantite_min, quantite_max, prix_unitaire.' });
        }

        // Construire et valider les paliers
        const newTiers = [];
        for (let i = 0; i < normalizedRows.length; i++) {
            const row = normalizedRows[i];
            const qty_min = Number(row[COL_MIN]);
            const qty_max = row[COL_MAX] !== null && row[COL_MAX] !== '' ? Number(row[COL_MAX]) : null;
            const unit_price = Number(row[COL_PRICE]);

            if (!Number.isSafeInteger(qty_min) || qty_min < 1) {
                return res.status(400).json({ success: false, message: `Ligne ${i+2} : quantite_min invalide (doit être >= 1).` });
            }
            if (!Number.isFinite(unit_price) || unit_price <= 0 || unit_price > 100000) {
                return res.status(400).json({ success: false, message: `Ligne ${i+2} : prix_unitaire invalide (doit être > 0).` });
            }
            if (qty_max !== null && (!Number.isSafeInteger(qty_max) || qty_max <= qty_min)) {
                return res.status(400).json({ success: false, message: `Ligne ${i+2} : quantite_max doit être supérieure à quantite_min, ou vide pour le dernier palier.` });
            }

            // Seul le dernier palier peut avoir qty_max null
            const isLast = i === normalizedRows.length - 1;
            if (!isLast && qty_max === null) {
                return res.status(400).json({ success: false, message: `Ligne ${i+2} : seul le dernier palier peut avoir quantite_max vide.` });
            }
            if (isLast && qty_max !== null) {
                return res.status(400).json({ success: false, message: `Dernière ligne (${i+2}) : le dernier palier doit avoir quantite_max vide (illimité).` });
            }

            newTiers.push({ qty_min, qty_max, unit_price });
        }

        // Vérifier la continuité (pas de trous ni chevauchements)
        for (let i = 1; i < newTiers.length; i++) {
            const prev = newTiers[i - 1];
            const curr = newTiers[i];
            if (prev.qty_max !== curr.qty_min) {
                return res.status(400).json({ success: false, message: `Paliers non continus entre ligne ${i+1} et ${i+2} : quantite_max de la ligne ${i+1} (${prev.qty_max}) doit être égale à quantite_min de la ligne ${i+2} (${curr.qty_min}).` });
            }
        }

        // Snapshot du palier actif AVANT remplacement (pour notif)
        const priceBefore = getCurrentPrice(product_id);

        // Transaction : remplacer la grille + snapshot historique
        const nowIso = new Date().toISOString();
        db.transaction(() => {
            db.prepare('DELETE FROM price_tiers WHERE product_id = ?').run(product_id);
            const insertTier = db.prepare('INSERT INTO price_tiers (product_id, qty_min, qty_max, unit_price, created_at) VALUES (?, ?, ?, ?, ?)');
            for (const t of newTiers) {
                insertTier.run(product_id, t.qty_min, t.qty_max, t.unit_price, nowIso);
            }
            db.prepare('INSERT INTO price_tier_history (product_id, uploaded_at, tiers_json) VALUES (?, ?, ?)').run(product_id, nowIso, JSON.stringify(newTiers));
        })();

        // Détecter changement de palier actif et notifier (non bloquant)
        ;(async () => {
            const priceAfter = getCurrentPrice(product_id);
            if (priceBefore && priceAfter
                && priceBefore.tier_id !== priceAfter.tier_id
                && priceAfter.unit_price < priceBefore.unit_price) {
                const alreadySent = db.prepare('SELECT id FROM tier_notifications_sent WHERE product_id = ? AND tier_id = ?').get(product_id, priceAfter.tier_id);
                if (!alreadySent) {
                    await sendTierChangeEmail(product_id, priceBefore.unit_price, priceAfter.unit_price);
                }
            }
        })().catch(err => console.error('Erreur notification palier après upload:', err));

        // Retourner la nouvelle grille
        const tiers = db.prepare('SELECT * FROM price_tiers WHERE product_id = ? ORDER BY qty_min ASC').all(product_id);
        const currentPrice = getCurrentPrice(product_id);

        return res.json({
            success: true,
            message: `Grille tarifaire mise à jour (${newTiers.length} palier(s)).`,
            tiers,
            current_price: currentPrice,
        });
    } catch(error) {
        console.error('Erreur POST price-tiers:', error);
        return res.status(500).json({ success: false, message: 'Erreur mise à jour grille tarifaire.' });
    }
});

// ─── Route Logo
app.get('/favicon.ico', (req, res) => {
    try {
        const row = db.prepare("SELECT valeur FROM settings WHERE cle = 'logo_url'").get();
        const match = row?.valeur?.match(/^\/uploads\/(logo-custom\.(?:jpg|png|webp))$/);
        const customLogo = match ? path.join(uploadsDir, match[1]) : null;
        res.set('Cache-Control', 'no-store');
        return res.redirect(302, customLogo && fs.existsSync(customLogo) ? match[0] : '/logo.svg');
    } catch(e) {
        console.error('Erreur récupération favicon:', e);
        return res.status(500).send('Erreur récupération favicon.');
    }
});

app.get('/api/logo', (req, res) => {
    try {
        const row = db.prepare("SELECT valeur FROM settings WHERE cle = 'logo_url'").get();
        return res.json({ success: true, url: row ? row.valeur : '/logo.svg' });
    } catch(e) { return res.json({ success: true, url: '/logo.svg' }); }
});

app.get('/api/logo/image', (req, res) => {
    try {
        const row = db.prepare("SELECT valeur FROM settings WHERE cle = 'logo_url'").get();
        const match = row?.valeur?.match(/^\/uploads\/(logo-custom\.(?:jpg|png|webp))$/);
        const customLogo = match ? path.join(uploadsDir, match[1]) : null;
        const logoPath = customLogo && fs.existsSync(customLogo)
            ? customLogo
            : path.join(__dirname, '../public/logo.svg');
        res.set('Cache-Control', 'no-store');
        return res.sendFile(logoPath);
    } catch(e) {
        console.error('Erreur récupération logo:', e);
        return res.status(500).send('Erreur récupération logo.');
    }
});

app.post('/api/admin/logo', requireAdmin, uploadLimiter, upload.single('logo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier reçu.' });
        const detectedMime = checkMagicBytes(req.file.buffer);
        if (!detectedMime) return res.status(400).json({ success: false, message: 'Fichier invalide. JPEG, PNG ou WebP uniquement.' });
        const ext = detectedMime === 'image/jpeg' ? 'jpg' : detectedMime === 'image/png' ? 'png' : 'webp';
        const oldRow = db.prepare("SELECT valeur FROM settings WHERE cle = 'logo_url'").get();
        const oldFile = getLogoUploadPath(oldRow?.valeur);
        if (oldFile && fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
        const filename = `logo-custom.${ext}`;
        const destPath = path.join(uploadsDir, filename);
        fs.writeFileSync(destPath, req.file.buffer);
        const logoUrl = `/uploads/${filename}`;
        db.prepare("INSERT INTO settings (cle, valeur) VALUES ('logo_url', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(logoUrl);
        return res.json({ success: true, url: logoUrl });
    } catch(e) {
        console.error('Erreur upload logo:', e);
        return res.status(500).json({ success: false, message: 'Erreur upload logo.' });
    }
});

// ─── Production Static Serving
const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.get(['/admin-print', '/admin-print.html'], requireAdmin, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(distPath, 'admin-print.html'));
    });
    app.use(express.static(distPath));
    app.get('/admin', (req, res) => res.sendFile(path.join(distPath, 'admin.html')));
    app.get('/admin.html', (req, res) => res.sendFile(path.join(distPath, 'admin.html')));
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) return res.sendFile(path.join(distPath, 'index.html'));
        next();
    });
}

// Multer error handler
app.use((err, req, res, next) => {
    if (err) {
        if (err.message && err.message.includes('File too large')) return res.status(400).json({ success: false, message: 'Fichier trop volumineux.' });
        if (err.message && (err.message.includes('MIME') || err.message.includes('Extension') || err.code === 'LIMIT_UNEXPECTED_FILE')) return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
});

app.listen(PORT, () => {
    console.log('Serveur API ACELSPACE démarré sur http://localhost:' + PORT);
    scheduleBackups(db, purgeExpiredPersonalData);
});

export default app;