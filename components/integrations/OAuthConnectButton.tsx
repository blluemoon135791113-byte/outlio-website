import { ConnectorLogo, type ConnectorLogoName } from '@/components/integrations/ConnectorLogo'

export function OAuthConnectButton({ href, label, logo }: { href: string; label: string; logo: ConnectorLogoName }) {
  return (
    <a href={href} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97]">
      <ConnectorLogo name={logo} className="size-4" />
      {label}
    </a>
  )
}
