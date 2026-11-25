import { Env, AuthUser } from '../types';
import { jsonResponse, errorResponse, getNextSequence, recordAuditLog } from '../helpers';

export async function handleFinanceRoutes(
  request: Request,
  env: Env,
  url: URL,
  user: AuthUser | null
): Promise<Response> {
  const path = url.pathname;

  // --- EXPENSES ---
  if (path === '/api/finance/expenses') {
    if (request.method === 'GET') {
      if (!user) return errorResponse('Unauthorized', 401);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');

      let query = 'SELECT * FROM expenses WHERE 1=1';
      const params: unknown[] = [];
      if (startDate) {
        query += ' AND date >= ?';
        params.push(startDate);
      }
      if (endDate) {
        query += ' AND date <= ?';
        params.push(endDate);
      }
      query += ' ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const list = await env.DB.prepare(query).bind(...params).all();
      return jsonResponse(list.results);
    }

    if (request.method === 'POST') {
      if (!user || user.role === 'cashier') return errorResponse('Forbidden: Cashiers cannot log expenses', 403);
      const body = (await request.json()) as {
        category: string;
        description: string;
        amount: number;
        paymentMethod?: 'cash' | 'bank' | 'card';
        date?: string;
        notes?: string;
      };

      if (!body.category || !body.description || !body.amount) {
        return errorResponse('Category, description, and amount are required');
      }

      const expenseNumber = await getNextSequence(env.DB, 'expense', 'EXP');
      const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      await env.DB.prepare(
        `INSERT INTO expenses (
          id, branch_id, expense_number, category, description,
          amount, payment_method, date, notes, status, created_by, created_at
        ) VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP)`
      ).bind(
        id,
        expenseNumber,
        body.category,
        body.description,
        Math.round(body.amount),
        body.paymentMethod || 'cash',
        body.date || new Date().toISOString().split('T')[0],
        body.notes || null,
        user.name || user.email
      ).run();

      await recordAuditLog(env.DB, user, 'finance', 'create_expense', id, `Logged expense ${expenseNumber}: ${body.description} (${body.amount})`);
      return jsonResponse({ id, expenseNumber, success: true }, 201);
    }
  }

  // --- ACCOUNT PAYMENTS (AR/AP) ---
  if (path === '/api/finance/payments') {
    if (request.method === 'GET') {
      if (!user) return errorResponse('Unauthorized', 401);
      const partyId = url.searchParams.get('partyId');
      let query = 'SELECT * FROM payments WHERE 1=1';
      const params: unknown[] = [];
      if (partyId) {
        query += ' AND party_id = ?';
        params.push(partyId);
      }
      query += ' ORDER BY date DESC, created_at DESC LIMIT 100';
      const list = await env.DB.prepare(query).bind(...params).all();
      return jsonResponse(list.results);
    }

    if (request.method === 'POST') {
      if (!user) return errorResponse('Unauthorized', 401);
      const body = (await request.json()) as {
        type: 'customer' | 'supplier' | 'refund' | 'other';
        partyId: string;
        partyName: string;
        amount: number;
        paymentMethod?: 'cash' | 'bank' | 'card' | 'cheque';
        reference?: string;
        date?: string;
      };

      if (!body.type || !body.partyId || !body.amount) {
        return errorResponse('Type, partyId, and amount are required');
      }

      const paymentNumber = await getNextSequence(env.DB, 'payment', 'PAY');
      const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const statements: ReturnType<typeof env.DB.prepare>[] = [
        env.DB.prepare(
          `INSERT INTO payments (
            id, branch_id, payment_number, type, party_id, party_name,
            amount, payment_method, reference, date, created_by, created_at
          ) VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(
          id,
          paymentNumber,
          body.type,
          body.partyId,
          body.partyName,
          Math.round(body.amount),
          body.paymentMethod || 'cash',
          body.reference || null,
          body.date || new Date().toISOString().split('T')[0],
          user.name || user.email
        ),
      ];

      // Update party balances
      if (body.type === 'customer') {
        statements.push(
          env.DB.prepare(
            'UPDATE customers SET current_credit = current_credit - ?, current_balance = current_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).bind(Math.round(body.amount), Math.round(body.amount), body.partyId)
        );
      } else if (body.type === 'supplier') {
        statements.push(
          env.DB.prepare(
            'UPDATE suppliers SET current_balance = current_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).bind(Math.round(body.amount), body.partyId)
        );
      }

      if (env.DB.batch) {
        await env.DB.batch(statements);
      } else {
        for (const s of statements) await s.run();
      }

      await recordAuditLog(env.DB, user, 'finance', 'record_payment', id, `Recorded payment ${paymentNumber} for ${body.partyName} (${body.amount})`);
      return jsonResponse({ id, paymentNumber, success: true }, 201);
    }
  }

  // --- CASH CLOSINGS ---
  if (path === '/api/finance/cash-closing') {
    if (request.method === 'GET') {
      if (!user) return errorResponse('Unauthorized', 401);
      const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];

      // Aggregate today's cash transactions
      const cashSales = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(sp.amount), 0) as total
           FROM sale_payments sp
           JOIN sales s ON sp.sale_id = s.id
           WHERE sp.method = 'cash' AND s.status != 'voided' AND date(s.created_at) = ?`
        )
        .bind(date)
        .first<{ total: number }>();

      const cashCustomerPayments = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM payments
           WHERE type = 'customer' AND payment_method = 'cash' AND date = ?`
        )
        .bind(date)
        .first<{ total: number }>();

      const cashExpenses = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM expenses
           WHERE payment_method = 'cash' AND status = 'approved' AND date = ?`
        )
        .bind(date)
        .first<{ total: number }>();

      const cashRefunds = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(refund_amount), 0) as total
           FROM sales_returns
           WHERE refund_method = 'cash' AND date(return_date) = ?`
        )
        .bind(date)
        .first<{ total: number }>();

      const existingClosing = await env.DB
        .prepare('SELECT * FROM cash_closings WHERE date = ?')
        .bind(date)
        .first();

      const expectedCash = (cashSales?.total || 0) + (cashCustomerPayments?.total || 0) - (cashExpenses?.total || 0) - (cashRefunds?.total || 0);

      return jsonResponse({
        date,
        cashSales: cashSales?.total || 0,
        cashCustomerPayments: cashCustomerPayments?.total || 0,
        cashExpenses: cashExpenses?.total || 0,
        cashRefunds: cashRefunds?.total || 0,
        expectedCash,
        closing: existingClosing || null,
      });
    }

    if (request.method === 'POST') {
      if (!user) return errorResponse('Unauthorized', 401);
      const body = (await request.json()) as {
        date?: string;
        openingCash?: number;
        actualCash: number;
        notes?: string;
      };

      const date = body.date || new Date().toISOString().split('T')[0];
      const closingNumber = await getNextSequence(env.DB, 'close', 'CLS');
      const closingId = `close_${date}`;

      // Recalculate expected cash
      const cashSales = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(sp.amount), 0) as total
           FROM sale_payments sp
           JOIN sales s ON sp.sale_id = s.id
           WHERE sp.method = 'cash' AND s.status != 'voided' AND date(s.created_at) = ?`
        )
        .bind(date)
        .first<{ total: number }>();

      const cashCust = await env.DB
        .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE type = 'customer' AND payment_method = 'cash' AND date = ?")
        .bind(date)
        .first<{ total: number }>();

      const cashExp = await env.DB
        .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE payment_method = 'cash' AND status = 'approved' AND date = ?")
        .bind(date)
        .first<{ total: number }>();

      const cashRef = await env.DB
        .prepare("SELECT COALESCE(SUM(refund_amount), 0) as total FROM sales_returns WHERE refund_method = 'cash' AND date(return_date) = ?")
        .bind(date)
        .first<{ total: number }>();

      const openingCash = Math.round(body.openingCash || 0);
      const expectedCash = openingCash + (cashSales?.total || 0) + (cashCust?.total || 0) - (cashExp?.total || 0) - (cashRef?.total || 0);
      const actualCash = Math.round(body.actualCash);
      const difference = actualCash - expectedCash;

      await env.DB.prepare(
        `INSERT INTO cash_closings (
          id, branch_id, closing_number, date, opening_cash, cash_sales,
          cash_customer_payments, cash_expenses, cash_refunds, supplier_cash,
          expected_cash, actual_cash, difference, notes, status, closed_by, created_at
        ) VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'closed', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          actual_cash = excluded.actual_cash,
          difference = excluded.difference,
          notes = excluded.notes,
          closed_by = excluded.closed_by`
      ).bind(
        closingId,
        closingNumber,
        date,
        openingCash,
        cashSales?.total || 0,
        cashCust?.total || 0,
        cashExp?.total || 0,
        cashRef?.total || 0,
        expectedCash,
        actualCash,
        difference,
        body.notes || null,
        user.name || user.email
      ).run();

      await recordAuditLog(env.DB, user, 'finance', 'cash_closing', closingId, `Closed shift for ${date}. Diff: ${difference}`);
      return jsonResponse({ success: true, closingNumber, difference, expectedCash, actualCash });
    }
  }

  return errorResponse('Not Found', 404);
}
