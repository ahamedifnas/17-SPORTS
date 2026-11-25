import { getSession, localDb, persistSale } from '@/offline/database'
import { syncSales } from '@/offline/sync'
import type { CartLine, PaymentAllocation, UserProfile } from '@/types'
export const salesService={async complete(input:{clientSaleId:string;lines:CartLine[];billDiscount:number;taxRate:number;payments:PaymentAllocation[];customer?:{id:string;name:string};cashier:{id:string;name:string}},profile:UserProfile){
  const session=await getSession(profile.uid)
  const sale=await persistSale({...input,offline:!navigator.onLine,sessionId:session?.id},profile)
  if(navigator.onLine)await syncSales(profile,true).catch(console.error)
  return (await localDb.sales.get(sale.id))||sale
}}
