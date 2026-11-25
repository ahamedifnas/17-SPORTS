import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import { hasPermission, type Permission } from '@/lib/permissions'
import { LoginPage } from '@/pages/LoginPage'

const SyncPage = lazy(() => import('@/pages/SyncPage').then(m => ({ default: m.SyncPage })))
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const ProductsPage = lazy(() => import('@/pages/ProductsPage').then(m => ({ default: m.ProductsPage })))
const ProductFormPage = lazy(() => import('@/pages/ProductFormPage').then(m => ({ default: m.ProductFormPage })))
const PosPage = lazy(() => import('@/pages/PosPage').then(m => ({ default: m.PosPage })))
const InventoryPage = lazy(() => import('@/pages/InventoryPage').then(m => ({ default: m.InventoryPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const CatalogPage = lazy(() => import('@/pages/CatalogPage').then(m => ({ default: m.CatalogPage })))
const PurchasesPage = lazy(() => import('@/pages/PurchasesPage').then(m => ({ default: m.PurchasesPage })))
const PurchaseReturnsPage = lazy(() => import('@/pages/PurchaseReturnsPage').then(m => ({ default: m.PurchaseReturnsPage })))
const SalesPage = lazy(() => import('@/pages/SalesPage').then(m => ({ default: m.SalesPage })))
const PartiesPage = lazy(() => import('@/pages/PartiesPage').then(m => ({ default: m.PartiesPage })))
const ExpensesPage = lazy(() => import('@/pages/FinancePages').then(m => ({ default: m.ExpensesPage })))
const PaymentsPage = lazy(() => import('@/pages/FinancePages').then(m => ({ default: m.PaymentsPage })))
const SalesReturnsPage = lazy(() => import('@/pages/FinancePages').then(m => ({ default: m.SalesReturnsPage })))
const CashClosingPage = lazy(() => import('@/pages/FinancePages').then(m => ({ default: m.CashClosingPage })))
const ReportsPage = lazy(() => import('@/pages/AdminReportsPages').then(m => ({ default: m.ReportsPage })))
const UsersPage = lazy(() => import('@/pages/AdminReportsPages').then(m => ({ default: m.UsersPage })))
const AuditLogsPage = lazy(() => import('@/pages/AdminReportsPages').then(m => ({ default: m.AuditLogsPage })))

function LoadingScreen() { return <div className="grid min-h-[50vh] place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-emerald-700"/></div> }

function ProtectedRoute({ permission, children }: { permission?: Permission; children?: ReactNode }) {
  const { user, profile, loading, configured, profileIssue } = useAuth()
  const location = useLocation()
  const [online,setOnline]=useState(navigator.onLine)
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}},[])
  if (loading) return <LoadingScreen/>
  if (!configured || !user) return <Navigate to="/login" state={{ from: location }} replace />
  if (!profile) return <div className="grid min-h-screen place-items-center p-8 text-center"><div className="max-w-lg"><h1 className="text-2xl font-bold">Account access unavailable</h1><p className="mt-2 text-muted-foreground">{profileIssue?.message ?? 'Your Firestore user profile could not be verified.'}</p>{profileIssue?.code === 'invalid' && <p className="mt-2 text-sm text-red-700">Check: {profileIssue.fields.join(', ')}</p>}<p className="mt-4 text-xs text-muted-foreground">Expected document: users/{user.uid}</p></div></div>
  if (profile.status !== 'active') return <div className="grid min-h-screen place-items-center p-8 text-center"><div><h1 className="text-2xl font-bold">Account is {profile.status}</h1><p className="mt-2 text-muted-foreground">An administrator must set the profile status to active.</p></div></div>
  if(!online&&(profile.role!=='cashier'||!['/pos','/sync'].includes(location.pathname)))return <div className="p-8"><h1 className="text-xl font-bold">Internet connection required</h1><p className="mt-2">Owner management uses confirmed cloud data. Authorized cashiers can continue billing through POS.</p><a className="mt-4 inline-block text-purple-300" href="/pos">Open POS</a></div>
  if (permission && !hasPermission(profile.role, permission)) return <Navigate to={hasPermission(profile.role, 'dashboard.view') ? '/dashboard' : '/pos'} replace />
  return children ?? <Outlet/>
}

export default function App() {
  return <BrowserRouter><Suspense fallback={<LoadingScreen/>}><Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route element={<ProtectedRoute><AppShell><Outlet/></AppShell></ProtectedRoute>}>
      <Route index element={<Navigate to="/dashboard" replace/>}/>
      <Route path="dashboard" element={<ProtectedRoute permission="dashboard.view"><DashboardPage/></ProtectedRoute>}/>
      <Route path="sync" element={<ProtectedRoute permission="pos.use"><SyncPage/></ProtectedRoute>}/>
      <Route path="sync" element={<ProtectedRoute permission="pos.use"><SyncPage/></ProtectedRoute>}/>
      <Route path="pos" element={<ProtectedRoute permission="pos.use"><PosPage/></ProtectedRoute>}/>
      <Route path="products" element={<ProtectedRoute permission="products.read"><ProductsPage/></ProtectedRoute>}/>
      <Route path="products/new" element={<ProtectedRoute permission="products.write"><ProductFormPage/></ProtectedRoute>}/>
      <Route path="products/:id" element={<ProtectedRoute permission="products.write"><ProductFormPage/></ProtectedRoute>}/>
      <Route path="inventory" element={<ProtectedRoute permission="products.read"><InventoryPage/></ProtectedRoute>}/>
      <Route path="categories" element={<ProtectedRoute permission="products.write"><CatalogPage kind="categories"/></ProtectedRoute>}/>
      <Route path="brands" element={<ProtectedRoute permission="products.write"><CatalogPage kind="brands"/></ProtectedRoute>}/>
      <Route path="sales" element={<ProtectedRoute permission="reports.sales"><SalesPage/></ProtectedRoute>}/>
      <Route path="purchases" element={<ProtectedRoute permission="purchases.manage"><PurchasesPage/></ProtectedRoute>}/>
      <Route path="purchase-returns" element={<ProtectedRoute permission="returns.manage"><PurchaseReturnsPage/></ProtectedRoute>}/>
      <Route path="customers" element={<ProtectedRoute permission="parties.manage"><PartiesPage kind="customers"/></ProtectedRoute>}/>
      <Route path="suppliers" element={<ProtectedRoute permission="purchases.manage"><PartiesPage kind="suppliers"/></ProtectedRoute>}/>
      <Route path="sales-returns" element={<ProtectedRoute permission="returns.manage"><SalesReturnsPage/></ProtectedRoute>}/>
      <Route path="expenses" element={<ProtectedRoute permission="expenses.manage"><ExpensesPage/></ProtectedRoute>}/>
      <Route path="payments" element={<ProtectedRoute permission="expenses.manage"><PaymentsPage/></ProtectedRoute>}/>
      <Route path="cash-closing" element={<ProtectedRoute permission="expenses.manage"><CashClosingPage/></ProtectedRoute>}/>
      <Route path="reports" element={<ProtectedRoute permission="reports.profit"><ReportsPage/></ProtectedRoute>}/>
      <Route path="users" element={<ProtectedRoute permission="users.manage"><UsersPage/></ProtectedRoute>}/>
      <Route path="audit-logs" element={<ProtectedRoute permission="audit.read"><AuditLogsPage/></ProtectedRoute>}/>
      <Route path="settings" element={<ProtectedRoute permission="settings.manage"><SettingsPage/></ProtectedRoute>}/>
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
  </Routes></Suspense></BrowserRouter>
}
