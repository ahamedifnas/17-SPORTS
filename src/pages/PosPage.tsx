import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Barcode, CreditCard, Download, Minus, Pause, Plus, Printer, Receipt, Search, ShoppingBag, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger, EmptyState, Input, Label, Skeleton } from '@/components/ui'
import { usePosStore } from '@/stores/posStore'
import { availableCatalog, getSession, localDb } from '@/offline/database'
import { prepareDevice } from '@/offline/sync'
import { useOffline } from '@/offline/useOffline'
import { liveQuery } from 'dexie'
import type { PaymentAllocation, PaymentMethod, Product, Settings } from '@/types'
import { calculateCart, formatMoney, toMoney } from '@/lib/money'
import { salesService } from '@/services/salesService'
import { useAuth } from '@/contexts/AuthContext'
import { downloadInvoice, printInvoice, type InvoiceData } from '@/lib/invoice'

const methods: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'bank', label: 'Bank transfer' },
  { id: 'qr', label: 'QR' },
  { id: 'credit', label: 'Credit' },
]

export function PosPage() {
  const { profile } = useAuth()
  const store = usePosStore()
  const { online, pending } = useOffline()
  const [taxRate, setTaxRate] = useState(0)
  const [storeSettings, setStoreSettings] = useState<Settings | null>(null)
  const [variantProduct, setVariantProduct] = useState<Product | null>(null)
  const saleId = useRef(store.checkoutId)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([{ method: 'cash', amount: 0 }])
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [processing, setProcessing] = useState(false)
  const [invoice, setInvoice] = useState<InvoiceData | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Hardware barcode scanner rapid buffer
  const barcodeBuffer = useRef('')
  const lastKeyTime = useRef(0)
  const scanTimestamps = useRef<number[]>([])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    const subscription = liveQuery(() => availableCatalog(profile.uid, profile.branchId)).subscribe({
      next: rows => {
        if (!cancelled) setProducts(rows)
      },
      error: console.error,
    })

    void (async () => {
      try {
        if (navigator.onLine) await prepareDevice(profile)
        const session = await getSession(profile.uid)
        if (!session) throw new Error('Open Sync Center online to authorize this device.')
        setStoreSettings(session.settings)
        setTaxRate(session.settings.taxEnabled ? session.settings.taxRate : 0)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Catalog unavailable.')
      } finally {
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [profile])

  // Helper actions
  const addVariant = useCallback((p: Product, id: string) => {
    const v = p.variants.find(v => v.id === id)
    if (!v || v.stock < 1 || v.status !== 'active') return toast.error('Variant unavailable or out of stock.')
    store.addLine({
      key: `${p.id}:${v.id}`,
      productId: p.id,
      variantId: v.id,
      name: p.name,
      sku: v.sku,
      variantLabel: [v.color, v.size].filter(Boolean).join(' / '),
      unitPrice: v.sellingPrice,
      costPrice: v.buyingPrice,
      availableStock: v.stock,
    })
    setVariantProduct(null)
    toast.success(`${p.name} (${[v.color, v.size].filter(Boolean).join(' ')}) added.`)
  }, [store])

  const addProduct = useCallback((p: Product) => {
    if (p.variants?.length) {
      const available = p.variants.filter(v => v.status === 'active' && v.stock > 0)
      if (available.length === 1) {
        const v = available[0]
        store.addLine({
          key: `${p.id}:${v.id}`,
          productId: p.id,
          variantId: v.id,
          name: p.name,
          sku: v.sku,
          variantLabel: [v.color, v.size].filter(Boolean).join(' / '),
          unitPrice: v.sellingPrice,
          costPrice: v.buyingPrice,
          availableStock: v.stock,
        })
        return toast.success(`${p.name} added.`)
      }
      setVariantProduct(p)
      return
    }
    if (p.stock <= 0) return toast.error(`${p.name} is out of stock.`)
    store.addLine({
      key: p.id,
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unitPrice: p.sellingPrice,
      costPrice: p.averageCost,
      availableStock: p.stock,
    })
    toast.success(`${p.name} added.`)
  }, [store])

  const processBarcode = useCallback((code: string) => {
    const clean = code.trim().toLowerCase()
    if (!clean) return

    // 1. Search in variants first
    for (const p of products) {
      const v = p.variants.find(
        x => (x.barcode && x.barcode.toLowerCase() === clean) || (x.sku && x.sku.toLowerCase() === clean)
      )
      if (v) {
        addVariant(p, v.id)
        setSearch('')
        return
      }
    }

    // 2. Search in base products
    const exact = products.find(
      p => (p.barcode && p.barcode.toLowerCase() === clean) || (p.sku && p.sku.toLowerCase() === clean)
    )
    if (exact) {
      addProduct(exact)
      setSearch('')
      return
    }

    toast.error(`Barcode / SKU "${code}" not found in catalog.`)
  }, [products, addProduct, addVariant])

  // Global USB Barcode Scanner listener & Keyboard shortcuts (F2, F8)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shortcuts
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (e.key === 'F8') {
        e.preventDefault()
        if (store.lines.length > 0) {
          setPaymentOpen(true)
        }
        return
      }

      // Barcode Scanner detection
      const now = Date.now()
      if (e.key === 'Enter') {
        const buf = barcodeBuffer.current.trim()
        const stamps = scanTimestamps.current
        // If we received rapid keystrokes (average < 65ms between keystrokes) and length >= 3
        if (buf.length >= 3 && stamps.length >= 3) {
          const avgInterval = (stamps[stamps.length - 1] - stamps[0]) / (stamps.length - 1)
          if (avgInterval < 80) {
            e.preventDefault()
            processBarcode(buf)
            barcodeBuffer.current = ''
            scanTimestamps.current = []
            return
          }
        }
        barcodeBuffer.current = ''
        scanTimestamps.current = []
        return
      }

      // Buffer single printable characters
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (now - lastKeyTime.current > 120) {
          barcodeBuffer.current = ''
          scanTimestamps.current = []
        }
        barcodeBuffer.current += e.key
        scanTimestamps.current.push(now)
        lastKeyTime.current = now
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [processBarcode, store.lines])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(p => [p.name, p.sku, p.barcode].some(v => v?.toLowerCase().includes(q)))
  }, [products, search])

  const totals = calculateCart(store.lines, store.billDiscount, taxRate)

  // Update default allocation amount when payment opens or total changes
  useEffect(() => {
    if (paymentOpen) {
      setAllocations(prev => {
        if (prev.length === 1 && prev[0].method === 'cash') {
          return [{ method: 'cash', amount: totals.grandTotal }]
        }
        return prev
      })
    }
  }, [paymentOpen, totals.grandTotal])

  async function codeSubmit(e: React.FormEvent) {
    e.preventDefault()
    processBarcode(search)
  }

  async function complete() {
    if (!profile || processing) return
    try {
      setProcessing(true)
      const sale = await salesService.complete(
        {
          clientSaleId: saleId.current,
          lines: store.lines,
          billDiscount: store.billDiscount,
          taxRate,
          payments: allocations,
          customer: customerId ? { id: customerId, name: customerName || 'Customer' } : undefined,
          cashier: { id: profile.uid, name: profile.name },
        },
        profile
      )
      setInvoice(sale.invoice)
      store.clear()
      saleId.current = usePosStore.getState().checkoutId
      setPaymentOpen(false)
      toast.success(sale.state === 'synced' ? 'Sale confirmed by server.' : 'Receipt saved locally in journal (offline).')
    } catch (e) {
      const saved = await localDb.sales.get(saleId.current)
      if (saved) {
        setInvoice(saved.invoice)
        store.clear()
        saleId.current = usePosStore.getState().checkoutId
        setPaymentOpen(false)
      }
      toast.error(e instanceof Error ? e.message : 'Invoice could not be completed.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="-m-4 grid min-h-[calc(100vh-4rem)] lg:-m-8 xl:grid-cols-[1fr_430px] bg-[#11111E]">
      {/* LEFT SECTION: PRODUCT SEARCH, SHORTCUTS, GRID */}
      <section className="border-r border-white/5 p-4 lg:p-6 flex flex-col">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#912DFA]">Fast Billing</span>
              <span className="rounded bg-[#912DFA]/15 px-2 py-0.5 text-[10px] font-semibold text-purple-300">Design 1</span>
            </div>
            <h1 className="text-2xl font-black text-white">Point of Sale</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {online ? (
                <span className="text-emerald-400 font-medium">● Online Mode</span>
              ) : (
                <span className="text-amber-300 font-medium">● Offline Mode (Cash Only)</span>
              )}{' '}
              · {pending} pending sync
            </p>
          </div>

          <div className="flex items-center gap-2">
            {store.heldCarts.length > 0 && (
              <select
                className="h-9 rounded-lg border border-white/10 bg-[#222137] px-3 text-xs text-white"
                defaultValue=""
                onChange={e => {
                  if (e.target.value) store.resume(e.target.value)
                }}
              >
                <option value="">Held carts ({store.heldCarts.length})</option>
                {store.heldCarts.map(c => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!store.lines.length}
              onClick={() => {
                store.hold()
                toast.success('Cart held safely.')
              }}
              className="border-white/10 bg-[#222137] hover:bg-muted text-xs"
            >
              <Pause className="h-3.5 w-3.5" />
              Hold Bill
            </Button>
          </div>
        </div>

        {/* SCANNER READY SEARCH INPUT */}
        <form onSubmit={codeSubmit} className="relative mb-5">
          <Search className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-12 pl-12 pr-32 bg-[#222137] border-white/10 text-white placeholder:text-muted-foreground focus:ring-[#912DFA]"
            placeholder="Search product, SKU or scan barcode… (F2)"
          />
          <div className="absolute right-3 top-2.5 flex items-center gap-1.5 rounded-md bg-[#11111E] px-2.5 py-1 text-xs font-semibold text-purple-300 border border-purple-500/20">
            <Barcode className="h-4 w-4 text-[#912DFA]" />
            <span>Scanner Ready</span>
          </div>
        </form>

        {/* PRODUCT CATALOG GRID */}
        <div className="flex-1">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                <Skeleton key={i} className="h-36" />
              ))}
            </div>
          ) : !visible.length ? (
            <EmptyState
              icon={<ShoppingBag />}
              title="No products found"
              description="Check your search query or sync the catalog in Sync Center."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visible.map(p => {
                const isOutOfStock = p.stock === 0
                const isLowStock = p.stock > 0 && p.stock <= p.minimumStock
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="group flex flex-col justify-between rounded-xl border border-white/5 bg-[#222137] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#912DFA]/60 hover:shadow-lg hover:shadow-purple-500/10"
                  >
                    <div>
                      <div className="mb-3 flex items-start justify-between">
                        <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#11111E] text-slate-400 group-hover:text-[#912DFA]">
                          <ShoppingBag className="h-4 w-4" />
                        </div>
                        <Badge tone={isOutOfStock ? 'danger' : isLowStock ? 'warning' : 'success'}>
                          {p.stock} {p.unit}
                        </Badge>
                      </div>
                      <h3 className="line-clamp-2 text-sm font-bold text-white group-hover:text-purple-300">{p.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{p.sku}</p>
                    </div>

                    <div className="mt-4 flex items-baseline justify-between border-t border-white/5 pt-2">
                      <span className="text-base font-extrabold text-[#912DFA]">{formatMoney(p.sellingPrice)}</span>
                      {p.variants?.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">{p.variants.length} sizes</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* RIGHT SECTION: CART & BILL SUMMARY (APPROVED DESIGN 1 LAYOUT) */}
      <aside className="flex min-h-[600px] flex-col bg-[#222137] border-l border-white/5">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Order Summary</p>
              <h2 className="text-lg font-bold text-white">
                {store.lines.length} item{store.lines.length !== 1 ? 's' : ''} in cart
              </h2>
            </div>
            {store.lines.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => store.clear()}
                className="text-xs text-slate-400 hover:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* CART ITEMS LIST */}
        <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
          {store.lines.length === 0 ? (
            <div className="grid h-full min-h-64 place-items-center text-center">
              <div>
                <Receipt className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                <p className="font-semibold text-white">Cart is empty</p>
                <p className="text-xs text-muted-foreground mt-1">Scan a barcode or select an item to begin.</p>
              </div>
            </div>
          ) : (
            store.lines.map(line => (
              <Card key={line.key} className="p-3 bg-[#11111E]/80 border-white/5 shadow-none">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{line.name}</p>
                    <p className="text-xs text-purple-300/80">{line.variantLabel || line.sku}</p>
                  </div>
                  <button
                    onClick={() => store.removeLine(line.key)}
                    aria-label={`Remove ${line.name}`}
                    className="text-slate-400 hover:text-rose-400 p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center rounded-lg border border-white/10 bg-[#222137]">
                    <button
                      className="px-2.5 py-1 text-slate-300 hover:text-white"
                      onClick={() => store.updateQuantity(line.key, line.quantity - 1)}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-8 text-center text-sm font-bold text-white">{line.quantity}</span>
                    <button
                      className="px-2.5 py-1 text-slate-300 hover:text-white"
                      onClick={() => store.updateQuantity(line.key, line.quantity + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="font-bold text-white">
                    {formatMoney(line.unitPrice * line.quantity - line.discount)}
                  </span>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* CART TOTALS & PAYMENT TRIGGER */}
        <div className="border-t border-white/10 bg-[#11111E]/40 p-5">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="text-white font-medium">{formatMoney(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Bill discount</span>
              <Input
                className="h-8 w-28 text-right bg-[#11111E] border-white/10 text-white font-medium"
                type="number"
                min="0"
                step=".01"
                value={store.billDiscount / 100 || ''}
                onChange={e => store.setBillDiscount(toMoney(e.target.value))}
                placeholder="0.00"
              />
            </div>
            {taxRate > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Tax ({taxRate}%)</span>
                <span className="text-white font-medium">{formatMoney(totals.tax)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-white/10 pt-3 text-lg font-black text-white">
              <span>Grand Total</span>
              <span className="text-[#912DFA]">{formatMoney(totals.grandTotal)}</span>
            </div>
          </div>

          <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
            <DialogTrigger asChild>
              <Button
                className="mt-5 h-12 w-full bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold shadow-lg shadow-purple-500/25"
                disabled={!store.lines.length}
              >
                <CreditCard className="h-5 w-5" />
                Proceed to Payment
                <span className="ml-auto rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-mono">F8</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogTitle>Complete Checkout</DialogTitle>
              <DialogDescription>
                {online ? 'Select payment methods and allocate amounts.' : 'Offline checkout accepts Cash payments only.'}
              </DialogDescription>

              <div className="mt-5 space-y-4">
                <div className="rounded-xl bg-[#11111E] p-4 text-white border border-white/5">
                  <p className="text-xs uppercase tracking-wider text-purple-300 font-semibold">Total Payable</p>
                  <p className="mt-1 text-3xl font-black text-[#912DFA]">{formatMoney(totals.grandTotal)}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      <UserRound className="mr-1 inline h-3.5 w-3.5" />
                      Customer ID
                    </Label>
                    <Input
                      value={customerId}
                      onChange={e => setCustomerId(e.target.value)}
                      placeholder="Optional"
                      className="bg-[#11111E] border-white/10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Customer Name</Label>
                    <Input
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      placeholder="Walk-in Customer"
                      className="bg-[#11111E] border-white/10"
                    />
                  </div>
                </div>

                {allocations.map((a, i) => (
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center" key={i}>
                    <select
                      className="h-10 rounded-lg border border-white/10 bg-[#11111E] px-3 text-sm text-white"
                      value={a.method}
                      onChange={e =>
                        setAllocations(
                          allocations.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentMethod } : x))
                        )
                      }
                    >
                      {methods
                        .filter(m => online || m.id === 'cash')
                        .map(m => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                    <Input
                      type="number"
                      step=".01"
                      min="0"
                      placeholder="Amount"
                      value={a.amount / 100 || ''}
                      onChange={e =>
                        setAllocations(
                          allocations.map((x, j) => (j === i ? { ...x, amount: toMoney(e.target.value) } : x))
                        )
                      }
                      className="bg-[#11111E] border-white/10 font-bold"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={allocations.length === 1}
                      onClick={() => setAllocations(allocations.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {online && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-white/10 bg-[#11111E]"
                    onClick={() => setAllocations([...allocations, { method: 'card', amount: 0 }])}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Split Payment Method
                  </Button>
                )}

                <Button
                  className="h-12 w-full bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold shadow-lg"
                  disabled={processing || !store.lines.length}
                  onClick={complete}
                >
                  {processing ? 'Confirming Sale…' : 'Complete Sale & Save'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </aside>

      {/* SELECT VARIANT MODAL */}
      <Dialog
        open={Boolean(variantProduct)}
        onOpenChange={open => {
          if (!open) setVariantProduct(null)
        }}
      >
        <DialogContent>
          <DialogTitle>Select Size / Colour Variant</DialogTitle>
          <DialogDescription>{variantProduct?.name}</DialogDescription>
          <div className="mt-4 grid gap-2.5">
            {variantProduct?.variants.map(v => (
              <Button
                variant="outline"
                disabled={v.stock < 1 || v.status !== 'active'}
                key={v.id}
                onClick={() => addVariant(variantProduct, v.id)}
                className="justify-between h-12 border-white/10 bg-[#11111E] hover:bg-[#912DFA]/20"
              >
                <span>{[v.size, v.color, v.sku].filter(Boolean).join(' · ')}</span>
                <span className="font-bold text-purple-300">
                  {v.stock} in stock · {formatMoney(v.sellingPrice)}
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* COMPLETED RECEIPT MODAL */}
      <Dialog
        open={Boolean(invoice)}
        onOpenChange={open => {
          if (!open) setInvoice(null)
        }}
      >
        <DialogContent>
          <DialogTitle>{invoice?.pending ? 'Saved Locally (Pending Sync)' : 'Sale Confirmed'}</DialogTitle>
          <DialogDescription>
            {invoice?.invoiceNumber}{' '}
            {invoice?.pending
              ? 'is stored safely in offline journal. Server acknowledgement pending.'
              : 'is confirmed by server and stock decremented.'}
          </DialogDescription>
          {invoice && (
            <div className="mt-5 space-y-3">
              <div className="rounded-xl bg-[#912DFA]/10 border border-[#912DFA]/20 p-5 text-center">
                <p className="text-xs uppercase tracking-wider text-purple-300 font-semibold">Total Amount</p>
                <p className="text-3xl font-black text-purple-300">{formatMoney(invoice.grandTotal)}</p>
              </div>
              <Button
                className="w-full bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold h-11"
                onClick={() => {
                  try {
                    printInvoice(invoice, storeSettings || undefined)
                  } catch (e) {
                    toast.error(String(e))
                  }
                }}
              >
                <Printer className="h-4 w-4 mr-2" />
                Print 80mm Receipt
              </Button>
              <Button
                variant="outline"
                className="w-full border-white/10 bg-[#11111E]"
                onClick={() => downloadInvoice(invoice, storeSettings || undefined)}
              >
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
