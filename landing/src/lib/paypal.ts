// Lädt das PayPal-JavaScript-SDK nur auf der Buchungsseite (nicht auf der Startseite).
// Die Client-ID ist öffentlich (VITE_PAYPAL_CLIENT_ID); das Secret liegt ausschließlich in der Edge Function.
export interface PayPalActions {
  resolve(): Promise<void> | void
  reject(): Promise<void> | void
}

export interface PayPalButtonsOptions {
  /** Vor dem Bezahlfenster: resolve() lässt weiter, reject() bricht ab */
  onClick?: (data: unknown, actions: PayPalActions) => unknown
  createOrder: () => Promise<string>
  onApprove: (data: { orderID: string }) => Promise<void>
  onError?: (err: unknown) => void
  style?: Record<string, string | number>
}

export interface PayPalNamespace {
  Buttons(options: PayPalButtonsOptions): { render(container: HTMLElement | string): Promise<void>; close?: () => void }
}

declare global {
  interface Window {
    paypal?: PayPalNamespace
  }
}

const SDK_ID = 'paypal-sdk'
let loading: Promise<PayPalNamespace> | null = null

export function paypalClientId(): string | null {
  const id = import.meta.env.VITE_PAYPAL_CLIENT_ID
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export function loadPayPal(clientId: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal)
  if (loading) return loading
  loading = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = SDK_ID
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons&locale=de_DE`
    script.async = true
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal nicht verfügbar')))
    script.onerror = () => {
      loading = null
      script.remove()
      reject(new Error('PayPal konnte nicht geladen werden'))
    }
    document.head.appendChild(script)
  })
  return loading
}
