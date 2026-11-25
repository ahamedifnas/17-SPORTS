# Z17 SPORTS — Commercial Production Operations & Deployment Guide

## 1. System Overview

**Z17 SPORTS** is a commercial-grade, single-branch sports retail management and Point of Sale (POS) application built for high-reliability cashier billing on a physical shop PC and remote real-time business administration by the owner on mobile and desktop.

### Core Architecture & Technical Stack
- **Frontend Framework**: React 19, TypeScript 5.8, Vite 7
- **Styling & Design System**: Tailwind CSS (Approved Design 1: Modern Dark + Purple)
- **Local Persistence**: IndexedDB managed via Dexie 4.4
- **State Management**: Zustand 5
- **Cloud Backend**: Firebase Authentication, Cloud Firestore, Cloud Functions v2 (Node.js 22, region `asia-south1`), Firebase Storage, Firebase Hosting
- **Reporting & Printing**: Recharts 3.1, jsPDF 3.0, Thermal 80mm Web Printing Engine
- **Test Harness**: Vitest 3.2 with isolated transactional state mocks and Firebase rules testing

---

## 2. Design 1: Modern Dark + Purple Aesthetic

The user interface strictly adheres to the approved Design 1 design system:
- **Base Background**: `#11111E` (Dark Navy / Charcoal)
- **Cards & Surfaces**: `#222137` (Rich Dark Slate with subtle border highlights)
- **Primary Brand Accent**: `#912DFA` (Electric Purple)
- **Status Accents**: Emerald green (`#10b981`), Amber (`#f59e0b`), Rose (`#f43f5e`)
- **POS Layout**: Preserves the approved 2-column layout:
  - **Left Column**: Fast search, USB scanner readiness indicator, product catalog cards with stock badges, and hold/resume bill controls.
  - **Right Column**: Live order cart, line discounts, quantity incrementers, bill discounts, subtotal, tax calculation, and F8 payment modal.

---

## 3. Hardware Integration Guide

### A. USB Barcode Scanner (Keyboard Wedge)
- **Protocol**: Standard USB HID keyboard emulation.
- **Handling Mechanism**:
  1. The application registers both a targeted search listener and a global rapid-keystroke buffer.
  2. USB scanners emit rapid keystroke sequences (inter-key delay < 60ms) terminated by an `Enter` key.
  3. When an `Enter` is detected from rapid keystrokes, the scanner engine automatically captures the buffer, prevents unwanted form submissions, and invokes `processBarcode()`.
  4. Barcodes are matched against product variants first (`variant.barcode` and `variant.sku`), then against base products.
  5. Matching active items are instantly added to the cart (or quantity incremented if already present) with positive audio/toast feedback.
  6. The `F2` shortcut instantly focuses and selects the search input for manual keyboard lookups.

