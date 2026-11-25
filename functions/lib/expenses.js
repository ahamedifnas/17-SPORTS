"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveExpense = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const checkout_js_1 = require("./checkout.js");
exports.saveExpense = (0, https_1.onCall)({ region: 'asia-south1' }, async (r) => {
    const user = await (0, checkout_js_1.actor)(r.auth?.uid, ['admin', 'manager', 'accountant']), d = r.data, db = (0, firestore_1.getFirestore)();
    if (typeof d.id !== 'string' || !/^[\w-]{1,128}$/.test(d.id))
        throw new https_1.HttpsError('invalid-argument', 'Expense identifier required.');
    const ref = db.doc(`expenses/${d.id}`);
    return db.runTransaction(async (tx) => {
        const old = (await tx.get(ref)).data();
        if (old && old.branchId !== user.branchId)
            throw new https_1.HttpsError('permission-denied', 'Expense unavailable.');
        if (d.archive) {
            if (!old)
                throw new https_1.HttpsError('not-found', 'Expense unavailable.');
            tx.update(ref, { status: 'archived', updatedAt: firestore_1.FieldValue.serverTimestamp(), updatedBy: r.auth.uid });
        }
        else {
            if (typeof d.description !== 'string' || d.description.trim().length < 2 || !Number.isSafeInteger(d.amount) || d.amount <= 0 || !['cash', 'card', 'bank', 'qr'].includes(d.paymentMethod) || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !['rent', 'electricity', 'water', 'salary', 'transport', 'maintenance', 'marketing', 'other'].includes(d.category))
                throw new https_1.HttpsError('invalid-argument', 'Invalid expense details.');
            const year = new Date().getUTCFullYear();
            const counterRef = db.doc(`counters/expense-${year}`);
            let expenseNumber = old?.expenseNumber;
            if (!expenseNumber) {
                const counter = await tx.get(counterRef);
                const sequence = (counter.data()?.value || 0) + 1;
                expenseNumber = `EXP-${year}-${String(sequence).padStart(6, '0')}`;
                tx.set(counterRef, { value: sequence, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
            }
            tx.set(ref, { branchId: user.branchId, expenseNumber, category: d.category, description: d.description.trim(), amount: d.amount, paymentMethod: d.paymentMethod, date: d.date, notes: String(d.notes || ''), status: 'active', createdAt: old?.createdAt || firestore_1.FieldValue.serverTimestamp(), createdBy: old?.createdBy || r.auth.uid, updatedAt: firestore_1.FieldValue.serverTimestamp(), updatedBy: r.auth.uid });
        }
        tx.set(db.collection('auditLogs').doc(), { branchId: user.branchId, userId: r.auth.uid, userName: user.name, action: d.archive ? 'ARCHIVE_EXPENSE' : 'SAVE_EXPENSE', module: 'expenses', referenceId: ref.id, description: d.archive ? 'Archived expense' : d.description, timestamp: firestore_1.FieldValue.serverTimestamp() });
        return { id: ref.id };
    });
});
