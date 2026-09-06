const STEPS = [
  {
    n: '01',
    title: 'Bring in the list',
    body: 'Open a Sales Navigator lead search, press Cmd+S (Ctrl+S on Windows) and save the page — or capture it with the extension while you browse. Upload one file or a batch. Duplicates are caught against every list you have uploaded before.',
  },
  {
    n: '02',
    title: 'Research it',
    body: 'Pick what you want to know and Outlio gathers it from public sources: registries and filings, funding rounds, technology in use, hiring signals, recent news, and publicly published contact details. Nothing is guessed.',
  },
  {
    n: '03',
    title: 'Ask, score and export',
    body: 'Ask Hubble a question about any lead and read the answer with its sources. Score the list against your ideal-customer profile. Export to CSV or XLSX when you are ready.',
  },
]

/**
 * Shared between the Lead Engine homepage (as the `#how-it-works` section) and
 * the standalone `/how-it-works` page. Keep the id — the nav links to it.
 */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 bg-sage-soft px-4 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <h2 className="max-w-2xl text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
          Three steps. No setup.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          No credentials, no browser automation, no scraping bot. You bring the
          page; Outlio does the research.
        </p>

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n}>
              <span className="text-[13px] font-bold uppercase tracking-[0.22em] text-accent">
                {s.n}
              </span>
              <h3 className="mt-3 text-2xl font-bold tracking-tight">{s.title}</h3>
              <p className="mt-2.5 text-base leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
