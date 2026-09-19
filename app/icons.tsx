// Small monochrome line glyphs standing in for emoji — keeps the challenge/
// streak affordances on-brand instead of dropping platform-rendered emoji art
// into an otherwise deliberate visual system.

export function ArenaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 14 12 4M9.3 2 14 2 14 6.7" />
      <path d="M14 14 4 4M6.7 2 2 2 2 6.7" />
    </svg>
  );
}

export function OmensIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 10s2.7-4.1 7.5-4.1 7.5 4.1 7.5 4.1-2.7 4.1-7.5 4.1S2.5 10 2.5 10Z" />
      <circle cx="10" cy="10" r="1.8" />
    </svg>
  );
}

export function RoomsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h14v9H8l-4.5 3v-12Z" />
      <path d="M6.5 8.5h7M6.5 11h4.5" />
    </svg>
  );
}

export function WalletIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5.2A1.7 1.7 0 0 1 4.7 3.5h10.6A1.7 1.7 0 0 1 17 5.2v9.6a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 14.8V5.2Z" />
      <path d="M3 6.5h11.7A2.3 2.3 0 0 1 17 8.8v2.4H13a1.9 1.9 0 1 1 0-3.8h4" />
      <circle cx="13.1" cy="9.3" r=".45" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ProfileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="6.5" r="2.8" />
      <path d="M4.5 16c.7-2.7 2.5-4.1 5.5-4.1s4.8 1.4 5.5 4.1" />
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
