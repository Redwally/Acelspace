export const PRODUCTS_CATALOG = {
    'club-shirt': {
        id: 'club-shirt',
        name: 'T-shirt',
        price: 30,
        sizes: ['M', 'L', 'XL', 'XXL']
    },
    'club-pen': {
        id: 'club-pen',
        name: 'Stylo',
        price: 10,
        sizes: ['S', 'M', 'L', 'XL', 'Taille unique']
    },
    'club-mousepad': {
        id: 'club-mousepad',
        name: 'Tapis de souris',
        price: 18,
        sizes: ['Taille unique']
    },
    'usb-key': {
        id: 'usb-key',
        name: 'Cle usb',
        price: 15,
        sizes: ['32 GO', 'Taille unique']
    }
};

/**
 * Finds a product from the catalog by ID or exact name
 */
export function findProduct(identifier) {
    if (!identifier) return null;
    const cleanId = String(identifier).trim().toLowerCase();
    
    // Direct ID match
    if (PRODUCTS_CATALOG[cleanId]) {
        return PRODUCTS_CATALOG[cleanId];
    }
    
    // Name match
    for (const prod of Object.values(PRODUCTS_CATALOG)) {
        if (prod.name.toLowerCase() === cleanId || prod.id.toLowerCase() === cleanId) {
            return prod;
        }
    }
    
    return null;
}
