"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProductDetails = exports.getSalesPage = exports.adjustStock = exports.completeSale = exports.getPosCatalog = exports.beginOfflineSession = void 0;
exports.actor = actor;
exports.validateSale = validateSale;
const firestore_js_1 = require("./firestore.js");
const https_1 = require("firebase-functions/v2/https");
const node_crypto_1 = require("node:crypto");
const region = 'asia-south1';
const integer = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
async function actor(uid, roles = ['admin', 'manager', 'cashier']) {
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'Sign in is required.');
    const p = (await (0, firestore_js_1.getFirestore)().doc(`users/${uid}`).get()).data();
    if (!p || p.status !== 'active' || !roles.includes(p.role))
        throw new https_1.HttpsError('permission-denied', 'Active authorized staff required.');
    return p;
}
function validateSale(d) {
    if (!d || !id(d.clientSaleId) || !id(d.deviceId) || !Array.isArray(d.lines) || !d.lines.length || d.lines.length > 100)
        throw new https_1.HttpsError('invalid-argument', 'Invalid sale identifier or items.');
    const keys = new Set();
    for (const l of d.lines) {
        const key = `${l.productId}:${l.variantId || ''}`;
        if (!id(l.productId) || (l.variantId && !id(l.variantId)) || keys.has(key) || !integer(l.quantity) || l.quantity < 1 || l.quantity > 100000 || !integer(l.unitPrice) || l.unitPrice < 0 || !integer(l.discount) || l.discount < 0 || l.discount > l.unitPrice * l.quantity)
            throw new https_1.HttpsError('invalid-argument', 'Invalid or duplicate sale line.');
        keys.add(key);
    }
    if (!integer(d.billDiscount) || d.billDiscount < 0 || !Number.isFinite(d.taxRate) || d.taxRate < 0 || d.taxRate > 100 || !Array.isArray(d.payments) || !d.payments.length || d.payments.length > 10 || d.payments.some((p) => !['cash', 'card', 'bank', 'qr', 'credit'].includes(p.method) || !integer(p.amount) || p.amount < 0))
        throw new https_1.HttpsError('invalid-argument', 'Invalid payment, tax or discount.');
    if (d.offline && d.payments.some((p) => p.method !== 'cash'))
        throw new https_1.HttpsError('invalid-argument', 'Offline sales accept cash only.');
    if (typeof d.localReceiptNumber !== 'string' || d.localReceiptNumber.length > 100 || !Number.isFinite(Date.parse(d.completedAt)))
        throw new https_1.HttpsError('invalid-argument', 'Receipt metadata required.');
}
exports.beginOfflineSession = (0, https_1.onCall)({ region }, async (r) => {
    const user = await actor(r.auth?.uid);
    if (!id(r.data?.deviceId))
        throw new https_1.HttpsError('invalid-argument', 'Device ID required.');
    const ref = (0, firestore_js_1.getFirestore)().collection('offlineSessions').doc(), expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    await ref.set({ uid: r.auth.uid, branchId: user.branchId, deviceId: r.data.deviceId, issuedAt: Date.now(), expiresAt });
    return { id: ref.id, expiresAt };
});
exports.getPosCatalog = (0, https_1.onCall)({ region }, async (r) => {
    const user = await actor(r.auth?.uid, ['admin', 'manager', 'cashier', 'inventory', 'accountant']);
    let q = (0, firestore_js_1.getFirestore)().collection('products').where('branchId', '==', user.branchId).orderBy(firestore_js_1.FieldPath.documentId()).limit(200);
    if (r.data?.cursor) {
        if (!id(r.data.cursor))
            throw new https_1.HttpsError('invalid-argument', 'Invalid cursor.');
        q = q.startAfter(r.data.cursor);
    }
    const snap = await q.get();
    // Explicit allowlist: do not send costs or supplier/private fields to POS storage.
    const items = snap.docs.filter(s => s.data().status === 'active').map(s => {
        const p = s.data();
        return { id: s.id, branchId: p.branchId, name: p.name, sku: p.sku, barcode: p.barcode || '', categoryId: p.categoryId, brandId: p.brandId, imageUrl: p.imageUrl || '', sellingPrice: p.sellingPrice, minimumSellingPrice: p.minimumSellingPrice || 0, stock: p.stock, minimumStock: p.minimumStock, unit: p.unit, status: p.status, variants: (p.variants || []).map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode || '', size: v.size || '', color: v.color || '', sellingPrice: v.sellingPrice, stock: v.stock, minimumStock: v.minimumStock, status: v.status })) };
    });
    return { items, cursor: snap.size === 200 ? snap.docs.at(-1).id : null };
});
exports.completeSale = (0, https_1.onCall)({ region }, async (r) => {
    const user = await actor(r.auth?.uid), d = r.data;
    validateSale(d);
    const ownerRecovery = user.role === 'admin' && typeof d.approvalReason === 'string' && d.approvalReason.trim().length >= 10;
    if (d.cashier?.id !== r.auth.uid && !ownerRecovery)
        throw new https_1.HttpsError('permission-denied', 'Cashier identity mismatch. Owner approval required for recovery.');
    const db = (0, firestore_js_1.getFirestore)(), key = d.clientSaleId, saleRef = db.doc(`sales/${key}`), receiptRef = db.doc(`saleRequests/${key}`);
    const fingerprint = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({ lines: d.lines, billDiscount: d.billDiscount, taxRate: d.taxRate, payments: d.payments, customer: d.customer || null, cashier: d.cashier, deviceId: d.deviceId, offline: !!d.offline, sessionId: d.sessionId || null, localReceiptNumber: d.localReceiptNumber })).digest('hex');
    return db.runTransaction(async (tx) => {
        const existing = await tx.get(receiptRef);
        if (existing.exists) {
            const old = existing.data();
            if (old.branchId !== user.branchId || old.fingerprint !== fingerprint)
                throw new https_1.HttpsError('already-exists', 'Sale ID was already used for different contents.');
            return old.result;
        }
        const settings = (await tx.get(db.doc('settings/business'))).data() || {};
        const expectedTax = settings.taxEnabled ? Number(settings.taxRate) : 0;
        if (d.taxRate !== expectedTax && !ownerRecovery)
            throw new https_1.HttpsError('failed-precondition', 'Tax settings changed. Owner must review this pending receipt.');
        if (d.offline) {
            if (!id(d.sessionId))
                throw new https_1.HttpsError('permission-denied', 'Authorized offline session required.');
            const session = (await tx.get(db.doc(`offlineSessions/${d.sessionId}`))).data(), soldAt = Date.parse(d.completedAt);
            if (!session || session.uid !== d.cashier.id || session.deviceId !== d.deviceId || session.branchId !== user.branchId || soldAt < session.issuedAt || soldAt > session.expiresAt || soldAt > Date.now() + 60000)
                throw new https_1.HttpsError('permission-denied', 'Offline authorization is invalid or expired at checkout.');
        }
        const subtotal = d.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0), itemDiscount = d.lines.reduce((s, l) => s + l.discount, 0), discount = itemDiscount + d.billDiscount;
        if (discount > subtotal)
            throw new https_1.HttpsError('invalid-argument', 'Discount exceeds subtotal.');
        const tax = Math.round((subtotal - discount) * d.taxRate / 100), grandTotal = subtotal - discount + tax;
        const tendered = d.payments.reduce((s, p) => s + p.amount, 0), credit = d.payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0), cash = d.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0), change = tendered - grandTotal;
        if (![subtotal, discount, tax, grandTotal, tendered].every(integer) || change < 0 || change > cash || credit > grandTotal)
            throw new https_1.HttpsError('invalid-argument', 'Payment must cover the total; change can only be returned from cash.');
        let customer;
        if (d.customer?.id) {
            if (!id(d.customer.id))
                throw new https_1.HttpsError('invalid-argument', 'Invalid customer.');
            customer = (await tx.get(db.doc(`customers/${d.customer.id}`))).data();
            if (!customer || customer.branchId !== user.branchId || customer.status !== 'active')
                throw new https_1.HttpsError('invalid-argument', 'Customer unavailable.');
        }
        if (credit && (!customer || (customer.currentCredit || 0) + credit > (customer.creditLimit || 0)))
            throw new https_1.HttpsError('failed-precondition', 'Customer credit limit exceeded.');
        const ids = [...new Set(d.lines.map((l) => l.productId))], products = new Map();
        for (const pid of ids) {
            const snap = await tx.get(db.doc(`products/${pid}`));
            if (!snap.exists)
                throw new https_1.HttpsError('not-found', 'Product no longer exists.');
            products.set(pid, snap.data());
        }
        const year = new Date().getUTCFullYear(), counterRef = db.doc(`counters/invoice-${year}`), counter = await tx.get(counterRef), sequence = (counter.data()?.value || 0) + 1, invoiceNumber = `INV-${year}-${String(sequence).padStart(6, '0')}`;
        let cost = 0, cumulativeBase = 0, cumulativeNet = 0;
        const items = d.lines.map((l) => {
            const p = products.get(l.productId);
            if (p.branchId !== user.branchId || p.status !== 'active')
                throw new https_1.HttpsError('failed-precondition', 'Product is unavailable.');
            const v = l.variantId ? (p.variants || []).find((x) => x.id === l.variantId) : undefined;
            if ((l.variantId && !v) || (!l.variantId && p.variants?.length) || (v && v.status !== 'active'))
                throw new https_1.HttpsError('failed-precondition', 'Choose an active product variant.');
            const stock = v ? v.stock : p.stock, price = v ? v.sellingPrice : p.sellingPrice, unitCost = v ? v.buyingPrice : (p.averageCost ?? p.buyingPrice ?? 0);
            if (stock < l.quantity)
                throw new https_1.HttpsError('failed-precondition', `Stock conflict: ${p.name}. Owner must reconcile stock before retrying this receipt.`);
            if (l.unitPrice !== price && !ownerRecovery)
                throw new https_1.HttpsError('failed-precondition', `Price changed for ${p.name}; owner review required.`);
            const lineBase = l.quantity * l.unitPrice - l.discount, base = subtotal - itemDiscount;
            const billShare = base ? Math.round(d.billDiscount * (cumulativeBase + lineBase) / base) - Math.round(d.billDiscount * cumulativeBase / base) : 0;
            cumulativeBase += lineBase;
            const net = lineBase - billShare, taxBase = grandTotal - tax, taxShare = taxBase ? Math.round(tax * (cumulativeNet + net) / taxBase) - Math.round(tax * cumulativeNet / taxBase) : 0;
            cumulativeNet += net;
            if (user.role === 'cashier' && settings.requireManagerBelowMinimum !== false && net < l.quantity * (p.minimumSellingPrice || 0))
                throw new https_1.HttpsError('permission-denied', 'Manager approval required below minimum selling price.');
            if (!integer(unitCost) || unitCost < 0)
                throw new https_1.HttpsError('failed-precondition', 'Product cost requires correction.');
            cost += unitCost * l.quantity;
            if (v)
                v.stock -= l.quantity;
            p.stock -= l.quantity;
            tx.set(db.collection('stockMovements').doc(), { branchId: user.branchId, productId: l.productId, variantId: l.variantId || null, type: 'sale', quantity: -l.quantity, beforeStock: stock, afterStock: stock - l.quantity, referenceId: saleRef.id, createdBy: r.auth.uid, createdAt: firestore_js_1.FieldValue.serverTimestamp() });
            return { productId: l.productId, variantId: l.variantId || null, productName: p.name, sku: v?.sku || p.sku, variantDescription: l.variantLabel || null, quantity: l.quantity, unitPrice: l.unitPrice, costPrice: unitCost, discount: l.discount + billShare, lineTotal: net, tax: taxShare, refundTotal: net + taxShare, returnedQuantity: 0 };
        });
        for (const [pid, p] of products)
            tx.update(db.doc(`products/${pid}`), { stock: p.stock, variants: p.variants || [], updatedAt: firestore_js_1.FieldValue.serverTimestamp() });
        const result = { id: saleRef.id, invoiceNumber, subtotal, discount, tax, grandTotal, paid: grandTotal - credit, balance: credit, change };
        tx.set(saleRef, { ...result, branchId: user.branchId, clientSaleId: d.clientSaleId, deviceId: d.deviceId, localReceiptNumber: d.localReceiptNumber, completedAt: d.completedAt, offline: !!d.offline, customerId: d.customer?.id || null, customerName: customer?.name || 'Walk-in Customer', cashierId: d.cashier.id, cashierName: d.cashier.name, items, cost, grossProfit: grandTotal - tax - cost, payments: d.payments, paymentStatus: credit ? 'partial' : 'paid', status: 'completed', createdAt: firestore_js_1.FieldValue.serverTimestamp(), createdBy: r.auth.uid });
        if (credit) {
            tx.update(db.doc(`customers/${d.customer.id}`), { currentCredit: firestore_js_1.FieldValue.increment(credit), currentBalance: firestore_js_1.FieldValue.increment(credit) });
            tx.set(db.collection('customerTransactions').doc(), { branchId: user.branchId, customerId: d.customer.id, type: 'sale', referenceId: saleRef.id, debit: credit, credit: 0, date: firestore_js_1.FieldValue.serverTimestamp(), createdBy: r.auth.uid });
        }
        let remainingChange = change;
        for (const p of d.payments) {
            if (p.method === 'credit' || !p.amount)
                continue;
            const deduction = p.method === 'cash' ? Math.min(p.amount, remainingChange) : 0;
            remainingChange -= deduction;
            tx.set(db.collection('payments').doc(), { branchId: user.branchId, type: 'sale-payment', referenceId: saleRef.id, amount: p.amount - deduction, paymentMethod: p.method, date: firestore_js_1.FieldValue.serverTimestamp(), createdAt: firestore_js_1.FieldValue.serverTimestamp(), createdBy: r.auth.uid });
        }
        tx.set(counterRef, { value: sequence }, { merge: true });
        tx.set(receiptRef, { branchId: user.branchId, fingerprint, result, createdAt: firestore_js_1.FieldValue.serverTimestamp() });
        tx.set(db.collection('auditLogs').doc(), { branchId: user.branchId, userId: r.auth.uid, userName: user.name, action: ownerRecovery ? 'APPROVE_OFFLINE_SALE' : 'SALE', module: 'sales', referenceId: saleRef.id, description: ownerRecovery ? d.approvalReason : `Completed ${invoiceNumber}`, timestamp: firestore_js_1.FieldValue.serverTimestamp() });
        return result;
    });
});
exports.adjustStock = (0, https_1.onCall)({ region }, async (r) => {
    const user = await actor(r.auth?.uid, ['admin', 'manager', 'inventory']), d = r.data;
    if (!id(d.productId) || !id(d.operationId) || !integer(d.quantity) || !d.quantity || typeof d.reason !== 'string' || d.reason.trim().length < 3 || !['adjustment', 'damage', 'lost', 'internal-use', 'opening-stock'].includes(d.type))
        throw new https_1.HttpsError('invalid-argument', 'Invalid stock adjustment.');
    if (['damage', 'lost', 'internal-use'].includes(d.type) && d.quantity > 0)
        throw new https_1.HttpsError('invalid-argument', 'This adjustment must reduce stock.');
    const db = (0, firestore_js_1.getFirestore)(), ref = db.doc(`products/${d.productId}`), movement = db.doc(`stockAdjustments/${d.operationId}`);
    return db.runTransaction(async (tx) => {
        const old = await tx.get(movement);
        if (old.exists) {
            if (old.data().createdBy !== r.auth.uid)
                throw new https_1.HttpsError('permission-denied', 'Operation belongs to another user.');
            return { id: movement.id };
        }
        const p = (await tx.get(ref)).data();
        if (!p || p.branchId !== user.branchId)
            throw new https_1.HttpsError('not-found', 'Product unavailable.');
        const v = d.variantId ? (p.variants || []).find((v) => v.id === d.variantId) : undefined;
        if ((d.variantId && !v) || (!d.variantId && p.variants?.length))
            throw new https_1.HttpsError('invalid-argument', 'Select a variant.');
        const before = v ? v.stock : p.stock;
        if (before + d.quantity < 0)
            throw new https_1.HttpsError('failed-precondition', 'Insufficient stock.');
        if (v)
            v.stock += d.quantity;
        tx.update(ref, { stock: p.stock + d.quantity, variants: p.variants || [], updatedAt: firestore_js_1.FieldValue.serverTimestamp() });
        const record = { branchId: user.branchId, productId: d.productId, variantId: d.variantId || null, type: d.type, quantity: d.quantity, beforeStock: before, afterStock: before + d.quantity, reason: d.reason.trim(), referenceId: movement.id, createdBy: r.auth.uid, createdAt: firestore_js_1.FieldValue.serverTimestamp() };
        tx.set(movement, record);
        tx.set(db.doc(`stockMovements/${movement.id}`), record);
        tx.set(db.collection('auditLogs').doc(), { branchId: user.branchId, userId: r.auth.uid, userName: user.name, action: 'ADJUST_STOCK', module: 'inventory', referenceId: movement.id, description: d.reason, timestamp: firestore_js_1.FieldValue.serverTimestamp() });
        return { id: movement.id };
    });
});
exports.getSalesPage = (0, https_1.onCall)({ region }, async (r) => {
    const user = await actor(r.auth?.uid, ['admin', 'manager', 'cashier', 'accountant']);
    let q = (0, firestore_js_1.getFirestore)().collection('sales').where('branchId', '==', user.branchId).orderBy(firestore_js_1.FieldPath.documentId()).limit(200);
    if (r.data?.cursor) {
        if (!id(r.data.cursor))
            throw new https_1.HttpsError('invalid-argument', 'Invalid cursor.');
        q = q.startAfter(r.data.cursor);
    }
    const snap = await q.get();
    const items = snap.docs.map(s => { const p = s.data(); return { id: s.id, branchId: p.branchId, invoiceNumber: p.invoiceNumber, customerId: p.customerId, customerName: p.customerName, cashierId: p.cashierId, cashierName: p.cashierName, items: p.items.map((i) => ({ productId: i.productId, variantId: i.variantId, productName: i.productName, sku: i.sku, variantDescription: i.variantDescription, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount, lineTotal: i.lineTotal, returnedQuantity: i.returnedQuantity || 0 })), subtotal: p.subtotal, discount: p.discount, tax: p.tax, grandTotal: p.grandTotal, paid: p.paid, balance: p.balance, change: p.change, payments: p.payments, paymentStatus: p.paymentStatus, status: p.status, createdAtMillis: p.createdAt?.toMillis() || 0 }; });
    return { items, cursor: snap.size === 200 ? snap.docs.at(-1).id : null };
});
exports.updateProductDetails = (0, https_1.onCall)({ region }, async (r) => {
    const user = await actor(r.auth?.uid, ['admin', 'manager', 'inventory']), d = r.data;
    if (!id(d.id) || !d.changes || typeof d.changes.name !== 'string' || !d.changes.name.trim() || typeof d.changes.sku !== 'string' || !d.changes.sku.trim())
        throw new https_1.HttpsError('invalid-argument', 'Product details required.');
    const db = (0, firestore_js_1.getFirestore)(), ref = db.doc(`products/${d.id}`);
    await db.runTransaction(async (tx) => {
        const p = (await tx.get(ref)).data();
        if (!p || p.branchId !== user.branchId)
            throw new https_1.HttpsError('permission-denied', 'Product unavailable.');
        const c = d.changes, changes = {};
        for (const key of ['name', 'sku', 'barcode', 'categoryId', 'brandId', 'description', 'imageUrl', 'unit', 'status'])
            if (c[key] !== undefined) {
                if (typeof c[key] !== 'string' || c[key].length > 4000)
                    throw new https_1.HttpsError('invalid-argument', 'Invalid text field.');
                changes[key] = c[key];
            }
        for (const key of ['buyingPrice', 'sellingPrice', 'wholesalePrice', 'minimumSellingPrice', 'minimumStock'])
            if (c[key] !== undefined) {
                if (!integer(c[key]) || c[key] < 0)
                    throw new https_1.HttpsError('invalid-argument', 'Invalid price or stock threshold.');
                changes[key] = c[key];
            }
        const variants = c.variants ?? p.variants ?? [];
        if (!Array.isArray(variants) || variants.length > 100 || new Set(variants.map((v) => v.id)).size !== variants.length)
            throw new https_1.HttpsError('invalid-argument', 'Invalid variants.');
        if ((p.variants || []).some((old) => !variants.some((v) => v.id === old.id)))
            throw new https_1.HttpsError('failed-precondition', 'Preserve existing variants and their history. Archive instead.');
        changes.variants = variants.map((v) => { const old = (p.variants || []).find((x) => x.id === v.id); if (!id(v.id) || typeof v.sku !== 'string' || !v.sku.trim() || !integer(v.sellingPrice) || v.sellingPrice < 0 || !integer(v.buyingPrice) || v.buyingPrice < 0)
            throw new https_1.HttpsError('invalid-argument', 'Invalid variant.'); return { id: v.id, sku: v.sku, barcode: String(v.barcode || ''), size: String(v.size || ''), color: String(v.color || ''), buyingPrice: v.buyingPrice, sellingPrice: v.sellingPrice, minimumStock: integer(v.minimumStock) ? Math.max(0, v.minimumStock) : 0, status: v.status === 'inactive' ? 'inactive' : 'active', stock: old?.stock || 0 }; });
        if (!(p.variants || []).length && variants.length && p.stock)
            throw new https_1.HttpsError('failed-precondition', 'Reconcile base stock to zero before adding variants.');
        tx.update(ref, { ...changes, updatedAt: firestore_js_1.FieldValue.serverTimestamp(), updatedBy: r.auth.uid });
        tx.set(db.collection('auditLogs').doc(), { branchId: user.branchId, userId: r.auth.uid, userName: user.name, action: 'UPDATE_PRODUCT', module: 'products', referenceId: d.id, description: 'Updated product metadata; preserved inventory and average cost.', timestamp: firestore_js_1.FieldValue.serverTimestamp() });
    });
    return { id: d.id };
});
