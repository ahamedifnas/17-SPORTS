import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { localDb, type LocalSale } from './database'
import { useAuth } from '@/contexts/AuthContext'
import { syncSales } from './sync'
export function useOffline() {
  const {profile}=useAuth(),[online,setOnline]=useState(navigator.onLine),[sales,setSales]=useState<LocalSale[]>([]),[lastSync,setLastSync]=useState('Never')
  useEffect(()=>{
    const change=()=>setOnline(navigator.onLine)
    window.addEventListener('online',change);window.addEventListener('offline',change)
    const subscription=liveQuery(async()=>({sales:await localDb.sales.toArray(),last:await localDb.metadata.get('lastSync')})).subscribe({next:({sales,last})=>{setSales(sales.filter(s=>s.branchId===profile?.branchId&&(s.uid===profile?.uid||profile?.role==='admin')));setLastSync(String(last?.value||'Never'))},error:console.error})
    return()=>{subscription.unsubscribe();window.removeEventListener('online',change);window.removeEventListener('offline',change)}
  },[profile])
  useEffect(()=>{
    if(!profile)return
    const sync=()=>{void syncSales(profile).catch(console.error)}
    sync();const interval=window.setInterval(sync,15000);window.addEventListener('online',sync)
    return()=>{clearInterval(interval);window.removeEventListener('online',sync)}
  },[profile])
  return {online,sales,lastSync,pending:sales.filter(s=>s.state!=='synced').length}
}
