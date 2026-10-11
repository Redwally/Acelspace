import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path outside public folder
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'precommandes.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for performance & durability
db.pragma('journal_mode = WAL');

// ─── Helpers Validation & Normalisation ────────────────────────────────────────

// Helper: normalize email (lowercase, trimmed)
export function normalizeEmail(email) {
    if (!email) return '';
    return String(email).trim().toLowerCase();
}

// Helper: validate email
export function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim();
    if (trimmed.length < 5 || trimmed.length > 100) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// Helper: normalize phone (+ initial optionnel, chiffres uniquement au stockage)
export function normalizePhone(phone) {
    if (!phone) return '';
    const str = String(phone).trim();
    const hasPlus = str.startsWith('+');
    const digits = str.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
}

// Helper: validate phone (8 à 15 chiffres, espaces/points/tirets autorisés)
export function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const str = phone.trim();
    if (!/^\+?[0-9\s.\-_()]+$/.test(str)) return false;
    const digits = str.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
}

// Helper legacy: normalize contact string
export function normalizeContact(contact) {
    if (!contact) return '';
    return String(contact)
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/\s+/g, '');
}

// Helper: format client ID to "C-001" (at least 3 digits)
export function formatClientId(id) {
    if (id === null || id === undefined || isNaN(Number(id))) return '-';
    return `C-${String(id).padStart(3, '0')}`;
}

// ─── Tables Initiales ──────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        contact TEXT NOT NULL,
        contact_normalise TEXT,
        email TEXT,
        telephone TEXT,
        email_normalise TEXT,
        date_creation TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS precommandes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER REFERENCES clients(id),
        nom TEXT NOT NULL,
        contact TEXT NOT NULL,
        email TEXT,
        telephone TEXT,
        produit TEXT NOT NULL,
        taille TEXT NOT NULL,
        quantite INTEGER NOT NULL CHECK (quantite >= 1 AND quantite <= 10),
        prix_estime REAL NOT NULL CHECK (prix_estime >= 0),
        statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'confirmee', 'livree', 'annulee')),
        consentement INTEGER NOT NULL DEFAULT 1 CHECK (consentement IN (0, 1)),
        date_consentement TEXT,
        date_creation TEXT NOT NULL,
        product_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_precommandes_statut ON precommandes (statut);
    CREATE INDEX IF NOT EXISTS idx_precommandes_produit ON precommandes (produit);
    CREATE INDEX IF NOT EXISTS idx_precommandes_date ON precommandes (date_creation);
`);

// ─── Migrations Clients ───────────────────────────────────────────────────────

const clientCols = db.pragma('table_info(clients)').map(c => c.name);
if (!clientCols.includes('email')) {
    db.exec(`ALTER TABLE clients ADD COLUMN email TEXT;`);
}
if (!clientCols.includes('telephone')) {
    db.exec(`ALTER TABLE clients ADD COLUMN telephone TEXT;`);
}
if (!clientCols.includes('email_normalise')) {
    db.exec(`ALTER TABLE clients ADD COLUMN email_normalise TEXT;`);
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_email_norm ON clients (email_normalise);`);

// ─── Migrations Precommandes ──────────────────────────────────────────────────

const precommandeCols = db.pragma('table_info(precommandes)').map(c => c.name);
if (!precommandeCols.includes('consentement')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN consentement INTEGER NOT NULL DEFAULT 1;`);
}
if (!precommandeCols.includes('date_consentement')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN date_consentement TEXT;`);
    db.exec(`UPDATE precommandes SET date_consentement = date_creation WHERE date_consentement IS NULL;`);
}
if (!precommandeCols.includes('client_id')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN client_id INTEGER REFERENCES clients(id);`);
}
if (!precommandeCols.includes('product_id')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN product_id INTEGER;`);
}
if (!precommandeCols.includes('email')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN email TEXT;`);
}
if (!precommandeCols.includes('telephone')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN telephone TEXT;`);
}
if (!precommandeCols.includes('commande_ref')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN commande_ref TEXT;`);
}
// Migration : chaque ancienne ligne reçoit sa propre ref
db.exec(`UPDATE precommandes SET commande_ref = 'CMD-' || printf('%04d', id) WHERE commande_ref IS NULL;`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_precommandes_client_id ON precommandes (client_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_precommandes_commande_ref ON precommandes (commande_ref);`);

