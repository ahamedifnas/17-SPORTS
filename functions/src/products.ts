import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { actor } from './checkout.js'
export const createProduct=onCall({region:'asia-south1'},async r=>{
  const user=await actor(r.auth?.uid,['admin','manager','inventory']),d=r.data,db=getFirestore()
  const nonnegative=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
  if(!d||typeof d.name!=='string'||!d.name.trim()||typeof d.sku!=='string'||!d.sku.trim()||!Array.isArray(d.variants)||d.variants.length>100||!['buyingPrice','sellingPrice','wholesalePrice','minimumSellingPrice','stock','minimumStock'].every(k=>nonnegative(d[k]))||d.minimumSellingPrice>d.sellingPrice)throw new HttpsError('invalid-argument','Invalid product values.')
  const variants=d.variants.map((v:any)=>{
    if(typeof v.id!=='string'||!v.id||typeof v.sku!=='string'||!v.sku||!['buyingPrice','sellingPrice','stock','minimumStock'].every(k=>nonnegative(v[k])))throw new HttpsError('invalid-argument','Invalid variant values.')
    return {id:v.id,sku:v.sku.trim(),barcode:String(v.barcode||'').trim(),size:String(v.size||''),color:String(v.color||''),buyingPrice:v.buyingPrice,sellingPrice:v.sellingPrice,stock:v.stock,minimumStock:v.minimumStock,status:'active'}
  })
  if(new Set(variants.map((v:any)=>v.id)).size!==variants.length)throw new HttpsError('invalid-argument','Duplicate variant IDs.')
  const codes=[d.sku.trim(),String(d.barcode||'').trim(),...variants.flatMap((v:any)=>[v.sku,v.barcode])].filter(Boolean)
  if(new Set(codes).size!==codes.length)throw new HttpsError('invalid-argument','Use unique SKUs and barcodes for each product and variant.')
  const ref=db.collection('products').doc()
  return db.runTransaction(async tx=>{
    const existing=await tx.get(db.collection('products').where('branchId','==',user.branchId))
    const used=new Set(existing.docs.flatMap(s=>{const p=s.data();return [p.sku,p.barcode,...(p.variants||[]).flatMap((v:any)=>[v.sku,v.barcode])].filter(Boolean)}))
    if(codes.some(c=>used.has(c)))throw new HttpsError('already-exists','A product or variant already uses this SKU/barcode.')
    const stock=variants.length?variants.reduce((n:number,v:any)=>n+v.stock,0):d.stock,averageCost=variants.length&&stock?Math.round(variants.reduce((n:number,v:any)=>n+v.stock*v.buyingPrice,0)/stock):d.buyingPrice
    const p={name:d.name.trim(),sku:d.sku.trim(),barcode:String(d.barcode||'').trim(),branchId:user.branchId,categoryId:String(d.categoryId||''),brandId:String(d.brandId||''),description:String(d.description||''),imageUrl:String(d.imageUrl||''),unit:String(d.unit||'pcs'),buyingPrice:d.buyingPrice,averageCost,sellingPrice:d.sellingPrice,wholesalePrice:d.wholesalePrice,minimumSellingPrice:d.minimumSellingPrice,minimumStock:d.minimumStock,stock,variants,status:'active',createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),createdBy:r.auth!.uid,updatedBy:r.auth!.uid}
    tx.set(ref,p)
    for(const v of variants.length?variants:[{id:null,stock}])if(v.stock)tx.set(db.collection('stockMovements').doc(),{branchId:user.branchId,productId:ref.id,variantId:v.id,type:'opening-stock',quantity:v.stock,beforeStock:0,afterStock:v.stock,referenceId:ref.id,createdAt:FieldValue.serverTimestamp(),createdBy:r.auth!.uid})
    tx.set(db.collection('auditLogs').doc(),{branchId:user.branchId,userId:r.auth!.uid,userName:user.name,action:'CREATE_PRODUCT',module:'products',referenceId:ref.id,description:`Created ${p.name}`,timestamp:FieldValue.serverTimestamp()})
    return {id:ref.id}
  })
})
