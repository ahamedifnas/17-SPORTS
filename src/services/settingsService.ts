import type { Settings } from '@/types'
import { apiClient } from './apiClient'

export const defaultSettings: Settings = {
  businessName: 'Z17 SPORTS',
  address: '',
  phone: '',
  email: '',
  invoicePrefix: 'INV',
  currency: 'LKR',
  taxEnabled: false,
  taxRate: 0,
  invoiceFooter: 'Thank you for shopping with us.',
  paperSize: '80mm',
  allowNegativeStock: false,
  requireManagerBelowMinimum: true,
}

interface D1SettingsRow {
  business_name?: string
  address?: string
  phone?: string
  email?: string
  invoice_prefix?: string
  currency?: string
  tax_enabled?: number | boolean
  tax_rate?: number
  invoice_footer?: string
  paper_size?: string
  require_manager_below_minimum?: number | boolean
}

export const settingsService = {
  async get(): Promise<Settings> {
    try {
      const row = await apiClient.get<D1SettingsRow>('/settings')
      if (row) {
        const paperSize = row.paper_size === 'a4' || row.paper_size === 'a5' ? row.paper_size : '80mm'
        return {
          businessName: row.business_name || defaultSettings.businessName,
          address: row.address || '',
          phone: row.phone || '',
          email: row.email || '',
          invoicePrefix: row.invoice_prefix || 'INV',
          currency: 'LKR',
          taxEnabled: Boolean(row.tax_enabled),
          taxRate: row.tax_rate || 0,
          invoiceFooter: row.invoice_footer || defaultSettings.invoiceFooter,
          paperSize,
          allowNegativeStock: false,
          requireManagerBelowMinimum: Boolean(row.require_manager_below_minimum),
        }
      }
    } catch {
      // Ignored - fallback to defaultSettings
    }
    return defaultSettings
  },

  async save(settings: Settings, _userId: string) {
    await apiClient.put('/settings', {
      business_name: settings.businessName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      invoice_prefix: settings.invoicePrefix,
      currency: 'LKR',
      tax_enabled: settings.taxEnabled ? 1 : 0,
      tax_rate: settings.taxRate,
      invoice_footer: settings.invoiceFooter,
      paper_size: settings.paperSize,
      require_manager_below_minimum: settings.requireManagerBelowMinimum ? 1 : 0,
    })
  },
}
