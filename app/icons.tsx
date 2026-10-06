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

// "Live in the Arena" header sigil: a triangle holding a smaller one (⟁).
export function ArenaSigilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 14.6 13.8H1.4L8 1.8Z" />
      <path d="M8 7.6 10.6 12.2H5.4L8 7.6Z" />
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

// A small temple: pediment, three columns, plinth.
export function SanctumIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7.5 10 3l7.5 4.5h-15Z" />
      <path d="M5 10v4.5M10 10v4.5M15 10v4.5" />
      <path d="M3 17h14" />
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

export function ForYouIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 9 10 3.5 16.5 9v7.5h-4.2v-4.6H7.7v4.6H3.5V9Z" />
    </svg>
  );
}

export function FollowingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="7" r="2.6" />
      <path d="M2.8 16c.5-2.6 2.4-4.1 4.7-4.1s4.2 1.5 4.7 4.1" />
      <path d="M13 4.6a2.5 2.5 0 0 1 0 4.8M14.6 11.9c1.4.5 2.3 1.8 2.6 4.1" />
    </svg>
  );
}

export function LiveCallsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 10.5h3l2-5 3 9 2-6 1.5 2h3.5" />
    </svg>
  );
}

export function BookmarkIcon({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 3.5h9v13L10 13.2l-4.5 3.3v-13Z" />
    </svg>
  );
}

export function SwapIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h11.5M12.5 3.5 16 7l-3.5 3.5" />
      <path d="M16 13H4.5M7.5 9.5 4 13l3.5 3.5" />
    </svg>
  );
}

export function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3 3 9.2l6 2.3 2.3 6L17 3Z" />
      <path d="M17 3 9.3 11.5" />
    </svg>
  );
}

export function DepositIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3v9.5M6 9l4 4 4-4" />
      <path d="M3.5 14.5v1.3A1.2 1.2 0 0 0 4.7 17h10.6a1.2 1.2 0 0 0 1.2-1.2v-1.3" />
    </svg>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.3 7V5a2.7 2.7 0 0 1 5.4 0v2" />
    </svg>
  );
}

// Zigzag price line — a stock-chart glyph for trade actions (Copy trade).
export function TrendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 12 4.5 7.5 7 9.5 10 4.5 12.2 7 14.5 3" />
    </svg>
  );
}

// Nested triangles — the Omen Clash mark.
export function ClashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 14.6 13.6H1.4Z" />
      <path d="M8 6.6 11 12H5Z" />
    </svg>
  );
}

// Post action row (app/PostCard.tsx): like → comment → vouch → defy, then bookmark.
export function HeartIcon({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 16.6 3.9 10.6a3.8 3.8 0 0 1 5.4-5.4l.7.7.7-.7a3.8 3.8 0 0 1 5.4 5.4L10 16.6Z" />
    </svg>
  );
}

export function CommentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.2 4h11.6c.9 0 1.7.8 1.7 1.7v7.1c0 .9-.8 1.7-1.7 1.7H9.4L5.8 17.4v-2.9H4.2c-.9 0-1.7-.8-1.7-1.7V5.7C2.5 4.8 3.3 4 4.2 4Z" />
    </svg>
  );
}

// Vouch: a seal with a check — "I stand behind this omen".
export function VouchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.5 16 5v4.4c0 3.7-2.6 6.6-6 8.1-3.4-1.5-6-4.4-6-8.1V5l6-2.5Z" />
      <path d="m7.2 9.9 2 2 3.6-3.9" />
    </svg>
  );
}

// Defy: crossed swords — reposting while betting against it.
export function DefyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 3.5h2.8l7.4 7.4M3.5 3.5v2.8l7.4 7.4M11.2 15.6l4.4-4.4M13.2 13.6l3 3" />
      <path d="M16.5 3.5h-2.8l-3 3M16.5 3.5v2.8l-3 3M8.8 15.6l-4.4-4.4M6.8 13.6l-3 3" />
    </svg>
  );
}

// Circle-slash for "Not interested in …".
export function NotInterestedIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" />
      <path d="m5.4 5.4 9.2 9.2" />
    </svg>
  );
}

export function BackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 10H4M9 5l-5 5 5 5" />
    </svg>
  );
}
