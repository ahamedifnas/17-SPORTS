// Single server database boundary, replaceable by isolated transaction tests.
export { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore'
