import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { BOOKING_STATUS_LABEL, type BookingStatus } from '../types/domain'

const STATUS_STYLE: Record<BookingStatus, string> = {
  booked: 'bg-slate-100 text-slate-700',
  arrived: 'bg-sky-100 text-sky-800',
  stored: 'bg-indigo-100 text-indigo-800',
  in_service: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  in_transit: 'bg-violet-100 text-violet-800',
  completed: 'bg-slate-200 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_STYLE[status]}`}>
      {BOOKING_STATUS_LABEL[status]}
    </span>
  )
}

type Variant = 'primary' | 'secondary' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-slate-300 bg-white hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`touch-target inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT[variant]} ${className}`}
    />
  )
}

const fieldClass = 'touch-target w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm'

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-sm font-medium text-slate-700 ${className}`}>
      {label}
      {children}
    </label>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldClass} ${props.className ?? ''}`} />
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/50 md:items-center md:p-4">
      <div className="flex max-h-[95dvh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-2xl md:rounded-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Schließen"
            className="touch-target flex items-center justify-center rounded-lg text-2xl leading-none text-slate-500 hover:bg-slate-100">
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null
  return (
    <ul className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  )
}
