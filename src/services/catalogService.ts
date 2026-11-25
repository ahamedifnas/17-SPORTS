import type { Brand, Category, Status } from '@/types'
import { apiClient } from './apiClient'

export type CatalogKind = 'categories' | 'brands'
export type CatalogItem = Category | Brand
export interface CatalogInput { id?: string; name: string; description: string; status: Status }

interface D1CatalogRow {
  id: string
  branch_id: string
  name: string
  description?: string
  created_at: string
}

export const catalogService = {
  async list(kind: CatalogKind, branchId: string): Promise<CatalogItem[]> {
    const rows = await apiClient.get<D1CatalogRow[]>(`/${kind}`)
    if (Array.isArray(rows)) {
      return rows.map((r) => ({
        id: r.id,
        branchId: r.branch_id || branchId,
        name: r.name,
        description: r.description || '',
        status: 'active' as Status,
      }))
    }
    return []
  },

  async save(kind: CatalogKind, input: CatalogInput, _userId: string, _branchId: string) {
    const name = input.name.trim()
    const description = input.description.trim()

    if (input.id) {
      await apiClient.put(`/${kind}/${input.id}`, { name, description })
      return input.id
    } else {
      const res = await apiClient.post<{ id: string }>(`/${kind}`, { name, description })
      return res.id
    }
  },

  async archive(kind: CatalogKind, item: CatalogItem, _userId: string, _branchId: string) {
    await apiClient.delete(`/${kind}/${item.id}`)
    return { referenced: false, deleted: true }
  },

  async activate(kind: CatalogKind, id: string, _userId: string) {
    await apiClient.put(`/${kind}/${id}`, { status: 'active' })
  },
}
