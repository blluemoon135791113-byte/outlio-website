import Image from 'next/image'
import Link from 'next/link'

const metrics = [
  { label: 'Credits remaining', value: '994', note: '1,000 included', featured: true, width: '99.4%' },
  { label: 'Extractions today', value: '4', note: 'Unlimited allowance', width: '28%' },
  { label: 'This month', value: '4', note: 'Unlimited allowance', width: '28%' },
  { label: 'Records this month', value: '128', note: 'Unlimited allowance', width: '42%' },
  { label: 'Exports this month', value: '4', note: 'Unlimited allowance', width: '28%' },
]

export function DashboardPreview() {
  return (
    <section id="product-preview" className="relative scroll-mt-20 overflow-hidden bg-[linear-gradient(180deg,var(--paper)_0%,var(--cream)_100%)] px-4 pb-20 pt-8 sm:pb-28 sm:pt-12">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-accent">
            Inside Lead Engine
          </p>
          <h2 className="mt-3 text-3xl font-bold uppercase leading-tight tracking-tight sm:text-4xl">
            Everything in one workspace
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted">
            See your credits, extraction activity, files, account access, and subscription the moment you sign in.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-[20px] border border-accent/15 bg-white shadow-[0_28px_80px_rgba(80,55,140,0.14)] sm:mt-12">
          <div className="flex h-10 items-center gap-1.5 border-b border-border bg-[#fcfbff] px-4">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff8a80]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffd180]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#8bd3a8]" />
            <span className="mx-auto -translate-x-5 text-[10px] font-medium tracking-wide text-muted/70">
              app.outlio.io
            </span>
          </div>

          <div className="grid min-h-[520px] bg-app md:grid-cols-[180px_minmax(0,1fr)] lg:min-h-[610px] lg:grid-cols-[205px_minmax(0,1fr)]">
            <aside className="hidden border-r border-border bg-panel md:flex md:flex-col">
              <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
                <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-ink">
                  <Image src="/icon.png" alt="" width={32} height={32} />
                </span>
                <span className="font-heading text-sm font-semibold tracking-tight">Outlio</span>
              </div>
              <div className="px-3 py-7">
                <p className="px-3 text-[9px] font-semibold uppercase tracking-[0.17em] text-muted/65">Workspace</p>
                <nav aria-label="Dashboard preview" className="mt-3 space-y-1 text-[12px]">
                  <PreviewNav active icon="⊞">Overview</PreviewNav>
                  <PreviewNav icon="↓">New extraction</PreviewNav>
                  <PreviewNav icon="◷">Extractions</PreviewNav>
                  <PreviewNav icon="⚙">Settings</PreviewNav>
                </nav>
              </div>
              <div className="mt-auto border-t border-border px-4 py-5 text-[11px] font-medium text-muted">
                <span className="mr-2">◎</span> Back to website
              </div>
            </aside>

            <div className="min-w-0">
              <header className="flex h-16 items-center justify-between border-b border-border bg-panel px-4 sm:px-6">
                <div>
                  <p className="font-heading text-xs font-semibold text-ink">Overview</p>
                  <p className="mt-0.5 text-[9px] text-muted">Outlio Lead Engine · Professional</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[10px] font-bold text-accent">AM</span>
                  <span className="hidden text-[10px] font-semibold text-ink sm:block">Alex Morgan</span>
                </div>
              </header>

              <div className="p-4 sm:p-6 lg:p-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">Lead Engine</p>
                    <h3 className="mt-1 font-heading text-2xl font-semibold tracking-[-0.035em] text-ink">Overview</h3>
                    <p className="mt-1 text-[11px] text-muted">Your usage, account, and next extraction in one place.</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="hidden h-9 items-center rounded-lg border border-border-strong bg-white px-3 text-[10px] font-semibold sm:inline-flex">View extractions</span>
                    <span className="product-gradient inline-flex h-9 items-center rounded-lg px-3 text-[10px] font-semibold text-white">+&nbsp; New extraction</span>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-5">
                  {metrics.map((metric, index) => (
                    <PreviewMetric key={metric.label} {...metric} className={index === 4 ? 'hidden lg:block' : index === 3 ? 'hidden sm:block' : ''} />
                  ))}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(210px,0.55fr)]">
                  <div className="relative min-h-[220px] overflow-hidden rounded-xl border border-border bg-panel p-5 shadow-[var(--shadow-sm)] sm:min-h-[260px]">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-base text-accent">↗</span>
                    <h4 className="mt-7 font-heading text-lg font-semibold tracking-tight text-ink">Build your next lead list</h4>
                    <p className="mt-2 max-w-lg text-[11px] leading-5 text-muted">
                      Upload the lead-search pages you already saved. Outlio removes duplicates and prepares a clean CSV.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <span className="product-gradient inline-flex h-9 items-center rounded-lg px-3.5 text-[10px] font-semibold text-white">Start an extraction</span>
                      <span className="inline-flex h-9 items-center rounded-lg border border-border px-3.5 text-[10px] font-semibold text-ink">Open workspace</span>
                    </div>
                    <div aria-hidden className="absolute -bottom-20 -right-14 h-52 w-52 rounded-full border-[34px] border-accent-soft/70" />
                  </div>

                  <div className="hidden space-y-3 lg:block">
                    <div className="rounded-xl border border-border bg-panel p-4 shadow-[var(--shadow-sm)]">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">Account</p>
                          <p className="mt-1 text-sm font-semibold text-ink">Current access</p>
                        </div>
                        <span className="rounded-full bg-accent-soft px-2 py-1 text-[9px] font-semibold text-accent">Active</span>
                      </div>
                      <dl className="mt-4 divide-y divide-border text-[10px]">
                        <PreviewRow label="Plan" value="Professional" />
                        <PreviewRow label="Account" value="alex@demo.outlio.io" />
                        <PreviewRow label="Access" value="Active subscription" />
                      </dl>
                    </div>
                    <div className="rounded-xl border border-accent/15 bg-[linear-gradient(145deg,#fbf9ff,#f0eaff)] p-4">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-accent">Subscription</p>
                      <p className="mt-2 text-sm font-semibold text-ink">Professional</p>
                      <p className="mt-1 text-[10px] text-muted">Active · Monthly</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-7 flex justify-center">
          <Link href="/sign-up" className="inline-flex items-center gap-2 text-sm font-semibold text-ink underline decoration-accent/35 decoration-2 underline-offset-4 transition-[color,transform] duration-150 ease-out hover:text-accent active:scale-[0.97]">
            Get your workspace <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}

