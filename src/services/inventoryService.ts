import { apiClient } from './apiClient'

export const inventoryService = {
  async adjust(input: {
    operationId: string
    productId: string
    variantId?: string
    quantity: number
    type: 'adjustment' | 'damage' | 'lost' | 'internal-use' | 'opening-stock'
    reason: string
    userId: string
    branchId: string
  }) {
    const res = await apiClient.post<{ success: boolean; afterStock: number }>('/inventory/adjust', {
      productId: input.productId,
      variantId: input.variantId,
      type: 'adjustment',
      quantity: input.quantity,
      reason: input.reason || 'Manual Adjustment',
    })
    return res
  },
}