// Helper: générer une référence de commande unique
export function generateCommandeRef() {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `CMD-${dateStr}-${rand}`;
}

// ─── Migration données existantes : contact -> email si format email ─────────

const allLegacyClients = db.prepare(`SELECT id, contact, email FROM clients WHERE email IS NULL`).all();
if (allLegacyClients.length > 0) {
    const updateClientEmail = db.prepare(`UPDATE clients SET email = ?, email_normalise = ? WHERE id = ?`);
    db.transaction(() => {
        for (const cl of allLegacyClients) {
            if (isValidEmail(cl.contact)) {
                const norm = normalizeEmail(cl.contact);
                try {
                    updateClientEmail.run(norm, norm, cl.id);
                } catch {
                    // Ignorer en cas de doublon déjà existant
                }
            }
        }
    })();
}

const allLegacyOrders = db.prepare(`SELECT id, contact, email FROM precommandes WHERE email IS NULL`).all();
if (allLegacyOrders.length > 0) {
    const updateOrderEmail = db.prepare(`UPDATE precommandes SET email = ? WHERE id = ?`);
    db.transaction(() => {
        for (const ord of allLegacyOrders) {
            if (isValidEmail(ord.contact)) {
                updateOrderEmail.run(normalizeEmail(ord.contact), ord.id);
            }
        }
    })();
}

// ─── Settings Table ───────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        cle TEXT PRIMARY KEY,
        valeur TEXT NOT NULL
    );
`);

const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (cle, valeur) VALUES (?, ?)`);
insertSetting.run('precommandes_ouvertes', '1');
insertSetting.run('message_fermeture', 'Les precommandes sont terminees. Merci !');

// ─── Products Table ───────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        description TEXT,
        sizes TEXT NOT NULL DEFAULT '["Taille unique"]',
        image TEXT,
        featured INTEGER NOT NULL DEFAULT 0,
        actif INTEGER NOT NULL DEFAULT 1,
        ordre INTEGER NOT NULL DEFAULT 0,
        date_creation TEXT NOT NULL
    );
`);

// Seed products if table empty
const productCount = db.prepare(`SELECT COUNT(*) as c FROM products`).get();
if (productCount.c === 0) {
    const now = new Date().toISOString();
    const insertProduct = db.prepare(`
        INSERT INTO products (name, price, description, sizes, image, featured, actif, ordre, date_creation)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    db.transaction(() => {
        insertProduct.run('T-shirt', 30, 'T-shirt aux couleurs du club, avec votre nom et prenom.',
            JSON.stringify(['M', 'L', 'XL', 'XXL']),
            '/images/products/acelspace-shirt.jpg', 1, 1, now);
        insertProduct.run('Stylo', 10, 'Stylo officiel aux couleurs du club ACELSPACE.',
            JSON.stringify(['S', 'M', 'L', 'XL']),
            '/images/products/acelspace-pen.jpg', 0, 2, now);
        insertProduct.run('Tapis de souris', 18, 'Tapis de souris avec le logo officiel du club ACELSPACE.',
            JSON.stringify(['Taille unique']),
            '/images/products/acelspace-mousepad.jpg', 0, 3, now);
        insertProduct.run('Cle usb', 15, 'Cle USB 32 Go aux couleurs officielles du club ACELSPACE.',
            JSON.stringify(['32 GO']),
            '/images/products/acelspace-usb.jpg', 0, 4, now);
    })();
}

// ─── Règle Vedette : Seul un produit actif peut être vedette ──────────────────
// Nettoie l'anomalie où un produit archivé est marqué vedette
db.exec(`UPDATE products SET featured = 0 WHERE actif = 0;`);

export default db;