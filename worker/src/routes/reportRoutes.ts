import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse } from '../helpers';

export async function handleReportRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // GET /api/reports/summary - Comprehensive financial & inventory business KPIs
  if (path === '/api/reports/summary' && request.method === 'GET') {
    if (!user) return errorResponse('Unauthorized', 401);
    if (user.role === 'cashier') return errorResponse('Forbidden: Cashiers cannot view business reports', 403);

    const startDate = url.searchParams.get('startDate') || '1970-01-01';
    const endDate = url.searchParams.get('endDate') || '2099-12-31';

    // 1. Sales totals (excluding voided)
    const salesAgg = await env.DB
      .prepare(
        `SELECT
          COUNT(*) as bill_count,
          COALESCE(SUM(subtotal), 0) as gross_sales,
          COALESCE(SUM(discount), 0) as total_discount,
          COALESCE(SUM(tax), 0) as total_tax,
          COALESCE(SUM(grand_total), 0) as total_sales,
          COALESCE(SUM(cost), 0) as total_cogs,
          COALESCE(SUM(gross_profit), 0) as gross_profit
         FROM sales
         WHERE status != 'voided' AND date(created_at) >= ? AND date(created_at) <= ?`
      )
      .bind(startDate, endDate)
      .first<{
        bill_count: number;
        gross_sales: number;
        total_discount: number;
        total_tax: number;
        total_sales: number;
        total_cogs: number;
        gross_profit: number;
      }>();

    // 2. Sales Returns
    const returnsAgg = await env.DB
      .prepare(
        `SELECT COALESCE(SUM(total), 0) as total_returns, COALESCE(SUM(refund_amount), 0) as total_refunds
         FROM sales_returns
         WHERE status != 'voided' AND date(return_date) >= ? AND date(return_date) <= ?`
      )
      .bind(startDate, endDate)
      .first<{ total_returns: number; total_refunds: number }>();

    // 2b. Reconcile Returned COGS
    const returnedCogsAgg = await env.DB
      .prepare(
        `SELECT COALESCE(SUM(sri.quantity * sri.cost_price), 0) as returned_cogs
         FROM sales_return_items sri
         JOIN sales_returns sr ON sri.return_id = sr.id
         WHERE sr.status != 'voided' AND date(sr.return_date) >= ? AND date(sr.return_date) <= ?`
      )
      .bind(startDate, endDate)
      .first<{ returned_cogs: number }>();

    // 3. Approved Expenses
    const expensesAgg = await env.DB
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total_expenses
         FROM expenses
         WHERE status = 'approved' AND date(date) >= ? AND date(date) <= ?`
      )
      .bind(startDate, endDate)
      .first<{ total_expenses: number }>();

    // 4. Purchases (Received)
    const purchasesAgg = await env.DB
      .prepare(
        `SELECT COALESCE(SUM(grand_total), 0) as total_purchases
         FROM purchases
         WHERE status = 'received' AND date(purchase_date) >= ? AND date(purchase_date) <= ?`
      )
      .bind(startDate, endDate)
      .first<{ total_purchases: number }>();

    // 5. Total outstanding customer credit
    const customerCredit = await env.DB
      .prepare('SELECT COALESCE(SUM(current_credit), 0) as total FROM customers')
      .first<{ total: number }>();

    // 6. Total outstanding supplier payables
    const supplierPayables = await env.DB
      .prepare('SELECT COALESCE(SUM(current_balance), 0) as total FROM suppliers')
      .first<{ total: number }>();

    // 7. Inventory total value (at cost)
    const invProductVal = await env.DB
      .prepare("SELECT COALESCE(SUM(stock * buying_price), 0) as total FROM products WHERE status = 'active'")
      .first<{ total: number }>();

    const invVariantVal = await env.DB
      .prepare("SELECT COALESCE(SUM(stock * buying_price), 0) as total FROM product_variants WHERE status = 'active'")
      .first<{ total: number }>();

    const totalInventoryValue = (invProductVal?.total || 0) + (invVariantVal?.total || 0);

    const grossSales = salesAgg?.gross_sales || 0;
    const totalDiscount = salesAgg?.total_discount || 0;
    const totalTax = salesAgg?.total_tax || 0;
    const totalReturns = returnsAgg?.total_returns || 0;
    const netSales = (salesAgg?.total_sales || 0) - totalReturns;
    const salesCogs = salesAgg?.total_cogs || 0;
    const returnedCogs = returnedCogsAgg?.returned_cogs || 0;
    const netCogs = Math.max(0, salesCogs - returnedCogs);
    const grossProfit = netSales - netCogs;
    const expenses = expensesAgg?.total_expenses || 0;
    const netProfit = grossProfit - expenses;

    return jsonResponse({
      startDate,
      endDate,
      billCount: salesAgg?.bill_count || 0,
      grossSales,
      totalDiscount,
      totalTax,
      totalReturns,
      netSales,
      costOfGoodsSold: netCogs,
      returnedCogs,
      grossProfit,
      expenses,
      netProfit,
      totalPurchases: purchasesAgg?.total_purchases || 0,
      customerCredit: customerCredit?.total || 0,
      supplierPayables: supplierPayables?.total || 0,
      inventoryValuation: totalInventoryValue,
    });
  }

  // GET /api/reports/products - Top performing products by sales volume & revenue
  if (path === '/api/reports/products' && request.method === 'GET') {
    if (!user) return errorResponse('Unauthorized', 401);
    if (user.role === 'cashier') return errorResponse('Forbidden: Cashiers cannot view reports', 403);

    const startDate = url.searchParams.get('startDate') || '1970-01-01';
    const endDate = url.searchParams.get('endDate') || '2099-12-31';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

    const topProducts = await env.DB
      .prepare(
        `SELECT
          si.product_id,
          si.product_name,
          si.sku,
          SUM(si.quantity) as total_quantity,
          SUM(si.line_total) as total_revenue,
          SUM(si.cost_price * si.quantity) as total_cost,
          (SUM(si.line_total) - SUM(si.cost_price * si.quantity)) as total_profit
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         WHERE s.status != 'voided' AND date(s.created_at) >= ? AND date(s.created_at) <= ?
         GROUP BY si.product_id, si.product_name, si.sku
         ORDER BY total_revenue DESC
         LIMIT ?`
      )
      .bind(startDate, endDate, limit)
      .all();

    return jsonResponse(topProducts.results);
  }

  return errorResponse('Not Found', 404);
}
