'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

import { ProductIcon, ProductNav } from '@/components/product/ProductNav'
import { NavigationProgress } from '@/components/product/NavigationProgress'
import { SidebarReferral } from '@/components/product/SidebarReferral'
import { signOutAction } from '@/lib/auth/actions'

function pageLabel(pathname: string) {
  if (pathname.startsWith('/admin')) return 'User administration'
  if (pathname.startsWith('/crm/contacts')) return 'Contacts'
  if (pathname.startsWith('/crm/pipeline')) return 'Pipeline'
  if (pathname.startsWith('/crm/reports')) return 'Reports'
  if (pathname.startsWith('/crm')) return 'CRM'
  if (pathname.startsWith('/dashboard/extract/new')) return 'New extraction'
  if (pathname.startsWith('/dashboard/jobs')) return 'Extraction workspace'
  if (pathname.startsWith('/dashboard/intelligence')) return 'Intelligence'
  if (pathname.startsWith('/dashboard/access')) return 'Access status'
  if (pathname.startsWith('/dashboard/settings')) return 'Settings'
  return 'Overview'
}

function initials(name: string | null, email: string) {
  const source = name?.trim() || email.split('@')[0] || 'O'
  const parts = source.split(/\s+/).filter(Boolean)
  return `${parts[0]?.[0] ?? 'O'}${parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''}`.toUpperCase()
}

function SidebarContent({
  isAdmin,
  canUseScraper,
  showCrm,
  showEmail,
  referralLink,
  onNavigate,
}: {
  isAdmin: boolean
  canUseScraper: boolean
  showCrm: boolean
  showEmail: boolean
  /** `null` until a profile has a code allocated. */
  referralLink: string | null
  onNavigate?: () => void
}) {
  return (
    <>
      <div className="px-5 pb-8 pt-6">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="inline-flex items-center gap-2.5 rounded-lg text-ink focus-visible:outline-offset-4"
        >
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-ink">
            <Image
              src="/icon.png"
              alt=""
              width={32}
              height={32}
              style={{ width: 32, height: 32 }}
            />
          </span>
          <span className="font-heading text-[16px] font-semibold tracking-[-0.025em]">
            Outlio
          </span>
        </Link>
      </div>

      <div className="flex-1 px-3">
        <ProductNav
          isAdmin={isAdmin}
          canUseScraper={canUseScraper}
          showCrm={showCrm}
          showEmail={showEmail}
          onNavigate={onNavigate}
        />
      </div>

      {referralLink ? (
        <div className="px-3 pb-2 pt-2">
          <SidebarReferral link={referralLink} onNavigate={onNavigate} />
        </div>
      ) : null}

      <div className="px-3 pb-5 pt-2">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.98]"
        >
          <ProductIcon name="website" className="h-[18px] w-[18px]" />
          Back to website
        </Link>
      </div>
    </>
  )
}

export function ProductShell({
  children,
  email,
  fullName,
  planName,
  isAdmin,
  canUseScraper,
  showCrm = false,
  showEmail = false,
  avatarUrl,
  referralLink = null,
}: {
  children: ReactNode
  email: string
  fullName: string | null
  planName: string | null
  isAdmin: boolean
  canUseScraper: boolean
  showCrm?: boolean
  showEmail?: boolean
  avatarUrl?: string | null
  referralLink?: string | null
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const userInitials = useMemo(() => initials(fullName, email), [email, fullName])
  const displayName = fullName?.trim() || email.split('@')[0] || 'Outlio user'
  return (
    <div className="app-shell product-clay hubble-shell min-h-dvh bg-app text-ink">
      <NavigationProgress />
      <aside className="hubble-nav-panel fixed inset-y-0 left-0 z-30 hidden w-[216px] flex-col border-0 lg:flex">
        <SidebarContent
          isAdmin={isAdmin}
          canUseScraper={canUseScraper}
          showCrm={showCrm}
          showEmail={showEmail}
          referralLink={referralLink}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-ink/25"
          />
          <aside className="hubble-nav-panel relative flex h-full w-[min(86vw,280px)] flex-col border-0 shadow-[var(--shadow-lg)]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-4 top-5 flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-muted hover:text-ink active:scale-[0.96]"
              aria-label="Close navigation"
            >
              <span className="text-xl leading-none">×</span>
            </button>
            <SidebarContent
              isAdmin={isAdmin}
              canUseScraper={canUseScraper}
              showCrm={showCrm}
              showEmail={showEmail}
              referralLink={referralLink}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="min-h-dvh lg:pl-[216px]">
        <header className="sticky top-0 z-20 border-0 bg-app px-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-muted hover:text-ink active:scale-[0.96] lg:hidden"
                aria-label="Open navigation"
                aria-expanded={mobileOpen}
              >
                <span aria-hidden className="space-y-1">
                  <span className="block h-px w-4 bg-current" />
                  <span className="block h-px w-4 bg-current" />
                  <span className="block h-px w-4 bg-current" />
                </span>
              </button>
              <div className="min-w-0">
                <p className="truncate font-heading text-sm font-semibold tracking-[-0.015em] text-ink">
                  {pageLabel(pathname)}
                </p>
                <p className="hidden truncate text-[11px] text-muted sm:block">
                  Outlio Lead Engine{planName ? ` · ${planName}` : ''}
                </p>
              </div>
            </div>

            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-xl p-1.5 pr-2 transition-[background-color,transform] duration-150 hover:bg-surface-muted active:scale-[0.98] [&::-webkit-details-marker]:hidden">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft bg-cover bg-center font-heading text-xs font-bold text-accent ring-1 ring-accent/15"
                  style={avatarUrl ? { backgroundImage: `url(${JSON.stringify(avatarUrl).slice(1, -1)})` } : undefined}
                >
                  {avatarUrl ? null : userInitials}
                </span>
                <span className="hidden max-w-44 text-left sm:block">
                  <span className="block truncate font-heading text-xs font-semibold text-ink">
                    {displayName}
                  </span>
                  <span className="block truncate text-[10px] text-muted">{email}</span>
                </span>
                <span aria-hidden className="hidden text-xs text-muted transition-transform duration-150 group-open:rotate-180 sm:inline">
                  ▾
                </span>
              </summary>
              <div className="absolute right-0 top-[calc(100%+8px)] w-64 origin-top-right rounded-xl border-0 bg-panel p-2 shadow-[var(--shadow-lg)]">
                <div className="border-b border-border px-2 py-2">
                  <p className="truncate font-heading text-sm font-semibold text-ink">{displayName}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">{email}</p>
                </div>
                <Link
                  href="/dashboard/settings"
                  className="mt-1 flex h-9 items-center rounded-lg px-2 text-sm font-medium text-muted transition-colors duration-150 hover:bg-accent-soft/60 hover:text-accent"
                >
                  Settings
                </Link>
                <Link
                  href="/"
                  className="flex h-9 items-center rounded-lg px-2 text-sm font-medium text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
                >
                  Visit Outlio website
                </Link>
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="flex h-9 w-full items-center rounded-lg px-2 text-left text-sm font-medium text-muted transition-colors duration-150 hover:bg-danger-soft hover:text-danger"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}
