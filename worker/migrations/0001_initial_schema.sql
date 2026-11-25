-- ==============================================================================
-- Z17 SPORTS Cloudflare D1 Initial Schema Migration (0001_initial_schema.sql)
-- Single-Branch Sports Retail Management System (Zero-Cost Free Tier)
-- Currency: LKR (Integer cents/minor units)
-- ==============================================================================

-- 1. Counters Table for atomic sequential numbering (INV-YYYY-XXXXXX, etc.)
CREATE TABLE IF NOT EXISTS counters (
    key TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 2. Store Settings Table (Branch level)
CREATE TABLE IF NOT EXISTS settings (
    branch_id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    email TEXT,
    invoice_prefix TEXT NOT NULL DEFAULT 'INV',
    currency TEXT NOT NULL DEFAULT 'LKR',
    tax_enabled INTEGER NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    invoice_footer TEXT,
    paper_size TEXT NOT NULL DEFAULT '80mm',
    require_manager_below_minimum INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 3. Users Table (Authoritative Edge Role-Based Access Control)
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'cashier', 'inventory', 'accountant')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    branch_id TEXT NOT NULL DEFAULT 'main',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 4. Categories Table
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 5. Brands Table
CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 6. Products Table
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    name TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    barcode TEXT,
    category_id TEXT,
    brand_id TEXT,
    description TEXT,
    image_url TEXT,
    unit TEXT NOT NULL DEFAULT 'pcs',
    buying_price INTEGER NOT NULL DEFAULT 0,
    average_cost INTEGER NOT NULL DEFAULT 0,
    selling_price INTEGER NOT NULL DEFAULT 0,
    wholesale_price INTEGER NOT NULL DEFAULT 0,
    minimum_selling_price INTEGER NOT NULL DEFAULT 0,
    stock REAL NOT NULL DEFAULT 0,
    minimum_stock REAL NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'archived')),
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 7. Product Variants Table
CREATE TABLE IF NOT EXISTS product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku TEXT NOT NULL UNIQUE,
    barcode TEXT,
    size TEXT,
    color TEXT,
    buying_price INTEGER NOT NULL DEFAULT 0,
    selling_price INTEGER NOT NULL DEFAULT 0,
    stock REAL NOT NULL DEFAULT 0,
    minimum_stock REAL NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'archived')),
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 8. Stock Movements Table (Immutable Audit Ledger)
CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    product_id TEXT NOT NULL REFERENCES products(id),
    variant_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('sale', 'sale_return', 'purchase', 'purchase_return', 'adjustment', 'initial')),
    quantity REAL NOT NULL,
    before_stock REAL NOT NULL,
    after_stock REAL NOT NULL,
    reference_id TEXT,
    reason TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 9. Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    opening_balance INTEGER NOT NULL DEFAULT 0,
    current_balance INTEGER NOT NULL DEFAULT 0,
    current_credit INTEGER NOT NULL DEFAULT 0,
    credit_limit INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 10. Suppliers Table
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    opening_balance INTEGER NOT NULL DEFAULT 0,
    current_balance INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 11. Purchases Table
CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    purchase_number TEXT NOT NULL UNIQUE,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    supplier_name TEXT NOT NULL,
    reference_number TEXT,
    purchase_date TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'credit',
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    tax INTEGER NOT NULL DEFAULT 0,
    grand_total INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'received', 'cancelled')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 12. Purchase Items Table
CREATE TABLE IF NOT EXISTS purchase_items (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    variant_id TEXT,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity REAL NOT NULL,
    cost_price INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    line_total INTEGER NOT NULL DEFAULT 0
);

