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
        `SELECT id, name, price, sizes, requires_customization, allow_no_customization FROM products WHERE actif = 1 AND id = ?`
    ).get(Number(clean));
    if (byId) {
        return { ...byId, sizes: JSON.parse(byId.sizes || '["Taille unique"]') };
    }

    // Try exact name match (case-insensitive, legacy support)
    const byName = db.prepare(
        `SELECT id, name, price, sizes, requires_customization, allow_no_customization FROM products WHERE actif = 1 AND LOWER(name) = LOWER(?)`
    ).get(clean);
    if (byName) {
        return { ...byName, sizes: JSON.parse(byName.sizes || '["Taille unique"]') };
    }

    return null;
}

export function getTierProgress(product_id) {
    const current = db.prepare(`
        SELECT COALESCE(SUM(quantite), 0) as quantity
        FROM precommandes
        WHERE product_id = ? AND statut != 'annulee'
    `).get(product_id);
    const current_quantity = Number(current?.quantity) || 0;
    const tiers = db.prepare(`
        SELECT qty_min, unit_price
        FROM price_tiers
        WHERE product_id = ?
        ORDER BY qty_min ASC
    `).all(product_id);
    const next = tiers.find(tier => tier.qty_min > current_quantity);

    if (!next) {
        return {
            current_quantity,
            next_tier: null,
            max_tier_reached: tiers.length > 0 && current_quantity >= tiers[tiers.length - 1].qty_min,
            progress_percent: tiers.length > 0 && current_quantity >= tiers[tiers.length - 1].qty_min ? 100 : 0
        };
    }

    const previous = [...tiers].reverse().find(tier => tier.qty_min <= current_quantity);
    const rangeStart = previous?.qty_min || 0;
    const rangeSize = next.qty_min - rangeStart;
    return {
        current_quantity,
        next_tier: {
            qty_min: next.qty_min,
            unit_price: next.unit_price,
            remaining_for_next_tier: next.qty_min - current_quantity
        },
        max_tier_reached: false,
        progress_percent: Math.min(100, Math.max(0, ((current_quantity - rangeStart) / rangeSize) * 100))
    };
}

export function getMaxPrice(product_id, defaultPrice) {
    const tier = db.prepare(`
        SELECT MAX(unit_price) AS max_price
        FROM price_tiers
        WHERE product_id = ?
    `).get(product_id);

    return tier?.max_price ?? defaultPrice;
}