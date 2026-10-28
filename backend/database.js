import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path outside public folder
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
}
fs.chmodSync(dbDir, 0o700);

const dbPath = path.join(dbDir, 'precommandes.sqlite');
const db = new Database(dbPath);
fs.chmodSync(dbPath, 0o600);

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
        status TEXT NOT NULL DEFAULT 'EN_ATTENTE_PAIEMENT',
        consentement INTEGER NOT NULL DEFAULT 1 CHECK (consentement IN (0, 1)),
        date_consentement TEXT,
        date_creation TEXT NOT NULL,
        product_id INTEGER,
        personnalisation TEXT,
        no_customization INTEGER NOT NULL DEFAULT 0,
        notify_price_drops INTEGER NOT NULL DEFAULT 0,
        student_first_name TEXT,
        student_last_name TEXT
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
if (!precommandeCols.includes('remarques')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN remarques TEXT;`);
}
if (!precommandeCols.includes('personnalisation')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN personnalisation TEXT;`);
}
if (!precommandeCols.includes('notify_price_drops')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN notify_price_drops INTEGER NOT NULL DEFAULT 0;`);
}
if (!precommandeCols.includes('no_customization')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN no_customization INTEGER NOT NULL DEFAULT 0;`);
}
if (!precommandeCols.includes('status')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN status TEXT NOT NULL DEFAULT 'EN_ATTENTE_PAIEMENT';`);
}
if (!precommandeCols.includes('student_first_name')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN student_first_name TEXT;`);
}
if (!precommandeCols.includes('student_last_name')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN student_last_name TEXT;`);
}
db.prepare(`
    UPDATE precommandes
    SET status = 'EN_ATTENTE_PAIEMENT'
    WHERE status IS NULL
       OR status NOT IN ('EN_ATTENTE_PAIEMENT', 'PAYE', 'EN_COMMANDE', 'PRET_AU_LOCAL', 'REMIS', 'ANNULE')
`).run();
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
        date_creation TEXT NOT NULL,
        requires_customization INTEGER NOT NULL DEFAULT 0,
        customization_fields TEXT NOT NULL DEFAULT '',
        image_url_2 TEXT,
        allow_no_customization INTEGER NOT NULL DEFAULT 1,
        detail_table_image TEXT
    );
`);

const productCols = db.pragma('table_info(products)').map(c => c.name);
if (!productCols.includes('requires_customization')) {
    db.exec(`ALTER TABLE products ADD COLUMN requires_customization INTEGER NOT NULL DEFAULT 0;`);
}
if (!productCols.includes('customization_fields')) {
    db.exec(`ALTER TABLE products ADD COLUMN customization_fields TEXT NOT NULL DEFAULT '';`);
}
if (!productCols.includes('image_url_2')) {
    db.exec(`ALTER TABLE products ADD COLUMN image_url_2 TEXT;`);
}
if (!productCols.includes('allow_no_customization')) {
    db.exec(`ALTER TABLE products ADD COLUMN allow_no_customization INTEGER NOT NULL DEFAULT 1;`);
}
if (!productCols.includes('detail_table_image')) {
    db.exec(`ALTER TABLE products ADD COLUMN detail_table_image TEXT;`);
}
const productsWithLegacyCustomizationSize = db.prepare(`
    SELECT id, sizes FROM products WHERE sizes LIKE '%SANS PERSONNALISATION%'
`).all();
if (productsWithLegacyCustomizationSize.length > 0) {
    const updateSizes = db.prepare('UPDATE products SET sizes = ? WHERE id = ?');
    db.transaction(() => {
        for (const product of productsWithLegacyCustomizationSize) {
            const sizes = JSON.parse(product.sizes || '[]')
                .filter(size => size !== 'SANS PERSONNALISATION');
            updateSizes.run(JSON.stringify(sizes.length > 0 ? sizes : ['Taille unique']), product.id);
        }
    })();
}
db.prepare(`
    UPDATE products
    SET customization_fields = 'Informations à personnaliser'
    WHERE requires_customization = 1
      AND (customization_fields IS NULL OR trim(customization_fields) = '')
`).run();

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
        insertProduct.run('Stylo', 10, 'Stylo officiel aux couleurs du club AcelSpace.',
            JSON.stringify(['S', 'M', 'L', 'XL']),
            '/images/products/acelspace-pen.jpg', 0, 2, now);
        insertProduct.run('Tapis de souris', 18, 'Tapis de souris avec le logo officiel du club AcelSpace.',
            JSON.stringify(['Taille unique']),
            '/images/products/acelspace-mousepad.jpg', 0, 3, now);
        insertProduct.run('Cle usb', 15, 'Cle USB 32 Go aux couleurs officielles du club AcelSpace.',
            JSON.stringify(['32 GO']),
            '/images/products/acelspace-usb.jpg', 0, 4, now);
    })();
}

