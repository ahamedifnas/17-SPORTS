import type { CartLine, Money, PaymentAllocation } from '@/types'

export const toMoney = (value: number | string): Money => Math.round(Number(value || 0) * 100)
export const fromMoney = (value: Money): number => value / 100
export const formatMoney = (value: Money, compact = false) =>
  new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', currencyDisplay: 'symbol', minimumFractionDigits: compact ? 0 : 2 }).format(fromMoney(value)).replace('LKR', 'Rs.')

export function calculateLine(line: Pick<CartLine, 'quantity' | 'unitPrice' | 'discount'>): Money {
  return Math.max(0, line.unitPrice * line.quantity - line.discount)
}

export function calculateCart(lines: CartLine[], billDiscount: Money, taxRate = 0) {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const itemDiscount = lines.reduce((sum, line) => sum + Math.min(line.discount, line.unitPrice * line.quantity), 0)
  const discount = Math.min(subtotal, itemDiscount + Math.max(0, billDiscount))
  const taxable = subtotal - discount
  const tax = Math.round(taxable * Math.max(0, taxRate) / 100)
  const grandTotal = taxable + tax
  const cost = lines.reduce((sum, line) => sum + line.costPrice * line.quantity, 0)
  return { subtotal, itemDiscount, discount, tax, grandTotal, cost, grossProfit: grandTotal - tax - cost }
}

export function calculatePayment(total: Money, allocations: PaymentAllocation[]) {
  const paid = allocations.reduce((sum, p) => sum + Math.max(0, p.amount), 0)
  const nonCreditPaid = allocations.filter(p => p.method !== 'credit').reduce((sum, p) => sum + p.amount, 0)
  const credit = allocations.filter(p => p.method === 'credit').reduce((sum, p) => sum + p.amount, 0)
  return { paid: Math.min(total, paid), tendered: paid, credit, balance: Math.max(0, total - paid), change: Math.max(0, nonCreditPaid - total) }
}
