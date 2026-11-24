// Berliner Ortszeit ↔ UTC (gleiche Rechnung wie booking-checkout/logic.ts; dort noch eigene Kopie,
// damit der offene Rechner-PR #42 nicht kollidiert – beim nächsten Umbau dorthin umstellen).

export const TIME_ZONE = 'Europe/Berlin'

/** Wandzeit in Berlin zu einem UTC-Zeitpunkt → Offset in Minuten */
function berlinOffsetMinutes(utcMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
  return (asUtc - utcMs) / 60_000
}

/** Lokale Berliner Zeit (YYYY-MM-DD + HH:MM) → ISO-Zeitpunkt in UTC */
export function berlinToUtcIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const local = Date.UTC(y, m - 1, d, hh, mm)
  let utc = local - berlinOffsetMinutes(local) * 60_000
  utc = local - berlinOffsetMinutes(utc) * 60_000
  return new Date(utc).toISOString()
}
