import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, type User } from 'firebase/auth'
import { z } from 'zod'
import { auth, isFirebaseConfigured } from '@/firebase/config'
import type { Role, Status, UserProfile } from '@/types'
import { getSession, localDb } from '@/offline/database'
import { apiClient } from '@/services/apiClient'

export type ProfileIssue =
  | { code: 'missing'; message: string }
  | { code: 'invalid'; message: string; fields: string[] }
  | { code: 'permission-denied'; message: string }
  | { code: 'unavailable'; message: string }

export const userProfileSchema = z.object({
  uid: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(['admin', 'manager', 'cashier', 'inventory', 'accountant']),
  branchId: z.string().min(1),
  status: z.enum(['active', 'inactive', 'archived']),
}).passthrough()

interface AuthValue {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  profileIssue: ProfileIssue | null
  configured: boolean
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
  resetPassword(email: string): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)
  const [profileIssue, setProfileIssue] = useState<ProfileIssue | null>(null)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, async next => {
      setUser(next)
      setProfile(null)
      setProfileIssue(null)
      try {
        if (next) {
          if (!navigator.onLine) {
            const session = await getSession(next.uid)
            if (session && session.expiresAt > Date.now() && session.profile.role === 'cashier' && session.profile.status === 'active') {
              setProfile(session.profile)
              return
            }
            throw new Error('Reconnect to authorize this session. Owner access requires internet.')
          }

          const res = await apiClient.get<{ user: {uid:string;name:string;email:string;phone?:string;role:Role;status:Status;branch_id:string} }>('/auth/me')
          const parsed=userProfileSchema.safeParse({...res.user,branchId:res.user.branch_id})
          if(!parsed.success||parsed.data.uid!==next.uid)throw new Error('Invalid authoritative D1 profile.')
          setProfile({id:next.uid,...parsed.data} as UserProfile)
          // Offline authorization is issued only by /auth/offline-session during device preparation.

        }
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
        if (code.includes('permission-denied')) {
          setProfileIssue({ code: 'permission-denied', message: 'Security rules denied access to your user profile.' })
        } else {
          console.error('Unable to load user profile.', error)
          setProfileIssue({ code: 'unavailable', message: 'The user profile could not be loaded.' })
        }
      } finally {
        setLoading(false)
      }
    })
  }, [])

  const value = useMemo<AuthValue>(() => ({
    user, profile, loading, profileIssue, configured: isFirebaseConfigured,
    login: async (email, password) => { if (!auth) throw new Error('Firebase is not configured.'); await signInWithEmailAndPassword(auth, email, password) },
    logout: async () => { if (user) await localDb.metadata.delete(`session:${user.uid}`); if (auth) await signOut(auth) },
    resetPassword: async email => { if (!auth) throw new Error('Firebase is not configured.'); await sendPasswordResetEmail(auth, email) },
  }), [user, profile, loading, profileIssue])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
