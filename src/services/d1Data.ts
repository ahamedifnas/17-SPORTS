import { Timestamp } from 'firebase/firestore'
import { apiClient } from './apiClient'
export function fromD1(value:unknown):any {
  if(Array.isArray(value))return value.map(fromD1)
  if(!value||typeof value!=='object')return value
  return Object.fromEntries(Object.entries(value).map(([key,v])=>{
    const name=key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase())
    if(['createdAt','updatedAt'].includes(name)&&typeof v==='string')return [name,Timestamp.fromDate(new Date(v.includes('T')?v:v.replace(' ','T')+'Z'))]
    return [name,fromD1(v)]
  }))
}
export async function d1List<T>(name:string,branchId:string,pageSize=200):Promise<T[]> {
  if(!branchId)throw new Error('Branch required.')
  const rows:T[]=[];const limit=Math.min(pageSize,200)
  for(let offset=0;;offset+=limit){const page=await apiClient.get<unknown[]>(`/data/${name}`,{limit,offset});if(!Array.isArray(page))throw new Error('Invalid D1 response.');rows.push(...page.map(fromD1));if(page.length<limit)return rows}
}
