import { describe, expect, it } from 'vitest'
import { sanitizeFirestoreData } from './firestoreData'

describe('Firestore data sanitization', () => {
  it('removes undefined values recursively without removing valid falsy values', () => {
    const result = sanitizeFirestoreData({
      barcode: undefined,
      description: '',
      price: 0,
      active: false,
      variants: [{ barcode: undefined, size: '', nested: { value: undefined } }],
    })

    expect(result).toEqual({
      description: '',
      price: 0,
      active: false,
      variants: [{ size: '', nested: {} }],
    })
  })
})
