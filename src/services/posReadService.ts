import { apiClient } from './apiClient'
import type { Product, Sale } from '@/types'

interface PosCatalogResponse {
  products: {
    id: string
    branch_id: string
    name: string
    sku: string
    barcode?: string
    category_id?: string
    brand_id?: string
    description?: string
    image_url?: string
    unit: string
    buying_price?: number
    average_cost?: number
    selling_price: number
    wholesale_price?: number
    minimum_selling_price?: number
    stock: number
    minimum_stock: number
    status: string
    variants: {
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
  }[]
}

interface D1SaleRow {
  id: string
  branch_id: string
  invoice_number: string
  client_sale_id: string
  device_id: string
  customer_id?: string
  customer_name?: string
  cashier_id: string
  cashier_name: string
  subtotal: number
  discount: number
  tax_rate: number
  tax: number
  grand_total: number
  paid: number
  balance: number
  change: number
  status: string
  created_at: string
}

export const posReadService = {
  products: async (): Promise<Product[]> => {
    const res = await apiClient.get<PosCatalogResponse>('/catalog/pos')
    if (!res?.products) return []
    return res.products.map((p) => ({
      id: p.id,
      branchId: p.branch_id || 'main',
      name: p.name,
      sku: p.sku,
      barcode: p.barcode || '',
      categoryId: p.category_id || '',
      brandId: p.brand_id || '',
      description: p.description || '',
      imageUrl: p.image_url || '',
      unit: p.unit || 'pcs',
      buyingPrice: p.buying_price || 0,
      averageCost: p.average_cost || 0,
      sellingPrice: p.selling_price,
      wholesalePrice: p.wholesale_price || p.selling_price,
      minimumSellingPrice: p.minimum_selling_price || 0,
      stock: p.stock,
      minimumStock: p.minimum_stock,
      status: p.status as 'active',
      variants: (p.variants || []).map((v) => ({
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
    }))
  },

  sales: async (): Promise<Sale[]> => {
    const rows = await apiClient.get<D1SaleRow[]>('/sales')
    if (!Array.isArray(rows)) return []
    return rows.map((r): Sale => ({
      id: r.id,
      branchId: r.branch_id || 'main',
      invoiceNumber: r.invoice_number,
      customerId: r.customer_id,
      customerName: r.customer_name || 'Walk-in Customer',
      cashierId: r.cashier_id,
      cashierName: r.cashier_name,
      items: [],
      subtotal: r.subtotal,
      discount: r.discount,
      tax: r.tax,
      grandTotal: r.grand_total,
      paid: r.paid,
      balance: r.balance,
      change: r.change,
      payments: [],
      paymentStatus: r.balance > 0 ? 'credit' : 'paid',
      status: (r.status as 'completed' | 'voided') || 'completed',
    }))
  },
}
