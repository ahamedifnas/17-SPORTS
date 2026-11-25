import jsPDF from 'jspdf'
import type { CartLine, Settings } from '@/types'
import { formatMoney } from '@/lib/money'

export interface InvoiceData {
  invoiceNumber: string
  items: CartLine[]
  subtotal: number
  discount: number
  tax: number
  grandTotal: number
  paid: number
  balance: number
  change: number
  customerName: string
  cashierName: string
  pending?: boolean
  issuedAt?: string
  isReprint?: boolean
  businessName?: string
  address?: string
  phone?: string
  footer?: string
}

export function escapeReceipt(value: string) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export function generateReceiptHtml(original: InvoiceData, settings?: Partial<Settings>) {
  const storeName = escapeReceipt(settings?.businessName || original.businessName || 'Z17 SPORTS')
  const storeAddress = escapeReceipt(settings?.address || original.address || 'Sports & Fitness Equipment')
  const storePhone = escapeReceipt(settings?.phone || original.phone || '')
  const footerNote = escapeReceipt(settings?.invoiceFooter || original.footer || 'Thank you for shopping with us.')

  const data = {
    ...original,
    invoiceNumber: escapeReceipt(original.invoiceNumber),
    customerName: escapeReceipt(original.customerName),
    cashierName: escapeReceipt(original.cashierName),
    items: original.items.map(i => ({
      ...i,
      name: escapeReceipt(i.name),
      variantLabel: i.variantLabel ? escapeReceipt(i.variantLabel) : undefined,
    })),
  }

  const dateStr = new Date(data.issuedAt || Date.now()).toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${data.invoiceNumber}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.35;
      color: #000;
      width: 72mm;
      max-width: 72mm;
      margin: 0 auto;
      padding: 4mm 2mm 10mm 2mm;
      background: #fff;
    }
    .header {
      text-align: center;
      margin-bottom: 6px;
    }
    .store-name {
      font-size: 16px;
      font-weight: 900;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .store-meta {
      font-size: 10px;
      color: #333;
    }
    .badge {
      display: block;
      margin: 4px auto;
      padding: 2px 4px;
      font-size: 10px;
      font-weight: bold;
      text-align: center;
      border: 1px dashed #000;
    }
    .divider {
      border: none;
      border-top: 1px dashed #000;
      margin: 5px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin: 2px 0;
    }
    .items-table {
      width: 100%;
      margin: 4px 0;
    }
    .item-name {
      font-weight: 600;
      word-break: break-word;
    }
    .item-sub {
      font-size: 10px;
      color: #444;
      display: flex;
      justify-content: space-between;
    }
    .totals {
      margin-top: 4px;
    }
    .grand-total {
      font-size: 14px;
      font-weight: 900;
      margin: 4px 0;
    }
    .footer {
      text-align: center;
      margin-top: 8px;
      font-size: 10px;
      color: #333;
    }
    @media print {
      body {
        width: 72mm;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="store-name">${storeName}</div>
    <div class="store-meta">${storeAddress}</div>
    ${storePhone ? `<div class="store-meta">Tel: ${storePhone}</div>` : ''}
    ${data.pending ? '<div class="badge">*** PENDING CLOUD CONFIRMATION ***</div>' : ''}
    ${data.isReprint ? '<div class="badge">*** DUPLICATE / REPRINT RECEIPT ***</div>' : ''}
  </div>

  <hr class="divider" />

  <div class="row">
    <span>Invoice:</span>
    <strong>${data.invoiceNumber}</strong>
  </div>
  <div class="row">
    <span>Date:</span>
    <span>${dateStr}</span>
  </div>
  <div class="row">
    <span>Customer:</span>
    <span>${data.customerName}</span>
  </div>
  <div class="row">
    <span>Cashier:</span>
    <span>${data.cashierName}</span>
  </div>

  <hr class="divider" />

  <div class="items-table">
    ${data.items
      .map(
        i => `
      <div style="margin-bottom: 4px;">
        <div class="item-name">${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''}</div>
        <div class="item-sub">
          <span>${i.quantity} × ${formatMoney(i.unitPrice)}${i.discount > 0 ? ` [-${formatMoney(i.discount)}]` : ''}</span>
          <strong>${formatMoney(i.quantity * i.unitPrice - i.discount)}</strong>
        </div>
      </div>`
      )
      .join('')}
  </div>

  <hr class="divider" />

  <div class="totals">
    <div class="row">
      <span>Subtotal:</span>
      <span>${formatMoney(data.subtotal)}</span>
    </div>
    ${data.discount > 0 ? `<div class="row"><span>Bill Discount:</span><span>-${formatMoney(data.discount)}</span></div>` : ''}
    ${data.tax > 0 ? `<div class="row"><span>Tax:</span><span>${formatMoney(data.tax)}</span></div>` : ''}
    <hr class="divider" />
    <div class="row grand-total">
      <span>TOTAL:</span>
      <span>${formatMoney(data.grandTotal)}</span>
    </div>
    <div class="row">
      <span>Paid / Tendered:</span>
      <span>${formatMoney(data.paid)}</span>
    </div>
    ${data.balance > 0 ? `<div class="row"><span>Credit Balance:</span><span>${formatMoney(data.balance)}</span></div>` : ''}
    ${data.change > 0 ? `<div class="row"><span>Change Given:</span><strong>${formatMoney(data.change)}</strong></div>` : ''}
  </div>

  <hr class="divider" />

  <div class="footer">
    <p>${footerNote}</p>
    <p style="margin-top: 3px; font-size: 8px; color: #666;">Z17 SPORTS POS Engine</p>
  </div>
</body>
</html>`
}

export function printInvoice(original: InvoiceData, settings?: Partial<Settings>) {
  const html = generateReceiptHtml(original, settings)

  // Try popup window first
  const w = window.open('', '_blank', 'width=420,height=700')
  if (w && !w.closed) {
    try {
      w.document.open()
      w.document.write(html)
      w.document.close()
      w.focus()
      setTimeout(() => {
        try {
          w.print()
        } catch (e) {
          console.error('Print failed:', e)
        }
      }, 250)
      return
    } catch {
      // Fall through to iframe fallback
    }
  }

  // Fallback: hidden iframe print (immune to popup blockers)
  const existingFrame = document.getElementById('thermal-print-frame')
  if (existingFrame) existingFrame.remove()

  const iframe = document.createElement('iframe')
  iframe.id = 'thermal-print-frame'
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = 'none'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document || iframe.contentDocument
  if (doc) {
    doc.open()
    doc.write(html)
    doc.close()
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch (err) {
        console.error('Iframe print failed:', err)
      } finally {
        setTimeout(() => iframe.remove(), 60000)
      }
    }, 300)
  }
}

export function downloadInvoice(data: InvoiceData, settings?: Partial<Settings>) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' })
  let y = 16
  const storeName = settings?.businessName || data.businessName || 'Z17 SPORTS'
  const storeAddress = settings?.address || data.address || 'Sports & Fitness Equipment'

  doc.setFontSize(18)
  doc.text(storeName, 74, y, { align: 'center' })
  y += 6
  doc.setFontSize(9)
  doc.text(data.pending ? '*** PENDING CLOUD CONFIRMATION ***' : storeAddress, 74, y, { align: 'center' })
  y += 10
  doc.text(`Invoice: ${data.invoiceNumber}`, 10, y)
  doc.text(new Date(data.issuedAt || Date.now()).toLocaleString('en-LK'), 138, y, { align: 'right' })
  y += 6
  doc.text(`Customer: ${data.customerName}`, 10, y)
  doc.text(`Cashier: ${data.cashierName}`, 138, y, { align: 'right' })
  y += 8
  doc.line(10, y, 138, y)
  y += 6
  data.items.forEach(item => {
    doc.text(`${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ''}`, 10, y)
    doc.text(`${item.quantity} × ${formatMoney(item.unitPrice)}`, 85, y, { align: 'right' })
    doc.text(formatMoney(item.quantity * item.unitPrice - item.discount), 138, y, { align: 'right' })
    y += 6
    if (y > 190) {
      doc.addPage()
      y = 15
    }
  })
  doc.line(10, y, 138, y)
  y += 7
  ;[
    ['Subtotal', data.subtotal],
    ['Discount', -data.discount],
    ['Tax', data.tax],
    ['Grand total', data.grandTotal],
    ['Paid', data.paid],
    ['Balance', data.balance],
    ['Change', data.change],
  ].forEach(([label, amount]) => {
    doc.text(String(label), 90, y)
    doc.text(formatMoney(Number(amount)), 138, y, { align: 'right' })
    y += 6
  })
  y += 6
  doc.text(settings?.invoiceFooter || data.footer || 'Thank you for shopping with us.', 74, y, { align: 'center' })
  doc.save(`${data.invoiceNumber}.pdf`)
}
