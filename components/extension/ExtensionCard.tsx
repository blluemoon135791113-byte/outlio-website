import Image from 'next/image'

import { CHROME_EXTENSION_URL } from '@/app/lib/constants'

/**
 * Dashboard prompt to install the browser extension.
 *
 * Sits in the sidebar above the referral card. Shown whether or not a browser
 * is already connected — a user with Chrome linked may still want it on a
 * second machine — but the copy changes so it does not nag someone who has
 * already installed it.
 */
export function ExtensionCard({ connectedDevices }: { connectedDevices: number }) {
  const connected = connectedDevices > 0

  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-muted">
          <Image
            src="/outlio logo.png"
            alt=""
            width={24}
            height={24}
            className="object-contain"
          />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-[-0.01em] text-ink">
            Get your extension
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {connected
              ? `${connectedDevices} browser${connectedDevices === 1 ? '' : 's'} connected`
              : 'Capture leads as you browse'}
          </p>
        </div>
      </div>

      <p className="mt-3.5 text-xs leading-5 text-muted">
        {connected
          ? 'Add it to another browser, or reconnect one you have disconnected.'
          : 'Skip saving and uploading HTML files. Start a capture, browse the results pages yourself, and leads land here automatically.'}
      </p>

      <a
        href={CHROME_EXTENSION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="product-gradient mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3.5 text-xs font-semibold text-white transition-[filter] duration-150 hover:brightness-95"
      >
        {connected ? 'Add to another browser' : 'Download the extension'}
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 10h11M11 5l5 5-5 5" />
        </svg>
      </a>

      <p className="mt-2.5 text-center text-[11px] text-muted">
        Chrome · free with your plan
      </p>
    </section>
  )
}
