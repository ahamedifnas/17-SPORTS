import type { Timestamp } from 'firebase/firestore'

export type Role = 'admin' | 'manager' | 'cashier'
export type Status = 'active' | 'inactive' | 'archived'
export type Money = number // integer cents; 125000 = Rs. 1,250.00
export type PaymentMethod = 'cash' | 'card' | 'bank' | 'qr' | 'credit'

export interface BaseEntity {
  id: string
  branchId: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
  createdBy?: string
  updatedBy?: string
}

export interface UserProfile extends BaseEntity {
  uid: string
  name: string
  email: string
  phone?: string
  role: Role
  status: Status
}

export interface Category extends BaseEntity { name: string; description?: string; status: Status }
export interface Brand extends BaseEntity { name: string; description?: string; logoUrl?: string; status: Status }

export interface ProductVariant {
  id: string
  sku: string
  barcode?: string
  size?: string
  color?: string
  attributes?: Record<string, string>
  buyingPrice: Money
  sellingPrice: Money
  stock: number
  minimumStock: number
  status: Status
}

export interface Product extends BaseEntity {
  name: string
  sku: string
  barcode?: string
  categoryId: string
  brandId: string
  description?: string
  imageUrl?: string
  buyingPrice: Money
  averageCost: Money
  sellingPrice: Money
  wholesalePrice: Money
  minimumSellingPrice: Money
  stock: number
  minimumStock: number
  maximumStock?: number
  unit: string
  status: Status
  variants: ProductVariant[]
}

export interface CartLine {
  key: string
  productId: string
  variantId?: string
  name: string
  sku: string
  variantLabel?: string
  quantity: number
  unitPrice: Money
  costPrice: Money
  discount: Money
  availableStock: number
}

export interface PaymentAllocation { method: PaymentMethod; amount: Money }

export interface SaleItemSnapshot {
  productId: string
  variantId?: string
  productName: string
  sku: string
  variantDescription?: string
  quantity: number
  unitPrice: Money
  costPrice: Money
  discount: Money
  lineTotal: Money
  returnedQuantity: number
}

export interface Sale extends BaseEntity {
  invoiceNumber: string
  customerId?: string
  customerName: string
  cashierId: string
  cashierName: string
  items: SaleItemSnapshot[]
  subtotal: Money
  discount: Money
  tax: Money
  grandTotal: Money
  paid: Money
  balance: Money
  change: Money
  payments: PaymentAllocation[]
  paymentStatus: 'paid' | 'partial' | 'credit'
  status: 'completed' | 'partially-returned' | 'returned' | 'voided'
}

export interface Party extends BaseEntity {
  name: string
  phone: string
  email?: string
  address?: string
  openingBalance: Money
  currentBalance: Money
  status: Status
}
export interface Customer extends Party { customerType: 'retail' | 'wholesale' | 'vip' | 'credit' }
export interface Supplier extends Party { company?: string }

export interface Settings {
  businessName: string
  address: string
  phone: string
  email: string
  invoicePrefix: string
  currency: 'LKR'
  taxEnabled: boolean
  taxRate: number
  invoiceFooter: string
  paperSize: 'a4' | 'a5' | '80mm'
  allowNegativeStock: boolean
  requireManagerBelowMinimum: boolean
}

export interface StockMovement extends BaseEntity {
  productId: string
  variantId?: string
  type: 'purchase' | 'sale' | 'sales-return' | 'purchase-return' | 'adjustment' | 'damage' | 'lost' | 'internal-use' | 'opening-stock'
  quantity: number
  beforeStock: number
  afterStock: number
  referenceId: string
  reason?: string
}
