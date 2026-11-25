import type { BusinessPayment, CashClosing, Customer, Expense, PaymentMethod, Role, SalesReturn, Supplier, UserProfile } from '@/types'
import { apiClient } from './apiClient'
import { d1List } from './d1Data'
import { saleHistoryService } from './saleHistoryService'

export type PartyKind = 'customers' | 'suppliers'

export const adminService = {
  listUsers: async (_branchId: string): Promise<UserProfile[]> => {
    const rows = await apiClient.get<UserProfile[]>('/staff')
    return Array.isArray(rows) ? rows : []
  },

  listStaff: async (branchId: string): Promise<UserProfile[]> => {
    return adminService.listUsers(branchId)
  },

  saveStaff: async (input: { uid?: string; email: string; name: string; phone?: string; role: Role; password?: string; status?: string; branchId?: string }) => {
    const uid = input.uid || `staff_${Date.now()}`
    const res = await apiClient.post<{ success: boolean; uid: string }>('/staff', { ...input, uid })
    return res
  },

  listAudit: async (_branchId: string): Promise<(Record<string, unknown> & { id: string })[]> => {
    const rows = await apiClient.get<(Record<string, unknown> & { id: string })[]>('/audit-logs')
    return Array.isArray(rows) ? rows : []
  },
}

export const reportService = {
  branchList: d1List,
  summary: async () => {
    try {
      return await apiClient.get('/reports/summary')
    } catch {
      return null
    }
  },
}

export const partyService = {
  listCustomers: async (_branchId: string): Promise<Customer[]> => {
    const rows = await apiClient.get<Customer[]>('/customers')
    return Array.isArray(rows) ? rows : []
  },

  listSuppliers: async (_branchId: string): Promise<Supplier[]> => {
    const rows = await apiClient.get<Supplier[]>('/suppliers')
    return Array.isArray(rows) ? rows : []
  },

  async save(kind: PartyKind, input: Record<string, unknown> & { id?: string; name: string }, _user: UserProfile) {
    if (input.id) {
      await apiClient.put(`/${kind}/${input.id}`, input)
      return input.id
    }
    const res = await apiClient.post<{ id: string }>(`/${kind}`, input)
    return res.id
  },

  async archive(kind: PartyKind, id: string, _name: string, _user: UserProfile) {
    await apiClient.put(`/${kind}/${id}`, { status: 'inactive' })
  },
}

export const expenseService = {
  list: async (_branchId: string): Promise<Expense[]> => {
    const rows = await apiClient.get<Expense[]>('/finance/expenses')
    return Array.isArray(rows) ? rows : []
  },

  async save(input: Omit<Expense, 'id' | 'branchId'> & { id?: string }, user: UserProfile) {
    if (!user.uid) throw new Error('Sign in required.')
    const res = await apiClient.post<{ id: string }>('/finance/expenses', input)
    return res.id
  },

  async archive(id: string, _number: string, user: UserProfile) {
    if (!user.uid) throw new Error('Sign in required.')
    await apiClient.put(`/finance/expenses/${id}`, { status: 'archived' })
  },
}

export const financeService = {
  listPayments: async (_branchId: string): Promise<BusinessPayment[]> => {
    const rows = await apiClient.get<BusinessPayment[]>('/finance/payments')
    return Array.isArray(rows) ? rows : []
  },

  recordPayment: async (input: { type: string; partyId: string | null; partyName: string; amount: number; paymentMethod: string; reference?: string; date: string; notes?: string }) => {
    const res = await apiClient.post<{ id: string; paymentNumber: string }>('/finance/payments', input)
    return res
  },

  listClosings: async (_branchId: string): Promise<CashClosing[]> => {
    const res = await apiClient.get<{ closing?: CashClosing }>('/finance/cash-closing')
    return res?.closing ? [res.closing] : []
  },

  closeCashShift: async (input: { date: string; openingCash: number; actualCash: number; notes?: string }) => {
    const res = await apiClient.post<{ closingNumber: string; difference: number }>('/finance/cash-closing', input)
    return res
  },

  listReturns: async (_branchId: string): Promise<SalesReturn[]> => {
    const rows = await apiClient.get<SalesReturn[]>('/sales/returns')
    return Array.isArray(rows) ? rows : []
  },

  completeSalesReturn: async (input: { saleId: string; items: { index: number; quantity: number }[]; reason: string; notes?: string; returnDate: string; refundMethod: PaymentMethod }) => {
    const res = await apiClient.post<{ id: string; returnNumber: string }>('/sales/returns', input)
    return res
  },

  listSales: (_branchId: string) => {
    return saleHistoryService.list(_branchId)
  },
}
