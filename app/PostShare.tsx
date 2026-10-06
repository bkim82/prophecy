"use client";

import { useState } from "react";
import { AuthorLink } from "@/app/AuthorLink";
import { avatarGradient } from "@/app/lib/avatar";
import { DefyIcon, FlameIcon, VouchIcon } from "@/app/icons";
import type { Side } from "@/app/lib/mockPosts";

// Vouch / Defy, the two ways to reshare an omen (app/PostCard.tsx). A vouch
// puts the post in your followers' feeds with your name on it; a defy does
// the same while staking Embers against it — the other side of the trade,
// for a call. Mock only: nothing is sent to followers and no Embers move.

// For a call, the side a defier takes (the opposite of the caller's).
export type DefySide = { side: Side; market: string };

export type Defy = { stake: number; note: string };

const STAKES = [10, 50, 100, 250];

const stakeLabel = (stake: number, takes?: DefySide) =>
  takes ? `${stake.toLocaleString("en-US")} Embers on ${takes.side === "LONG" ? "↑" : "↓"} ${takes.side} ${takes.market}` : `${stake.toLocaleString("en-US")} Embers against`;

// The sharer's own row above a reshared post (the post itself sits in a
// bordered card under it, see PostCard): avatar with a vouch/defy badge,
// "Nova vouched for this omen · 8m ago", then for a defy the stake chip and
// the defier's note as their own words. `handle` is omitted for the viewer's
// own share ("You").
export function ReshareHead({
  kind,
  name,
  handle,
  timestamp,
  stake,
  note,
  takes,
}: {
  kind: "vouch" | "defy";
  name: string;
  handle?: string;
  timestamp: string;
  stake?: number;
  note?: string;
  takes?: DefySide;
}) {
  const icon = kind === "vouch" ? <VouchIcon /> : <DefyIcon />;
  return (
    <div className="post-reshare-head" data-kind={kind}>
      {handle ? (
        <span className="post-reshare-avatar" aria-hidden="true" style={{ background: avatarGradient(handle) }}>
          {name[0].toUpperCase()}
          <span className="post-reshare-badge">{icon}</span>
        </span>
      ) : (
        <span className="post-reshare-avatar is-you" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="post-reshare-text">
        <p className="post-reshare-who">
          {handle ? <AuthorLink handle={handle} name={name} /> : <strong>{name}</strong>}{" "}
          <span className="post-reshare-verb">{kind === "vouch" ? "vouched for this omen" : "defied this omen"}</span>
          <span className="muted"> · {timestamp}</span>
        </p>
        {kind === "defy" && stake !== undefined && (
          <p className="post-reshare-stake">
            <FlameIcon />
            {stakeLabel(stake, takes)}
          </p>
        )}
        {note && <p className="post-reshare-note">{note}</p>}
        {!handle && <p className="post-reshare-reach">Your followers see this with your name on it.</p>}
      </div>
    </div>
  );
}

// Opens under the action row when you press Defy: pick a stake, add an
// optional note, confirm. Pressing Defy again on a post you defied offers to
// withdraw instead.
export function DefyPanel({
  author,
  takes,
  current,
  onDefy,
  onWithdraw,
  onClose,
}: {
  author: string;
  takes?: DefySide;
  current: Defy | null;
  onDefy: (defy: Defy) => void;
  onWithdraw: () => void;
  onClose: () => void;
}) {
  const [stake, setStake] = useState(50);
  const [note, setNote] = useState("");

  if (current) {
    return (
      <div className="defy-panel">
        <p className="defy-panel-title">
          <DefyIcon /> You&apos;re defying {author} with {stakeLabel(current.stake, takes)}
        </p>
        <div className="defy-panel-actions">
          <button type="button" className="defy-panel-cancel" onClick={onClose}>
            Keep it
          </button>
          <button type="button" className="defy-panel-withdraw" onClick={onWithdraw}>
            Withdraw defy
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="defy-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onDefy({ stake, note: note.trim() });
      }}
    >
      <p className="defy-panel-title">
        <DefyIcon /> Defy {author}&apos;s omen
      </p>
      <p className="defy-panel-copy">
        {takes ? (
          <>
            You take{" "}
            <span className={`call-side ${takes.side === "LONG" ? "is-up" : "is-down"}`}>
              {takes.side === "LONG" ? "↑" : "↓"}
              {takes.side}
            </span>{" "}
            {takes.market}, the other side of {author}&apos;s call. It reposts to your followers with your bet on it.
          </>
        ) : (
          <>Bet Embers that this one doesn&apos;t play out. It reposts to your followers with your bet on it.</>
        )}
      </p>
      <div className="defy-stakes" role="radiogroup" aria-label="Stake">
        {STAKES.map((amount) => (
          <button key={amount} type="button" role="radio" aria-checked={stake === amount} onClick={() => setStake(amount)}>
            <FlameIcon />
            {amount}
          </button>
        ))}
      </div>
      <input
        className="defy-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Tell your followers why (optional)"
        maxLength={140}
        aria-label="Note for your followers"
      />
      <div className="defy-panel-actions">
        <button type="button" className="defy-panel-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="defy-panel-submit">
          <DefyIcon /> Defy · {stake} Embers
        </button>
      </div>
    </form>
  );
}
