import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { requireDb } from '@/firebase/config'
import { DEFAULT_BRANCH_ID } from '@/lib/utils'

export function createEntityService<T extends { id: string }>(collectionName: string) {
  return {
    async list(pageSize = 50): Promise<T[]> {
      const snap = await getDocs(query(collection(requireDb(), collectionName), where('branchId', '==', DEFAULT_BRANCH_ID), orderBy('createdAt', 'desc'), limit(pageSize)))
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as T))
    },
    async create(input: Omit<T, 'id'>) {
      const ref = await addDoc(collection(requireDb(), collectionName), { ...input, branchId: DEFAULT_BRANCH_ID, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      return ref.id
    },
  }
}
