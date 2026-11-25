import fs from 'node:fs'
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8')))
edit('functions/src/index.ts',s=>{
 s=s.replace("if(!data.supplierName?.trim()", "if(data.items?.length>100||new Set(data.items?.map(i=>i.productId+':'+(i.variantId||''))).size!==data.items?.length)throw new HttpsError('invalid-argument','Duplicate or excessive purchase lines.');\n  if(!data.supplierName?.trim()")
 s=s.replace('item.discount<0)', 'item.discount<0||item.discount>item.costPrice*item.quantity)')
 // A single mutable working copy per product preserves changes across multiple variants.
 let start=s.indexOf('export const createPurchase'),end=s.indexOf('interface ReturnInput')
 let part=s.slice(start,end)
 part=part.replaceAll('snaps=await Promise.all(refs.map(ref=>tx.get(ref)))','snaps=await Promise.all(refs.map(ref=>tx.get(ref))),productCache=new Map(snaps.map(s=>[s.id,s.data()!]))')
 part=part.replace('const product=snaps[index].data()!,before=', 'const product=productCache.get(item.productId)!,before=')
 part=part.replace('const product=snap.data()!,before=', 'const product=productCache.get(item.productId)!,before=')
 part=part.replaceAll('variants[variantIndex]={...variants[variantIndex],stock:before+item.quantity,buyingPrice:item.costPrice};', 'variants[variantIndex]={...variants[variantIndex],stock:before+item.quantity,buyingPrice:item.costPrice};product.variants=variants;')
 part=part.replaceAll('tx.update(refs[index],{variants,stock:totalStock', 'product.stock=totalStock;product.averageCost=newAverage;tx.update(refs[index],{variants,stock:totalStock')
 part=part.replaceAll('tx.update(refs[index],{stock:after', 'product.stock=after;product.averageCost=newAverage;tx.update(refs[index],{stock:after')
 part=part.replace("if(purchase.status!=='draft')throw", "if(purchase.status==='received')return{id:purchaseId,purchaseNumber:purchase.purchaseNumber,status:'received'};if(purchase.status!=='draft')throw")
 part=part.replace('    purchase.items.forEach(', "    if(purchase.supplierId){const supplierRef=db.doc(`suppliers/${purchase.supplierId}`),supplier=await tx.get(supplierRef);if(!supplier.exists||supplier.data()!.branchId!==user.branchId)throw new HttpsError('failed-precondition','Supplier unavailable.');tx.update(supplierRef,{currentBalance:FieldValue.increment(purchase.grandTotal),updatedAt:FieldValue.serverTimestamp()})}\n    purchase.items.forEach(")
 // Require a variant for variant products, including received historical drafts.
 part=part.replace('const variant=item.variantId?',"if(!item.variantId&&product.variants?.length)throw new HttpsError('invalid-argument','Select a variant.');const variant=item.variantId?")
 part=part.replace('let totalStock=', 'let totalStock=')
 s=s.slice(0,start)+part+s.slice(end)
 // Purchase refunds use original discounted purchase values, not current catalog cost.
 s=s.replace('    let before:number,costPrice:number;',`    const originalItems=purchase.items.filter((i:any)=>i.productId===data.productId&&(i.variantId||null)===(data.variantId||null)),originalTotal=originalItems.reduce((n:number,i:any)=>n+i.lineTotal,0),returnAmount=Math.round(originalTotal*(alreadyReturned+data.quantity)/purchased)-Math.round(originalTotal*alreadyReturned/purchased)
    if(purchase.supplierId){const supplierRef=db.doc(\`suppliers/\${purchase.supplierId}\`),supplier=await tx.get(supplierRef);if(!supplier.exists||supplier.data()!.branchId!==user.branchId)throw new HttpsError('failed-precondition','Supplier unavailable.');tx.update(supplierRef,{currentBalance:FieldValue.increment(-returnAmount),updatedAt:FieldValue.serverTimestamp()})}
    let before:number;`)
 s=s.replace('costPrice=variants[index].buyingPrice;','').replace('costPrice=product.averageCost??product.buyingPrice??0;','').replace('amount:data.quantity*costPrice','amount:returnAmount')
 // Legacy alternate payment endpoint now shares the validated account-payment path.
 start=s.indexOf('export const recordPayment=');end=s.indexOf("export { completeSalesReturn",start)
 s=s.slice(0,start)+s.slice(end)
 s=s.replace("if(!['customer','supplier','other'].includes(data.type)","if(!['cash','card','bank','qr'].includes(data.paymentMethod)||!['customer','supplier','other'].includes(data.type)")
 s += '\nexport const recordPayment = recordAccountPayment\n'
 // Cash totals subtract change and supplier cash disbursements; dates use the shop timezone.
 s=s.replace("row.createdAt?.toDate?.().toISOString().slice(0,10)===data.date","(row.createdAt?.toDate?.()&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo'}).format(row.createdAt.toDate())===data.date)")
 s=s.replace("s+p.amount,0),0),cashCustomerPayments", "s+p.amount,0)-(row.data().change||0),0),cashCustomerPayments")
 s=s.replace("row.data().status!=='inactive'", "row.data().status==='active'")
 s=s.replace("sum+row.data().total,0),expectedCash", "sum+(row.data().refundAmount??row.data().total),0),supplierCash=payments.docs.filter(row=>onDate(row.data())&&row.data().type==='supplier'&&row.data().paymentMethod==='cash').reduce((sum,row)=>sum+row.data().amount,0),expectedCash")
 s=s.replace('cashCustomerPayments-cashExpenses-cashRefunds','cashCustomerPayments-cashExpenses-cashRefunds-supplierCash')
 // Deterministic day key guards two simultaneous closing submissions.
 s=s.replace("const counter=await tx.get(counterRef),sequence=(counter.data()?.value??0)+1,closingNumber=", "const closingRef=db.doc(`cashClosings/${user.branchId}-${data.date}`);if((await tx.get(closingRef)).exists)throw new HttpsError('already-exists','Day already closed.');const counter=await tx.get(counterRef),sequence=(counter.data()?.value??0)+1,closingNumber=")
 s=s.replace("ref=db.collection('cashClosings').doc()",'ref=closingRef')
 return s
})
edit('src/pages/AdminReportsPages.tsx',s=>{
 s="import { reportTotals } from '@/lib/reportTotals'\n"+s
 s=s.replace('profit=salesTotal-salesCost-returnTotal-expenseTotal','profit=reportTotals(sales,salesReturns,expenses,data.sales).profit')
 s=s.replace('Live branch data; no demo figures.','Confirmed cloud data. Pending device receipts are excluded; profit excludes tax and restores returned cost.')
 return s
})
