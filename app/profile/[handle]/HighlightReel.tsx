"use client";

import { signedPct } from "@/app/lib/calls";
import { ASSET_META, MAX_PINS, type Highlight } from "@/app/lib/profileTraits";

// Up to three pinned wins above the profile tabs, each wearing the gold
// ✦ Fulfilled chip of a fulfilled call (.market-call[data-state="fulfilled"]).
// Mock traders' reels are pinned omens; on your own profile they're won Arena
// matches, with Unpin on each card and empty slots pointing at the Matches tab.

const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usdCents.format(Math.abs(n))}`;

type HighlightReelProps = {
  highlights: Highlight[];
  // Own profile only.
  onUnpin?: (id: string) => void;
  pendingId?: string | null;
};

export function HighlightReel({ highlights, onUnpin, pendingId }: HighlightReelProps) {
  const editable = Boolean(onUnpin);
  if (highlights.length === 0 && !editable) return null;
  const emptySlots = editable ? MAX_PINS - highlights.length : 0;

  return (
    <section className="profile-reel" aria-label="Highlight reel">
      <div className="profile-reel-head">
        <span className="eyebrow">✦ Highlight reel</span>
        {editable && (
          <span className="muted">
            {highlights.length}/{MAX_PINS} pinned
          </span>
        )}
      </div>
      <ol className="profile-reel-list">
        {highlights.map((highlight) => {
          const meta = ASSET_META[highlight.asset];
          return (
            <li key={highlight.id} className="profile-reel-card">
              <div className="profile-reel-top">
                <span className="profile-reel-chip">✦ Fulfilled</span>
                <span className="muted">{highlight.date}</span>
              </div>
              {highlight.kind === "omen" ? (
                <p className="profile-reel-text">“{highlight.text}”</p>
              ) : (
                <p className="profile-reel-text">
                  <strong>vs {highlight.opponent}</strong>
                  <span className="muted">{highlight.round}</span>
                </p>
              )}
              <div className="profile-reel-foot">
                <span className="profile-reel-terms">
                  {meta && (
                    <span className={`market-symbol ${meta.symbolClass}`} aria-hidden="true">
                      {meta.symbol}
                    </span>
                  )}
                  {highlight.asset}{" "}
                  {highlight.kind === "omen"
                    ? `${highlight.side === "LONG" ? "↑" : "↓"} ${highlight.leverage}×`
                    : `· ${highlight.net >= 0 ? "+" : "−"}${Math.abs(highlight.net)} Embers`}
                </span>
                <strong className="profile-reel-result">
                  {highlight.kind === "omen" ? signedPct(highlight.roi) : signedUsd(highlight.profit)}
                </strong>
              </div>
              {onUnpin && (
                <button type="button" className="profile-reel-unpin" disabled={pendingId === highlight.id} onClick={() => onUnpin(highlight.id)}>
                  {pendingId === highlight.id ? "Unpinning…" : "Unpin"}
                </button>
              )}
            </li>
          );
        })}
        {Array.from({ length: emptySlots }, (_, i) => (
          <li key={`empty-${i}`} className="profile-reel-card is-empty">
            <span aria-hidden="true">✦</span>
            Pin a winning match from the Matches tab
          </li>
        ))}
      </ol>
    </section>
  );
}