// ─── Règle Vedette : Seul un produit actif peut être vedette ──────────────────
// Nettoie l'anomalie où un produit archivé est marqué vedette
db.exec(`UPDATE products SET featured = 0 WHERE actif = 0;`);

// ─── Prix Dégressifs ──────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS price_tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        qty_min INTEGER NOT NULL,
        qty_max INTEGER,        -- NULL = dernier palier (illimité)
        unit_price REAL NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_tier_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        uploaded_at TEXT NOT NULL,
        tiers_json TEXT NOT NULL -- snapshot JSON complet de la grille
    );

    CREATE TABLE IF NOT EXISTS tier_notifications_sent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        tier_id INTEGER NOT NULL,   -- id du palier actif au moment de l'envoi
        sent_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_price_tiers_product ON price_tiers (product_id);
    CREATE INDEX IF NOT EXISTS idx_tier_notif_product ON tier_notifications_sent (product_id, tier_id);
`);

// ─── Fonction : Prix courant pour un produit ──────────────────────────────────
/**
 * Calcule le prix unitaire courant d'un produit selon la quantité totale
 * des précommandes non-annulées.
 *
 * @param {number} product_id
 * @returns {{ unit_price: number, tier_id: number, qty_total: number } | null}
 *   null si aucune grille n'est définie pour ce produit.
 */
export function getCurrentPrice(product_id) {
    // Vérifie qu'une grille existe
    const tierCount = db.prepare(`
        SELECT COUNT(*) as c FROM price_tiers WHERE product_id = ?
    `).get(product_id);

    if (!tierCount || tierCount.c === 0) return null;

    // Somme des quantités commandées (précommandes non-annulées)
    const row = db.prepare(`
        SELECT COALESCE(SUM(quantite), 0) as total
        FROM precommandes
        WHERE product_id = ? AND statut != 'annulee'
    `).get(product_id);

    const qty_total = row ? row.total : 0;

    // Palier actif : qty_min <= total < qty_max, ou dernier palier (qty_max IS NULL)
    const tier = db.prepare(`
        SELECT id, unit_price
        FROM price_tiers
        WHERE product_id = ?
          AND qty_min <= ?
          AND (qty_max IS NULL OR qty_max > ?)
        ORDER BY qty_min DESC
        LIMIT 1
    `).get(product_id, qty_total, qty_total);

    if (!tier) {
        // qty_total inférieur au premier palier : prendre le premier palier quand même
        const firstTier = db.prepare(`
            SELECT id, unit_price
            FROM price_tiers
            WHERE product_id = ?
            ORDER BY qty_min ASC
            LIMIT 1
        `).get(product_id);

        if (!firstTier) return null;
        return { unit_price: firstTier.unit_price, tier_id: firstTier.id, qty_total };
    }

    return { unit_price: tier.unit_price, tier_id: tier.id, qty_total };
}

// ─── Fonction : Emails clients ayant précommandé un produit ───────────────────
/**
 * Retourne les emails distincts des clients ayant demandé les notifications
 * de baisse de prix pour une précommande non-annulée de ce produit.
 *
 * @param {number} product_id
 * @returns {string[]}
 */
export function getClientsForProduct(product_id) {
    const rows = db.prepare(`
        SELECT DISTINCT email
        FROM precommandes
        WHERE product_id = ?
          AND statut != 'annulee'
          AND notify_price_drops = 1
          AND email IS NOT NULL
          AND email != ''
    `).all(product_id);

    return rows.map(r => r.email);
}

export function purgeExpiredPersonalData() {
    return db.transaction(() => {
        const orders = db.prepare(`
            DELETE FROM precommandes
            WHERE datetime(date_creation) < datetime('now', '-3 years')
        `).run();
        const clients = db.prepare(`
            DELETE FROM clients
            WHERE datetime(date_creation) < datetime('now', '-3 years')
              AND NOT EXISTS (
                  SELECT 1 FROM precommandes WHERE precommandes.client_id = clients.id
              )
        `).run();
        return { ordersDeleted: orders.changes, clientsDeleted: clients.changes };
    })();
}

export default db;