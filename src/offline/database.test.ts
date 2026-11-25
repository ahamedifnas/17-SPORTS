import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acknowledge, availableCatalog, persistSale, PosDatabase, type SaleCommand } from './database'
import { defaultSettings } from '@/services/settingsService'
import type { Product, UserProfile } from '@/types'

let db:PosDatabase
const profile={id:'u',uid:'u',name:'Cashier',role:'cashier',branchId:'main',status:'active',email:'cashier@example.com'} as UserProfile
const product={id:'p',branchId:'main',name:'Ball',sku:'BALL',stock:3,sellingPrice:1000,buyingPrice:0,averageCost:0,variants:[],status:'active'} as unknown as Product
function command(overrides:Partial<SaleCommand>={}) {
  return {clientSaleId:crypto.randomUUID(),offline:true,sessionId:'session',lines:[{key:'p',productId:'p',name:'Ball',sku:'BALL',quantity:1,unitPrice:1000,costPrice:0,discount:0,availableStock:3}],billDiscount:0,taxRate:0,payments:[{method:'cash' as const,amount:1200}],cashier:{id:'u',name:'Cashier'},...overrides}
}
beforeEach(async()=>{
  db=new PosDatabase(`test-${crypto.randomUUID()}`)
  await db.metadata.put({key:'session:u',value:{uid:'u',profile,id:'session',expiresAt:Date.now()+60000,settings:defaultSettings}})
  await db.catalog.put({id:'u:main:p',scope:'u:main',product})
})
afterEach(async()=>{await db.delete()})
describe('durable checkout journal',()=>{
  it('atomically stores receipt, items, reservation and outbox without cloud confirmation',async()=>{
    const sale=await persistSale(command(),profile,db)
    expect(sale.state).toBe('pending');expect(sale.invoice.pending).toBe(true);expect(sale.invoice.change).toBe(200)
    expect(await db.items.count()).toBe(1);expect(await db.reservations.count()).toBe(1);expect(await db.outbox.count()).toBe(1)
    expect((await availableCatalog('u','main',db))[0].stock).toBe(2)
  })
  it('does not duplicate a checkout identifier',async()=>{
    const input=command();const first=await persistSale(input,profile,db);const second=await persistSale(input,profile,db)
    expect(second.id).toBe(first.id);expect(await db.sales.count()).toBe(1);expect(await db.reservations.count()).toBe(1)
  })
  it('rolls back every table if the outbox write fails',async()=>{
    const input=command();await db.outbox.add({id:input.clientSaleId,uid:'u',attempts:0,nextAttempt:0})
    await expect(persistSale(input,profile,db)).rejects.toThrow()
    expect(await db.sales.count()).toBe(0);expect(await db.items.count()).toBe(0);expect(await db.reservations.count()).toBe(0)
  })
  it('rejects noncash offline payments and expired sessions',async()=>{
    await expect(persistSale(command({payments:[{method:'card',amount:1000}]}),profile,db)).rejects.toThrow('cash')
    await db.metadata.put({key:'session:u',value:{id:'session',expiresAt:0}})
    await expect(persistSale(command(),profile,db)).rejects.toThrow('unexpired')
    expect(await db.sales.count()).toBe(0)
  })
  it('prevents concurrent tabs from overselling locally reserved stock',async()=>{
    const input=command();input.lines[0].quantity=2;input.payments[0].amount=2000
    const results=await Promise.allSettled([persistSale(input,profile,db),persistSale({...input,clientSaleId:crypto.randomUUID()},profile,db)])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await db.sales.count()).toBe(1)
  })
  it('recovers pending receipts after database reopen and only acknowledges explicitly',async()=>{
    const sale=await persistSale(command(),profile,db);db.close();await db.open()
    expect((await db.sales.get(sale.id))?.state).toBe('pending')
    await acknowledge(sale,{id:'server',invoiceNumber:'INV-1',subtotal:1000,discount:0,tax:0,grandTotal:1000,paid:1000,balance:0,change:200},db)
    expect((await db.sales.get(sale.id))?.invoice.pending).toBe(false);expect(await db.outbox.count()).toBe(0)
    expect(await db.reservations.count()).toBe(1)
  })
  it('rejects fractional quantities, insufficient payment and duplicate variant keys',async()=>{
    const input=command();input.lines[0].quantity=1.5
    await expect(persistSale(input,profile,db)).rejects.toThrow('Invalid')
    await expect(persistSale(command({payments:[{method:'cash',amount:1}]}),profile,db)).rejects.toThrow('payment')
    const duplicate=command();duplicate.lines.push({...duplicate.lines[0]})
    await expect(persistSale(duplicate,profile,db)).rejects.toThrow('duplicate')
  })
})
