# Z17 SPORTS — Zero-Cost Cloudflare + D1 Production Deployment Guide

## 1. Executive Summary & Zero-Cost Architecture

Z17 SPORTS is a single-branch commercial sports retail management and Point of Sale (POS) system engineered to run **completely free of recurring subscriptions and credit card billing accounts** by leveraging modern edge serverless infrastructure.

### Free-Tier Technology Stack
* **Frontend Web App**: React 19, TypeScript, Vite, Tailwind CSS, Zustand, Dexie (IndexedDB), Recharts, jsPDF.
* **Static Hosting**: **Cloudflare Pages** (Free Tier — Unlimited bandwidth & requests).
* **Authoritative REST API**: **Cloudflare Workers** (Free Plan — 100,000 requests/day, 10ms CPU/req).
* **Authoritative Database**: **Cloudflare D1** (Serverless SQLite — 5,000,000 row reads/day, 100,000 row writes/day, 10 GB storage).
* **Identity & Authentication**: **Firebase Authentication Spark Plan** (Free tier — Up to 50,000 Monthly Active Users; 0 billing account required).
* **Edge Token Verification**: Cloudflare Worker native Web Crypto RS256 token verification against Google's public JWKS certificates (`crypto.subtle`).
* **Shop PC Offline POS**: Progressive Web App (PWA) with Service Worker asset caching, Dexie IndexedDB for local catalog snapshot, local stock reservations, durable sync outbox, and thermal receipt printing.

```
+---------------------------------------------------------------------------------------+
|                                    SHOP PC POS                                        |
|  - USB Barcode Scanner (< 60ms ambient keystroke buffer)                              |
|  - 80mm Windows Thermal Printer (raw HTML/CSS iframe printing fallback)               |
|  - Offline Dexie IndexedDB (Catalog snapshot, local stock reservations, outbox)        |
+---------------------------------------------------------------------------------------+
            │ (Online Shift Prep / Sync)               ▲ (Remote Owner Mobile Management)
            ▼                                          │
+───────────────────────────────────────────────────────────────────────────────────────+
|                               CLOUDFLARE WORKERS REST API                             |
|  - Edge RS256 JWT Verification against Google JWKS (Zero Node crypto dependency)      |
|  - Authoritative Edge RBAC (users table in D1)                                        |
|  - Idempotent Sync Guard (sync_requests table by clientSaleId + deviceId)             |
|  - Cashier Privacy Shield (buying_price and average_cost stripped for cashiers)       |
+───────────────────────────────────────────────────────────────────────────────────────+
            │
            ▼
+───────────────────────────────────────────────────────────────────────────────────────+
|                              CLOUDFLARE D1 (SQLITE)                                   |
|  - Integer cents (LKR) financial math                                                 |
|  - Atomic multi-statement transactions (.batch)                                       |
|  - Sequential counters (INV-YYYY-XXXXXX, PO-YYYY-XXXXXX, EXP-YYYY-XXXXXX)             |
|  - Immutable stock movements and audit ledgers                                        |
+───────────────────────────────────────────────────────────────────────────────────────+
```

---

## 2. Free-Tier Quota & Daily Limit Safety Analysis

The entire platform operates well below Cloudflare's free limits for a busy retail store generating ~300 bills per day:

| Cloudflare Free Limit | Daily Store Budget (~300 bills/day) | Utilization (% of Free Allowance) | Safety Margin |
| :--- | :--- | :--- | :--- |
| **Worker Requests** (100,000 / day) | ~1,500 – 2,500 requests / day | **~2.0%** | **40x safety margin** |
| **D1 Row Writes** (100,000 / day) | ~1,800 writes / day | **~1.8%** | **55x safety margin** |
| **D1 Row Reads** (5,000,000 / day) | ~15,000 reads / day | **~0.3%** | **330x safety margin** |
| **D1 Storage** (10,000 MB / 10 GB) | ~45 MB for 5 years of transactions | **~0.4%** | **220x safety margin** |
| **Firebase Auth** (50,000 MAU) | 1 Owner + 5 Cashiers = 6 users | **0.012%** | **8,000x safety margin** |

---

## 3. Step-by-Step Deployment Guide

