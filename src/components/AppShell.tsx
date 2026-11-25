import { useOffline } from '@/offline/useOffline'
import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Activity, ArchiveRestore, BadgeDollarSign, Banknote, BarChart3, Boxes, Building2, ChevronLeft, ChevronRight, ClipboardList, CreditCard, FileClock, LayoutDashboard, LogOut, Menu, Package, PackagePlus, Receipt, RotateCcw, Settings, ShoppingCart, Tags, Users, WalletCards, Wifi, WifiOff, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { hasPermission, type Permission } from '@/lib/permissions'

const navigation: { label: string; to: string; icon: typeof Activity; permission?: Permission }[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { label: 'POS / Billing', to: '/pos', icon: ShoppingCart, permission: 'pos.use' },
  { label: 'Offline Sync', to: '/sync', icon: Activity, permission: 'pos.use' },
  { label: 'Sales', to: '/sales', icon: Receipt, permission: 'reports.sales' },
  { label: 'Products', to: '/products', icon: Package, permission: 'products.read' },
  { label: 'Categories', to: '/categories', icon: Tags, permission: 'products.write' },
  { label: 'Brands', to: '/brands', icon: BadgeDollarSign, permission: 'products.write' },
  { label: 'Inventory', to: '/inventory', icon: Boxes, permission: 'products.read' },
  { label: 'Purchases', to: '/purchases', icon: PackagePlus, permission: 'purchases.manage' },
  { label: 'Purchase Returns', to: '/purchase-returns', icon: ArchiveRestore, permission: 'returns.manage' },
  { label: 'Customers', to: '/customers', icon: Users, permission: 'parties.manage' },
  { label: 'Suppliers', to: '/suppliers', icon: Building2, permission: 'purchases.manage' },
  { label: 'Sales Returns', to: '/sales-returns', icon: RotateCcw, permission: 'returns.manage' },
  { label: 'Expenses', to: '/expenses', icon: CreditCard, permission: 'expenses.manage' },
  { label: 'Payments', to: '/payments', icon: WalletCards, permission: 'expenses.manage' },
  { label: 'Cash Closing', to: '/cash-closing', icon: Banknote, permission: 'expenses.manage' },
  { label: 'Reports', to: '/reports', icon: BarChart3, permission: 'reports.profit' },
  { label: 'Staff & Users', to: '/users', icon: ClipboardList, permission: 'users.manage' },
  { label: 'Audit Logs', to: '/audit-logs', icon: FileClock, permission: 'audit.read' },
  { label: 'Settings', to: '/settings', icon: Settings, permission: 'settings.manage' },
]

function Sidebar({ collapsed, close }: { collapsed: boolean; close?: () => void }) {
  const { profile, logout } = useAuth()
  const visible = navigation.filter(item => !item.permission || hasPermission(profile?.role, item.permission))
  return (
    <div className="flex h-full flex-col bg-[#11111E] text-slate-300 border-r border-white/5">
      <div className={cn('flex h-20 items-center border-b border-white/10 px-5', collapsed && 'justify-center px-2')}>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#912DFA] font-black text-white shadow-lg shadow-purple-500/25">
          Z17
        </div>
        {!collapsed && (
          <div className="ml-3">
            <div className="font-extrabold tracking-wide text-white">Z17 SPORTS</div>
            <div className="text-[10px] font-medium uppercase tracking-[.2em] text-[#912DFA]">Retail Command</div>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visible.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={close}
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all hover:bg-[#222137] hover:text-white',
                isActive && 'bg-[#912DFA]/15 text-[#912DFA] font-semibold border-l-2 border-[#912DFA]',
                collapsed && 'justify-center px-0'
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        {!collapsed && (
          <div className="mb-2 px-3">
            <div className="truncate text-sm font-semibold text-white">{profile?.name}</div>
            <div className="text-xs capitalize text-purple-300/80 font-medium">{profile?.role}</div>
          </div>
        )}
        <button
          onClick={() => logout()}
          className={cn(
            'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition-colors',
            collapsed && 'justify-center px-0'
          )}
        >
          <LogOut className="h-[18px] w-[18px]" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { online, pending, lastSync } = useOffline()
  const { profile } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const label = navigation.find(item => location.pathname.startsWith(item.to))?.label ?? 'Z17 SPORTS'

  // High-frequency navigation for mobile owner / cashier
  const mobileNav = [
    { label: 'POS', to: '/pos', icon: ShoppingCart, permission: 'pos.use' as Permission },
    { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' as Permission },
    { label: 'Sales', to: '/sales', icon: Receipt, permission: 'reports.sales' as Permission },
    { label: 'Inventory', to: '/inventory', icon: Boxes, permission: 'products.read' as Permission },
    { label: 'Sync', to: '/sync', icon: Activity, permission: 'pos.use' as Permission },
  ].filter(i => hasPermission(profile?.role, i.permission))

  return (
    <div className="min-h-screen bg-[#11111E]">
      <aside className={cn('fixed inset-y-0 left-0 z-40 hidden transition-all duration-200 lg:block', collapsed ? 'w-[72px]' : 'w-64')}>
        <Sidebar collapsed={collapsed} />
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCollapsed(v => !v)}
          className="absolute -right-3 top-24 h-7 w-7 rounded-full border border-white/10 bg-[#222137] text-white shadow-md hover:bg-[#912DFA]"
        >
          <span className="sr-only">Toggle sidebar</span>
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </Button>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-[#11111E]/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-72 shadow-2xl">
            <Sidebar collapsed={false} close={() => setMobileOpen(false)} />
            <button className="absolute right-3 top-5 rounded-lg p-1 text-slate-400 hover:text-white" onClick={() => setMobileOpen(false)}>
              <X className="h-5 w-5" />
            </button>
          </aside>
        </div>
      )}

      <div className={cn('transition-all duration-200 pb-16 sm:pb-0', collapsed ? 'lg:pl-[72px]' : 'lg:pl-64')}>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/5 bg-[#11111E]/90 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden text-slate-300 hover:text-white" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#912DFA]">Workspace</p>
              <p className="font-bold text-white text-base leading-tight">{label}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              title={`Last sync: ${lastSync}`}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border',
                online
                  ? 'border-emerald-500/30 bg-purple-500/100/10 text-purple-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              )}
            >
              {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span>{online ? 'Online' : 'Offline'}</span>
              {pending > 0 && <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold">{pending} pending</span>}
            </div>
            <span title={`Last sync: ${lastSync}`} className="text-xs text-muted-foreground">{online?'Online':'Offline'} · {pending} pending on this device</span><span className="hidden rounded-full bg-[#912DFA]/15 px-3 py-1 text-xs font-semibold text-purple-300 border border-[#912DFA]/30 sm:block">
              Main Branch
            </span>
          </div>
        </header>
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>

      {/* Mobile Bottom Quick-Access Bar for Owner & Cashier */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-white/10 bg-[#11111E]/95 py-2 backdrop-blur-lg">
        {mobileNav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 py-1 px-3 text-[11px] font-medium transition-colors',
                isActive ? 'text-[#912DFA] font-bold' : 'text-slate-400 hover:text-white'
              )
            }
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
