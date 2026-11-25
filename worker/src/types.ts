// Cloudflare D1 Types
export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump?(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec<T = unknown>(query: string): Promise<D1Result<T>>;
}

export interface Env {
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  ENVIRONMENT: string;
  BOOTSTRAP_SECRET?: string;
  BOOTSTRAP_OWNER_UID?: string;
}

export type UserRole = 'admin' | 'manager' | 'cashier' | 'inventory' | 'accountant';
export type UserStatus = 'active' | 'inactive';

export interface AuthUser {
  uid: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  status: UserStatus;
  branch_id: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface StoreSettings {
  branch_id: string;
  business_name: string;
  address?: string;
  phone?: string;
  email?: string;
  invoice_prefix: string;
  currency: string;
  tax_enabled: number;
  tax_rate: number;
  invoice_footer?: string;
  paper_size: string;
  require_manager_below_minimum: number;
}
