import Link from "next/link";

// Moon-orb mark + lowercase wordmark, shared by the desktop and phone headers.
// The orb's gradient and glow live in CSS (.brand-mark) so the SVG needs no
// ids; a gradient id inside the hidden header copy would blank the other one.
export function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M9.28 5.55A7 7 0 1 0 18.45 14.72A6.5 6.5 0 0 1 9.28 5.55Z" fill="currentColor" />
        </svg>
      </span>
      <span className="brand-word">prophecy</span>
    </Link>
  );
}
