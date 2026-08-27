import Link from "next/link";

const SITE_MAP = [
  { title: "Home", href: "/" },
  { title: "Explainers", href: "/explainers" },
  { title: "How It Works", href: "/how" },
  { title: "Pricing", href: "/leadengine/pricing" },
  { title: "Terms", href: "/terms" },
  { title: "Privacy", href: "/privacy" },
];

const WHERE_TO_LOOK = [
  { title: "Homepage", href: "/" },
  { title: "Documentation", href: "/" },
  { title: "Contact", href: "mailto:husnain@outlio.io" },
];

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-16 text-[var(--foreground)]">
      <section className="w-full max-w-xl rounded-[2rem] border border-black/5 bg-white/70 p-8 text-center shadow-[10px_10px_24px_rgba(149,137,116,0.16),-10px_-10px_24px_rgba(255,255,255,0.8)] backdrop-blur-xl sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-black/45">
          Error 404
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          This page wandered off.
        </h1>
        <p className="mx-auto mt-5 max-w-md text-base leading-7 text-black/60">
          The address may have changed, or the page may no longer exist. Your
          workspace and saved research are unaffected.
        </p>

        <h2 className="mt-8 text-xl font-medium tracking-tight text-black">Site Map</h2>
        <ul className="mt-4 space-y-2 text-left max-w-md mx-auto">
          {SITE_MAP.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="text-ink/80 hover:text-ink transition">
                {item.title}
              </a>
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-xl font-medium tracking-tight text-black">Where to Look Next</h2>
        <ul className="mt-4 space-y-2 text-left max-w-md mx-auto">
          {WHERE_TO_LOOK.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="text-ink/80 hover:text-ink transition">
                {item.title}
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="rounded-2xl border border-black/10 bg-white/70 px-6 py-3 text-sm font-semibold transition hover:bg-white"
          >
            Go to homepage
          </Link>
          <Link
            href="/dashboard"
            className="rounded-2xl bg-black px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/80"
          >
            Return to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}