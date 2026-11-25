import { useState } from 'react'
import { z } from 'zod'
import { ShieldCheck, Store } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Input, Label } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'

const schema = z.object({ email: z.email('Enter a valid email address.'), password: z.string().min(6, 'Password must contain at least 6 characters.') })

export function LoginPage() {
  const { login, resetPassword, user, configured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/dashboard" replace />

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = schema.safeParse({ email, password })
    if (!parsed.success) return toast.error(parsed.error.issues[0].message)
    try { setBusy(true); await login(email, password) } catch { toast.error('Unable to sign in. Check your email and password.') } finally { setBusy(false) }
  }

  return <div className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden bg-[#11111E] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl"/>
      <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-purple-500/100 text-lg font-black">Z17</div><div><div className="font-bold tracking-wide">Z17 SPORTS</div><div className="text-xs uppercase tracking-[.2em] text-purple-300">Retail command</div></div></div>
      <div className="max-w-xl"><p className="mb-4 text-sm font-bold uppercase tracking-[.25em] text-purple-300">Built for the pace of retail</p><h1 className="text-5xl font-extrabold leading-tight">Every sale, every item, under control.</h1><p className="mt-6 max-w-lg text-lg leading-8 text-slate-400">A secure workspace for billing, inventory, customer credit, purchasing, and the decisions that keep Z17 SPORTS moving.</p></div>
      <div className="grid grid-cols-3 gap-4 text-sm text-slate-400"><div><ShieldCheck className="mb-2 text-purple-300"/>Role protected</div><div><Store className="mb-2 text-purple-300"/>Retail ready</div><div><span className="mb-2 block text-2xl font-bold text-purple-300">LKR</span>Local currency</div></div>
    </section>
    <section className="flex items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-md"><div className="mb-8 lg:hidden"><div className="inline-grid h-12 w-12 place-items-center rounded-xl bg-emerald-700 font-black text-white">Z17</div></div><h2 className="text-3xl font-extrabold">Welcome back</h2><p className="mt-2 text-muted-foreground">Sign in to your Z17 SPORTS workspace.</p>
        {!configured && <Card className="mt-6 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Firebase setup required.</strong><p className="mt-1">Copy <code>.env.example</code> to <code>.env</code>, add the Firebase web configuration, then restart the development server.</p></Card>}
        <form onSubmit={submit} className="mt-8 space-y-5"><div className="space-y-2"><Label htmlFor="email">Email address</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@z17sports.lk"/></div><div className="space-y-2"><div className="flex justify-between"><Label htmlFor="password">Password</Label><button type="button" onClick={async () => { if (!z.email().safeParse(email).success) return toast.error('Enter your email first.'); try { await resetPassword(email); toast.success('Password reset email sent.') } catch { toast.error('Unable to send reset email.') } }} className="text-xs font-semibold text-purple-300">Forgot password?</button></div><Input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></div><Button disabled={busy || !configured} className="h-12 w-full">{busy ? 'Signing in…' : 'Sign in securely'}</Button></form>
        <p className="mt-8 text-center text-xs text-muted-foreground">Access is monitored and recorded for business security.</p>
      </div>
    </section>
  </div>
}
