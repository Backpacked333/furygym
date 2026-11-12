import type { ReactNode } from "react";

// A small set of line icons for the console sidebar and buttons (24px grid, 1.8 stroke).
const paths: Record<string, ReactNode> = {
  dashboard: <><rect x="3.5" y="3.5" width="7" height="9" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="15.5" width="7" height="5" rx="1.5" /></>,
  builder: <><path d="M4 6h10M4 11h10M4 16h6" /><path d="M15.5 18.5l1-3.5 4.5-4.5 2.5 2.5-4.5 4.5z" transform="translate(-2 -1)" /></>,
  columns: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M9 5v14M15 5v14" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M8.5 3v4M15.5 3v4" /></>,
  people: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.900 1.500 5.500 4.500" /><circle cx="17" cy="8" r="2.300" /><path d="M16.500 13.200c2.200.2 3.600 1.500 4 3.800" /></>,
  run: <><circle cx="14" cy="5" r="1.800" /><path d="M7 12l3-3.500 3.500 1 2 3 3 1M11.500 9.500L9.500 15l3 2.500 1 4M9.500 15l-2 2.500-3.500.5" /></>,
  card: <><rect x="3" y="6" width="18" height="12.500" rx="2.500" /><path d="M3 10.500h18M7 14.500h3" /></>,
  cash: <><rect x="3" y="6.500" width="18" height="11" rx="2" /><circle cx="12" cy="12" r="2.500" /><path d="M6.500 9.500v5M17.500 9.500v5" /></>,
  display: <><rect x="3.500" y="5" width="17" height="11.500" rx="2" /><path d="M9 20h6M12 16.500V20" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1.200" /><rect x="14" y="4" width="6" height="6" rx="1.200" /><rect x="4" y="14" width="6" height="6" rx="1.200" /><path d="M14 14h2.500v2.500H14zM18 17.500h2V20h-2zM14 18.500h2" /></>,
  dumbbell: <><path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.500v2.500M12 18v2.500M3.500 12H6M18 12h2.500M6 6l1.800 1.800M16.200 16.200L18 18M18 6l-1.800 1.800M7.800 16.200L6 18" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  download: <path d="M12 4v11M7.500 11l4.500 4.500L16.500 11M5 19.500h14" />,
  clock: <><circle cx="12" cy="12" r="8.500" /><path d="M12 7.500V12l3 2" /></>,
  check: <path d="M5 12.500l4.500 4.500L19 7.500" />,
  chevronLeft: <path d="M14.500 5.500L8 12l6.500 6.500" />,
  chevronRight: <path d="M9.500 5.500L16 12l-6.500 6.500" />,
  external: <path d="M10 5H6.500A1.500 1.500 0 005 6.500v11A1.500 1.500 0 006.500 19h11a1.500 1.500 0 001.500-1.500V14M14 4.500h5.500V10M19 5l-8 8" />,
  trophy: <><path d="M8 4.500h8V10a4 4 0 01-8 0zM8 6H5v1.500A3 3 0 008 10.500M16 6h3v1.500a3 3 0 01-3 3M12 14v3.500M8.500 20h7" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name]}
    </svg>
  );
}
