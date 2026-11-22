import assert from 'assert';

const baseUrl = 'http://localhost:3000';
const origin = 'http://localhost:3000';

async function testAll() {
    console.log('=== LANCEMENT DU TEST END-TO-END COMPLET SUR PORT 3000 ===');

    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBuffer = Buffer.from(pngBase64, 'base64');

    // 1. GET /api/products
    console.log('\n--- 1. Catalogue public ---');
    const catalogRes = await fetch(`${baseUrl}/api/products`);
    assert.strictEqual(catalogRes.status, 200, 'GET /api/products doit renvoyer 200');
    const catalogData = await catalogRes.json();
    assert.strictEqual(catalogData.success, true, 'Catalogue doit success: true');
    console.log(`✓ Catalogue récupéré : ${catalogData.products.length} produits actifs.`);

    // 2. Admin Login
    console.log('\n--- 2. Authentification Admin ---');
    const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({ password: 'admin123' })
    });
    assert.strictEqual(loginRes.status, 200, 'Login admin doit renvoyer 200');
    const setCookie = loginRes.headers.get('set-cookie');
    assert(setCookie, 'Un cookie de session doit être retourné');
    const adminCookie = setCookie.split(';')[0];
    console.log('✓ Login admin réussi avec cookie de session.');

    const authCheckRes = await fetch(`${baseUrl}/api/admin/check-auth`, {
        headers: { 'Cookie': adminCookie, 'Origin': origin }
    });
    assert.strictEqual(authCheckRes.status, 200, 'Check-auth doit renvoyer 200');
    console.log('✓ Vérification de session admin OK.');

    // 3. Upload direct d'image via /api/admin/upload
    console.log('\n--- 3. Upload image via /api/admin/upload ---');
    const uploadFormData = new FormData();
    uploadFormData.append('image', new Blob([pngBuffer], { type: 'image/png' }), 'test-upload.png');
    const uploadRes = await fetch(`${baseUrl}/api/admin/upload`, {
        method: 'POST',
        headers: { 'Cookie': adminCookie, 'Origin': origin },
        body: uploadFormData
    });
    assert.strictEqual(uploadRes.status, 200, 'Upload image doit renvoyer 200');
    const uploadData = await uploadRes.json();
    assert.strictEqual(uploadData.success, true);
    assert(uploadData.url.startsWith('/uploads/'), 'URL image doit commencer par /uploads/');
    console.log(`✓ Image téléversée avec succès : ${uploadData.url}`);

    // Vérifier l'accès HTTP à l'image téléversée
    const imgFetchRes = await fetch(`${baseUrl}${uploadData.url}`);
    assert.strictEqual(imgFetchRes.status, 200, 'Image téléversée accessible par HTTP');
    assert.strictEqual(imgFetchRes.headers.get('content-type'), 'image/png');
    console.log('✓ Image téléversée servie avec succès en HTTP 200 image/png.');

    // 4. Création de produit avec image téléversée (req.body.image)
    console.log('\n--- 4. Création produit avec URL image ---');
    const prodFormData = new FormData();
    prodFormData.append('name', 'Casquette E2E Upload');
    prodFormData.append('price', '22.50');
    prodFormData.append('description', 'Superbe casquette test');
    prodFormData.append('sizes', JSON.stringify(['Unique']));
    prodFormData.append('featured', '0');
    prodFormData.append('requires_customization', '0');
    prodFormData.append('customization_fields', '');
    prodFormData.append('allow_no_customization', '1');
    prodFormData.append('image', uploadData.url);

    const createRes = await fetch(`${baseUrl}/api/admin/products`, {
        method: 'POST',
        headers: { 'Cookie': adminCookie, 'Origin': origin },
        body: prodFormData
    });
    assert.strictEqual(createRes.status, 201, 'Création produit doit renvoyer 201');
    const createData = await createRes.json();
    const createdProd = createData.products.find(p => p.name === 'Casquette E2E Upload');
    assert(createdProd, 'Le produit créé doit être dans la liste');
    assert.strictEqual(createdProd.image, uploadData.url, 'L\'image du produit doit correspondre');
    console.log(`✓ Produit créé avec succès (ID: ${createdProd.id}, Image: ${createdProd.image}).`);

    // 5. Création de produit avec fichier image direct (req.file)
    console.log('\n--- 5. Création produit avec fichier direct ---');
    const prodFileFormData = new FormData();
    prodFileFormData.append('name', 'Gourde E2E Direct');
    prodFileFormData.append('price', '15.00');
    prodFileFormData.append('description', 'Gourde inox');
    prodFileFormData.append('sizes', JSON.stringify(['500ml', '750ml']));
    prodFileFormData.append('featured', '0');
    prodFileFormData.append('requires_customization', '0');
    prodFileFormData.append('customization_fields', '');
    prodFileFormData.append('allow_no_customization', '1');
    prodFileFormData.append('image', new Blob([pngBuffer], { type: 'image/png' }), 'gourde.png');

    const createFileRes = await fetch(`${baseUrl}/api/admin/products`, {
        method: 'POST',
        headers: { 'Cookie': adminCookie, 'Origin': origin },
        body: prodFileFormData
    });
    assert.strictEqual(createFileRes.status, 201);
    const createFileResult = await createFileRes.json();
    const createdFileProd = createFileResult.products.find(p => p.name === 'Gourde E2E Direct');
    assert(createdFileProd, 'Produit direct créé');
    assert(createdFileProd.image && createdFileProd.image.startsWith('/uploads/'), 'Image doit être dans /uploads/');
    console.log(`✓ Produit avec fichier direct créé (ID: ${createdFileProd.id}, Image: ${createdFileProd.image}).`);

    // Vérifier l'image du produit direct
    const directImgRes = await fetch(`${baseUrl}${createdFileProd.image}`);
    assert.strictEqual(directImgRes.status, 200);
    console.log('✓ Image du produit direct accessible en HTTP 200.');

    // 6. Modification du produit (PATCH)
    console.log('\n--- 6. Modification produit (PATCH) ---');
    const patchFormData = new FormData();
    patchFormData.append('name', 'Casquette E2E Modifiée');
    patchFormData.append('price', '25.00');
    const patchRes = await fetch(`${baseUrl}/api/admin/products/${createdProd.id}`, {
        method: 'PATCH',
        headers: { 'Cookie': adminCookie, 'Origin': origin },
        body: patchFormData
    });
    assert.strictEqual(patchRes.status, 200);
    const patchData = await patchRes.json();
    const updated = patchData.products.find(p => p.id === createdProd.id);
    assert.strictEqual(updated.name, 'Casquette E2E Modifiée');
    assert.strictEqual(updated.price, 25);
    assert.strictEqual(updated.image, uploadData.url, 'L\'image existante doit être conservée');
    console.log('✓ Produit modifié avec succès, image intacte.');

    // 7. Passage de commande (POST /api/precommande)
    console.log('\n--- 7. Création de précommande ---');
    const orderPayload = {
        parent_prenom: 'Jean',
        parent_nom: 'Dupont',
        parent_email: 'jean.dupont@example.com',
        parent_telephone: '0612345678',
        enfant_prenom: 'Alice',
        enfant_nom: 'Dupont',
        consentement: true,
        lignes: [
            { product_id: createdProd.id, taille: 'Unique', quantite: 2, personnalisation: '' }
        ]
    };
    const orderRes = await fetch(`${baseUrl}/api/precommande`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify(orderPayload)
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok) console.error('Order error:', orderData);
    assert.strictEqual(orderRes.status, 201, 'Commande doit être créée (201)');
    assert.strictEqual(orderData.success, true);
    console.log(`✓ Précommande validée avec succès (201 Created).`);

    // 8. Suivi de commande avec OTP challenge
    console.log('\n--- 8. Suivi de commande (OTP) ---');
    const codeReqRes = await fetch(`${baseUrl}/api/precommandes/suivi/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({ email: 'jean.dupont@example.com' })
    });
    assert([200, 503].includes(codeReqRes.status), 'Demande de code OTP doit renvoyer 200 (avec SMTP) ou 503 (sans SMTP configuré)');
    console.log(`✓ Code OTP testé (Statut: ${codeReqRes.status} - ${codeReqRes.status === 200 ? 'email envoyé' : 'indisponible car pas de compte SMTP configuré'}).`);

    // 9. Contact form
    console.log('\n--- 9. Formulaire de contact ---');
    const contactRes = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({
            nom: 'Dupont',
            prenom: 'Jean',
            email: 'jean.dupont@example.com',
            message: 'Bonjour, ceci est un test.'
        })
    });
    assert([200, 503].includes(contactRes.status), 'Contact doit renvoyer 200 (avec SMTP) ou 503 (sans SMTP configuré)');
    console.log(`✓ Message de contact testé (Statut: ${contactRes.status} - ${contactRes.status === 200 ? 'envoyé' : 'indisponible car pas de compte SMTP'}).`);

    // 10. Nettoyage des produits créés pour le test
    console.log('\n--- 10. Nettoyage des produits de test ---');
    // Supprimer le produit direct (pas de commande liée)
    const delFileRes = await fetch(`${baseUrl}/api/admin/products/${createdFileProd.id}`, {
        method: 'DELETE',
        headers: { 'Cookie': adminCookie, 'Origin': origin }
    });
    assert.strictEqual(delFileRes.status, 200);
    console.log(`✓ Produit ${createdFileProd.id} supprimé.`);

    // Produit lié à une commande : la suppression doit être rejetée avec 409 (intégrité référentielle)
    const delLinkedRes = await fetch(`${baseUrl}/api/admin/products/${createdProd.id}`, {
        method: 'DELETE',
        headers: { 'Cookie': adminCookie, 'Origin': origin }
    });
    assert.strictEqual(delLinkedRes.status, 409, 'Suppression refusée car commande liée');
    console.log('✓ Protection intégrité référentielle validée (refus 409).');

    // 11. Nettoyer aussi les produits tests résiduels
    const currentProds = await (await fetch(`${baseUrl}/api/admin/products`, { headers: { 'Cookie': adminCookie } })).json();
    for (const p of currentProds.products) {
        if (p.name.includes('Test Produit') || p.name.includes('Test Auto')) {
            await fetch(`${baseUrl}/api/admin/products/${p.id}`, { method: 'DELETE', headers: { 'Cookie': adminCookie, 'Origin': origin } });
        }
    }

    console.log('\n=============================================');
    console.log('TOUS LES TESTS E2E SONT PASSÉS AVEC SUCCÈS !');
    console.log('=============================================');
}

testAll()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('ÉCHEC DES TESTS E2E :', err);
        process.exit(1);
    });
