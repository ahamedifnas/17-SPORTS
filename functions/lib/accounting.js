"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.voidSale = exports.completeSalesReturn = void 0;
exports.returnedShare = returnedShare;
exports.processSalesReturn = processSalesReturn;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const checkout_js_1 = require("./checkout.js");
const region = 'asia-south1';
const int = (n) => typeof n === 'number' && Number.isSafeInteger(n);
/** Cumulative allocation gives the final returned unit every rounding remainder. */
function returnedShare(total, quantity, previous, returned) { return Math.round(total * (previous + returned) / quantity) - Math.round(total * previous / quantity); }
async function processSalesReturn(r, full = false) {
    const user = await (0, checkout_js_1.actor)(r.auth?.uid, full ? ['admin', 'manager'] : ['admin', 'manager', 'cashier']), d = r.data, db = (0, firestore_1.getFirestore)();
    if (!d.saleId || (!full && (!Array.isArray(d.items) || !d.items.length || d.items.length > 100 || new Set(d.items.map((i) => i.index)).size !== d.items.length)) || typeof d.reason !== 'string' || d.reason.trim().length < 3 || (!full && !['cash', 'card', 'bank', 'qr'].includes(d.refundMethod)))
        throw new https_1.HttpsError('invalid-argument', 'Invalid return or refund method.');
    return db.runTransaction(async (tx) => {
        const saleRef = db.doc(`sales/${d.saleId}`), sale = (await tx.get(saleRef)).data();
        if (!sale || sale.branchId !== user.branchId || !['completed', 'partially-returned'].includes(sale.status))
            throw new https_1.HttpsError('failed-precondition', 'Sale is not returnable.');
        if (full) {
            if (sale.status !== 'completed' || sale.payments.some((p) => !['cash', 'credit'].includes(p.method)))
                throw new https_1.HttpsError('failed-precondition', 'Use Sales Returns to select the verified refund method for this invoice.');
            d.items = sale.items.map((i, index) => ({ index, quantity: i.quantity }));
            d.refundMethod = 'cash';
        }
        const previous = await tx.get(db.collection('salesReturns').where('saleId', '==', d.saleId).where('status', '==', 'completed'));
        const already = new Map();
        previous.docs.forEach(s => s.data().items.forEach((i) => already.set(i.index, (already.get(i.index) || 0) + i.quantity)));
        const netBase = sale.items.reduce((n, i) => n + i.lineTotal, 0);
        // Older invoices lack allocated bill-discount/tax snapshots. Allocate their actual total cumulatively.
        let cumulative = 0;
        const refundTotals = sale.items.map((i) => { const start = cumulative; cumulative += i.lineTotal; return i.refundTotal ?? (netBase ? Math.round(sale.grandTotal * cumulative / netBase) - Math.round(sale.grandTotal * start / netBase) : 0); });
        const items = d.items.map((i) => {
            const sold = sale.items[i.index], before = already.get(i.index) || 0;
            if (!int(i.index) || !sold || !int(i.quantity) || i.quantity < 1 || i.quantity > sold.quantity - before)
                throw new https_1.HttpsError('failed-precondition', 'Quantity exceeds remaining sold units.');
            return { index: i.index, productId: sold.productId, variantId: sold.variantId || null, productName: sold.productName, sku: sold.sku, quantity: i.quantity, amount: returnedShare(refundTotals[i.index], sold.quantity, before, i.quantity), tax: returnedShare(sold.tax ?? Math.round(sale.tax * (netBase ? sold.lineTotal / netBase : 0)), sold.quantity, before, i.quantity) };
        });
        const products = new Map();
        for (const pid of new Set(items.map((i) => i.productId))) {
            const p = (await tx.get(db.doc(`products/${pid}`))).data();
            if (!p || p.branchId !== user.branchId)
                throw new https_1.HttpsError('failed-precondition', 'Returned product unavailable.');
            products.set(pid, p);
        }
        const customer = sale.customerId ? (await tx.get(db.doc(`customers/${sale.customerId}`))).data() : undefined;
        const counterRef = db.doc(`counters/sales-return-${new Date().getUTCFullYear()}`), counter = await tx.get(counterRef), sequence = (counter.data()?.value || 0) + 1;
        const returnRef = db.collection('salesReturns').doc(), returnNumber = `SR-${new Date().getUTCFullYear()}-${String(sequence).padStart(6, '0')}`, total = items.reduce((s, i) => s + i.amount, 0), creditReduction = Math.min(total, sale.balance || 0, customer?.currentCredit || 0), refund = total - creditReduction;
        for (const i of items) {
            const p = products.get(i.productId), v = i.variantId ? (p.variants || []).find((v) => v.id === i.variantId) : undefined;
            if (i.variantId && !v)
                throw new https_1.HttpsError('failed-precondition', 'Returned variant unavailable.');
            const before = v ? v.stock : p.stock;
            if (v)
                v.stock += i.quantity;
            p.stock += i.quantity;
            tx.set(db.collection('stockMovements').doc(), { branchId: user.branchId, productId: i.productId, variantId: i.variantId, type: 'sales-return', quantity: i.quantity, beforeStock: before, afterStock: before + i.quantity, referenceId: returnRef.id, createdAt: firestore_1.FieldValue.serverTimestamp(), createdBy: r.auth.uid });
        }
        for (const [pid, p] of products)
            tx.update(db.doc(`products/${pid}`), { stock: p.stock, variants: p.variants || [], updatedAt: firestore_1.FieldValue.serverTimestamp() });
        const allReturned = sale.items.every((i, index) => i.quantity === (already.get(index) || 0) + (items.find((x) => x.index === index)?.quantity || 0));
        tx.update(saleRef, { status: allReturned ? 'returned' : 'partially-returned', balance: Math.max(0, (sale.balance || 0) - creditReduction), updatedAt: firestore_1.FieldValue.serverTimestamp() });
        tx.set(returnRef, { branchId: user.branchId, returnNumber, saleId: d.saleId, invoiceNumber: sale.invoiceNumber, customerId: sale.customerId || null, customerName: sale.customerName, items, total, tax: items.reduce((s, i) => s + i.tax, 0), creditReduction, refundAmount: refund, refundMethod: d.refundMethod, reason: d.reason.trim(), notes: String(d.notes || ''), returnDate: d.returnDate || new Date().toISOString().slice(0, 10), status: 'completed', createdAt: firestore_1.FieldValue.serverTimestamp(), createdBy: r.auth.uid });
        if (creditReduction)
            tx.update(db.doc(`customers/${sale.customerId}`), { currentCredit: firestore_1.FieldValue.increment(-creditReduction), currentBalance: firestore_1.FieldValue.increment(-creditReduction) });
        if (refund)
            tx.set(db.collection('payments').doc(), { branchId: user.branchId, type: 'refund', referenceId: returnRef.id, amount: refund, paymentMethod: d.refundMethod, date: d.returnDate || new Date().toISOString().slice(0, 10), createdAt: firestore_1.FieldValue.serverTimestamp(), createdBy: r.auth.uid });
        tx.set(counterRef, { value: sequence }, { merge: true });
        tx.set(db.collection('auditLogs').doc(), { branchId: user.branchId, userId: r.auth.uid, userName: user.name, action: 'SALE_RETURN', module: 'sales-returns', referenceId: returnRef.id, description: d.reason, timestamp: firestore_1.FieldValue.serverTimestamp() });
        return { id: returnRef.id, returnNumber, total };
    });
}
exports.completeSalesReturn = (0, https_1.onCall)({ region }, r => processSalesReturn(r));
exports.voidSale = (0, https_1.onCall)({ region }, r => processSalesReturn(r, true));
