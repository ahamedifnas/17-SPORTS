import { getDocs, limit, query, startAfter, type Query, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore'
/** Exhaust a query in bounded network pages; never silently truncate accounting totals. */
export async function allDocuments(base:Query<DocumentData>, pageSize=200) {
  const docs:QueryDocumentSnapshot<DocumentData>[]=[]
  let cursor:QueryDocumentSnapshot<DocumentData>|undefined
  for(;;){const page=await getDocs(query(base,limit(pageSize),...(cursor?[startAfter(cursor)]:[])));docs.push(...page.docs);if(page.size<pageSize)break;cursor=page.docs.at(-1)}
  return {docs}
}