-- 13. Purchase Returns Table
CREATE TABLE IF NOT EXISTS purchase_returns (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    return_number TEXT NOT NULL UNIQUE,
    purchase_id TEXT NOT NULL REFERENCES purchases(id),
    purchase_number TEXT NOT NULL,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    supplier_name TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id),
    variant_id TEXT,
    quantity REAL NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    return_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 14. Sales Table (Authoritative Store Record)
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    invoice_number TEXT NOT NULL UNIQUE,
    client_sale_id TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    local_receipt_number TEXT,
    customer_id TEXT REFERENCES customers(id),
    customer_name TEXT,
    cashier_id TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    tax INTEGER NOT NULL DEFAULT 0,
    grand_total INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 0,
    change INTEGER NOT NULL DEFAULT 0,
    cost INTEGER NOT NULL DEFAULT 0,
    gross_profit INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'voided', 'refunded', 'conflict')),
    is_offline INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 15. Sale Items Table
CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    variant_id TEXT,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    variant_description TEXT,
    quantity REAL NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0,
    cost_price INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    line_total INTEGER NOT NULL DEFAULT 0,
    tax INTEGER NOT NULL DEFAULT 0,
    returned_quantity REAL NOT NULL DEFAULT 0
);

-- 16. Sale Payments Table
CREATE TABLE IF NOT EXISTS sale_payments (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK(method IN ('cash', 'card', 'bank', 'qr', 'credit')),
    amount INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 17. Sales Returns Table
CREATE TABLE IF NOT EXISTS sales_returns (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    return_number TEXT NOT NULL UNIQUE,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    invoice_number TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    customer_name TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    tax INTEGER NOT NULL DEFAULT 0,
    credit_reduction INTEGER NOT NULL DEFAULT 0,
    refund_amount INTEGER NOT NULL DEFAULT 0,
    refund_method TEXT NOT NULL DEFAULT 'cash' CHECK(refund_method IN ('cash', 'credit_note', 'card', 'bank')),
    reason TEXT,
    return_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 18. Sales Return Items Table
CREATE TABLE IF NOT EXISTS sales_return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    variant_id TEXT,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0,
    cost_price INTEGER NOT NULL DEFAULT 0,
    line_total INTEGER NOT NULL DEFAULT 0
);

-- 19. Expenses Table
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    expense_number TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'cash' CHECK(payment_method IN ('cash', 'bank', 'card')),
    date TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'approved',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 20. Payments Table (Accounts Receivable & Accounts Payable)
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    payment_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('customer', 'supplier', 'refund', 'other')),
    party_id TEXT NOT NULL,
    party_name TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'cash' CHECK(payment_method IN ('cash', 'bank', 'card', 'cheque')),
    reference TEXT,
    date TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 21. Cash Closings Table
CREATE TABLE IF NOT EXISTS cash_closings (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    closing_number TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    opening_cash INTEGER NOT NULL DEFAULT 0,
    cash_sales INTEGER NOT NULL DEFAULT 0,
    cash_customer_payments INTEGER NOT NULL DEFAULT 0,
    cash_expenses INTEGER NOT NULL DEFAULT 0,
    cash_refunds INTEGER NOT NULL DEFAULT 0,
    supplier_cash INTEGER NOT NULL DEFAULT 0,
    expected_cash INTEGER NOT NULL DEFAULT 0,
    actual_cash INTEGER NOT NULL DEFAULT 0,
    difference INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'closed',
    closed_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 22. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL DEFAULT 'main',
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    reference_id TEXT,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 23. Offline Sessions Table (For POS Authorization verification)
CREATE TABLE IF NOT EXISTS offline_sessions (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    device_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    issued_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    expires_at TEXT NOT NULL
);

-- 24. Sync Requests Table (Idempotency Guard for offline sales)
CREATE TABLE IF NOT EXISTS sync_requests (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    client_sale_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- ==============================================================================
-- INDEXES for Maximum Query Efficiency on Cloudflare D1 Free Tier
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants(barcode);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);

CREATE INDEX IF NOT EXISTS idx_stock_movements_prod ON stock_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(type, created_at);

CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_number);
CREATE INDEX IF NOT EXISTS idx_sales_client_sale ON sales(client_sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id, date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
