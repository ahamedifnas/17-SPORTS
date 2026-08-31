import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { requireDb } from '@/firebase/config'
import { DEFAULT_BRANCH_ID } from '@/lib/utils'

export interface AuditInput { userId: string; userName: string; action: string; module: string; referenceId?: string; description: string; branchId?: string }

export const auditService = {
  async record(input: AuditInput) {
    await addDoc(collection(requireDb(), 'auditLogs'), { ...input, branchId: input.branchId ?? DEFAULT_BRANCH_ID, timestamp: serverTimestamp() })
  },
}
