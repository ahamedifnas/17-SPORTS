import { describe, expect, it } from 'vitest'
import { userProfileSchema } from './AuthContext'

const validProfile = {
  uid: 'firebase-auth-uid',
  name: 'Administrator',
  email: 'admin@example.com',
  phone: '',
  role: 'admin',
  branchId: 'main',
  status: 'active',
}

describe('Firestore user profile contract', () => {
  it('accepts the required lowercase profile structure', () => {
    expect(userProfileSchema.safeParse(validProfile).success).toBe(true)
  })

  it('rejects uppercase role and status values', () => {
    expect(userProfileSchema.safeParse({ ...validProfile, role: 'ADMIN' }).success).toBe(false)
    expect(userProfileSchema.safeParse({ ...validProfile, status: 'ACTIVE' }).success).toBe(false)
  })

  it('requires uid, name, email and branchId', () => {
    expect(userProfileSchema.safeParse({ role: 'admin', status: 'active' }).success).toBe(false)
  })
})
