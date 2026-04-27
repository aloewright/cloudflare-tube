// Inline SVG icons used as card placeholders + suggestion glyphs.
// Kept in a single file so they can be tree-shaken at the call site
// and ship as part of the eager bundle (each <1KB minified).

type IconProps = {
  className?: string;
  style?: React.CSSProperties;
  // Aspect-ratio container so the placeholder sits where a thumbnail would.
  thumbnail?: boolean;
};

const baseSvg = {
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

function ThumbnailFrame({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '16/9',
        background:
          'linear-gradient(135deg, color-mix(in oklch, var(--card), var(--accent) 6%), color-mix(in oklch, var(--card), var(--border) 25%))',
        borderRadius: 8,
        marginBottom: 'var(--space-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'color-mix(in oklch, var(--card-foreground), transparent 55%)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Generic video placeholder — shown when a video card has no thumbnail. */
export function VideoPlaceholderIcon({ thumbnail = true, className, style }: IconProps): JSX.Element {
  const svg = (
    <svg {...baseSvg} viewBox="0 0 24 24" width="36" height="36" className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
  return thumbnail ? <ThumbnailFrame style={style}>{svg}</ThumbnailFrame> : svg;
}

/** Cloud-up arrow — for "Upload a clip" suggestion card. */
export function UploadIcon({ className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseSvg} viewBox="0 0 24 24" width="28" height="28" className={className} style={style}>
      <path d="M7 18a4 4 0 0 1-.7-7.94 6 6 0 0 1 11.66-1.05A4.5 4.5 0 0 1 18 18" />
      <path d="M12 12v7" />
      <path d="M9 15l3-3 3 3" />
    </svg>
  );
}

/** Film-strip / channel marker — for "Open a channel" suggestion card. */
export function ChannelIcon({ className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseSvg} viewBox="0 0 24 24" width="28" height="28" className={className} style={style}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M3 15h18M8 5v14M16 5v14" />
    </svg>
  );
}

/** Triangle play in a circle — for "Watch something" suggestion card. */
export function PlayIcon({ className, style }: IconProps): JSX.Element {
  return (
    <svg {...baseSvg} viewBox="0 0 24 24" width="28" height="28" className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6l5-3z" fill="currentColor" stroke="none" />
    </svg>
  );
}
