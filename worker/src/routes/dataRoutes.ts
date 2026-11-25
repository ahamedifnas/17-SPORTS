import type { Env,AuthUser } from '../types'
import { errorResponse,jsonResponse } from '../helpers'
const tables:Record<string,{table:string;roles:string[]}>={
  sales:{table:'sales',roles:['admin','manager','cashier','accountant']},products:{table:'products',roles:['admin','manager','cashier','inventory','accountant']},
  purchases:{table:'purchases',roles:['admin','manager','inventory','accountant']},purchaseReturns:{table:'purchase_returns',roles:['admin','manager','inventory','accountant']},
  salesReturns:{table:'sales_returns',roles:['admin','manager','cashier','accountant']},customers:{table:'customers',roles:['admin','manager','cashier','accountant']},suppliers:{table:'suppliers',roles:['admin','manager','inventory','accountant']},
  expenses:{table:'expenses',roles:['admin','manager','accountant']},payments:{table:'payments',roles:['admin','manager','accountant']},cashClosings:{table:'cash_closings',roles:['admin','manager','accountant']},
  users:{table:'users',roles:['admin']},auditLogs:{table:'audit_logs',roles:['admin','accountant']},stockMovements:{table:'stock_movements',roles:['admin','manager','inventory']},categories:{table:'categories',roles:['admin','manager','inventory','cashier']},brands:{table:'brands',roles:['admin','manager','inventory','cashier']},
}
export async function handleDataRoutes(request:Request,env:Env,url:URL,user:AuthUser|null){
  const name=url.pathname.split('/').at(-1)!,config=tables[name]
  if(!user||user.status!=='active')return errorResponse('Unauthorized',401)
  if(!config||request.method!=='GET')return errorResponse('Not found',404)
  if(!config.roles.includes(user.role))return errorResponse('Forbidden',403)
  const offset=Number(url.searchParams.get('offset')||0),limit=Math.min(Number(url.searchParams.get('limit')||200),200)
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)return errorResponse('Invalid pagination')
  const rows=(await env.DB.prepare(`SELECT * FROM ${config.table} WHERE branch_id=? ORDER BY ${name==='users'?'uid':'id'} LIMIT ? OFFSET ?`).bind(user.branch_id,limit,offset).all<Record<string,any>>()).results
  for(const row of rows){
    if(name==='sales'){
      row.items=(await env.DB.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY rowid').bind(row.id).all()).results
      row.payments=(await env.DB.prepare('SELECT * FROM sale_payments WHERE sale_id=? ORDER BY rowid').bind(row.id).all()).results
      row.payment_status=row.balance>0?'credit':'paid'
    }
    if(name==='products')row.variants=(await env.DB.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY rowid').bind(row.id).all()).results
    if(name==='purchases')row.items=(await env.DB.prepare('SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid').bind(row.id).all()).results
    if(name==='salesReturns')row.items=(await env.DB.prepare('SELECT * FROM sales_return_items WHERE return_id=? ORDER BY rowid').bind(row.id).all()).results
    if(name==='users')row.id=row.uid
    if(name==='customers')row.customer_code=row.code||''
    if(name==='suppliers')row.supplier_code=row.code||''
    if(name==='categories'||name==='brands')row.status=row.status||'active'
    if(name==='expenses'&&row.status==='approved')row.status='active'
    if(user.role==='cashier'){
      for(const record of [row,...(row.items||[]),...(row.variants||[])])for(const field of ['cost','gross_profit','cost_price','buying_price','average_cost'])delete record[field]
    }
  }
  return jsonResponse(rows)
}
