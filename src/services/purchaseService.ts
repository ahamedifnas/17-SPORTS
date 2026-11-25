import type { PaymentMethod, Purchase } from '@/types'
import { apiClient } from './apiClient'

export interface PurchaseCommandItem {
  productId: string
  variantId?: string
  quantity: number
  costPrice: number
  discount: number
}

export interface CreatePurchaseCommand {
  supplierId?: string
  supplierName: string
  referenceNumber: string
  purchaseDate: string
  paymentMethod: PaymentMethod
  notes?: string
  status: 'draft' | 'received'
  items: PurchaseCommandItem[]
}

interface D1PurchaseRow {
  id: string
  branch_id: string
  purchase_number: string
  supplier_id: string
  supplier_name: string
  reference_number?: string
  purchase_date: string
  payment_method: PaymentMethod
  subtotal: number
  discount: number
  tax: number
  grand_total: number
  status: 'draft' | 'received'
  created_at: string
  items?: {
    id: string
    product_id: string
    variant_id?: string
    product_name: string
    sku: string
    quantity: number
    cost_price: number
    discount: number
    line_total: number
  }[]
}

function mapD1Purchase(row: D1PurchaseRow): Purchase {
  return {
    id: row.id,
    branchId: row.branch_id || 'main',
    purchaseNumber: row.purchase_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    referenceNumber: row.reference_number || '',
    purchaseDate: row.purchase_date,
    paymentMethod: row.payment_method || 'credit',
    subtotal: row.subtotal,
    discount: row.discount || 0,
    tax: row.tax || 0,
    grandTotal: row.grand_total,
    status: row.status,
    items: (row.items || []).map((i) => ({
      productId: i.product_id,
      variantId: i.variant_id,
      productName: i.product_name,
      sku: i.sku,
      quantity: i.quantity,
      costPrice: i.cost_price,
      discount: i.discount || 0,
      lineTotal: i.line_total,
    })),
  }
}

export const purchaseService = {
  async list(_branchId: string): Promise<Purchase[]> {
    const rows = await apiClient.get<D1PurchaseRow[]>('/purchases')
    if (Array.isArray(rows)) {
      return rows.map(mapD1Purchase)
    }
    return []
  },

  async create(command: CreatePurchaseCommand) {
    const payload = {
      supplierId: command.supplierId || '',
      supplierName: command.supplierName,
      referenceNumber: command.referenceNumber,
      purchaseDate: command.purchaseDate,
      paymentMethod: command.paymentMethod,
      subtotal: command.items.reduce((acc, i) => acc + i.costPrice * i.quantity, 0),
      discount: 0,
      tax: 0,
      grandTotal: command.items.reduce((acc, i) => acc + (i.costPrice * i.quantity - (i.discount || 0)), 0),
      status: command.status,
      items: command.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        productName: 'Product',
        sku: 'SKU',
        quantity: i.quantity,
        costPrice: i.costPrice,
        discount: i.discount,
        lineTotal: i.costPrice * i.quantity - (i.discount || 0),
      })),
    }

    const res = await apiClient.post<{ id: string; purchaseNumber: string; success: boolean }>('/purchases', payload)
    return {
      id: res.id,
      purchaseNumber: res.purchaseNumber,
      status: command.status,
      grandTotal: payload.grandTotal,
    }
  },

  async receive(purchaseId: string) {
    const res = await apiClient.post<{ success: boolean; id: string }>(`/purchases/${purchaseId}/receive`)
    return { id: res.id || purchaseId, purchaseNumber: '', status: 'received' }
  },
}
