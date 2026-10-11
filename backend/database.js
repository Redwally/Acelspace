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

// Helper: normalize contact string (lowercase, trimmed, without initial @, stripped spaces)
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

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        contact TEXT NOT NULL,
        contact_normalise TEXT UNIQUE NOT NULL,
        date_creation TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clients_contact_norm ON clients (contact_normalise);

    CREATE TABLE IF NOT EXISTS precommandes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER REFERENCES clients(id),
        nom TEXT NOT NULL,
        contact TEXT NOT NULL,
        produit TEXT NOT NULL,
        taille TEXT NOT NULL,
        quantite INTEGER NOT NULL CHECK (quantite >= 1 AND quantite <= 10),
        prix_estime REAL NOT NULL CHECK (prix_estime >= 0),
        statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'confirmee', 'livree', 'annulee')),
        consentement INTEGER NOT NULL DEFAULT 1 CHECK (consentement IN (0, 1)),
        date_consentement TEXT,
        date_creation TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_precommandes_statut ON precommandes (statut);
    CREATE INDEX IF NOT EXISTS idx_precommandes_produit ON precommandes (produit);
    CREATE INDEX IF NOT EXISTS idx_precommandes_date ON precommandes (date_creation);
`);

// Migrations for precommandes table
const columns = db.pragma('table_info(precommandes)').map(c => c.name);

if (!columns.includes('consentement')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN consentement INTEGER NOT NULL DEFAULT 1;`);
}
if (!columns.includes('date_consentement')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN date_consentement TEXT;`);
    db.exec(`UPDATE precommandes SET date_consentement = date_creation WHERE date_consentement IS NULL;`);
}
if (!columns.includes('client_id')) {
    db.exec(`ALTER TABLE precommandes ADD COLUMN client_id INTEGER REFERENCES clients(id);`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_precommandes_client_id ON precommandes (client_id);`);

// Populate / link clients for any legacy orders lacking client_id
const unlinkedOrders = db.prepare(`SELECT id, nom, contact, date_creation FROM precommandes WHERE client_id IS NULL`).all();
if (unlinkedOrders.length > 0) {
    const findClientStmt = db.prepare(`SELECT id FROM clients WHERE contact_normalise = ?`);
    const insertClientStmt = db.prepare(`INSERT INTO clients (nom, contact, contact_normalise, date_creation) VALUES (?, ?, ?, ?)`);
    const updateOrderStmt = db.prepare(`UPDATE precommandes SET client_id = ? WHERE id = ?`);

    const migrateTx = db.transaction(() => {
        for (const order of unlinkedOrders) {
            const norm = normalizeContact(order.contact);
            let client = findClientStmt.get(norm);
            let clientId;
            if (client) {
                clientId = client.id;
            } else {
                const res = insertClientStmt.run(
                    order.nom || 'Client',
                    order.contact || '',
                    norm,
                    order.date_creation || new Date().toISOString()
                );
                clientId = res.lastInsertRowid;
            }
            updateOrderStmt.run(clientId, order.id);
        }
    });
    migrateTx();
}

// Settings table for pre-orders state & closure message
db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        cle TEXT PRIMARY KEY,
        valeur TEXT NOT NULL
    );
`);

// Insert default settings if absent
const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (cle, valeur) VALUES (?, ?)`);
insertSetting.run('precommandes_ouvertes', '1');
insertSetting.run('message_fermeture', 'Les précommandes sont terminées. Merci !');

export default db;
