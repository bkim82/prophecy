"use client";

import { AuthorLink } from "@/app/AuthorLink";
import { avatarGradient } from "@/app/lib/avatar";
import { DefyIcon, RepostIcon, VouchIcon } from "@/app/icons";

// The three ways to repost an omen, all picked from the one Repost button
// (app/RepostMenu.tsx). Each sends the post to your followers' feeds with your
// name on it: a plain repost just shares it, a vouch says you back it, a defy
// says you're against it. Any of them can carry your own words. Mock only:
// nothing is actually sent to followers.
export type ReshareKind = "repost" | "vouch" | "defy";

// Your own repost of a post: the kind plus your words ("" for none).
export type Reshare = { kind: ReshareKind; text: string };

export const RESHARE_KINDS: ReshareKind[] = ["repost", "vouch", "defy"];

export const RESHARE: Record<
  ReshareKind,
  { label: string; done: string; verb: string; hint: string; Icon: typeof RepostIcon }
> = {
  repost: { label: "Repost", done: "Reposted", verb: "reposted this omen", hint: "Share it with your followers", Icon: RepostIcon },
  vouch: { label: "Vouch", done: "Vouched", verb: "vouched for this omen", hint: "Repost it as one you back", Icon: VouchIcon },
  defy: { label: "Defy", done: "Defied", verb: "defied this omen", hint: "Repost it as one you're against", Icon: DefyIcon },
};

// The sharer's own row above a reshared post (the post itself sits in a
// bordered card under it, see PostCard): avatar with a kind badge, then
// "Nova vouched for this omen · 8m ago", then their words if they added any.
// `handle` is omitted for the viewer's own repost ("You").
export function ReshareHead({
  kind,
  name,
  handle,
  timestamp,
  text,
}: {
  kind: ReshareKind;
  name: string;
  handle?: string;
  timestamp: string;
  text?: string;
}) {
  const { Icon, verb } = RESHARE[kind];
  return (
    <div className="post-reshare-head" data-kind={kind}>
      {handle ? (
        <span className="post-reshare-avatar" aria-hidden="true" style={{ background: avatarGradient(handle) }}>
          {name[0].toUpperCase()}
          <span className="post-reshare-badge">
            <Icon />
          </span>
        </span>
      ) : (
        <span className="post-reshare-avatar is-you" aria-hidden="true">
          <Icon />
        </span>
      )}
      <div className="post-reshare-text">
        <p className="post-reshare-who">
          {handle ? <AuthorLink handle={handle} name={name} /> : <strong>{name}</strong>}{" "}
          <span className="post-reshare-verb">{verb}</span>
          <span className="muted"> · {timestamp}</span>
        </p>
        {text && <p className="post-reshare-words">{text}</p>}
        {!handle && <p className="post-reshare-reach">Your followers see this with your name on it.</p>}
      </div>
    </div>
  );
}
