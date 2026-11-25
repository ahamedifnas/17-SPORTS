import { describe, expect, it } from 'vitest'
import { validateCheckout, type CheckoutInput } from '../../worker/src/checkout'

const valid = (): CheckoutInput => ({
  clientSaleId: 'sale-1',
  deviceId: 'device-1',
  localReceiptNumber: 'LOCAL-1',
  createdAt: new Date().toISOString(),
  items: [{ productId: 'p', quantity: 1, unitPrice: 100, discount: 0, lineTotal: 100 }],
  subtotal: 100,
  discount: 0,
  billDiscount: 0,
  taxRate: 0,
  tax: 0,
  grandTotal: 100,
  paid: 100,
  balance: 0,
  change: 0,
  payments: [{ method: 'cash', amount: 100 }],
})

describe('server checkout validation', () => {
  it('accepts valid intent', () => expect(() => validateCheckout(valid(), false)).not.toThrow())
  it('rejects unknown payment methods and offline cards', () => {
    expect(() => validateCheckout({ ...valid(), payments: [{ method: 'fake', amount: 100 }] }, false)).toThrow()
    expect(() => validateCheckout({ ...valid(), payments: [{ method: 'card', amount: 100 }] }, true)).toThrow()
  })
  it('rejects duplicate items, traversal IDs and invalid money', () => {
    const d = valid()
    expect(() => validateCheckout({ ...d, items: [...d.items, ...d.items] }, false)).toThrow()
    expect(() => validateCheckout({ ...d, clientSaleId: '../../x' }, false)).toThrow()
    expect(() => validateCheckout({ ...d, billDiscount: NaN as unknown as number }, false)).toThrow()
  })
})
