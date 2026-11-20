import type { SVGProps } from 'react'
import { Icon } from '../components/Icon'

export type LabIconName =
  | Parameters<typeof Icon>[0]['name']
  | 'clock'
  | 'database'
  | 'cloud'
  | 'key'
  | 'bell'
  | 'refresh'
  | 'check-circle'
  | 'hard-drive'

interface LabIconProps extends SVGProps<SVGSVGElement> {
  name: LabIconName
  size?: number
}

const EXTRA_PATHS: Record<
  Exclude<LabIconName, Parameters<typeof Icon>[0]['name']>,
  React.ReactNode
> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </>
  ),
  cloud: (
    <path d="M17.5 19H7a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 17.3 9.5a3.5 3.5 0 0 1 .2 9.5Z" />
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m11 12 8.5-8.5M16 7l2.5 2.5M18.5 4.5 21 7" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8.5-3 8.5h18S18 15 18 8Z" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  'hard-drive': (
    <>
      <path d="M22 12H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      <path d="M6 16h.01M10 16h.01" />
    </>
  ),
}

export function LabIcon({ name, size = 20, ...props }: LabIconProps) {
  if (name in EXTRA_PATHS) {
    const extraName = name as keyof typeof EXTRA_PATHS
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {EXTRA_PATHS[extraName]}
      </svg>
    )
  }

  return <Icon name={name as Parameters<typeof Icon>[0]['name']} size={size} {...props} />
}
