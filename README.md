# Z17 SPORTS

Production-oriented sports retail management and POS foundation built with React, Vite, TypeScript, Firebase, Tailwind CSS, Zustand, React Hook Form/Zod, Recharts and jsPDF.

## Implemented

- Firebase email/password authentication, reset password, protected routes and active user-profile enforcement
- Admin, manager and cashier UI permissions; sensitive cost values are hidden from cashiers
- Responsive collapsible navigation and mobile drawer
- Product catalogue with SKU/barcode uniqueness checks, pricing, stock and size/color variations
- Inventory status, valuation and transactional adjustments with stock movements and audit entries
- POS search/barcode entry, cart, quantity controls, bill discounts, held carts, cash/card/bank/QR/credit and split payments
- Callable Firebase Function for secure sale completion, transactional stock deduction, invoice numbering, payment/customer ledger writes and audit logging
- Immutable sale item snapshots of name, SKU, price and cost
- A5 PDF invoices, 80mm browser-print receipts
- Live Firestore dashboard without production mock statistics
- Business/invoice settings foundation
- Deny-by-default Firestore and Storage rules, composite indexes and Firebase Hosting SPA configuration
- Integer-cent money utilities with automated tests

## Local setup

1. Install Node.js 22 (Firebase Functions runtime) and Firebase CLI.
2. Run `npm install`.
3. Run `npm --prefix functions install`.
4. Copy `.env.example` to `.env` and fill in the Firebase Web App values.
5. In Firebase Authentication, enable Email/Password.
6. Create the first Authentication user, then create `users/{uid}` in Firestore:

```json
{
  "uid": "AUTH_UID",
  "name": "Administrator",
  "email": "admin@example.com",
  "phone": "",
  "role": "admin",
  "branchId": "main",
  "status": "active"
}
```

7. Deploy backend resources:

```bash
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

8. Start the client with `npm run dev`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npm run build` | Type-check and production client build |
| `npm test` | Business-logic tests |
| `npm --prefix functions run build` | Type-check Firebase Functions |
| `firebase deploy` | Deploy rules, indexes, functions and hosting |

## Firestore structure

Primary collections are `users`, `products`, `categories`, `brands`, `sales`, `purchases`, `customers`, `suppliers`, `customerTransactions`, `supplierTransactions`, `stockMovements`, `stockAdjustments`, `salesReturns`, `purchaseReturns`, `payments`, `expenses`, `cashClosings`, `auditLogs`, `settings` and protected `counters`.

Master records store IDs and current values. Financial documents store immutable item snapshots so renaming or repricing a product cannot rewrite history. Monetary amounts are integer cents. All records are branch-scoped with `branchId`.

## Security model

Firestore is deny-by-default. Completed sales and their stock/payment side effects are written only by the Admin SDK in the callable `completeSale` function. The function validates authentication, active role, branch, integer money values, current stock, customer requirements and identity, then performs one atomic transaction. Private Admin credentials are never shipped to the browser.

Product/brand/business image uploads accept JPEG, PNG or WebP up to 5 MB. Financial records cannot be deleted through client rules. Deploy and test the rules against the Firebase Emulator Suite before production use.

## POS workflow

Sign in, open POS, search or scan a SKU/barcode, add products, hold/resume carts as needed, press F8 for payment, allocate one or more payment methods, and complete the sale. The callable function rechecks stock at commit time. After success, print an 80mm receipt or download the PDF invoice.

## Backup and export guidance

For real backups use scheduled Firestore managed exports to a locked Google Cloud Storage bucket with retention/versioning. CSV/JSON downloads are useful operational exports, but are not substitutes for managed backups. Grant export/restore permissions only to dedicated administrator service accounts.

## Deployment notes

- Functions deploy to `asia-south1`; change both client and server regions together if required.
- Firebase Functions production deployment may require the Blaze plan.
- `firestore.indexes.json` contains the required list/dashboard indexes.
- Hosting rewrites all paths to `index.html` for React Router.
- Offline billing is deliberately not advertised: concurrent stock mutation requires an online callable transaction.

## Current extension points

The service/type structure is ready for dedicated purchase receiving, purchase/sales returns, party ledgers, expense/cash-closing forms and richer report exports. Those workflows must follow the same callable-function boundary used by sales rather than granting clients broad stock or balance write permissions.
