/**
 * products.js — helpers to look up products from the SQLite database.
 * The static PRODUCTS_CATALOG is kept for backward compatibility during migration
 * but findProduct now reads from the DB.
 */
import db from './database.js';

/**
 * Find an active product by its numeric DB id or by exact name match.
 * Returns { id, name, price, sizes } or null.
 */
export function findProduct(identifier) {
    if (!identifier) return null;
    const clean = String(identifier).trim();

    // Try numeric id first
    const byId = db.prepare(
        `SELECT id, name, price, sizes FROM products WHERE actif = 1 AND id = ?`
    ).get(Number(clean));
    if (byId) {
        return { ...byId, sizes: JSON.parse(byId.sizes || '["Taille unique"]') };
    }

    // Try exact name match (case-insensitive, legacy support)
    const byName = db.prepare(
        `SELECT id, name, price, sizes FROM products WHERE actif = 1 AND LOWER(name) = LOWER(?)`
    ).get(clean);
    if (byName) {
        return { ...byName, sizes: JSON.parse(byName.sizes || '["Taille unique"]') };
    }

    return null;
}