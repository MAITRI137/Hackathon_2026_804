/**
 * The product mark.
 *
 * Drawn as an application tile in the same family as the other suite icons:
 * a rounded square, a single vivid gradient, and one white glyph — a person,
 * the pay they are owed, and the 360 cycle that returns every month.
 */
export function BrandMark({ size = 30, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="brand-mark-svg"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id="ppTile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d94c6" />
          <stop offset="1" stopColor="#1b5e87" />
        </linearGradient>
        <linearGradient id="ppSheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".26" />
          <stop offset=".55" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#ppTile)" />
      <rect width="64" height="64" rx="15" fill="url(#ppSheen)" />
      <path
        d="M32 12.5a19.5 19.5 0 1 1-13.8 5.7"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".55"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="18.2" cy="18.2" r="3.1" fill="#ffffff" />
      <circle cx="32" cy="26.5" r="6.4" fill="#ffffff" />
      <path
        d="M20 46.5c0-6.5 5.4-11 12-11s12 4.5 12 11v.8a1 1 0 0 1-1 1H21a1 1 0 0 1-1-1z"
        fill="#ffffff"
      />
      <path d="M26.5 41.5h11M26.5 45h11" stroke="#1b5e87" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
