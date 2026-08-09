import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Unauthenticated page shell.
 *
 * Per docs/DESIGN_TOKENS.md §8, the hero aurora treatment is permitted HERE and
 * only here — sign-in, sign-up, verify-email, reset-password. Authenticated
 * dashboard surfaces use flat backgrounds so data stays legible.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-paper px-4 py-12">
      <div className="hero-aurora pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative w-full max-w-md">
        <Link href="/" className="mx-auto mb-7 flex w-fit rounded-2xl focus-visible:outline-offset-4">
          <Image
            src="/icon.png"
            alt="Outlio home"
            width={54}
            height={54}
            priority
            className="rounded-2xl shadow-[0_12px_34px_rgba(107,70,193,0.18)]"
          />
        </Link>

        <div className="auth-glass-card rounded-[22px] border border-white/75 p-7 shadow-[0_24px_80px_rgba(98,70,170,0.15)] sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>
          ) : null}

          <div className="mt-6">{children}</div>
        </div>

        {footer ? (
          <div className="mt-6 text-center text-sm text-muted">{footer}</div>
        ) : null}
      </div>
    </main>
  )
}
