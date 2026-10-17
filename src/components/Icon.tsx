import type { SVGProps } from 'react'

type IconName = 'sparkles' | 'grid' | 'arrow-up-right' | 'arrow-right' | 'chevron-down' | 'settings' | 'image' | 'download' | 'trash' | 'close' | 'check' | 'copy' | 'eye' | 'eye-off' | 'plus' | 'arrow-left' | 'folder' | 'loader' | 'shield' | 'sliders' | 'banana'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

const paths: Record<IconName, React.ReactNode> = {
  sparkles: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" /><path d="M20 2v4M18 4h4" /></>,
  grid: <><rect x="3.5" y="3.5" width="6" height="6" rx="1.5" /><rect x="14.5" y="3.5" width="6" height="6" rx="1.5" /><rect x="3.5" y="14.5" width="6" height="6" rx="1.5" /><rect x="14.5" y="14.5" width="6" height="6" rx="1.5" /></>,
  'arrow-up-right': <path d="M6 18 18 6M6 6h12v12" />,
  'arrow-right': <path d="M4 12h16m-6-6 6 6-6 6" />,
  'arrow-left': <path d="M20 12H4m6-6-6 6 6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  settings: <><path d="m9 3-.5 3-2.5 1-2.5-1.5L1.5 9l2.5 2v2l-2.5 2 2 3.5L6 17l2.5 1 .5 3h4l.5-3 2.5-1 2.5 1.5 2-3.5-2.5-2v-2l2.5-2-2-3.5L16 7l-2.5-1-.5-3Z" /><circle cx="11" cy="12" r="3" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="m3 3 18 18M10 5.2a13 13 0 0 1 2-.2c6.5 0 10 7 10 7a18 18 0 0 1-3 4M6 6C3.5 8.3 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  loader: <path d="M21 12a9 9 0 1 1-9-9" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  sliders: <><path d="M4 7h7m4 0h5M4 17h3m4 0h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  banana: <><path d="M18 3c2 8-3 15-12 14C11 23 23 17 21 7l-1-4Z" /><path d="M18 3c0 6-5 10-12 10l-2 2 2 2M17 5l-1-2" /></>,
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
