import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', { variants: { variant: { default: 'bg-primary text-primary-foreground hover:bg-primary/90', outline: 'border border-border bg-card hover:bg-muted', ghost: 'hover:bg-muted', destructive: 'bg-destructive text-white hover:bg-destructive/90' }, size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', lg: 'h-12 px-6', icon: 'h-10 w-10' } }, defaultVariants: { variant: 'default', size: 'default' } })

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => { const Comp = asChild ? Slot : 'button'; return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} /> })
Button.displayName = 'Button'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn('flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-50', className)} {...props} />)
Input.displayName = 'Input'

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) { return <label className={cn('text-sm font-medium text-foreground', className)} {...props} /> }
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-soft', className)} {...props} /> }
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'purple' }) {
  const tones = {
    neutral: 'bg-muted text-slate-300 border border-white/5',
    success: 'bg-purple-500/100/15 text-purple-300 border border-emerald-500/20',
    warning: 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
    danger: 'bg-rose-500/15 text-rose-400 border border-rose-500/20',
    purple: 'bg-[#912DFA]/15 text-purple-300 border border-[#912DFA]/30',
  }
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>
}
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>{action}</div> }
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) { return <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-card p-8 text-center"><div className="mb-4 rounded-full bg-[#912DFA]/15 p-3 text-purple-300">{icon}</div><h3 className="font-semibold text-white">{title}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>{action && <div className="mt-5">{action}</div>}</div> }
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export function DialogContent({ children, className }: { children: ReactNode; className?: string }) { return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#11111E]/80 backdrop-blur-sm"/><DialogPrimitive.Content className={cn('fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-white/10 bg-card p-6 shadow-2xl', className)}>{children}<DialogPrimitive.Close className="absolute right-4 top-4 rounded p-1 text-muted-foreground hover:bg-muted hover:text-white"><X className="h-4 w-4"/><span className="sr-only">Close</span></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal> }
export const DialogTitle = ({ children }: { children: ReactNode }) => <DialogPrimitive.Title className="text-lg font-bold text-white">{children}</DialogPrimitive.Title>
export const DialogDescription = ({ children }: { children: ReactNode }) => <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{children}</DialogPrimitive.Description>
export function Skeleton({ className }: { className?: string }) { return <div className={cn('animate-pulse rounded-lg bg-card/5 border border-white/5', className)} /> }
