import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartLine } from '@/types'

interface HeldCart { id: string; name: string; lines: CartLine[]; billDiscount: number; heldAt: string }
interface PosState {
  checkoutId: string
  lines: CartLine[]
  billDiscount: number
  heldCarts: HeldCart[]
  addLine(line: Omit<CartLine, 'quantity' | 'discount'>): void
  updateQuantity(key: string, quantity: number): void
  updateDiscount(key: string, discount: number): void
  removeLine(key: string): void
  setBillDiscount(value: number): void
  clear(): void
  hold(name?: string): void
  resume(id: string): void
}

export const usePosStore = create<PosState>()(persist((set, get) => ({
  checkoutId: crypto.randomUUID(), lines: [], billDiscount: 0, heldCarts: [],
  addLine: line => set(state => {
    const existing = state.lines.find(item => item.key === line.key)
    if (existing) {
      if (existing.quantity >= existing.availableStock) return state
      return { lines: state.lines.map(item => item.key === line.key ? { ...item, quantity: item.quantity + 1 } : item) }
    }
    return { lines: [...state.lines, { ...line, quantity: 1, discount: 0 }] }
  }),
  updateQuantity: (key, quantity) => set(state => ({ lines: state.lines.map(item => item.key === key ? { ...item, quantity: Math.max(1, Math.min(quantity, item.availableStock)) } : item) })),
  updateDiscount: (key, discount) => set(state => ({ lines: state.lines.map(item => item.key === key ? { ...item, discount: Math.max(0, Math.min(discount, item.unitPrice * item.quantity)) } : item) })),
  removeLine: key => set(state => ({ lines: state.lines.filter(item => item.key !== key) })),
  setBillDiscount: billDiscount => set({ billDiscount: Math.max(0, billDiscount) }),
  clear: () => set({ checkoutId: crypto.randomUUID(), lines: [], billDiscount: 0 }),
  hold: name => {
    const { lines, billDiscount } = get()
    if (!lines.length) return
    set(state => ({ lines: [], billDiscount: 0, heldCarts: [...state.heldCarts, { id: crypto.randomUUID(), name: name || `Cart ${state.heldCarts.length + 1}`, lines, billDiscount, heldAt: new Date().toISOString() }] }))
  },
  resume: id => set(state => {
    const held = state.heldCarts.find(cart => cart.id === id)
    return held ? { lines: held.lines, billDiscount: held.billDiscount, heldCarts: state.heldCarts.filter(cart => cart.id !== id) } : state
  }),
}), { name: 'z17-pos' }))