### Prerequisites
1. Free Cloudflare account ([dash.cloudflare.com](https://dash.cloudflare.com)).
2. Free Firebase project `z17-sports` with Email/Password authentication enabled.
3. Node.js 18+ installed on your deployment workstation.

---

### Step 1: Provision Cloudflare D1 Database

In your terminal or PowerShell:
```powershell
# 1. Log in to your Cloudflare account
npx wrangler login

# 2. Create the production D1 database
npx wrangler d1 create z17-sports-db
```
The command outputs your `database_name` and `database_id`. Open `worker/wrangler.toml` and update `database_id`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "z17-sports-db"
database_id = "YOUR_ACTUAL_DATABASE_ID_FROM_OUTPUT"
migrations_dir = "migrations"
```

---

### Step 2: Apply Database Schema Migration

Execute the initial D1 migration to create all tables and indexes:
```powershell
cd worker
npx wrangler d1 migrations apply z17-sports-db --remote
```
To verify the migration locally or in development:
```powershell
npx wrangler d1 execute z17-sports-db --local --file=./migrations/0001_initial_schema.sql
```

---

### Step 3: Deploy the Worker REST API

From the `worker` directory:
```powershell
npx wrangler deploy
```
Wrangler will print your live API URL:
`https://z17-sports-api.<your-subdomain>.workers.dev`

Test the health endpoint:
```powershell
curl https://z17-sports-api.<your-subdomain>.workers.dev/health
# Response: {"status":"ok","service":"Z17 SPORTS Cloudflare REST API","environment":"production"}
```

---

### Step 4: First-Time Owner Bootstrap

When the application is first deployed, the D1 `users` table is empty. The secure bootstrap endpoint allows the authorized Firebase account to initialize as the store Owner/Admin:

1. In Firebase Console (`z17-sports`), create your Owner email and password (e.g. `owner@z17sports.com`).
2. Log in using the web application or call the bootstrap endpoint with your Firebase ID token:
```powershell
# POST to /api/auth/bootstrap
$headers = @{
    "Authorization" = "Bearer <FIREBASE_ID_TOKEN>"
    "Content-Type" = "application/json"
}
$body = @{
    name = "Store Owner"
    phone = "+94 77 123 4567"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://z17-sports-api.<your-subdomain>.workers.dev/api/auth/bootstrap" -Method POST -Headers $headers -Body $body
```
Once the initial admin is provisioned, the bootstrap endpoint is **permanently sealed**. All future staff accounts must be created or invited by the Owner through **Settings > Staff Management**.

---

### Step 5: Deploy Frontend to Cloudflare Pages

1. Build the production static assets:
```powershell
npm run build
```
2. Deploy the `dist/` folder to Cloudflare Pages:
```powershell
# Option A: Direct upload with wrangler
npx wrangler pages deploy dist --project-name z17-sports-pos

# Option B: Connect your GitHub repository to Cloudflare Pages:
# - Build command: npm run build
# - Build output directory: dist
# - Environment variable: VITE_API_BASE_URL = https://z17-sports-api.<your-subdomain>.workers.dev/api
```

The application is now live, globally distributed on Cloudflare's edge network, and completely free of recurring charges!

---

## 4. Hardware Configuration & POS Operations

### USB Barcode Scanner
* Standard USB barcode scanners operate as a Human Interface Device (HID) keyboard.
* The POS ambient keystroke buffer automatically captures rapid keystrokes (< 60ms delay) ending with `Enter`.
* Supported barcodes: EAN-13, UPC-A, Code-128, Code-39, and custom alphanumeric SKU strings.
* Pressing **F2** focuses the product search input instantly.
* Pressing **F8** opens the Payment modal directly from the keyboard.

### 80mm Thermal Receipt Printer
* Windows POS thermal printers (Xprinter, Epson TM-T88, POS-80) are supported natively without proprietary browser plugins.
* Printing uses an isolated hidden `<iframe>` with custom print stylesheets (`@page { size: 80mm auto; margin: 0; }`), avoiding browser popup blockers.
* Store identity, custom invoice header/footer, tax breakdown, and cashier name are automatically printed on every receipt.
* Offline sales display a prominent `OFFLINE TRANSACTION` header. Reprints include an audit watermark.

### Offline Cash Billing Procedure
1. **Morning Shift Prep**: Cashier opens the POS while connected to the internet. The catalog snapshot and store settings are automatically stored in Dexie IndexedDB.
2. **Network Disconnection**: If the internet disconnects, the status pill changes to **Offline Mode (Cash Only)**.
3. **Cashier Billing**: Cashier continues scanning barcodes, adding products, and billing cash sales normally.
4. **Local Persistence**: Each offline sale is saved to Dexie with a unique UUID `clientSaleId` and local receipt number. Local stock reservations prevent accidental overselling.
5. **Reconnection & Cloud Sync**: As soon as the PC reconnects, `syncSales()` synchronizes all pending transactions to `/api/sales/sync` using idempotent deduplication.

---

## 5. Security & Rollback Plan

### Security Rules
* All business logic, price calculations, and stock deductions are enforced on the backend at the Cloudflare edge.
* Cashiers are strictly prevented from viewing buying prices or cost information (`buying_price` and `average_cost` are omitted from cashier catalog payloads).
* Unsigned or manipulated client payloads are rejected.

### Instant Zero-Risk Rollback Plan
If you ever wish to revert to Firebase Cloud Functions and Firestore:
1. Set `VITE_USE_FIREBASE_FIRESTORE = true` in `.env`.
2. Set `VITE_USE_FIREBASE_FUNCTIONS = true` in `.env`.
3. Re-run `npm run build`.
All original Firebase Cloud Functions and Firestore security rules remain completely intact in the repository.
