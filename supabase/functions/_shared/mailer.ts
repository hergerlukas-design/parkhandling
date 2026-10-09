// Austauschbare Mail-Schnittstelle für Edge Functions.
// Ein Anbieterwechsel braucht nur eine neue Mailer-Implementierung und eine Zeile in mailerFromEnv().
// Secrets: MAIL_PROVIDER (Standard "resend"), RESEND_API_KEY, MAIL_FROM.

export interface MailMessage {
  to: string[]
  subject: string
  text: string
  replyTo?: string
}

export interface Mailer {
  /** Versendet die Mail; wirft bei einem Fehler des Anbieters. */
  send(message: MailMessage): Promise<void>
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

/** Liefert den konfigurierten Mailer oder null, wenn kein Mail-Dienst eingerichtet ist. */
export function mailerFromEnv(env: { get(key: string): string | undefined }): Mailer | null {
  const provider = env.get('MAIL_PROVIDER') ?? 'resend'
  const from = env.get('MAIL_FROM')
  if (provider === 'resend') {
    const apiKey = env.get('RESEND_API_KEY')
    return apiKey && from ? new ResendMailer(apiKey, from) : null
  }
  return null
}
