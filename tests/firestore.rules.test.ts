import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

const enabled=Boolean(process.env.FIRESTORE_EMULATOR_HOST)
describe.skipIf(!enabled)('Firestore emulator access boundaries',()=>{
  let env:RulesTestEnvironment
  beforeAll(async()=>{
    env=await initializeTestEnvironment({projectId:'demo-z17-tests',firestore:{rules:readFileSync('firestore.rules','utf8')}})
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore()
      await setDoc(doc(db,'users/cashier'),{uid:'cashier',role:'cashier',status:'active',branchId:'main'})
      await setDoc(doc(db,'users/admin'),{uid:'admin',role:'admin',status:'active',branchId:'main'})
      await setDoc(doc(db,'products/ball'),{branchId:'main',name:'Ball',stock:5,buyingPrice:100,variants:[]})
      await setDoc(doc(db,'sales/invoice'),{branchId:'main',cost:100})
    })
  })
  afterAll(async()=>{await env?.cleanup()})
  it('denies cashier access to costs and direct stock/financial writes',async()=>{
    const db=env.authenticatedContext('cashier').firestore()
    await assertFails(getDoc(doc(db,'products/ball')))
    await assertFails(getDoc(doc(db,'sales/invoice')))
    await assertFails(updateDoc(doc(db,'products/ball'),{stock:99}))
    await assertFails(setDoc(doc(db,'sales/new'),{branchId:'main'}))
  })
  it('allows owner reads but requires server stock adjustment',async()=>{
    const db=env.authenticatedContext('admin').firestore()
    await assertSucceeds(getDoc(doc(db,'products/ball')))
    await assertFails(updateDoc(doc(db,'products/ball'),{stock:99}))
  })
})
