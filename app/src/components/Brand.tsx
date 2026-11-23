/** The W mark whose last stroke rises into a tick (the logo set in ~/Downloads/workos-logo). */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M3 6l3.2 12L10 9l3.6 9 2.4-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 12l2 3 4-7" stroke="var(--acc)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand"><Mark /><span>WorkOS</span></span>
  );
}
