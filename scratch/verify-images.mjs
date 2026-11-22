import fs from 'fs';

async function run() {
    // 1. Login
    const loginRes = await fetch('http://localhost:3000/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'admin' }) // wait, password is admin123?
    });
    console.log('Login res status:', loginRes.status);
    let cookie = loginRes.headers.get('set-cookie');
    if (!loginRes.ok) {
        const retry = await fetch('http://localhost:3000/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'admin123' })
        });
        console.log('Login admin123 res status:', retry.status);
        cookie = retry.headers.get('set-cookie');
    }
    console.log('Cookie:', cookie);

    // 2. Create a 10x10 valid PNG buffer
    // PNG 1x1 base64: iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    
    // 3. Try POST /api/admin/products with FormData
    const formData = new FormData();
    formData.append('name', 'Produit Test Auto');
    formData.append('price', '19.99');
    formData.append('description', 'Test upload image');
    formData.append('sizes', JSON.stringify(['S', 'M']));
    formData.append('featured', '0');
    formData.append('requires_customization', '0');
    formData.append('customization_fields', '');
    formData.append('allow_no_customization', '1');
    const blob = new Blob([pngBuffer], { type: 'image/png' });
    formData.append('image', blob, 'test.png');

    const addRes = await fetch('http://localhost:3000/api/admin/products', {
        method: 'POST',
        headers: {
            'Cookie': cookie ? cookie.split(';')[0] : '',
            'Origin': 'http://localhost:3000'
        },
        body: formData
    });
    console.log('Add product status:', addRes.status);
    const addData = await addRes.json();
    console.log('Add product response:', addData.success ? 'Success! Products count: ' + addData.products?.length : addData);

    const created = addData.products?.find(p => p.name === 'Produit Test Auto');
    console.log('Created product image path:', created?.image);

    if (created?.image) {
        const imgUrl = 'http://localhost:3000' + created.image;
        const imgRes = await fetch(imgUrl);
        console.log('Fetch image HTTP status:', imgRes.status, 'Content-Type:', imgRes.headers.get('content-type'), 'Length:', imgRes.headers.get('content-length'));
    }

    // 4. Also check GET /api/products
    const prodRes = await fetch('http://localhost:3000/api/products');
    const prodData = await prodRes.json();
    const publicCreated = prodData.products?.find(p => p.name === 'Produit Test Auto');
    console.log('Public product in /api/products:', publicCreated ? { id: publicCreated.id, name: publicCreated.name, image: publicCreated.image } : 'Not found');
}

run().catch(console.error);