function PreviewNav({ children, icon, active = false }: { children: React.ReactNode; icon: string; active?: boolean }) {
  return <div className={active ? 'flex h-9 items-center gap-3 rounded-lg bg-accent-soft px-3 font-semibold text-accent' : 'flex h-9 items-center gap-3 rounded-lg px-3 font-medium text-muted'}><span className="w-4 text-center text-sm">{icon}</span>{children}</div>
}

function PreviewMetric({ label, value, note, featured = false, width, className = '' }: { label: string; value: string; note: string; featured?: boolean; width: string; className?: string }) {
  return <article className={`${className} min-h-[135px] rounded-xl border p-3.5 ${featured ? 'product-gradient border-accent/20 text-white shadow-[var(--shadow-md)]' : 'border-border bg-panel shadow-[var(--shadow-sm)]'}`}><p className={featured ? 'text-[9px] font-medium text-white/75' : 'text-[9px] font-medium text-muted'}>{label}</p><p className="mt-4 font-heading text-2xl font-semibold leading-none tracking-[-0.04em]">{value}</p><div className={featured ? 'mt-5 h-1 rounded-full bg-white/25' : 'mt-5 h-1 rounded-full bg-surface-muted'}><div className={featured ? 'h-full rounded-full bg-white' : 'h-full rounded-full bg-accent'} style={{ width }} /></div><p className={featured ? 'mt-2 text-[8px] text-white/70' : 'mt-2 text-[8px] text-muted'}>{note}</p></article>
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return <div className="py-2.5 first:pt-0 last:pb-0"><dt className="text-muted">{label}</dt><dd className="mt-0.5 truncate font-semibold text-ink">{value}</dd></div>
}
