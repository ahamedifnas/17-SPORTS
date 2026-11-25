import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { requireDb } from '@/firebase/config'
import { sanitizeFirestoreData } from '@/lib/firestoreData'

export function createEntityService<T extends { id: string }>(collectionName: string) {
  return {
    async list(branchId: string, pageSize = 50): Promise<T[]> {
      const snap = await getDocs(query(collection(requireDb(), collectionName), where('branchId', '==', branchId), orderBy('createdAt', 'desc'), limit(pageSize)))
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as T))
    },
    async create(input: Omit<T, 'id'>, branchId: string) {
      const ref = await addDoc(collection(requireDb(), collectionName), sanitizeFirestoreData({ ...input, branchId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
      return ref.id
    },
  }
}
