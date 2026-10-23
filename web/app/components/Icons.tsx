// Inline SVG icons: 24 px grid, 1.5 px stroke, round caps (SPEC §14.4). Decorative: the text beside each one carries the meaning.
import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const PlayIcon = () => <Svg><path d="M7 5v14l11-7z" /></Svg>;

export const MicIcon = () => (
  <Svg>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

export const CheckIcon = () => <Svg><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;

export const XIcon = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>;

export const AlertIcon = () => (
  <Svg>
    <path d="M12 3.5L2.5 20h19z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Svg>
);
