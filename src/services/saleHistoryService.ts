import { apiClient } from './apiClient'
import type { Sale } from '@/types'

interface D1SaleRow {
  id: string
  branch_id: string
  invoice_number: string
  client_sale_id: string
  device_id: string
  local_receipt_number?: string
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
  cost?: number
  gross_profit?: number
  status: string
  is_offline: number
  notes?: string
  created_at: string
}

export const saleHistoryService = {
  async list(_branchId: string, from?: Date, to?: Date): Promise<Sale[]> {
    const params: Record<string, string> = {}
    if (from) params.startDate = from.toISOString().split('T')[0]
    if (to) params.endDate = to.toISOString().split('T')[0]
    const rows = await apiClient.get<D1SaleRow[]>('/sales', params)
    if (!Array.isArray(rows)) return []
    return rows.map((r): Sale => ({
      id: r.id,
      branchId: r.branch_id || 'main',
      invoiceNumber: r.invoice_number,
      customerId: r.customer_id || undefined,
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

  async void(id: string, reason: string): Promise<{ id: string; invoiceNumber: string }> {
    const res = await apiClient.post<{ success: boolean; id: string }>(`/sales/${id}/void`, { reason })
    return { id: res.id, invoiceNumber: '' }
  },
}
