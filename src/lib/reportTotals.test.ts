import { describe, expect, it } from 'vitest'
import { reportTotals, returnedShare } from './reportTotals'
import type { Expense, Sale, SalesReturn } from '@/types'
describe('reconciled reporting',()=>{
  it('excludes tax and restores COGS for returned units',()=>{
    const sale={id:'s',grandTotal:1100,tax:100,status:'completed',items:[{productId:'p',quantity:2,costPrice:300}]} as Sale
    const returned={saleId:'s',total:550,tax:50,status:'completed',items:[{index:0,productId:'p',quantity:1}]} as SalesReturn
    const expense={amount:50,status:'active'} as Expense
    expect(reportTotals([sale],[returned],[expense]).profit).toBe(150)
  })
  it('uses the original sale cost for a return outside the sale reporting period',()=>{
    const sale={id:'s',grandTotal:1000,tax:0,status:'completed',items:[{productId:'p',quantity:1,costPrice:600}]} as Sale
    const returned={saleId:'s',total:1000,tax:0,status:'completed',items:[{index:0,productId:'p',quantity:1}]} as SalesReturn
    expect(reportTotals([],[returned],[],[sale]).profit).toBe(-400)
  })
  it('allocates rounding remainders exactly over successive partial refunds',()=>{
    const parts=[0,1,2].map(previous=>returnedShare(100,3,previous,1))
    expect(parts.reduce((s,n)=>s+n,0)).toBe(100)
  })
})
