// Small monochrome line glyphs standing in for emoji — keeps the challenge/
// streak affordances on-brand instead of dropping platform-rendered emoji art
// into an otherwise deliberate visual system.

export function DuelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 14 12 4M9.3 2 14 2 14 6.7" />
      <path d="M14 14 4 4M6.7 2 2 2 2 6.7" />
    </svg>
  );
}

export function FlameIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.4c.7 2.1 2.7 3.3 2.7 5.9a2.7 2.7 0 0 1-5.4 0c0-.8.3-1.4.8-1.9-.2.9.1 1.6.7 1.6.7 0 .9-.8.5-1.6C6.8 4 7.2 2.6 8 1.4Z" />
      <path d="M4.9 9.3A3.1 3.1 0 0 0 8 14.6a3.1 3.1 0 0 0 3.1-5.1" />
    </svg>
  );
}
