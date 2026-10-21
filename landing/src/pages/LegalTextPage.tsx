import { usePageTitle } from '../components/usePageTitle'
import { AGB_BLOCKS, AGB_VERSION, WIDERRUF_BLOCKS, type LegalBlock } from '../content/legal'
import { WithdrawalForm } from '../components/WithdrawalForm'

const TITLES = { agb: 'Allgemeine Geschäftsbedingungen', widerruf: 'Widerrufsbelehrung' } as const

function Blocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <div className="mt-6 space-y-3 text-[15px] leading-relaxed">
      {blocks.map((b, i) =>
        b.kind === 'h2' ? (
          <h2 key={i} className="mt-8 text-lg font-semibold first:mt-0">
            {b.text}
          </h2>
        ) : b.kind === 'h3' ? (
          <h3 key={i} className="mt-5 font-semibold">
            {b.text}
          </h3>
        ) : (
          <p key={i} className="break-words">
            {b.text}
          </p>
        ),
      )}
    </div>
  )
}

export function LegalTextPage({ kind }: { kind: keyof typeof TITLES }) {
  usePageTitle(TITLES[kind])
  const blocks = kind === 'agb' ? AGB_BLOCKS : WIDERRUF_BLOCKS

  return (
    <article className="mx-auto max-w-3xl px-4 py-10" data-review={`rechtstext-${kind}`} data-review-label={TITLES[kind]}>
      <h1 className="text-3xl font-bold">{TITLES[kind]}</h1>
      <p className="mt-2 text-sm text-ink-soft">Stand: {AGB_VERSION}. Diese Fassung wird Ihnen auch per E-Mail übermittelt.</p>
      {kind === 'widerruf' && <WithdrawalForm />}
      <Blocks blocks={blocks} />
    </article>
  )
}
