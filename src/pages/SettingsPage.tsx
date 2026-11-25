import { useEffect, useState } from 'react'
import { Save, Store } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Input, Label, PageHeader, Skeleton } from '@/components/ui'
import { defaultSettings, settingsService } from '@/services/settingsService'
import { useAuth } from '@/contexts/AuthContext'
import type { Settings } from '@/types'

export function SettingsPage() {
  const { profile } = useAuth()
  const [value, setValue] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    settingsService
      .get()
      .then(setValue)
      .catch(() => setValue(defaultSettings))
  }, [])

  if (!value) return <Skeleton className="h-[500px]" />

  const field = (key: keyof Settings, label: string, type = 'text') => (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={String(value[key] ?? '')}
        onChange={e =>
          setValue({
            ...value,
            [key]: type === 'number' ? Number(e.target.value) : e.target.value,
          })
        }
        className="bg-[#11111E] border-white/10 text-white"
      />
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Store & System Settings"
        description="Configure store identity, receipt header/footer, thermal printer preferences, and pricing controls."
        action={
          <Button
            disabled={saving}
            onClick={async () => {
              try {
                setSaving(true)
                await settingsService.save(value, profile!.uid)
                toast.success('Store settings saved successfully.')
              } catch {
                toast.error('Unable to save settings.')
              } finally {
                setSaving(false)
              }
            }}
            className="bg-[#912DFA] hover:bg-[#912DFA]/90 text-white font-bold"
          >
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? 'Saving Settings…' : 'Save Changes'}
          </Button>
        }
      />

      {/* BUSINESS PROFILE */}
      <Card className="p-5 bg-[#222137]">
        <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-3">
          <Store className="h-5 w-5 text-[#912DFA]" />
          <h2 className="font-bold text-white text-base">Store Identity & Receipts</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {field('businessName', 'Business Name')}
          {field('phone', 'Phone Number')}
          {field('email', 'Email Address', 'email')}
          {field('address', 'Physical Address')}
          <div className="md:col-span-2">{field('invoiceFooter', 'Invoice / Receipt Footer Note')}</div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Default Receipt Paper Size</Label>
            <select
              className="h-10 w-full rounded-lg border border-white/10 bg-[#11111E] px-3 text-sm text-white"
              value={value.paperSize}
              onChange={e => setValue({ ...value, paperSize: e.target.value as Settings['paperSize'] })}
            >
              <option value="80mm">80mm Thermal Paper (Standard POS)</option>
              <option value="a5">A5 Slip / Sheet</option>
              <option value="a4">A4 Full Page</option>
            </select>
          </div>
        </div>
      </Card>

      {/* TAXATION & CONTROLS */}
      <Card className="p-5 bg-[#222137]">
        <h2 className="mb-4 font-bold text-white text-base border-b border-white/5 pb-3">Taxation & Price Safeguards</h2>
        <div className="grid gap-5 md:grid-cols-3">
          {field('invoicePrefix', 'Invoice Number Prefix')}
          {field('taxRate', 'Tax Rate (%)', 'number')}
          <div className="space-y-3 pt-4 md:col-span-3">
            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#11111E] p-4 text-sm font-semibold text-white cursor-pointer hover:bg-card/[0.02]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-[#912DFA]"
                checked={value.taxEnabled}
                onChange={e => setValue({ ...value, taxEnabled: e.target.checked })}
              />
              <span>Enable sales tax calculation on invoices</span>
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#11111E] p-4 text-sm font-semibold text-white cursor-pointer hover:bg-card/[0.02]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-[#912DFA]"
                checked={value.requireManagerBelowMinimum}
                onChange={e => setValue({ ...value, requireManagerBelowMinimum: e.target.checked })}
              />
              <span>Require manager approval if cashier sells below minimum selling price</span>
            </label>
          </div>
        </div>
      </Card>
    </div>
  )
}
