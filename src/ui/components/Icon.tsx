import type { SVGProps } from 'react';

const P: Record<string, string> = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  gantt: 'M3 5h8M7 10h10M5 15h7M12 20h9M3 3v18',
  aparato: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  tree: 'M5 4h5v4H5zM14 10h5v4h-5zM14 17h5v4h-5zM7.5 8v11H14M7.5 12H14',
  puesto: 'M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6',
  load: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  bottleneck: 'M3 4h18l-7 8v6l-4 2v-8z',
  compare: 'M7 4v16M17 4v16M3 8h8M13 16h8M3 8l3-3M3 8l3 3M21 16l-3-3M21 16l-3 3',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  import: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .2-1.3-1.3.2-2-3-1-1 2h-1.8l-1-2-3 1 .2 2L6 7.2 4 7 3 10l2 1v1.8l-2 1 1 3 2-.2 1.3 1.3-.2 2 3 1 1-2h1.8l1 2 3-1-.2-2 1.3-1.3 2 .2 1-3-2-1z',
  filter: 'M3 5h18M6 12h12M10 19h4',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  menu: 'M3 6h18M3 12h18M3 18h18',
  x: 'M6 6l12 12M18 6L6 18',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  check: 'M5 12l5 5 9-11',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7.5v.5',
  warning: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6M11 8v6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
};

export function Icon({ name, ...rest }: { name: keyof typeof P | string } & SVGProps<SVGSVGElement>) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name] ?? P.info} />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="5" fill="#2a78d6" />
      <rect x="6" y="8" width="11" height="3.2" rx="1" fill="#fff" />
      <rect x="11" y="14.4" width="13" height="3.2" rx="1" fill="#fff" opacity="0.85" />
      <rect x="9" y="20.8" width="8" height="3.2" rx="1" fill="none" stroke="#fbb38f" strokeWidth="1.4" />
      <path d="M6 6v20" stroke="#cfe1f7" strokeWidth="1.2" />
    </svg>
  );
}