### B. Thermal Receipt Printing (80mm)
- **Paper Specification**: 80mm roll thermal paper (printable width: 72mm).
- **Print Engine**:
  - Located in [src/lib/invoice.ts](file:///c:/Users/UL/Desktop/Projects/Z17%20sports/src/lib/invoice.ts).
  - Generates optimized, high-contrast monochrome HTML styled with `@page { size: 80mm auto; margin: 0; }`.
  - **Popup-Blocker Resilience**: Attempts opening a print popup window; if blocked by Windows/Chrome browser settings, it seamlessly falls back to a hidden dynamic `iframe` print target without failing or interrupting the checkout flow.
  - **Metadata Included**:
    - Store Identity: Name, Address, Contact Telephone (configured in Settings).
    - Invoice metadata: Invoice number, date, cashier name, customer name.
    - Itemized breakdown: Name, variant details, quantity, unit price, discounts, line totals.
    - Accounting totals: Subtotal, bill discount, tax, grand total, amount tendered, change given, outstanding credit balance.
    - Transaction state badges: `*** PENDING CLOUD CONFIRMATION ***` for offline receipts, or `*** DUPLICATE / REPRINT RECEIPT ***` for reprinted invoices.
    - Custom store footer note.

---

## 4. Offline POS Engine & Synchronization

### A. Service Worker & PWA Caching
- Configured via `vite-plugin-pwa` with Workbox caching:
  - Caches HTML, JS bundles, CSS stylesheets, fonts, and SVG icons.
  - Allows full application launch and execution on the shop PC during internet outages.

### B. Durable IndexedDB Storage (Dexie)
The shop PC maintains an isolated, transactional client database (`z17-pos-v1`):
1. **Catalog Table**: Scoped snapshot of active branch products and variants with cost prices stripped.
2. **Sales Table**: Local journal of completed sales (`LocalSale`) with states: `pending`, `syncing`, `synced`, `conflict`.
3. **Items Table**: Snapshot of individual sale lines.
4. **Reservations Table**: Real-time local stock reservations. When a sale is completed offline, stock is deducted from the local available catalog immediately to prevent overselling across successive offline checkouts.
5. **Outbox Table**: FIFO synchronization queue tracking retry attempts and backoff timestamps.
6. **Metadata Table**: Persists unique hardware `deviceId`, offline session tokens, receipt numbering sequences, and last sync timestamps.

### C. Offline Checkouts & Rules
- **Authorized Shift Session**: Requires an active offline session token issued while online (`beginOfflineSession`), valid for 12 hours.
- **Payment Constraint**: Offline sales are strictly restricted to **Cash** payments. Credit, cards, and QR payments cannot be verified offline and are disallowed.
- **Receipt Numbering**: Assigned a unique local sequence: `LOCAL-<deviceId>-<seq>`.
- **Never False Confirmation**: An offline sale is marked `pending` and its receipt is clearly labeled pending cloud confirmation. It is never marked `synced` until server acknowledgment.

### D. Synchronization & Conflict Resolution
- When internet connectivity is restored:
  1. `useOffline` hook detects `online` event or runs the 15-second background sync interval.
  2. Web Locks API (`navigator.locks.request('z17-sync')`) prevents duplicate syncs across multiple open tabs.
  3. Sends `completeSale` callable to Cloud Functions.
  4. Server validates user credentials, offline session expiration, clientSaleId idempotency, and verifies physical stock in a Firestore transaction.
  5. Upon success, server returns authoritative `invoiceNumber` (`INV-YYYY-XXXXXX`). Client acknowledges, sets state to `synced`, updates invoice, and clears outbox entry.
- **Conflict Handling**:
  - If server stock was depleted remotely or product prices were altered while the PC was offline, the transaction transitions to `conflict` state with the server error message.
  - The sale is halted from automatic retries.
  - The Owner inspects the conflict in the **Offline Sync Center** (`/sync`), reconciles physical inventory if necessary, inputs an approval justification (min 10 characters), and clicks **Approve & Retry Conflicted Receipts**.

### E. Backup & Recovery
- From the Sync Center, cashiers or managers can click **Export Journal Backup** to download `z17-journal-<timestamp>.json`.
- In case of PC disk replacement or browser profile reset, the **Restore Backup** tool safely re-queues all unconfirmed receipts into the outbox and restores stock reservations.

---

## 5. Security Architecture & RBAC

### A. Role Grants
- **Admin (Owner)**: Unrestricted access to all modules, financial metrics, cost prices, staff management, audit logs, and settings.
- **Manager**: Operations, product management, inventory adjustments, purchase receiving, customer/supplier accounts, and sales returns. No access to user credentials or system settings.
- **Cashier**: Fast POS checkout, customer management, sale history view, sales returns. **Strictly denied access to cost prices, profit reports, expenses, supplier payables, and user management.**
- **Inventory**: Product catalog, stock adjustments, purchase orders, purchase returns, and inventory counts. No access to financial payments or cash closing.
- **Accountant**: Dashboard, financial expenses, customer/supplier payments, cash shift closing, audit logs, and profit reports.

### B. Firestore Rules Enforcement
- **Direct Sales / Movements Write Denial**: Clients cannot write directly to `/sales`, `/stockMovements`, `/stockAdjustments`, `/payments`, or `/cashClosings`. All financial and inventory mutations must execute through server-side validated Cloud Functions.
- **Cost Protection**: The `/products/{id}` collection rule forbids cashiers from reading documents directly. Cashiers receive inventory through `getPosCatalog`, which explicitly strips `buyingPrice`, `averageCost`, and supplier information.

---

## 6. Financial Accounting & Reconciliations

### A. Net Profit Formula
Reports compute net profit with exact reconciliation of taxes and returns:
$$\text{Net Profit} = (\text{Net Sales} - \text{Net Sales Returns}) - (\text{Gross COGS} - \text{Restored Return COGS}) - \text{Operating Expenses}$$
- **Revenue**: Net of VAT/taxes.
- **COGS**: Computed using the authoritative product cost snapshotted at the exact moment of sale.
- **Restored COGS**: Sales returns restore the original cost of returned units back to inventory, ensuring gross profit is not penalized for returned goods.
- **Rounding Equity**: Partial refunds allocate rounding remainders cumulatively via `returnedShare` to guarantee cent-exact totals over successive partial returns.

### B. Purchases & Supplier Balances
- **Draft Purchases**: Create inventory purchase orders without modifying current product stock or supplier payable balances.
- **Received Purchases**: Increment product stock, record `stockMovements` (`type: 'purchase'`), recompute weighted average cost, and increment supplier `currentBalance`.
- **Purchase Returns**: Decrement product stock, record `stockMovements` (`type: 'purchase-return'`), and decrement supplier `currentBalance`.

### C. Daily Cash Shift Closing
- Cloud Function `closeCashShift` calculates:
$$\text{Expected Cash} = \text{Opening Cash} + \text{Cash Sales} + \text{Customer Cash Payments} - \text{Cash Expenses} - \text{Cash Refunds} - \text{Supplier Cash Payments}$$
- Compared against cashier's counted `actualCash`. Any discrepancy generates an audited variance and requires an explanatory note. Only one closed shift is permitted per branch per date.

---

## 7. Step-by-Step Deployment & Verification

### Step 1: Firebase Project Setup
1. Create a Firebase project (Blaze billing plan required for Cloud Functions v2).
2. Enable Firebase Authentication (Email/Password provider).
3. Create a Cloud Firestore database in Native mode (Recommended region: `asia-south1`).
4. Enable Firebase Storage and Firebase Hosting.

### Step 2: Environment Variables
Create `.env` in the root directory:
```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### Step 3: Deploy Firestore Security Rules & Indexes
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### Step 4: Build & Deploy Cloud Functions
```bash
cd functions
npm run build
firebase deploy --only functions
cd ..
```

### Step 5: Build & Deploy Web Application
```bash
npm run build
firebase deploy --only hosting
```

### Step 6: Initial Admin Provisioning
Create the initial store owner user in Firebase Console -> Authentication, then create the corresponding Firestore document in `/users/{uid}`:
```json
{
  "uid": "<USER_UID>",
  "name": "Store Owner",
  "email": "owner@z17sports.lk",
  "role": "admin",
  "status": "active",
  "branchId": "main"
}
```

---

## 8. User Acceptance Testing (UAT) Verification Checklist

| Test Case | Procedure | Expected Result | Verified |
| :--- | :--- | :--- | :--- |
| **Offline Checkout** | Disconnect PC network, add items in POS, pay with cash | Sale completes, local receipt prints, marked pending | [PASS] |
| **Reconnect Sync** | Reconnect network on shop PC | Outbox syncs automatically, cloud invoice issued | [PASS] |
| **Duplicate Retry** | Re-submit identical clientSaleId | Server responds idempotently without double-deducting stock | [PASS] |
| **Browser Refresh** | Refresh page with pending offline sales | Dexie retains journal and reservations intact | [PASS] |
| **PC Restart** | Close browser, reboot PC, open app | Pending sales, held carts, and sessions persist | [PASS] |
| **Stock Conflict** | Lower server stock remotely below offline sale qty | Sale transitions to conflict; owner approval unlocks | [PASS] |
| **Non-Cash Offline** | Attempt Card/QR payment while offline | System rejects; prompts cash payment only | [PASS] |
| **Barcode Scan** | Scan 1D barcode with USB scanner while unfocused | Buffer catches keystrokes and adds item to cart | [PASS] |
| **80mm Print** | Click Print Receipt on completed sale | Renders 72mm printable slip; fallback iframe works if popups blocked | [PASS] |
| **Cashier Cost Hide** | Log in as cashier role, inspect products / sales | Buying prices, cost prices, and margins omitted | [PASS] |
| **Supplier Balance** | Receive draft purchase; complete purchase return | Supplier currentBalance updates atomically | [PASS] |
| **Reports Reconciled**| Compare Sales, COGS, Returns, Expenses | Net Profit exact; no 500-record truncation | [PASS] |
