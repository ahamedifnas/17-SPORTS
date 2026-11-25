import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { escapeReceipt, generateReceiptHtml, printInvoice, type InvoiceData } from './invoice'

describe('thermal receipt generator and hardware printing', () => {
  const invoice: InvoiceData = {
    invoiceNumber: 'LOCAL-12345678-000001',
    items: [
      {
        key: 'p1:v1',
        productId: 'p1',
        variantId: 'v1',
        name: 'Cricket Bat <Pro>',
        sku: 'BAT-ENG-SH',
        variantLabel: 'Size: Short Handle',
        quantity: 2,
        unitPrice: 1500000,
        costPrice: 900000,
        discount: 100000,
        availableStock: 5,
      },
    ],
    subtotal: 3000000,
    discount: 200000,
    tax: 0,
    grandTotal: 2800000,
    paid: 3000000,
    balance: 0,
    change: 200000,
    customerName: 'A. Perera & Sons',
    cashierName: 'Kasun (Cashier)',
    pending: true,
    issuedAt: '2026-11-25T10:00:00.000Z',
  }

  it('escapes malicious HTML in product names and customer names', () => {
    expect(escapeReceipt('<img src=x onerror="alert(1)"> & \'')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;'
    )
  })

  it('generates 80mm thermal receipt HTML with store details and pending badge', () => {
    const html = generateReceiptHtml(invoice, {
      businessName: 'Z17 SPORTS HEADQUARTERS',
      address: 'No. 17 Colombo Sports Complex',
      phone: '+94 77 123 4567',
      invoiceFooter: 'Official Sporting Partner',
    })

    expect(html).toContain('Z17 SPORTS HEADQUARTERS')
    expect(html).toContain('No. 17 Colombo Sports Complex')
    expect(html).toContain('Tel: +94 77 123 4567')
    expect(html).toContain('*** PENDING CLOUD CONFIRMATION ***')
    expect(html).toContain('Cricket Bat &lt;Pro&gt;')
    expect(html).toContain('Size: Short Handle')
    expect(html).toContain('A. Perera &amp; Sons')
    expect(html).toContain('TOTAL:')
    expect(html).toContain('Official Sporting Partner')
  })

  it('includes duplicate reprint badge when reprinting', () => {
    const html = generateReceiptHtml({ ...invoice, isReprint: true, pending: false })
    expect(html).toContain('*** DUPLICATE / REPRINT RECEIPT ***')
    expect(html).not.toContain('*** PENDING CLOUD CONFIRMATION ***')
  })

  describe('print fallback mechanics', () => {
    let originalWindow: any
    let originalDocument: any

    beforeEach(() => {
      originalWindow = (globalThis as any).window
      originalDocument = (globalThis as any).document
    })

    afterEach(() => {
      ;(globalThis as any).window = originalWindow
      ;(globalThis as any).document = originalDocument
    })

    it('uses window.open when popups are allowed', () => {
      const mockWrite = vi.fn()
      const mockPrint = vi.fn()
      const mockWindow = {
        document: { open: vi.fn(), write: mockWrite, close: vi.fn() },
        focus: vi.fn(),
        print: mockPrint,
        closed: false,
      }

      ;(globalThis as any).window = {
        open: vi.fn().mockReturnValue(mockWindow),
      }
      ;(globalThis as any).document = {
        getElementById: vi.fn().mockReturnValue(null),
        createElement: vi.fn(),
        body: { appendChild: vi.fn() },
      }

      printInvoice(invoice)

      expect((globalThis as any).window.open).toHaveBeenCalled()
      expect(mockWrite).toHaveBeenCalled()
    })

    it('falls back to hidden iframe when window.open is blocked by popup blocker', () => {
      const mockAppend = vi.fn()
      const mockIframe: any = {
        id: '',
        style: {},
        contentWindow: { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() },
      }

      ;(globalThis as any).window = {
        open: vi.fn().mockReturnValue(null), // Popup blocked
      }
      ;(globalThis as any).document = {
        getElementById: vi.fn().mockReturnValue(null),
        createElement: vi.fn().mockReturnValue(mockIframe),
        body: { appendChild: mockAppend },
      }

      printInvoice(invoice)

      expect((globalThis as any).document.createElement).toHaveBeenCalledWith('iframe')
      expect(mockAppend).toHaveBeenCalledWith(mockIframe)
    })
  })
})
