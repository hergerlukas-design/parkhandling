// Minimaler PayPal-REST-Client (Orders v2). Läuft nur serverseitig: Client-ID und Secret
// kommen aus Edge-Function-Secrets und landen nie im Browser.
//  Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV ("sandbox" | "live", Standard sandbox)

export interface PayPalConfig {
  clientId: string
  clientSecret: string
  env: 'sandbox' | 'live'
}

export function paypalConfigFromEnv(env: { get(key: string): string | undefined }): PayPalConfig | null {
  const clientId = env.get('PAYPAL_CLIENT_ID')
  const clientSecret = env.get('PAYPAL_CLIENT_SECRET')
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, env: env.get('PAYPAL_ENV') === 'live' ? 'live' : 'sandbox' }
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
  }
}

export interface PayPalCapture {
  orderId: string
  status: string
  captureId: string | null
  captureStatus: string | null
  amount: string | null
  currency: string | null
}

export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null

  constructor(
    private readonly config: PayPalConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private get base(): string {
    return this.config.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value
    const res = await this.fetchFn(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.access_token) throw new PayPalError('PayPal-Anmeldung fehlgeschlagen', res.status, body)
    this.token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3000) * 1000 }
    return body.access_token
  }

  private async request(path: string, init: RequestInit & { idempotencyKey?: string }): Promise<unknown> {
    const token = await this.accessToken()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    if (init.idempotencyKey) headers['PayPal-Request-Id'] = init.idempotencyKey
    const res = await this.fetchFn(`${this.base}${path}`, { ...init, headers })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new PayPalError(`PayPal ${res.status}`, res.status, body)
    return body
  }

  /** Legt eine Bestellung mit festem Betrag an und liefert die Order-ID. */
  async createOrder(args: {
    referenceId: string
    amount: number
    currency: 'EUR'
    description: string
  }): Promise<string> {
    const body = (await this.request('/v2/checkout/orders', {
      method: 'POST',
      idempotencyKey: `order-${args.referenceId}`,
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: args.referenceId,
            custom_id: args.referenceId,
            description: args.description.slice(0, 127),
            amount: { currency_code: args.currency, value: args.amount.toFixed(2) },
          },
        ],
      }),
    })) as { id?: string }
    if (!body?.id) throw new PayPalError('PayPal hat keine Bestell-ID geliefert', 502, body)
    return body.id
  }

  /** Erfasst die Zahlung. Der Aufrufer prüft Status und Betrag. */
  async captureOrder(orderId: string): Promise<PayPalCapture> {
    const body = (await this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      idempotencyKey: `capture-${orderId}`,
      body: '{}',
    })) as {
      id?: string
      status?: string
      purchase_units?: { payments?: { captures?: { id?: string; status?: string; amount?: { value?: string; currency_code?: string } }[] } }[]
    }
    const capture = body?.purchase_units?.[0]?.payments?.captures?.[0]
    return {
      orderId: body?.id ?? orderId,
      status: body?.status ?? 'UNKNOWN',
      captureId: capture?.id ?? null,
      captureStatus: capture?.status ?? null,
      amount: capture?.amount?.value ?? null,
      currency: capture?.amount?.currency_code ?? null,
    }
  }
}
