import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake=vi.hoisted(()=>({docs:new Map<string,any>(),sequence:0,lock:Promise.resolve() as Promise<unknown>}))
vi.mock('../functions/src/firestore.js',()=>{
  const doc=(path:string)=>({path,id:path.split('/').at(-1),get:async()=>snapshot(path)})
  const snapshot=(path:string)=>({exists:fake.docs.has(path),data:()=>structuredClone(fake.docs.get(path))})
  return {FieldPath:{documentId:()=> '__name__'},FieldValue:{serverTimestamp:()=> 'server-time',increment:(n:number)=>({increment:n})},getFirestore:()=>({doc,collection:(name:string)=>({doc:()=>doc(`${name}/generated-${++fake.sequence}`)}),runTransaction:async(fn:any)=>{
    const run=fake.lock.then(async()=>{
      const changes:{path:string;data:any;merge:boolean}[]=[]
      const result=await fn({get:async(ref:any)=>snapshot(ref.path),set:(ref:any,data:any,options:any)=>changes.push({path:ref.path,data,merge:!!options?.merge}),update:(ref:any,data:any)=>changes.push({path:ref.path,data,merge:true})})
      for(const c of changes)fake.docs.set(c.path,c.merge?{...fake.docs.get(c.path),...c.data}:c.data)
      return result
    });fake.lock=run.catch(()=>{});return run
  }})}
})
import { completeSale } from '../functions/src/checkout'
const command=()=>({clientSaleId:'sale-uuid',deviceId:'device-uuid',localReceiptNumber:'LOCAL-1',completedAt:new Date().toISOString(),cashier:{id:'cashier',name:'Cashier'},lines:[{productId:'ball',name:'Forged name',sku:'forged',quantity:2,unitPrice:1000,costPrice:1,discount:0}],billDiscount:100,taxRate:10,payments:[{method:'cash',amount:2500}]})
const call=(data=command(),uid='cashier')=>completeSale.run({data,auth:{uid,token:{}},rawRequest:{}} as any)
beforeEach(()=>{
  fake.docs.clear();fake.sequence=0;fake.lock=Promise.resolve()
  fake.docs.set('users/cashier',{status:'active',role:'cashier',name:'Cashier',branchId:'main'})
  fake.docs.set('settings/business',{taxEnabled:true,taxRate:10})
  fake.docs.set('products/ball',{branchId:'main',name:'Ball',sku:'BALL',stock:5,sellingPrice:1000,averageCost:400,status:'active',variants:[]})
})
describe('callable checkout transaction with an isolated repository',()=>{
  it('commits authoritative snapshots and returns no cost information',async()=>{
    const result=await call()
    expect(result).toMatchObject({grandTotal:2090,change:410})
    expect(result).not.toHaveProperty('cost')
    const sale=fake.docs.get('sales/sale-uuid')
    expect(sale.cost).toBe(800);expect(sale.items[0].productName).toBe('Ball');expect(sale.items[0].costPrice).toBe(400)
    expect(fake.docs.get('products/ball').stock).toBe(3)
  })
  it('handles simultaneous retries and lost acknowledgements exactly once',async()=>{
    const d=command(),[a,b]=await Promise.all([call(d),call(d)])
    expect(a).toEqual(b);expect(await call(d)).toEqual(a)
    expect(fake.docs.get('products/ball').stock).toBe(3)
    expect([...fake.docs.keys()].filter(k=>k.startsWith('payments/'))).toHaveLength(1)
    expect(fake.docs.get(`counters/invoice-${new Date().getUTCFullYear()}`).value).toBe(1)
  })
  it('rejects reused IDs with different contents',async()=>{
    await call();const changed=command();changed.billDiscount=200
    await expect(call(changed)).rejects.toThrow('different contents')
    expect(fake.docs.get('products/ball').stock).toBe(3)
  })
  it('preserves all records on a stock conflict',async()=>{
    fake.docs.get('products/ball').stock=1
    await expect(call()).rejects.toThrow('Stock conflict')
    expect(fake.docs.has('sales/sale-uuid')).toBe(false);expect(fake.docs.get('products/ball').stock).toBe(1)
  })
  it('rejects wrong roles and server tax mismatches',async()=>{
    fake.docs.set('users/viewer',{status:'active',role:'inventory',branchId:'main'})
    await expect(call(command(),'viewer')).rejects.toThrow('authorized')
    await expect(call({...command(),taxRate:0})).rejects.toThrow('Tax settings changed')
  })
  it('keeps both stock updates when selling two variants of one product',async()=>{
    const p=fake.docs.get('products/ball');p.variants=[{id:'a',sku:'A',stock:2,status:'active',sellingPrice:1000,buyingPrice:300},{id:'b',sku:'B',stock:3,status:'active',sellingPrice:1000,buyingPrice:400}]
    const d=command();d.lines=[{...d.lines[0],quantity:1,variantId:'a'},{...d.lines[0],quantity:1,variantId:'b'}] as any
    await call(d)
    expect(fake.docs.get('products/ball').variants.map((v:any)=>v.stock)).toEqual([1,2]);expect(fake.docs.get('products/ball').stock).toBe(3)
  })
})
