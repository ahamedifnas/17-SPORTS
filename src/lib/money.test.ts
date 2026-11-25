import { describe, expect, it } from 'vitest'
import { calculateCart, calculatePayment, toMoney } from './money'
import type { CartLine } from '@/types'
const line:CartLine={key:'1',productId:'1',name:'Ball',sku:'B1',quantity:2,unitPrice:toMoney(1000),costPrice:toMoney(600),discount:toMoney(100),availableStock:5}
describe('money and POS calculations',()=>{it('uses integer money for discounts, tax and profit',()=>{expect(calculateCart([line],toMoney(100),10)).toEqual({subtotal:200000,itemDiscount:10000,discount:20000,tax:18000,grandTotal:198000,cost:120000,grossProfit:60000})});it('calculates credit balance without change',()=>{expect(calculatePayment(toMoney(25000),[{method:'cash',amount:toMoney(15000)},{method:'credit',amount:toMoney(10000)}])).toMatchObject({paid:toMoney(25000),credit:toMoney(10000),change:0})});it('returns cash change',()=>{expect(calculatePayment(toMoney(900),[{method:'cash',amount:toMoney(1000)}]).change).toBe(toMoney(100))})})
