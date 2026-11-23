/**
 * The sheet's stamp: one drawn mark. An uneven double rule, dry-ink breaks from a mask and the sheet name in Bricolage
 * on two lines, with the tilt drawn into the paths rather than added by CSS. No clock: the phone already shows the time (F19).
 */
export function Stamp({ name }: { name: string }) {
  const [a, b] = name.toUpperCase().split(' ');
  return (
    <span className="stamp" role="img" aria-label={name} data-testid="stamp">
      <svg viewBox="0 0 136 56" width="136" height="56" aria-hidden focusable="false">
        <defs>
          <mask id="stamp-ink" maskUnits="userSpaceOnUse" x="0" y="0" width="136" height="56">
            <rect width="136" height="56" fill="#fff" />
            <g fill="#000">
              <rect x="22" y="3" width="7" height="3.2" rx="1.4" />
              <rect x="88" y="48.6" width="11" height="3" rx="1.4" />
              <rect x="128" y="18" width="3" height="6" rx="1.4" />
              <rect x="5" y="33" width="3" height="5" rx="1.4" />
              <circle cx="61" cy="9" r="0.9" /><circle cx="104" cy="41" r="0.8" /><circle cx="37" cy="44" r="0.7" />
              <rect x="70" y="27.4" width="4" height="1.1" rx="0.5" />
            </g>
          </mask>
        </defs>
        <g transform="rotate(-2.6 68 28)" mask="url(#stamp-ink)" fill="none" stroke="currentColor">
          <path d="M6.5 6.2 C40 4.6 96 4.9 129.6 5.8 C130.8 20 130.6 35 129.9 49.6 C96 51.2 40 51 6.1 50.1 C5.2 35 5.4 20 6.5 6.2 Z" strokeWidth="2" strokeLinejoin="round" />
          <path d="M10.4 10 C44 8.9 92 9.2 125.7 9.8 C126.5 21.6 126.4 34 125.9 45.9 C92 47.2 44 47 10.1 46.2 C9.5 34 9.6 21.6 10.4 10 Z" strokeWidth="0.9" strokeLinejoin="round" />
          <text x="68" y="25" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="'Bricolage Grotesque', sans-serif" fontWeight="600" fontSize="13" letterSpacing="1.6">{a}</text>
          <path d="M30 30 H106" strokeWidth="0.7" strokeDasharray="1.5 2.2" />
          <text x="68" y="42.5" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="'Bricolage Grotesque', sans-serif" fontWeight="600" fontSize="11" letterSpacing="2.4">{b ?? ''}</text>
        </g>
      </svg>
    </span>
  );
}
