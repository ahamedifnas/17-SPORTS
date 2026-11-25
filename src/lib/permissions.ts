import type { Role } from '@/types'

export type Permission = 'dashboard.view' | 'pos.use' | 'products.read' | 'products.write' | 'cost.read' | 'inventory.adjust' | 'purchases.manage' | 'parties.manage' | 'returns.manage' | 'expenses.manage' | 'reports.sales' | 'reports.profit' | 'users.manage' | 'audit.read' | 'settings.manage'

const grants: Record<Role, Permission[]> = {
  admin: ['dashboard.view','pos.use','products.read','products.write','cost.read','inventory.adjust','purchases.manage','parties.manage','returns.manage','expenses.manage','reports.sales','reports.profit','users.manage','audit.read','settings.manage'],
  manager: ['dashboard.view','pos.use','products.read','products.write','cost.read','inventory.adjust','purchases.manage','parties.manage','returns.manage','expenses.manage','reports.sales','reports.profit'],
  cashier: ['pos.use','products.read','parties.manage','returns.manage','reports.sales'],
  inventory: ['products.read','products.write','cost.read','inventory.adjust','purchases.manage','returns.manage'],
  accountant: ['dashboard.view','cost.read','purchases.manage','parties.manage','expenses.manage','reports.sales','reports.profit','audit.read'],
}

export const hasPermission = (role: Role | undefined, permission: Permission) => Boolean(role && grants[role].includes(permission))
