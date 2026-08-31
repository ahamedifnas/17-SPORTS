import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, updateDoc, where, type DocumentSnapshot } from 'firebase/firestore'
import { requireDb } from '@/firebase/config'
import type { Product } from '@/types'
import { DEFAULT_BRANCH_ID } from '@/lib/utils'

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>

export const productService = {
  async list(pageSize = 50, cursor?: DocumentSnapshot) {
    const constraints = [where('branchId', '==', DEFAULT_BRANCH_ID), where('status', '==', 'active'), orderBy('name'), limit(pageSize)]
    const q = query(collection(requireDb(), 'products'), ...constraints, ...(cursor ? [startAfter(cursor)] : []))
    const snap = await getDocs(q)
    return { items: snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)), cursor: snap.docs.at(-1) }
  },
  async byId(id: string) {
    const snap = await getDoc(doc(requireDb(), 'products', id))
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Product) : null
  },
  async findByCode(code: string) {
    const root = await getDocs(query(collection(requireDb(), 'products'), where('barcode', '==', code), where('status', '==', 'active'), limit(1)))
    if (!root.empty) return { product: { id: root.docs[0].id, ...root.docs[0].data() } as Product }
    const sku = await getDocs(query(collection(requireDb(), 'products'), where('sku', '==', code), where('status', '==', 'active'), limit(1)))
    return sku.empty ? null : { product: { id: sku.docs[0].id, ...sku.docs[0].data() } as Product }
  },
  async create(input: ProductInput) {
    const duplicateSku = await getDocs(query(collection(requireDb(), 'products'), where('sku', '==', input.sku), limit(1)))
    if (!duplicateSku.empty) throw new Error('A product with this SKU already exists.')
    if (input.barcode) {
      const duplicateBarcode = await getDocs(query(collection(requireDb(), 'products'), where('barcode', '==', input.barcode), limit(1)))
      if (!duplicateBarcode.empty) throw new Error('A product with this barcode already exists.')
    }
    const ref = await addDoc(collection(requireDb(), 'products'), { ...input, branchId: input.branchId || DEFAULT_BRANCH_ID, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return ref.id
  },
  async update(id: string, changes: Partial<Product>) {
    const { id: _id, createdAt: _createdAt, ...safe } = changes
    await updateDoc(doc(requireDb(), 'products', id), { ...safe, updatedAt: serverTimestamp() })
  },
}
