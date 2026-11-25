# Commercial upgrade audit and plan

The existing React 19/Firebase application has authentication, role checks, product and party forms, purchase receiving/returns, sale returns, finance, reports, settings, invoices, and six existing Vitest test files. Existing uncommitted work is preserved. No production data is deleted.

## Findings

- POS is an existing product grid with a right-hand cart. Preserve this structure; no separate approved design image is present in the checkout.
- No service worker, IndexedDB outbox, offline authorization, or checkout idempotency.
- Stock adjustments run in the browser but rules deny movement writes.
- Products and sales expose costs to cashiers at the database boundary.
- Repeated product lines in server transactions can overwrite stock updates; client cost/tax and payment methods are insufficiently validated.
- Reports silently truncate at 500 records and profit includes tax and omits returned COGS.
- Purchase receiving omits the supplier balance on draft receipt. Refund/closing accounting needs regression verification.
- Browser receipt HTML interpolates unescaped customer/product text.

## Implementation sequence / affected areas

1. Shared CSS, shell and POS: dark navy/purple, preserve layout, responsive controls.
2. Functions, rules, inventory service: authoritative checkout, idempotency, costs, stock adjustment, restricted cost reads.
3. `src/offline`: Dexie atomic sales/items/reservations/outbox, scoped cached catalog and authorized session, durable recovery.
4. POS, auth, sync page: cash-only offline receipts, reconnect/manual retry, conflicts, export/reprint.
5. Vite/main/public: precached application shell and install manifest.
6. Financial services/reports: pagination and accounting corrections; preserve collection contracts.
7. Tests and deployment/UAT documentation.

## Release risks

Deploy functions before the new client. Rules and callable projections must ship together. Browser data is device-local and can be cleared/evicted; export pending sales before device maintenance. An offline authorization cannot observe immediate revocation, so it expires after a bounded shift. Offline stock conflicts remain pending until stock is reconciled by authorized staff; never force negative stock or silently rewrite a receipt. Historical invoice costs cannot be repaired without trusted historical evidence. Hardware, emulator and real Firebase verification are release gates, not implied by a successful build.
