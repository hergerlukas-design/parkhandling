import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { BOOKING_STATUS_LABEL, PAYMENT_STATUS_LABEL, type BookingStatus, type PaymentStatus } from '../types/domain'

const STATUS_STYLE: Record<BookingStatus, string> = {
  booked: 'bg-chip text-subtle',
  arrived: 'bg-accent-soft text-due-week-ink',
  stored: 'bg-accent-soft text-accent-dark',
  in_service: 'bg-warn-soft text-warn-ink',
  ready: 'bg-ok-soft text-ok-ink',
  in_transit: 'bg-accent text-white',
  completed: 'bg-chip text-muted',
  cancelled: 'bg-danger-soft text-danger-ink',
}

const PAYMENT_STYLE: Record<PaymentStatus, string> = {
  open: 'bg-warn-soft text-warn-ink',
  partial: 'bg-accent-soft text-due-week-ink',
  paid: 'bg-ok-soft text-ok-ink',
  refunded: 'bg-chip text-subtle',
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${PAYMENT_STYLE[status]}`}>
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  )
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
  primary: 'bg-accent text-white hover:bg-accent-dark',
  secondary: 'border border-line-strong bg-surface hover:bg-ground',
  danger: 'bg-danger text-white hover:brightness-95',
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

const fieldClass = 'touch-target w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base md:text-sm'

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-sm font-medium text-subtle ${className}`}>
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
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 md:items-center md:p-4">
      <div className="flex max-h-[95dvh] w-full max-w-3xl flex-col rounded-t-2xl bg-surface shadow-2xl md:rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Schließen"
            className="touch-target flex items-center justify-center rounded-lg text-2xl leading-none text-muted hover:bg-chip">
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null
  return (
    <ul className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-ink">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  )
}
