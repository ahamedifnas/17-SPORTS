import { apiClient } from './apiClient'

export interface AuditInput {
  userId: string
  userName: string
  action: string
  module: string
  referenceId?: string
  description: string
  branchId: string
}

export const auditService = {
  async record(_input: AuditInput) {
    // Audit logs are recorded authoritatively on the server during transaction operations
  },

  async list(module?: string) {
    try {
      const rows = await apiClient.get<unknown[]>('/audit-logs', module ? { module } : undefined)
      if (Array.isArray(rows)) return rows
    } catch {
      // Ignored
    }
    return []
  },
}
