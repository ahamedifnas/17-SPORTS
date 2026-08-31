import { collection, doc, increment, runTransaction, serverTimestamp } from 'firebase/firestore'
import { requireDb } from '@/firebase/config'
import type { CartLine, PaymentAllocation } from '@/types'
import { calculateCart, calculateLine, calculatePayment } from '@/lib/money'
import { DEFAULT_BRANCH_ID } from '@/lib/utils'

interface CompleteSaleInput {
  lines: CartLine[]
  billDiscount: number
  taxRate: number
  payments: PaymentAllocation[]
  customer?: { id: string; name: string }
  cashier: { id: string; name: string }
}

export const salesService = {
  async complete(input: CompleteSaleInput) {
    if (!input.lines.length) throw new Error('Add at least one item before payment.')
    const database = requireDb()
    const totals = calculateCart(input.lines, input.billDiscount, input.taxRate)
    const payment = calculatePayment(totals.grandTotal, input.payments)
    if (payment.paid + payment.credit < totals.grandTotal) throw new Error('Payment does not cover the invoice total.')
    if (payment.credit > 0 && !input.customer?.id) throw new Error('Select a customer for a credit sale.')

    return runTransaction(database, async transaction => {
      const counterRef = doc(database, 'counters', `invoice-${new Date().getFullYear()}`)
      const counterSnap = await transaction.get(counterRef)
      const sequence = (counterSnap.data()?.value ?? 0) + 1
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`

      for (const line of input.lines) {
        const productRef = doc(database, 'products', line.productId)
        const snap = await transaction.get(productRef)
        if (!snap.exists()) throw new Error(`${line.name} no longer exists.`)
        const product = snap.data()
        if (line.variantId) {
          const variants = [...(product.variants ?? [])]
          const index = variants.findIndex(v => v.id === line.variantId)
          if (index < 0 || variants[index].stock < line.quantity) throw new Error(`Insufficient stock for ${line.name}.`)
          const before = variants[index].stock
          variants[index] = { ...variants[index], stock: before - line.quantity }
          transaction.update(productRef, { variants, stock: increment(-line.quantity), updatedAt: serverTimestamp() })
          const movementRef = doc(collection(database, 'stockMovements'))
          transaction.set(movementRef, { branchId: DEFAULT_BRANCH_ID, productId: line.productId, variantId: line.variantId, type: 'sale', quantity: -line.quantity, beforeStock: before, afterStock: before - line.quantity, referenceId: invoiceNumber, createdBy: input.cashier.id, createdAt: serverTimestamp() })
        } else {
          const before = product.stock ?? 0
          if (before < line.quantity) throw new Error(`Insufficient stock for ${line.name}.`)
          transaction.update(productRef, { stock: before - line.quantity, updatedAt: serverTimestamp() })
          const movementRef = doc(collection(database, 'stockMovements'))
          transaction.set(movementRef, { branchId: DEFAULT_BRANCH_ID, productId: line.productId, type: 'sale', quantity: -line.quantity, beforeStock: before, afterStock: before - line.quantity, referenceId: invoiceNumber, createdBy: input.cashier.id, createdAt: serverTimestamp() })
        }
      }

      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true })
      const saleRef = doc(collection(database, 'sales'))
      const saleItems = input.lines.map(line => ({ productId: line.productId, variantId: line.variantId ?? null, productName: line.name, sku: line.sku, variantDescription: line.variantLabel ?? null, quantity: line.quantity, unitPrice: line.unitPrice, costPrice: line.costPrice, discount: line.discount, lineTotal: calculateLine(line), returnedQuantity: 0 }))
      transaction.set(saleRef, { branchId: DEFAULT_BRANCH_ID, invoiceNumber, customerId: input.customer?.id ?? null, customerName: input.customer?.name ?? 'Walk-in Customer', cashierId: input.cashier.id, cashierName: input.cashier.name, items: saleItems, ...totals, paid: payment.paid, balance: payment.credit, change: payment.change, payments: input.payments, paymentStatus: payment.credit ? (payment.paid ? 'partial' : 'credit') : 'paid', status: 'completed', createdAt: serverTimestamp(), createdBy: input.cashier.id })
      if (payment.credit && input.customer?.id) transaction.update(doc(database, 'customers', input.customer.id), { currentBalance: increment(payment.credit), updatedAt: serverTimestamp() })
      for (const allocation of input.payments.filter(p => p.amount > 0)) {
        transaction.set(doc(collection(database, 'payments')), { branchId: DEFAULT_BRANCH_ID, type: allocation.method === 'credit' ? 'sale-credit' : 'sale-payment', referenceId: saleRef.id, customerId: input.customer?.id ?? null, amount: allocation.amount, paymentMethod: allocation.method, date: serverTimestamp(), createdBy: input.cashier.id, createdAt: serverTimestamp() })
      }
      transaction.set(doc(collection(database, 'auditLogs')), { branchId: DEFAULT_BRANCH_ID, userId: input.cashier.id, userName: input.cashier.name, action: 'create', module: 'sales', referenceId: saleRef.id, description: `Completed ${invoiceNumber}`, timestamp: serverTimestamp() })
      return { id: saleRef.id, invoiceNumber, ...totals, ...payment, items: saleItems }
    })
  },
}
