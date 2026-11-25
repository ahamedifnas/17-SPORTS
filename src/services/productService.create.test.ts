import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductInput } from './productService'

const mockApi = vi.hoisted(() => ({
  post: vi.fn(async (_url: string, _data: unknown) => ({ id: 'created-product-id' })),
}))

vi.mock('./apiClient', () => ({
  apiClient: {
    post: mockApi.post,
  },
}))

import { productService } from './productService'

function input(barcode: string): ProductInput {
  return {
    branchId: 'main',
    name: 'Football',
    sku: 'FB-001',
    barcode,
    categoryId: 'football',
    brandId: 'brand',
    description: undefined,
    imageUrl: undefined,
    buyingPrice: 100000,
    averageCost: 100000,
    sellingPrice: 150000,
    wholesalePrice: 140000,
    minimumSellingPrice: 130000,
    stock: 10,
    minimumStock: 2,
    maximumStock: undefined,
    unit: 'pcs',
    status: 'active',
    variants: [],
  }
}

function containsUndefined(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUndefined)
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => entry === undefined || containsUndefined(entry))
  }
  return false
}

describe('productService.create validated API payload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a normalized server command without undefined fields', async () => {
    await expect(productService.create(input(''))).resolves.toBe('created-product-id')
    expect(mockApi.post).toHaveBeenCalledTimes(1)
    const [endpoint, payload] = mockApi.post.mock.calls[0] as [string, Record<string, unknown>]
    expect(endpoint).toBe('/products')
    expect(payload.sku).toBe('FB-001')
    expect(containsUndefined(payload)).toBe(false)
  })

  it('preserves the searchable barcode in the server command', async () => {
    await expect(productService.create(input(' 4791234567890 '))).resolves.toBe('created-product-id')
    expect(mockApi.post).toHaveBeenCalledTimes(1)
    const [endpoint, payload] = mockApi.post.mock.calls[0] as [string, Record<string, unknown>]
    expect(endpoint).toBe('/products')
    expect(payload.barcode).toBe('4791234567890')
    expect(payload.sku).toBe('FB-001')
    expect(containsUndefined(payload)).toBe(false)
  })
})
