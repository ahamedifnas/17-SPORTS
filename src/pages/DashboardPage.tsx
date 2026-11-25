import { allDocuments } from '@/services/pagedQuery'
import { useEffect, useState } from 'react'
import { collection, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { startOfDay, subDays } from 'date-fns'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowRight, Boxes, CircleDollarSign, PackagePlus, Receipt, ShoppingCart, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { db } from '@/firebase/config'
import { formatMoney } from '@/lib/money'
import { Badge, Button, Card, EmptyState, Skeleton } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { useOffline } from '@/offline/useOffline'

interface Row {
  id: string
  invoiceNumber?: string
  purchaseNumber?: string
  customerName?: string
  supplierName?: string
  grandTotal: number
  cashierName?: string
  createdAt?: Timestamp
  status: string
  items?: { productId: string; productName: string; quantity: number }[]
}

interface Data {
  sales: Row[]
  purchases: Row[]
  todaySales: number
  todayOrders: number
  totalSales: number
  totalPurchases: number
  stockValue: number
  low: number
  out: number
  series: { date: string; sales: number }[]
  top: { name: string; quantity: number }[]
}

export function DashboardPage() {
  const { profile } = useAuth()
  const { lastSync } = useOffline()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!db || !profile) return
    void (async () => {
      try {
        const now = new Date()
        const from = startOfDay(subDays(now, 29))
        const [salesSnap, purchasesSnap, productsSnap] = await Promise.all([
          allDocuments(
            query(
              collection(db!, 'sales'),
              where('branchId', '==', profile.branchId),
              where('createdAt', '>=', Timestamp.fromDate(from)),
              orderBy('createdAt', 'desc')
            )
          ),
          allDocuments(
            query(collection(db!, 'purchases'), where('branchId', '==', profile.branchId), orderBy('createdAt', 'desc'))
          ),
          allDocuments(
            query(collection(db!, 'products'), where('branchId', '==', profile.branchId), where('status', '==', 'active'))
          ),
        ])

        const sales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Row)).filter(s => s.status !== 'voided')
        const purchases = purchasesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Row))
        const products = productsSnap.docs.map(d => d.data())
        const today = sales.filter(s => s.createdAt?.toDate().toDateString() === now.toDateString())

        const series = Array.from({ length: 7 }, (_, i) => {
          const date = subDays(now, 6 - i)
          return {
            date: date.toLocaleDateString('en-LK', { weekday: 'short' }),
            sales: sales
              .filter(s => s.createdAt?.toDate().toDateString() === date.toDateString())
              .reduce((sum, s) => sum + s.grandTotal, 0),
          }
        })

        const quantities = new Map<string, { name: string; quantity: number }>()
        sales.forEach(s =>
          s.items?.forEach(item => {
            const current = quantities.get(item.productId) ?? { name: item.productName, quantity: 0 }
            current.quantity += item.quantity
            quantities.set(item.productId, current)
          })
        )

        setData({
          sales: sales.slice(0, 6),
          purchases: purchases.slice(0, 5),
          todaySales: today.reduce((sum, s) => sum + s.grandTotal, 0),
          todayOrders: today.length,
          totalSales: sales.reduce((sum, s) => sum + s.grandTotal, 0),
          totalPurchases: purchases.filter(p => p.status === 'received').reduce((sum, p) => sum + p.grandTotal, 0),
          stockValue: products.reduce((sum, p) => sum + (p.stock ?? 0) * (p.averageCost ?? p.buyingPrice ?? 0), 0),
          low: products.filter(p => p.stock > 0 && p.stock <= p.minimumStock).length,
          out: products.filter(p => p.stock === 0).length,
          series,
          top: [...quantities.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
        })
      } catch (cause) {
        console.error('Dashboard query failed', cause)
        setError(true)
      }
    })()
  }, [profile])

  if (error)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Dashboard unavailable"
        description="Please verify Firestore collection indexes and branch network permissions."
      />
    )

  if (!data)
    return (
      <div className="space-y-6">
        <Skeleton className="h-16" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    )

  const cards = [
    { label: "Today's sales", value: formatMoney(data.todaySales), icon: CircleDollarSign, highlight: true },
    { label: "Today's transactions", value: data.todayOrders, icon: Receipt },
    { label: '30-day confirmed sales', value: formatMoney(data.totalSales), icon: TrendingUp },
    { label: 'Received purchases', value: formatMoney(data.totalPurchases), icon: PackagePlus },
    { label: 'Inventory valuation', value: formatMoney(data.stockValue), icon: Boxes },
    { label: 'Low stock alerts', value: data.low, icon: AlertTriangle, warning: data.low > 0 },
    { label: 'Out of stock items', value: data.out, icon: AlertTriangle, danger: data.out > 0 },
  ]

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#912DFA]">Store Overview</span>
            <Badge tone="purple">{profile?.branchId || 'Main Branch'}</Badge>
          </div>
          <h1 className="text-2xl font-black text-white">Business Dashboard</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Confirmed cloud data · Last acknowledged sync: {lastSync === 'Never' ? lastSync : new Date(lastSync).toLocaleTimeString()}
          </p>
        </div>

        {/* OWNER QUICK ACTION BUTTONS */}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold">
            <Link to="/pos">
              <ShoppingCart className="h-4 w-4 mr-1.5" />
              Open POS
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="border-white/10 bg-[#222137] text-white">
            <Link to="/purchases">
              <PackagePlus className="h-4 w-4 mr-1.5" />
              Add Purchase
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="border-white/10 bg-[#222137] text-white">
            <Link to="/reports">
              <TrendingUp className="h-4 w-4 mr-1.5" />
              Reports
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI METRICS */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(item => (
          <Card key={item.label} className="p-5 bg-[#222137]">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className={`mt-2 text-2xl font-black ${item.highlight ? 'text-[#912DFA]' : item.danger ? 'text-rose-400' : item.warning ? 'text-amber-300' : 'text-white'}`}>
                  {item.value}
                </p>
              </div>
              <div className="rounded-xl bg-[#11111E] p-2.5 text-purple-300 border border-white/5">
                <item.icon className="h-5 w-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* CHARTS & TOP PRODUCTS */}
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5 bg-[#222137]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-white text-base">Sales Pulse</h2>
              <p className="text-xs text-muted-foreground">Daily sales performance over the last 7 days</p>
            </div>
            <span className="text-xs text-purple-300 font-semibold bg-[#912DFA]/15 px-2 py-0.5 rounded-full border border-[#912DFA]/20">
              7-Day Trend
            </span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series}>
                <defs>
                  <linearGradient id="purpleGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#912DFA" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#912DFA" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="#888899" fontSize={12} tickLine={false} />
                <YAxis
                  stroke="#888899"
                  fontSize={12}
                  tickLine={false}
                  tickFormatter={value => `${Math.round(value / 100000)}k`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#11111E', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  formatter={(value: any) => [formatMoney(Number(value)), 'Sales']}
                />
                <Area type="monotone" dataKey="sales" stroke="#912DFA" strokeWidth={2.5} fill="url(#purpleGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 bg-[#222137] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white text-base">Top Selling Items</h2>
              <span className="text-xs text-muted-foreground">By quantity</span>
            </div>
            <div className="space-y-3">
              {data.top.length ? (
                data.top.map((item, index) => (
                  <div className="flex items-center justify-between border-b border-white/5 pb-3" key={item.name}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="grid h-6 w-6 place-items-center rounded-md bg-[#11111E] text-xs font-bold text-purple-300">
                        {index + 1}
                      </span>
                      <span className="truncate text-sm font-semibold text-white">{item.name}</span>
                    </div>
                    <span className="font-mono text-xs font-bold text-purple-300 bg-[#912DFA]/15 px-2 py-0.5 rounded">
                      {item.quantity} sold
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">No sales registered in this 30-day window.</p>
              )}
            </div>
          </div>
          <div className="pt-4 border-t border-white/5">
            <Link to="/products" className="text-xs font-semibold text-purple-300 hover:text-white flex items-center justify-between">
              <span>View full catalog inventory</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      </div>

      {/* RECENT SALES & RECENT PURCHASES */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5 bg-[#222137]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-white text-base">Recent Confirmed Sales</h2>
            <Link to="/sales" className="text-xs text-purple-300 hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y divide-white/5">
            {data.sales.length ? (
              data.sales.map(s => (
                <div className="flex items-center justify-between py-3" key={s.id}>
                  <div>
                    <p className="text-sm font-bold text-white">{s.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.customerName} · Cashier: {s.cashierName}
                    </p>
                  </div>
                  <p className="font-bold text-sm text-white">{formatMoney(s.grandTotal)}</p>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No confirmed sales yet.</div>
            )}
          </div>
        </Card>

        <Card className="p-5 bg-[#222137]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-white text-base">Recent Stock Purchases</h2>
            <Link to="/purchases" className="text-xs text-purple-300 hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y divide-white/5">
            {data.purchases.length ? (
              data.purchases.map(p => (
                <div className="flex items-center justify-between py-3" key={p.id}>
                  <div>
                    <p className="text-sm font-bold text-white">{p.purchaseNumber}</p>
                    <p className="text-xs text-muted-foreground">Supplier: {p.supplierName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm text-white">{formatMoney(p.grandTotal)}</p>
                    <Badge tone={p.status === 'received' ? 'success' : 'warning'}>{p.status}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No purchases recorded yet.</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
