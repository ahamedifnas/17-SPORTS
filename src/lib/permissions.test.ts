import { describe, expect, it } from 'vitest'
import { hasPermission } from './permissions'

describe('role permissions', () => {
  it('grants full administration only to admin', () => {
    expect(hasPermission('admin', 'settings.manage')).toBe(true)
    expect(hasPermission('manager', 'settings.manage')).toBe(false)
    expect(hasPermission('cashier', 'settings.manage')).toBe(false)
  })

  it('allows cashiers to use POS without exposing cost', () => {
    expect(hasPermission('cashier', 'pos.use')).toBe(true)
    expect(hasPermission('cashier', 'cost.read')).toBe(false)
  })

  it('does not grant permissions for a missing role', () => {
    expect(hasPermission(undefined, 'pos.use')).toBe(false)
  })
})
