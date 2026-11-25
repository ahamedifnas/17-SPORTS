-- Additive only. Never rewrite or delete historical shop data.
CREATE TABLE checkout_requests (
  client_sale_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','applying','conflict','completed')),
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- A failed conditional UPDATE must cause an SQL error, not a successful zero-row update.
-- Rows exist only inside an atomic batch and are removed before commit.
CREATE TABLE transaction_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1));
CREATE TABLE owner_provisioning (id INTEGER PRIMARY KEY CHECK(id = 1), uid TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
