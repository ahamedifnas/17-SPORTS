"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProduct = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const checkout_js_1 = require("./checkout.js");
exports.createProduct = (0, https_1.onCall)({ region: 'asia-south1' }, async (r) => {
    const user = await (0, checkout_js_1.actor)(r.auth?.uid, ['admin', 'manager', 'inventory']), d = r.data, db = (0, firestore_1.getFirestore)();
    const nonnegative = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
    if (!d || typeof d.name !== 'string' || !d.name.trim() || typeof d.sku !== 'string' || !d.sku.trim() || !Array.isArray(d.variants) || d.variants.length > 100 || !['buyingPrice', 'sellingPrice', 'wholesalePrice', 'minimumSellingPrice', 'stock', 'minimumStock'].every(k => nonnegative(d[k])) || d.minimumSellingPrice > d.sellingPrice)
        throw new https_1.HttpsError('invalid-argument', 'Invalid product values.');
    const variants = d.variants.map((v) => {
        if (typeof v.id !== 'string' || !v.id || typeof v.sku !== 'string' || !v.sku || !['buyingPrice', 'sellingPrice', 'stock', 'minimumStock'].every(k => nonnegative(v[k])))
            throw new https_1.HttpsError('invalid-argument', 'Invalid variant values.');
        return { id: v.id, sku: v.sku.trim(), barcode: String(v.barcode || '').trim(), size: String(v.size || ''), color: String(v.color || ''), buyingPrice: v.buyingPrice, sellingPrice: v.sellingPrice, stock: v.stock, minimumStock: v.minimumStock, status: 'active' };
    });
    if (new Set(variants.map((v) => v.id)).size !== variants.length)
        throw new https_1.HttpsError('invalid-argument', 'Duplicate variant IDs.');
    const codes = [d.sku.trim(), String(d.barcode || '').trim(), ...variants.flatMap((v) => [v.sku, v.barcode])].filter(Boolean);
    if (new Set(codes).size !== codes.length)
        throw new https_1.HttpsError('invalid-argument', 'Use unique SKUs and barcodes for each product and variant.');
    const ref = db.collection('products').doc();
    return db.runTransaction(async (tx) => {
        const existing = await tx.get(db.collection('products').where('branchId', '==', user.branchId));
        const used = new Set(existing.docs.flatMap(s => { const p = s.data(); return [p.sku, p.barcode, ...(p.variants || []).flatMap((v) => [v.sku, v.barcode])].filter(Boolean); }));
        if (codes.some(c => used.has(c)))
            throw new https_1.HttpsError('already-exists', 'A product or variant already uses this SKU/barcode.');
        const stock = variants.length ? variants.reduce((n, v) => n + v.stock, 0) : d.stock, averageCost = variants.length && stock ? Math.round(variants.reduce((n, v) => n + v.stock * v.buyingPrice, 0) / stock) : d.buyingPrice;
        const p = { name: d.name.trim(), sku: d.sku.trim(), barcode: String(d.barcode || '').trim(), branchId: user.branchId, categoryId: String(d.categoryId || ''), brandId: String(d.brandId || ''), description: String(d.description || ''), imageUrl: String(d.imageUrl || ''), unit: String(d.unit || 'pcs'), buyingPrice: d.buyingPrice, averageCost, sellingPrice: d.sellingPrice, wholesalePrice: d.wholesalePrice, minimumSellingPrice: d.minimumSellingPrice, minimumStock: d.minimumStock, stock, variants, status: 'active', createdAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp(), createdBy: r.auth.uid, updatedBy: r.auth.uid };
        tx.set(ref, p);
        for (const v of variants.length ? variants : [{ id: null, stock }])
            if (v.stock)
                tx.set(db.collection('stockMovements').doc(), { branchId: user.branchId, productId: ref.id, variantId: v.id, type: 'opening-stock', quantity: v.stock, beforeStock: 0, afterStock: v.stock, referenceId: ref.id, createdAt: firestore_1.FieldValue.serverTimestamp(), createdBy: r.auth.uid });
        tx.set(db.collection('auditLogs').doc(), { branchId: user.branchId, userId: r.auth.uid, userName: user.name, action: 'CREATE_PRODUCT', module: 'products', referenceId: ref.id, description: `Created ${p.name}`, timestamp: firestore_1.FieldValue.serverTimestamp() });
        return { id: ref.id };
    });
});
