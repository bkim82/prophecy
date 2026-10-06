"use client";

import { AuthorLink } from "@/app/AuthorLink";
import { avatarGradient } from "@/app/lib/avatar";
import { DefyIcon, VouchIcon } from "@/app/icons";

// Vouch / Defy, the two ways to repost an omen (app/PostCard.tsx). Both work
// like a plain repost — the post goes to your followers' feeds with your name
// on it — a vouch says you back it, a defy says you're against it. Mock only:
// nothing is actually sent to followers.
export type ReshareKind = "vouch" | "defy";

// The sharer's own row above a reshared post (the post itself sits in a
// bordered card under it, see PostCard): avatar with a vouch/defy badge, then
// "Nova vouched for this omen · 8m ago". `handle` is omitted for the viewer's
// own repost ("You").
export function ReshareHead({ kind, name, handle, timestamp }: { kind: ReshareKind; name: string; handle?: string; timestamp: string }) {
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
        {!handle && <p className="post-reshare-reach">Your followers see this with your name on it.</p>}
      </div>
    </div>
  );
}
