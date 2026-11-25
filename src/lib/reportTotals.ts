import type { Expense, Sale, SalesReturn } from '@/types'

export function returnedShare(total: number, quantity: number, previous: number, returned: number) {
  return Math.round((total * (previous + returned)) / quantity) - Math.round((total * previous) / quantity)
}

export function reportTotals(sales:Sale[],returns:SalesReturn[],expenses:Expense[],allSales:Sale[]=sales){
  const valid=sales.filter(s=>s.status!=='voided'),revenue=valid.reduce((n,s)=>n+s.grandTotal-s.tax,0),cost=valid.reduce((n,s)=>n+s.items.reduce((n,i)=>n+i.costPrice*i.quantity,0),0)
  let returnedNet=0,returnedCost=0
  for(const r of returns.filter(r=>r.status==='completed')){
    const sale=allSales.find(s=>s.id===r.saleId)
    returnedNet+=r.total-(r.tax??0)
    for(const i of r.items){const sold=i.index!==undefined?sale?.items[i.index]:sale?.items.find(s=>s.productId===i.productId&&(s.variantId||'')===(i.variantId||''));returnedCost+=(sold?.costPrice||0)*i.quantity}
  }
  const expense=expenses.filter(e=>e.status==='active').reduce((n,e)=>n+e.amount,0)
  return {revenue,cost,returnedNet,returnedCost,expense,profit:revenue-returnedNet-cost+returnedCost-expense}
}
