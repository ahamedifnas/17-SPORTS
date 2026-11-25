import { reportTotals } from '@/lib/reportTotals'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileClock, Plus, Printer, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, Input, Label, PageHeader, Skeleton } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { formatMoney } from '@/lib/money'
import { adminService, reportService } from '@/services/businessService'
import type { CashClosing, Customer, Expense, Product, Purchase, PurchaseReturn, Role, Sale, SalesReturn, Supplier, UserProfile } from '@/types'

const dateText = (value: unknown) => {
  if (typeof value === 'string') return value
  const timestamp = value as { toDate?: () => Date } | undefined
  return timestamp?.toDate?.().toISOString().slice(0, 10) ?? '—'
}

export function ReportsPage() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [productPage, setProductPage] = useState(1)
  const pageSize = 10

  const [data, setData] = useState<{
    sales: Sale[]
    purchases: Purchase[]
    purchaseReturns: PurchaseReturn[]
    salesReturns: SalesReturn[]
    products: Product[]
    expenses: Expense[]
    customers: Customer[]
    suppliers: Supplier[]
    closings: CashClosing[]
  }>({
    sales: [],
    purchases: [],
    purchaseReturns: [],
    salesReturns: [],
    products: [],
    expenses: [],
    customers: [],
    suppliers: [],
    closings: [],
  })

  const load = useCallback(async () => {
    if (!profile) return
    try {
      const names = [
        'sales',
        'purchases',
        'purchaseReturns',
        'salesReturns',
        'products',
        'expenses',
        'customers',
        'suppliers',
        'cashClosings',
      ] as const
      const values = await Promise.all(names.map(name => reportService.branchList<{ id: string }>(name, profile.branchId)))
      setData(Object.fromEntries(names.map((name, index) => [name, values[index]])) as typeof data)
    } catch (cause) {
      console.error(cause)
      toast.error('Unable to load report data.')
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  const range = <T extends Record<string, unknown>>(rows: T[], fieldName: string) =>
    rows.filter(row => {
      const d = dateText(row[fieldName] ?? row.createdAt)
      return d >= from && d <= to
    })

  const sales = range(data.sales as unknown as Record<string, unknown>[], 'createdAt') as unknown as Sale[]
  const purchases = range(data.purchases as unknown as Record<string, unknown>[], 'purchaseDate') as unknown as Purchase[]
  const expenses = range(data.expenses as unknown as Record<string, unknown>[], 'date') as unknown as Expense[]
  const salesReturns = range(data.salesReturns as unknown as Record<string, unknown>[], 'returnDate') as unknown as SalesReturn[]
  const purchaseReturns = range(data.purchaseReturns as unknown as Record<string, unknown>[], 'returnDate') as unknown as PurchaseReturn[]

  const salesTotal = sales.filter(v => v.status !== 'voided').reduce((s, v) => s + v.grandTotal, 0)
  const expenseTotal = expenses.filter(v => v.status !== 'archived').reduce((s, v) => s + v.amount, 0)
  const returnTotal = salesReturns.reduce((s, v) => s + v.total, 0)
  const totals = reportTotals(sales, salesReturns, expenses, data.sales)
  const profit = totals.profit
  const purchaseTotal = purchases.filter(v => v.status === 'received').reduce((s, v) => s + v.grandTotal, 0)
  const stockValue = data.products.reduce((s, v) => s + v.stock * (v.averageCost || v.buyingPrice), 0)

  function csv() {
    const lines = [
      ['Report Item', 'Value (Rs.)'],
      ['Gross Sales', (salesTotal / 100).toFixed(2)],
      ['Net Revenue (Excl Tax)', (totals.revenue / 100).toFixed(2)],
      ['Sales Returns', (returnTotal / 100).toFixed(2)],
      ['Gross COGS', (totals.cost / 100).toFixed(2)],
      ['Restored COGS (Returns)', (totals.returnedCost / 100).toFixed(2)],
      ['Operating Expenses', (expenseTotal / 100).toFixed(2)],
      ['Reconciled Net Profit', (profit / 100).toFixed(2)],
      ['Purchases Received', (purchaseTotal / 100).toFixed(2)],
      ['Purchase Returns', (purchaseReturns.reduce((s, v) => s + v.amount, 0) / 100).toFixed(2)],
      ['Total Inventory Value', (stockValue / 100).toFixed(2)],
      ['Outstanding Customer Credit', (data.customers.reduce((s, v) => s + v.currentCredit, 0) / 100).toFixed(2)],
      ['Outstanding Supplier Payable', (data.suppliers.reduce((s, v) => s + v.currentBalance, 0) / 100).toFixed(2)],
    ]
    const blob = new Blob([lines.map(v => v.map(c => `"${c}"`).join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `z17-report-${from}-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const cards = [
    ['Gross sales', salesTotal],
    ['Purchases received', purchaseTotal],
    ['Sales returns', returnTotal],
    ['Purchase returns', purchaseReturns.reduce((s, v) => s + v.amount, 0)],
    ['Operating expenses', expenseTotal],
    ['Reconciled net profit', profit],
    ['Inventory valuation', stockValue],
    ['Customer credit balance', data.customers.reduce((s, v) => s + v.currentCredit, 0)],
    ['Supplier payables', data.suppliers.reduce((s, v) => s + v.currentBalance, 0)],
  ]

  // Product sales aggregation
  const productSales = Array.from(
    sales
      .filter(v => v.status !== 'voided')
      .flatMap(v => v.items)
      .reduce((map, item) => {
        const old = map.get(item.productId) ?? { name: item.productName, sku: item.sku, units: 0, revenue: 0, cost: 0 }
        old.units += item.quantity
        old.revenue += item.lineTotal
        old.cost += item.costPrice * item.quantity
        map.set(item.productId, old)
        return map
      }, new Map<string, { name: string; sku: string; units: number; revenue: number; cost: number }>())
      .values()
  ).sort((a, b) => b.revenue - a.revenue)

  const totalPages = Math.max(1, Math.ceil(productSales.length / pageSize))
  const paginatedProducts = productSales.slice((productPage - 1) * pageSize, productPage * pageSize)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Reports"
        description="Reconciled financial intelligence. Confirmed cloud figures only; profit restores returned costs and deducts operating expenses."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()} className="border-white/10 bg-[#222137]">
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
            <Button onClick={csv} className="bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold">
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        }
      />

      {/* DATE RANGE FILTER */}
      <Card className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 p-4 bg-[#222137]">
        <div className="flex-1 sm:max-w-xs">
          <Label className="text-xs text-muted-foreground">From Date</Label>
          <Input className="mt-1.5 bg-[#11111E] border-white/10 text-white" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="flex-1 sm:max-w-xs">
          <Label className="text-xs text-muted-foreground">To Date</Label>
          <Input className="mt-1.5 bg-[#11111E] border-white/10 text-white" type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="flex items-end self-end sm:self-auto pt-2">
          <span className="text-xs text-muted-foreground">
            Displaying {sales.length} sales · {purchases.length} purchases
          </span>
        </div>
      </Card>

      {loading ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          {/* KPI CARDS */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(([label, value]) => (
              <Card className="p-5 bg-[#222137]" key={String(label)}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className={`mt-2 text-2xl font-black ${String(label).includes('profit') ? 'text-[#912DFA]' : 'text-white'}`}>
                  {formatMoney(Number(value))}
                </p>
              </Card>
            ))}
          </div>

          {/* NET PROFIT CALCULATION FORMULA BREAKDOWN */}
          <Card className="p-5 bg-[#222137]">
            <h2 className="text-base font-bold text-white mb-2">Reconciled Profit Breakdown</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Net Profit = (Net Revenue - Returned Net Revenue) - (Gross COGS - Returned COGS) - Operating Expenses
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div className="rounded-lg bg-[#11111E] p-3 border border-white/5">
                <span className="text-xs text-muted-foreground">Net Sales Revenue</span>
                <p className="text-base font-bold text-white mt-1">{formatMoney(totals.revenue)}</p>
              </div>
              <div className="rounded-lg bg-[#11111E] p-3 border border-white/5">
                <span className="text-xs text-muted-foreground">Sales Returns Total</span>
                <p className="text-base font-bold text-rose-400 mt-1">-{formatMoney(totals.returnedNet)}</p>
              </div>
              <div className="rounded-lg bg-[#11111E] p-3 border border-white/5">
                <span className="text-xs text-muted-foreground">Effective Net COGS</span>
                <p className="text-base font-bold text-amber-300 mt-1">-{formatMoney(totals.cost - totals.returnedCost)}</p>
              </div>
              <div className="rounded-lg bg-[#11111E] p-3 border border-white/5">
                <span className="text-xs text-muted-foreground">Operating Expenses</span>
                <p className="text-base font-bold text-rose-400 mt-1">-{formatMoney(expenseTotal)}</p>
              </div>
            </div>
          </Card>

          {/* TOP PRODUCTS AGGREGATION TABLE WITH PAGINATION */}
          <Card className="overflow-hidden bg-[#222137]">
            <div className="border-b border-white/10 p-5 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-white text-base">Sales by Product</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{productSales.length} unique products sold in this period</p>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Page {productPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-white/10 bg-[#11111E]"
                    disabled={productPage <= 1}
                    onClick={() => setProductPage(p => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-white/10 bg-[#11111E]"
                    disabled={productPage >= totalPages}
                    onClick={() => setProductPage(p => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-[#11111E] text-xs font-semibold uppercase text-muted-foreground">
                  <tr>
                    <th className="p-4">Product</th>
                    <th>SKU</th>
                    <th>Units Sold</th>
                    <th>Revenue</th>
                    <th>Gross Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paginatedProducts.length ? (
                    paginatedProducts.map(row => (
                      <tr className="hover:bg-card/[0.02]" key={row.sku}>
                        <td className="p-4 font-semibold text-white">{row.name}</td>
                        <td className="text-muted-foreground font-mono text-xs">{row.sku}</td>
                        <td className="font-bold text-white">{row.units}</td>
                        <td className="font-bold text-purple-300">{formatMoney(row.revenue)}</td>
                        <td className="text-muted-foreground">{formatMoney(row.cost)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                        No product sales recorded in this date range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

export function UsersPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<UserProfile | null>(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'cashier' as Role,
    status: 'active' as 'active' | 'inactive',
    branchId: profile?.branchId ?? 'main',
  })

  const load = useCallback(async () => {
    if (profile)
      try {
        setRows(await adminService.listUsers(profile.branchId))
      } catch (cause) {
        console.error(cause)
        toast.error('Unable to load staff profiles.')
      } finally {
        setLoading(false)
      }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  function start(row?: UserProfile) {
    setEditing(row ?? null)
    setForm({
      name: row?.name ?? '',
      email: row?.email ?? '',
      password: '',
      role: row?.role ?? 'cashier',
      status: row?.status === 'inactive' ? 'inactive' : 'active',
      branchId: row?.branchId ?? profile?.branchId ?? 'main',
    })
    setOpen(true)
  }

  async function save() {
    if (!form.name.trim() || !form.email.trim() || (!editing && form.password.length < 6))
      return toast.error('Name, email and a password of at least 6 characters are required.')
    try {
      setSaving(true)
      await adminService.saveStaff({
        uid: editing?.uid,
        name: form.name,
        email: form.email,
        password: form.password || undefined,
        role: form.role,
        status: form.status,
        branchId: form.branchId,
      })
      toast.success('Staff account saved.')
      setOpen(false)
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to save staff account.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff & User Management"
        description="Role-based access permissions and staff authentication credentials for this branch."
        action={
          <Button onClick={() => start()} className="bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold">
            <Plus className="h-4 w-4 mr-1" />
            Add Staff Member
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-72" />
      ) : !rows.length ? (
        <EmptyState icon={<ShieldCheck />} title="No staff profiles" description="Create the first branch staff profile." />
      ) : (
        <Card className="divide-y divide-white/5 bg-[#222137]">
          {rows.map(row => (
            <div className="flex items-center justify-between p-5" key={row.id}>
              <div>
                <p className="font-bold text-white text-base">{row.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {row.email} · Branch: {row.branchId}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
                  {row.role.toUpperCase()} · {row.status}
                </Badge>
                <Button size="sm" variant="outline" className="border-white/10 bg-[#11111E]" onClick={() => start(row)}>
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{editing ? 'Edit Staff Profile' : 'Add New Staff Member'}</DialogTitle>
          <DialogDescription>Credentials are managed via Firebase Auth and user profile synchronized in Firestore.</DialogDescription>
          <div className="mt-5 space-y-4">
            <div>
              <Label>Full Name</Label>
              <Input className="mt-1.5 bg-[#11111E] border-white/10 text-white" value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} />
            </div>
            <div>
              <Label>Email Address</Label>
              <Input className="mt-1.5 bg-[#11111E] border-white/10 text-white" type="email" value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} />
            </div>
            {!editing && (
              <div>
                <Label>Password (Minimum 6 characters)</Label>
                <Input
                  className="mt-1.5 bg-[#11111E] border-white/10 text-white"
                  type="password"
                  value={form.password}
                  onChange={e => setForm(v => ({ ...v, password: e.target.value }))}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Role</Label>
                <select
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#11111E] px-3 text-sm text-white"
                  value={form.role}
                  onChange={e => setForm(v => ({ ...v, role: e.target.value as Role }))}
                >
                  {['admin', 'manager', 'cashier', 'inventory', 'accountant'].map(v => (
                    <option key={v} value={v}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Status</Label>
                <select
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#11111E] px-3 text-sm text-white"
                  value={form.status}
                  onChange={e => setForm(v => ({ ...v, status: e.target.value as 'active' | 'inactive' }))}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Branch ID</Label>
              <Input className="mt-1.5 bg-[#11111E] border-white/10 text-white" value={form.branchId} onChange={e => setForm(v => ({ ...v, branchId: e.target.value }))} />
            </div>
            <Button className="w-full bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold h-11" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving Profile…' : 'Save Staff Account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function AuditLogsPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<(Record<string, unknown> & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [module, setModule] = useState('all')
  const [action, setAction] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 15

  useEffect(() => {
    if (profile)
      adminService
        .listAudit(profile.branchId)
        .then(setRows)
        .catch((cause: unknown) => {
          console.error(cause)
          toast.error('Unable to load audit logs.')
        })
        .finally(() => setLoading(false))
  }, [profile])

  const filtered = useMemo(
    () =>
      rows
        .filter(
          row =>
            (module === 'all' || row.module === module) &&
            (action === 'all' || row.action === action) &&
            `${row.userName ?? ''} ${row.description ?? ''}`.toLowerCase().includes(search.toLowerCase())
        )
        .sort((a, b) => dateText(b.timestamp).localeCompare(dateText(a.timestamp))),
    [rows, module, action, search]
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  const modules = Array.from(new Set(rows.map(v => String(v.module ?? '')))).filter(Boolean)
  const actions = Array.from(new Set(rows.map(v => String(v.action ?? '')))).filter(Boolean)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Immutable chronological record of business transactions, inventory modifications, and security actions."
      />

      <Card className="grid gap-3 p-4 sm:grid-cols-3 bg-[#222137]">
        <Input
          value={search}
          onChange={e => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search user or description…"
          className="bg-[#11111E] border-white/10 text-white"
        />
        <select
          className="h-10 rounded-lg border border-white/10 bg-[#11111E] px-3 text-sm text-white"
          value={module}
          onChange={e => {
            setModule(e.target.value)
            setPage(1)
          }}
        >
          <option value="all">All Modules</option>
          {modules.map(v => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-lg border border-white/10 bg-[#11111E] px-3 text-sm text-white"
          value={action}
          onChange={e => {
            setAction(e.target.value)
            setPage(1)
          }}
        >
          <option value="all">All Actions</option>
          {actions.map(v => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Card>

      {loading ? (
        <Skeleton className="h-72" />
      ) : !filtered.length ? (
        <EmptyState icon={<FileClock />} title="No audit logs" description="System and transactional actions will appear here." />
      ) : (
        <Card className="overflow-hidden bg-[#222137]">
          <div className="divide-y divide-white/5">
            {paginated.map(row => (
              <div className="grid gap-2 p-4 sm:grid-cols-[140px_160px_1fr_130px] items-center text-sm" key={row.id}>
                <span className="font-semibold text-white truncate">{String(row.userName ?? row.userId ?? 'System')}</span>
                <div>
                  <Badge tone="purple">
                    {String(row.module ?? 'system')} · {String(row.action ?? '')}
                  </Badge>
                </div>
                <span className="text-slate-300 text-xs sm:text-sm">{String(row.description ?? '')}</span>
                <span className="text-xs text-muted-foreground text-right">{dateText(row.timestamp)}</span>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-white/10 p-4">
              <span className="text-xs text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} to {Math.min(filtered.length, page * pageSize)} of {filtered.length} entries
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-white/10 bg-[#11111E]"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground font-mono">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-white/10 bg-[#11111E]"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
