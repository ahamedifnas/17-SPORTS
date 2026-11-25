import fs from 'node:fs'
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8')))
edit('src/contexts/AuthContext.tsx',s=>{
 s=s.replace("import { doc, getDoc } from 'firebase/firestore'\n",'').replace('auth, db, isFirebaseConfigured','auth, isFirebaseConfigured')
 const a=s.indexOf('          // 1. Authoritative'),b=s.indexOf('\n        }\n      } catch (error)',a)
 s=s.slice(0,a)+`          const res = await apiClient.get<{ user: {uid:string;name:string;email:string;phone?:string;role:Role;status:Status;branch_id:string} }>('/auth/me')
          const parsed=userProfileSchema.safeParse({...res.user,branchId:res.user.branch_id})
          if(!parsed.success||parsed.data.uid!==next.uid)throw new Error('Invalid authoritative D1 profile.')
          setProfile({id:next.uid,...parsed.data} as UserProfile)
          // Offline authorization is issued only by /auth/offline-session during device preparation.
`+s.slice(b)
 return s
})
edit('src/offline/sync.ts',s=>{
 s=s.replace("import { httpsCallable } from 'firebase/functions'\n",'').replace("import { functions } from '@/firebase/config'\n",'').replace('type SaleCommand, ','')
 s="import { calculateCart } from '@/lib/money'\nimport { ApiError } from '@/services/apiClient'\n"+s
 s=s.replace('  let catalogFetched = false\n','').replace('      catalogFetched = true','')
 s=s.replace("  } catch (err) {\n    console.warn('Worker offline prepare failed, trying fallback...', err)\n  }", "  } catch (err) { throw err }")
 const a=s.indexOf('  // 2. Fallback'),b=s.indexOf('  const settings =',a)
 s=s.slice(0,a)+"  if(!sessionData||!Number.isFinite(sessionData.expiresAt)||sessionData.expiresAt<=Date.now())throw new Error('Server offline authorization was not issued. Reconnect and retry.')\n\n"+s.slice(b)
 const c=s.indexOf('          const subtotal ='),d=s.indexOf('          const payload =',c)
 s=s.slice(0,c)+`          const totals=calculateCart(sale.command.lines,sale.command.billDiscount,sale.command.taxRate)
          const tendered=sale.command.payments.reduce((acc,p)=>acc+p.amount,0)
          const credit=sale.command.payments.filter(p=>p.method==='credit').reduce((acc,p)=>acc+p.amount,0)
          const {subtotal,grandTotal}=totals,paid=grandTotal-credit,balance=credit,change=tendered-grandTotal
`+s.slice(d)
 s=s.replace('discount: sale.command.billDiscount,','discount: totals.discount,\n            billDiscount: sale.command.billDiscount,\n            sessionId: sale.command.sessionId,\n            cashierId: sale.uid,\n            approvalReason,').replace('tax: 0,','tax: totals.tax,')
 s=s.replace("          const res = await apiClient.post<{", "          const res = await apiClient.post<SaleResult & {")
 s=s.replace("}>('/sales/sync', payload)","}>(sale.command.offline?'/sales/sync':'/sales/checkout', payload)")
 const e=s.indexOf('          syncedResult = {'),f=s.indexOf('\n        if (syncedResult)',e)
 s=s.slice(0,e)+`          if(res.status!=='completed')throw new Error('Server did not confirm the receipt.')
          syncedResult = res
        } catch (workerErr) { throw workerErr }
`+s.slice(f)
 s=s.replace("const isConflict = message.toLowerCase().includes('conflict')","const isConflict = error instanceof ApiError && error.status>=400 && error.status<500 && error.status!==429")
 return s
})
