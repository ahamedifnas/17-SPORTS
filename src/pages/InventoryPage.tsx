import { posReadService } from '@/services/posReadService'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, Input, Label, PageHeader, Skeleton } from '@/components/ui'
import type { Product } from '@/types'
import { productService } from '@/services/productService'
import { inventoryService } from '@/services/inventoryService'
import { useAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/permissions'
import { formatMoney } from '@/lib/money'

export function InventoryPage() {
  const { profile } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState(0)
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [variantId, setVariantId] = useState('')
  const operationId = useRef(crypto.randomUUID())
  const [type, setType] = useState<'adjustment' | 'damage' | 'lost' | 'internal-use' | 'opening-stock'>('adjustment')

  const load = useCallback(async () => {
    if (!profile) return
    try {
      setError(false)
      setProducts(profile.role === 'cashier' ? await posReadService.products() : (await productService.list(profile.branchId, 200)).items)
    } catch (cause) {
      console.error('Unable to load inventory', cause)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () => products.filter(p => [p.name, p.sku, p.barcode].some(v => v?.toLowerCase().includes(search.toLowerCase()))),
    [products, search]
  )

  const totals = useMemo(
    () => ({
      units: products.reduce((s, p) => s + p.stock, 0),
      value: products.reduce((s, p) => s + p.stock * p.averageCost, 0),
      low: products.filter(p => p.stock > 0 && p.stock <= p.minimumStock).length,
      out: products.filter(p => p.stock === 0).length,
    }),
    [products]
  )

  async function adjust() {
    if (!selected || !profile) return
    try {
      setSaving(true)
      await inventoryService.adjust({
        operationId: operationId.current,
        productId: selected.id,
        variantId: variantId || undefined,
        quantity,
        type,
        reason,
        userId: profile.uid,
        branchId: profile.branchId,
      })
      operationId.current = crypto.randomUUID()
      toast.success('Stock adjusted and movement recorded.')
      setSelected(null)
      setQuantity(0)
      setReason('')
      await load()
    } catch (cause) {
      console.error('Unable to adjust stock', cause)
      toast.error(cause instanceof Error ? cause.message : 'Unable to adjust stock.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" description="Real-time branch stock derived from products and auditable movements." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Units on hand', totals.units],
          ...(hasPermission(profile?.role, 'cost.read') ? [['Stock value', formatMoney(totals.value)]] : []),
          ['Low stock', totals.low],
          ['Out of stock', totals.out],
        ].map(([label, value]) => (
          <Card className="p-5" key={label}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product, SKU or barcode…" />
        </div>
      </Card>
      {loading ? (
        <Skeleton className="h-80" />
      ) : error ? (
        <EmptyState icon={<Boxes />} title="Unable to load inventory" description="Please check permissions and network." action={<Button variant="outline" onClick={() => void load()}>Retry</Button>} />
      ) : !filtered.length ? (
        <EmptyState icon={<Boxes />} title="No inventory" description="Add a product or change the search filter." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th>SKU</th>
                  <th>Stock</th>
                  <th>Reorder level</th>
                  {hasPermission(profile?.role, 'cost.read') && <th>Cost / value</th>}
                  <th>Selling</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr className="border-t" key={p.id}>
                    <td className="px-5 py-4 font-semibold">{p.name}</td>
                    <td>{p.sku}</td>
                    <td className="font-bold">{p.stock}</td>
                    <td>{p.minimumStock}</td>
                    {hasPermission(profile?.role, 'cost.read') && (
                      <td>
                        {formatMoney(p.averageCost)} / {formatMoney(p.stock * p.averageCost)}
                      </td>
                    )}
                    <td>{formatMoney(p.sellingPrice)}</td>
                    <td>
                      <Badge tone={p.stock === 0 ? 'danger' : p.stock <= p.minimumStock ? 'warning' : 'success'}>
                        {p.stock === 0 ? 'OUT OF STOCK' : p.stock <= p.minimumStock ? 'LOW STOCK' : 'IN STOCK'}
                      </Badge>
                    </td>
                    <td>
                      {hasPermission(profile?.role, 'inventory.adjust') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelected(p)
                            setVariantId('')
                            operationId.current = crypto.randomUUID()
                          }}
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                          Adjust
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent>
          <DialogTitle>Adjust {selected?.name}</DialogTitle>
          <DialogDescription>Current stock: {selected?.stock}. Every change creates a stock movement and audit entry.</DialogDescription>
          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              {Boolean(selected?.variants.length) && (
                <>
                  <Label>Variant</Label>
                  <select className="h-11 w-full rounded-md border bg-card px-3" value={variantId} onChange={e => setVariantId(e.target.value)}>
                    <option value="">Select variant</option>
                    {selected?.variants.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.sku} · {v.size} {v.color} · {v.stock}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <Label>Type</Label>
              <select className="h-10 w-full rounded-md border bg-card px-3" value={type} onChange={e => setType(e.target.value as typeof type)}>
                <option value="adjustment">Correction</option>
                <option value="damage">Damage</option>
                <option value="lost">Lost</option>
                <option value="internal-use">Internal use</option>
                <option value="opening-stock">Opening stock</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Quantity change</Label>
              <Input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)} />
            </div>
            <Button className="w-full" disabled={saving || !quantity || reason.trim().length < 3} onClick={adjust}>
              {saving ? 'Saving…' : 'Record adjustment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
