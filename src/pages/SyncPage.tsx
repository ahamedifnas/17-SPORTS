import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowUpDown, CheckCircle2, Clock, Download, Printer, RefreshCw, ShieldAlert, Upload } from 'lucide-react'
import { Badge, Button, Card, Input, PageHeader } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { useOffline } from '@/offline/useOffline'
import { exportJournal, prepareDevice, syncSales } from '@/offline/sync'
import { printInvoice } from '@/lib/invoice'
import { formatMoney } from '@/lib/money'
import { localDb, type LocalSale } from '@/offline/database'

export function SyncPage() {
  const { profile } = useAuth()
  const { online, sales, pending, lastSync } = useOffline()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')

  async function action(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      toast.success('Operation completed. Journal status updated.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function restore(file: File) {
    try {
      const backup = JSON.parse(await file.text())
      if (backup.format !== 'z17-journal-v1' || !Array.isArray(backup.sales))
        throw new Error('Unsupported journal backup format.')

      await localDb.transaction('rw', [localDb.sales, localDb.items, localDb.outbox, localDb.reservations], async () => {
        for (const row of backup.sales as LocalSale[]) {
          if (
            row.uid !== profile!.uid ||
            row.branchId !== profile!.branchId ||
            row.id !== row.command?.clientSaleId ||
            !Array.isArray(row.command.lines)
          ) {
            throw new Error('Backup belongs to another account or contains corrupted sale lines.')
          }
          if (await localDb.sales.get(row.id)) continue
          await localDb.sales.add({
            ...row,
            state: 'pending',
            result: undefined,
            error: 'Restored from backup: pending server verification.',
          })
          await localDb.outbox.put({ id: row.id, uid: row.uid, attempts: 0, nextAttempt: 0 })
          await localDb.items.bulkPut(row.command.lines.map((line, i) => ({ id: `${row.id}:${i}`, saleId: row.id, line })))
          await localDb.reservations.bulkPut(
            row.command.lines.map((line, i) => ({
              id: `${row.id}:${i}`,
              saleId: row.id,
              scope: `${row.uid}:${row.branchId}`,
              key: `${line.productId}:${line.variantId || ''}`,
              quantity: line.quantity,
            }))
          )
        }
      })
      toast.success('Journal restored successfully. Pending receipts queued for sync.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Backup restoration failed.')
    }
  }

  if (!profile) return null

  const conflicts = sales.filter(s => s.state === 'conflict')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offline Sync Center"
        description="Local transaction journal, synchronization outbox, and durable hardware conflict resolution."
      />

      {/* DEVICE JOURNAL STATUS CARD */}
      <Card className="space-y-5 p-5 bg-[#222137]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#912DFA]">Device Outbox</span>
              <Badge tone={online ? 'success' : 'warning'}>
                {online ? 'Connected to Cloud' : 'Offline Mode (Local Journal Only)'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-300">
              {pending === 0 ? (
                <span className="text-purple-300 font-semibold flex items-center gap-1.5 mt-1">
                  <CheckCircle2 className="h-4 w-4" /> All receipts synchronized with Cloud Firestore
                </span>
              ) : (
                <span className="text-amber-300 font-semibold flex items-center gap-1.5 mt-1">
                  <Clock className="h-4 w-4" /> {pending} receipt{pending !== 1 ? 's' : ''} awaiting server confirmation
                </span>
              )}
            </p>
          </div>
          <div className="text-xs text-muted-foreground sm:text-right">
            <div>Last Server Acknowledgment:</div>
            <div className="font-mono text-white mt-0.5">{lastSync === 'Never' ? lastSync : new Date(lastSync).toLocaleString()}</div>
          </div>
        </div>

        {/* CONTROLS */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || !online || pending === 0}
            onClick={() => void action(() => syncSales(profile, true))}
            className="bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${busy ? 'animate-spin' : ''}`} />
            Sync Now ({pending})
          </Button>
          <Button
            disabled={busy || !online}
            variant="outline"
            onClick={() => void action(() => prepareDevice(profile))}
            className="border-white/10 bg-[#11111E] text-white"
          >
            <ArrowUpDown className="h-4 w-4 mr-1.5" />
            Refresh Catalog & Authorize 12h Shift
          </Button>
          <Button
            variant="outline"
            onClick={() => void action(() => exportJournal(profile))}
            className="border-white/10 bg-[#11111E] text-white"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Export Journal Backup
          </Button>

          <label className="flex items-center gap-1.5 cursor-pointer rounded-lg border border-white/10 bg-[#11111E] px-3 py-2 text-sm text-slate-300 hover:text-white transition-colors">
            <Upload className="h-4 w-4" />
            <span>Restore Backup</span>
            <input
              className="hidden"
              type="file"
              accept="application/json"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void action(() => restore(f))
              }}
            />
          </label>
        </div>

        <div className="rounded-lg bg-[#11111E] p-3.5 border border-white/5 text-xs text-muted-foreground space-y-1">
          <p>
            • <strong>Durable Local Storage:</strong> All offline sales are persisted atomically in IndexedDB before receipt printing.
          </p>
          <p>
            • <strong>Data Protection:</strong> Export the journal backup before clearing browser cache, resetting Chrome profiles, or servicing the shop PC.
          </p>
        </div>
      </Card>

      {/* OWNER CONFLICT RESOLUTION */}
      {profile.role === 'admin' && conflicts.length > 0 && (
        <Card className="space-y-3.5 p-5 bg-[#222137] border-amber-500/30">
          <div className="flex items-center gap-2 text-amber-300">
            <ShieldAlert className="h-5 w-5" />
            <h2 className="font-bold text-base">Owner Stock Conflict Review Required</h2>
          </div>
          <p className="text-xs text-slate-300">
            {conflicts.length} sale{conflicts.length !== 1 ? 's' : ''} encountered a conflict (e.g. server stock discrepancy or price change). Reconcile physical inventory first. Your approval confirms the original receipt as issued without altering the client receipt ID.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <Input
              placeholder="Reason for approving offline recovery (at least 10 characters)"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="bg-[#11111E] border-white/10 text-white flex-1"
            />
            <Button
              disabled={!online || busy || reason.trim().length < 10}
              onClick={() => void action(() => syncSales(profile, true, reason.trim()))}
              className="bg-amber-600 hover:bg-amber-500 text-white font-bold"
            >
              Approve & Retry Conflicted Receipts
            </Button>
          </div>
        </Card>
      )}

      {/* DEVICE TRANSACTION HISTORY */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-white px-1">Device Sales Outbox ({sales.length})</h2>
        {sales.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground bg-[#222137]">
            No receipts stored in local journal on this device yet.
          </Card>
        ) : (
          sales
            .slice()
            .reverse()
            .map(s => {
              const isSynced = s.state === 'synced'
              const isConflict = s.state === 'conflict'
              const isSyncing = s.state === 'syncing'
              return (
                <Card key={s.id} className="p-4 bg-[#222137] border-white/5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white font-mono">{s.result?.invoiceNumber || s.invoice.invoiceNumber}</span>
                        <Badge tone={isSynced ? 'success' : isConflict ? 'danger' : isSyncing ? 'purple' : 'warning'}>
                          {s.state.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Completed: {new Date(s.command.completedAt).toLocaleString()} · Total: {formatMoney(s.invoice.grandTotal)} · Cashier:{' '}
                        {s.command.cashier.name}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-white/10 bg-[#11111E] text-xs"
                        onClick={() => {
                          try {
                            printInvoice({ ...s.invoice, isReprint: true })
                          } catch (e) {
                            toast.error(String(e))
                          }
                        }}
                      >
                        <Printer className="h-3.5 w-3.5 mr-1" />
                        Reprint 80mm
                      </Button>
                    </div>
                  </div>

                  {s.error && (
                    <div className="rounded bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 text-xs text-rose-300 font-medium">
                      Sync Error: {s.error}
                    </div>
                  )}
                </Card>
              )
            })
        )}
      </div>
    </div>
  )
}
