import { Env } from './types';
import { handleOptions, jsonResponse, errorResponse } from './helpers';
import { authenticate } from './auth';
import { handleDataRoutes } from './routes/dataRoutes';

import { handleAuthRoutes } from './routes/authRoutes';
import { handleCatalogRoutes } from './routes/catalogRoutes';
import { handleProductRoutes } from './routes/productRoutes';
import { handleInventoryRoutes } from './routes/inventoryRoutes';
import { handlePurchaseRoutes } from './routes/purchaseRoutes';
import { handleSaleRoutes } from './routes/saleRoutes';
import { handlePartyRoutes } from './routes/partyRoutes';
import { handleFinanceRoutes } from './routes/financeRoutes';
import { handleReportRoutes } from './routes/reportRoutes';
import { handleAdminRoutes } from './routes/adminRoutes';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 2. Public health check
    if (path === '/' || path === '/health') {
      return jsonResponse({
        status: 'ok',
        service: 'Z17 SPORTS Cloudflare REST API',
        environment: env.ENVIRONMENT || 'production',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      // 3. Authenticate request (Bootstrap route can self-authenticate)
      const user = await authenticate(request, env);
      if(path.startsWith('/api/data/'))return await handleDataRoutes(request,env,url,user);

      // 4. Route dispatcher
      if (path.startsWith('/api/auth')) {
        return await handleAuthRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/catalog') || path.startsWith('/api/categories') || path.startsWith('/api/brands')) {
        return await handleCatalogRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/products')) {
        return await handleProductRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/inventory')) {
        return await handleInventoryRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/purchases')) {
        return await handlePurchaseRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/sales')) {
        return await handleSaleRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/customers') || path.startsWith('/api/suppliers')) {
        return await handlePartyRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/finance')) {
        return await handleFinanceRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/reports')) {
        return await handleReportRoutes(request, env, url, user);
      }

      if (path.startsWith('/api/settings') || path.startsWith('/api/staff') || path.startsWith('/api/audit-logs')) {
        return await handleAdminRoutes(request, env, url, user);
      }

      return errorResponse(`Endpoint not found: ${request.method} ${path}`, 404);
    } catch (err) {
      console.error('Unhandled API exception:', err);
      const message = err instanceof Error ? err.message : 'Internal Server Error';
      return errorResponse(message, 500);
    }
  },
};
