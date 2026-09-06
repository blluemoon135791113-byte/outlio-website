import Image from 'next/image'
import {
  siGoogledrive,
  siGooglesheets,
} from 'simple-icons'

import clayLogo from '@/app/clay-transparent.png'
import ghlLogo from '@/app/gohighlevel.png'

export type ConnectorLogoName =
  | 'clay'
  | 'google_sheets'
  | 'google_drive'
  | 'csv'
  | 'ghl'

const simpleIcons = {
  google_sheets: siGooglesheets,
  google_drive: siGoogledrive,
} as const

export function ConnectorLogo({
  name,
  className = 'size-5',
}: {
  name: ConnectorLogoName
  className?: string
}) {
  if (name in simpleIcons) {
    const icon = simpleIcons[name as keyof typeof simpleIcons]
    return (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className={className}
        fill={`#${icon.hex}`}
      >
        <path d={icon.path} />
      </svg>
    )
  }

  if (name === 'clay' || name === 'ghl') {
    const src = name === 'clay' ? clayLogo : ghlLogo
    return (
      <Image
        aria-hidden
        src={src}
        alt=""
        className={`${className} object-contain`}
      />
    )
  }

  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <path fill="#16A34A" d="M5 2h10l4 4v16H5z" />
      <path fill="#fff" d="M15 2v5h5M8 11h8v2H8zm0 4h8v2H8z" />
    </svg>
  )
}
