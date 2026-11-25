# Technical architecture

## Boundaries

- `src/pages` composes workflows and presentation.
- `src/components` contains shared UI and the responsive shell.
- `src/services` is the client data/API boundary.
- `src/stores` holds transient POS state only; Firestore remains the source of truth.
- `src/lib` contains deterministic money, permission and invoice logic.
- `src/types` defines Firestore/domain contracts.
- `functions/src` owns privileged multi-document financial transactions.

## Transaction pattern

The browser sends intent to a callable Function. The Function authenticates the user and reloads the authoritative user profile and products. In one Firestore transaction it allocates the sequence, checks current stock, changes stock, writes movements, snapshots sale items, writes payments/ledger entries and records an audit log. A conflict retries against fresh documents, preventing lost updates.

Purchases and returns should use the same pattern: a callable command with server-side validation and a single transaction that updates stock, movements, balances, ledgers and audit logs.

## Money and costing

All money is stored as integer cents. Product `averageCost` is the current weighted/recorded cost field. Every sale item copies the authoritative cost at the moment of sale, so historical gross profit does not change when current product cost changes.

## Roles

- Admin: full application administration.
- Manager: operations, cost, profit and stock management without user/security settings.
- Cashier: POS, customer assistance and non-sensitive sales views; no cost or supplier access.

UI checks improve usability. Firestore/Storage rules and callable functions are the actual security boundary.
