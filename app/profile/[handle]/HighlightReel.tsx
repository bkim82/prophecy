"use client";

import { useState, useTransition } from "react";
import { signedPct } from "@/app/lib/calls";
import { ASSET_META, MAX_PINS, type Highlight } from "@/app/lib/profileTraits";
import { togglePinnedMatch } from "@/app/profile/actions";

// Right-rail panel under Achievements (ProfileAchievements children): up to
// three pinned wins, each wearing the gold ✦ Fulfilled chip of a fulfilled
// call (.market-call[data-state="fulfilled"]). Mock traders' reels are pinned
// omens; on your own profile they're won Arena matches, with Unpin on each
// card and one hint line for the open slots (pinning lives in the Matches tab).

const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usdCents.format(Math.abs(n))}`;

// `editable` = your own profile.
export function HighlightReel({ highlights, editable = false }: { highlights: Highlight[]; editable?: boolean }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startUnpin] = useTransition();
  if (highlights.length === 0 && !editable) return null;
  const openSlots = editable ? MAX_PINS - highlights.length : 0;

  const unpin = (id: string) => {
    setPendingId(id);
    setError(null);
    startUnpin(async () => {
      const result = await togglePinnedMatch(id).catch(() => ({ ok: false as const, error: "Couldn't unpin — try again." }));
      if (!result.ok) setError(result.error);
      setPendingId(null);
    });
  };

  return (
    <section className="panel sidebar-panel profile-reel" aria-label="Highlight reel">
      <h3>
        ✦ Highlight reel
        {editable && (
          <span className="profile-reel-count">
            {highlights.length}/{MAX_PINS}
          </span>
        )}
      </h3>
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
              {editable && (
                <button type="button" className="profile-reel-unpin" disabled={pendingId === highlight.id} onClick={() => unpin(highlight.id)}>
                  {pendingId === highlight.id ? "Unpinning…" : "Unpin"}
                </button>
              )}
            </li>
          );
        })}
        {openSlots > 0 && (
          <li className="profile-reel-card is-empty">
            <span aria-hidden="true">✦</span>
            {openSlots === MAX_PINS ? "Pin up to 3 winning matches from the Matches tab" : `${openSlots} more ${openSlots === 1 ? "slot" : "slots"} — pin wins from the Matches tab`}
          </li>
        )}
      </ol>
      {error && (
        <p className="profile-pin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
