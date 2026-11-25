import { describe, expect, it } from 'vitest'
import { normalizeProductInput, type ProductInput } from './productService'

function product(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    branchId: 'main',
    name: '  Test Ball  ',
    sku: '  SKU-001  ',
    barcode: '',
    categoryId: 'category-1',
    brandId: 'brand-1',
    description: undefined,
    imageUrl: undefined,
    buyingPrice: 10000,
    averageCost: 10000,
    sellingPrice: 15000,
    wholesalePrice: 14000,
    minimumSellingPrice: 13000,
    stock: 5,
    minimumStock: 1,
    maximumStock: undefined,
    unit: 'pcs',
    status: 'active',
    variants: [],
    ...overrides,
  }
}

function containsUndefined(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUndefined)
  if (value && typeof value === 'object') {
    return Object.values(value).some(entry => entry === undefined || containsUndefined(entry))
  }
  return false
}

describe('product Firestore normalization', () => {
  it('creates a valid payload without a barcode', () => {
    const result = normalizeProductInput(product())
    expect(result.barcode).toBe('')
    expect(result.description).toBe('')
    expect(result.imageUrl).toBe('')
    expect('maximumStock' in result).toBe(false)
    expect(containsUndefined(result)).toBe(false)
  })

  it('preserves and trims a real barcode for scanner search', () => {
    const result = normalizeProductInput(product({ barcode: '  4791234567890  ' }))
    expect(result.barcode).toBe('4791234567890')
    expect(result.sku).toBe('SKU-001')
  })

  it('sanitizes optional fields inside product variations', () => {
    const result = normalizeProductInput(product({
      variants: [{
        id: 'variant-1', sku: ' SHOE-42 ', barcode: undefined,
        size: undefined, color: undefined, attributes: undefined,
        buyingPrice: 10000, sellingPrice: 15000, stock: 2,
        minimumStock: 1, status: 'active',
      }],
    }))
    expect(result.variants[0]).toMatchObject({
      sku: 'SHOE-42', barcode: '', size: '', color: '', attributes: {},
    })
    expect(containsUndefined(result)).toBe(false)
  })
})
