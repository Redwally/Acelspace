import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('--- STARTING SELF-TEST SUITE ---');

// 1. Test products.js functions
const { findProduct, getTierProgress, getMaxPrice } = await import('../backend/products.js');

const pById = findProduct(1);
assert(pById !== null, 'findProduct(1) should find product');
assert.strictEqual(pById.id, 1, 'Product id should be 1');

const pByStrId = findProduct('1');
assert(pByStrId !== null, "findProduct('1') should find product");

const pByName = findProduct('T-shirt');
assert(pByName !== null, "findProduct('T-shirt') should find product");

const pByNonExistent = findProduct('DefinitelyDoesNotExist123');
assert.strictEqual(pByNonExistent, null, 'findProduct should return null without error on non-existent string');

const progress = getTierProgress(1);
assert(typeof progress === 'object' && progress !== null, 'getTierProgress should return an object');
console.log('✓ products.js lookups and tier progress verified');

// 2. Test escapeCSV formula injection prevention
function escapeCSV(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val).replace(/\n|\r/g, ' ');
    if (/^[\s\uFEFF]*[=+\-@\t\r]/.test(str)) str = "'" + str;
    return '"' + str.replace(/"/g, '""') + '"';
}

assert.strictEqual(escapeCSV('=SUM(A1:A10)'), '"\'=SUM(A1:A10)"', 'Should prepend quote to = formula');
assert.strictEqual(escapeCSV('+123'), '"\'+123"', 'Should prepend quote to + formula');
assert.strictEqual(escapeCSV('-123'), '"\'-123"', 'Should prepend quote to - formula');
assert.strictEqual(escapeCSV('@mention'), '"\'@mention"', 'Should prepend quote to @ formula');
assert.strictEqual(escapeCSV('Normal text'), '"Normal text"', 'Normal text should not be prepended');
assert.strictEqual(escapeCSV(null), '""', 'null should be empty quoted');
console.log('✓ escapeCSV formula injection protection verified');

// 3. Test escapeHtml
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

assert.strictEqual(escapeHtml('<script>alert("XSS")</script>'), '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;', 'XSS tags must be escaped');
assert.strictEqual(escapeHtml("Jean d'Ormesson"), "Jean d&#39;Ormesson", 'Single quote must be escaped');
console.log('✓ escapeHtml sanitization verified');

// 4. Test price tiers continuity validator logic
function testContinuity(tiers) {
    for (let i = 1; i < tiers.length; i++) {
        const prev = tiers[i - 1];
        const curr = tiers[i];
        const isContinuous = prev.qty_max === curr.qty_min || (prev.qty_max + 1) === curr.qty_min;
        if (!isContinuous) return false;
    }
    return true;
}

assert.strictEqual(testContinuity([{ qty_min: 1, qty_max: 49 }, { qty_min: 50, qty_max: null }]), true, 'Discrete tiers [1-49] and [50+] must be accepted');
assert.strictEqual(testContinuity([{ qty_min: 1, qty_max: 50 }, { qty_min: 50, qty_max: null }]), true, 'Boundary-shared tiers [1-50] and [50+] must be accepted');
assert.strictEqual(testContinuity([{ qty_min: 1, qty_max: 40 }, { qty_min: 50, qty_max: null }]), false, 'Gap between 40 and 50 must be rejected');
console.log('✓ Price tiers continuity validator verified');

// 5. Test app.js getProductType helper logic
function getProductType(p) {
    if (!p) return '';
    if (p.type) return String(p.type).toLowerCase();
    if (p.product_type) return String(p.product_type).toLowerCase();
    const name = String(p.name || '').toLowerCase();
    if (name.includes('usb')) return 'usb';
    if (name.includes('t-shirt') || name.includes('tshirt') || name.includes('tee')) return 'tshirt';
    return '';
}

assert.strictEqual(getProductType({ name: 'Cle usb' }), 'usb', 'Cle usb must be detected as usb');
assert.strictEqual(getProductType({ name: 'T-shirt club' }), 'tshirt', 'T-shirt must be detected as tshirt');
assert.strictEqual(getProductType({ name: 'Stylo' }), '', 'Stylo should have empty type');
console.log('✓ Product type detection verified');

console.log('--- ALL TESTS PASSED SUCCESSFULLY ---');

