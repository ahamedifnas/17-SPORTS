import type { Product } from '@/types'
import { sanitizeFirestoreData } from '@/lib/firestoreData'
import { apiClient } from './apiClient'

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>

interface D1ProductRow {
  id: string
  branch_id: string
  name: string
  sku: string
  barcode?: string
  category_id?: string
  brand_id?: string
  description?: string
  image_url?: string
  unit?: string
  buying_price?: number
  average_cost?: number
  selling_price: number
  wholesale_price?: number
  minimum_selling_price?: number
  stock: number
  minimum_stock: number
  status: string
  variants?: {
    id: string
    sku: string
    barcode?: string
    size?: string
    color?: string
    buying_price?: number
    selling_price: number
    stock: number
    minimum_stock: number
    status: string
  }[]
}

function mapD1ToProduct(row: D1ProductRow): Product {
  return {
    id: row.id,
    branchId: row.branch_id || 'main',
    name: row.name,
    sku: row.sku,
    barcode: row.barcode || '',
    categoryId: row.category_id || '',
    brandId: row.brand_id || '',
    description: row.description || '',
    imageUrl: row.image_url || '',
    unit: row.unit || 'pcs',
    buyingPrice: row.buying_price || 0,
    averageCost: row.average_cost || row.buying_price || 0,
    sellingPrice: row.selling_price,
    wholesalePrice: row.wholesale_price || row.selling_price,
    minimumSellingPrice: row.minimum_selling_price || 0,
    stock: row.stock,
    minimumStock: row.minimum_stock,
    status: row.status as 'active',
    variants: (row.variants || []).map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode || '',
      size: v.size || '',
      color: v.color || '',
      buyingPrice: v.buying_price || 0,
      sellingPrice: v.selling_price,
      stock: v.stock,
      minimumStock: v.minimum_stock,
      status: v.status as 'active',
    })),
  }
}

export function normalizeProductInput(input: ProductInput): ProductInput {
  return sanitizeFirestoreData({
    ...input,
    name: input.name.trim(),
    sku: input.sku.trim(),
    barcode: input.barcode?.trim() ?? '',
    categoryId: input.categoryId.trim(),
    brandId: input.brandId.trim(),
    description: input.description?.trim() ?? '',
    imageUrl: input.imageUrl?.trim() ?? '',
    variants: (input.variants || []).map((variant) => ({
      ...variant,
      sku: variant.sku.trim(),
      barcode: variant.barcode?.trim() ?? '',
      size: variant.size?.trim() ?? '',
      color: variant.color?.trim() ?? '',
      attributes: variant.attributes ? sanitizeFirestoreData(variant.attributes) : {},
    })),
  })
}

export const productService = {
  async list(_branchId: string, _pageSize?: number, _cursor?: unknown, includeInactive = false) {
    const rows = await apiClient.get<D1ProductRow[]>('/products')
    const items = (rows || []).map(mapD1ToProduct).filter((p) => includeInactive || p.status === 'active')
    return { items, cursor: undefined }
  },

  async byId(id: string) {
    const rows = await apiClient.get<D1ProductRow[]>('/products')
    const found = rows.find((r) => r.id === id)
    return found ? mapD1ToProduct(found) : null
  },

  async findByCode(_branchId: string, code: string) {
    const rows = await apiClient.get<D1ProductRow[]>('/products')
    const target = code.trim().toLowerCase()
    const found = rows.find(
      (r) =>
        r.barcode?.toLowerCase() === target ||
        r.sku.toLowerCase() === target ||
        r.variants?.some((v) => v.barcode?.toLowerCase() === target || v.sku.toLowerCase() === target)
    )
    return found ? { product: mapD1ToProduct(found) } : null
  },

  async create(input: ProductInput) {
    const product = normalizeProductInput(input)
    const payload = {
      name: product.name,
      sku: product.sku,
      barcode: product.barcode || null,
      category_id: product.categoryId,
      brand_id: product.brandId,
      description: product.description || null,
      image_url: product.imageUrl || null,
      unit: product.unit || 'pcs',
      buying_price: product.buyingPrice,
      average_cost: product.averageCost || product.buyingPrice,
      selling_price: product.sellingPrice,
      wholesale_price: product.wholesalePrice,
      minimum_selling_price: product.minimumSellingPrice,
      stock: product.stock,
      minimum_stock: product.minimumStock,
      variants: product.variants.map((v) => ({
        sku: v.sku,
        barcode: v.barcode || null,
        size: v.size || null,
        color: v.color || null,
        buying_price: v.buyingPrice,
        selling_price: v.sellingPrice,
        stock: v.stock,
        minimum_stock: v.minimumStock,
      })),
    }
    const res = await apiClient.post<{ id: string }>('/products', payload)
    return res.id
  },

  async update(id: string, changes: Partial<Product>) {
    const safe = { ...changes }
    delete safe.id
    delete safe.createdAt
    const normalized = 'variants' in safe && safe.variants
      ? normalizeProductInput(safe as ProductInput)
      : sanitizeFirestoreData(safe)

    const payload: Record<string, unknown> = {
      name: normalized.name,
      barcode: normalized.barcode || null,
      category_id: normalized.categoryId,
      brand_id: normalized.brandId,
      description: normalized.description || null,
      image_url: normalized.imageUrl || null,
      unit: normalized.unit,
      buying_price: normalized.buyingPrice,
      average_cost: normalized.averageCost,
      selling_price: normalized.sellingPrice,
      wholesale_price: normalized.wholesalePrice,
      minimum_selling_price: normalized.minimumSellingPrice,
      minimum_stock: normalized.minimumStock,
      status: normalized.status,
    }
    if (normalized.variants) {
      payload.variants = normalized.variants.map((v: { id?: string; sku: string; barcode?: string; size?: string; color?: string; buyingPrice?: number; sellingPrice: number; minimumStock?: number; status?: string }) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode || null,
        size: v.size || null,
        color: v.color || null,
        buying_price: v.buyingPrice,
        selling_price: v.sellingPrice,
        minimum_stock: v.minimumStock,
        status: v.status || 'active',
      }))
    }
    await apiClient.put(`/products/${id}`, payload)
  },

  async archive(id: string, _userId: string) {
    await apiClient.delete(`/products/${id}`)
  },
}
