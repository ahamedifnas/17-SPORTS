import type { PurchaseReturn } from '@/types'
import { apiClient } from './apiClient'

export interface CompletePurchaseReturnCommand {
  purchaseId: string
  productId: string
  variantId?: string
  quantity: number
  reason: string
  notes?: string
  returnDate: string
}

export const purchaseReturnService = {
  async list(_branchId: string): Promise<PurchaseReturn[]> {
    const rows = await apiClient.get<PurchaseReturn[]>('/purchases/returns')
    return Array.isArray(rows) ? rows : []
  },

  async complete(command: CompletePurchaseReturnCommand) {
    const payload = {
      purchaseId: command.purchaseId,
      purchaseNumber: 'PO',
      supplierId: 'SUPP',
      supplierName: 'Supplier',
      productId: command.productId,
      variantId: command.variantId,
      quantity: command.quantity,
      amount: 0,
      reason: command.reason,
    }
    const res = await apiClient.post<{ id: string; returnNumber: string }>('/purchases/returns', payload)
    return { id: res.id, returnNumber: res.returnNumber }
  },
}
