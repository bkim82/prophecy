"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { ArenaIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import { challengeTerms, type IncomingChallenge } from "@/app/lib/challengeRules";
import { NOTIFICATIONS, type Notification } from "@/app/lib/mockNotifications";
import { getProfile, profileHref } from "@/app/lib/mockProfiles";
import { declineChallenge } from "@/app/profile/challengeActions";

// The header bell's Notifications list (app/NotificationsMenu.tsx): real
// incoming challenges on top (fetched by the bell), then mock mentions /
// copies (app/lib/mockNotifications.ts). Decline is saved; Accept stays
// disabled until there's a head-to-head round to start.

function Avatar({ initial, seed, href, challenge = false }: { initial: string; seed: string; href?: string; challenge?: boolean }) {
  const face = (
    <>
      {initial}
      {challenge && (
        <span className="feed-notif-kind">
          <ArenaIcon />
        </span>
      )}
    </>
  );
  const style = { background: avatarGradient(seed) };
  // Mouse-only duplicate of the name link, like PostCard's avatar.
  return href ? (
    <Link href={href} className="feed-notif-avatar" style={style} tabIndex={-1} aria-hidden="true">
      {face}
    </Link>
  ) : (
    <span className="feed-notif-avatar" style={style} aria-hidden="true">
      {face}
    </span>
  );
}

// Collapsed to who + when so the list stays short; "Show more" reveals the terms.
function ChallengeRow({ request }: { request: IncomingChallenge }) {
  const [open, setOpen] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startDecline] = useTransition();
  const termsId = useId();
  const href = request.handle ? `/profile/${request.handle.slice(1)}` : undefined;

  const decline = () =>
    startDecline(async () => {
      setError(null);
      const result = await declineChallenge(request.id).catch(() => ({ ok: false as const, error: "Couldn't decline — try again." }));
      if (result.ok) setDeclined(true);
      else setError(result.error);
    });

  return (
    <li className="feed-notif feed-notif--challenge">
      <Avatar initial={request.name.charAt(0).toUpperCase()} seed={request.handle ?? request.id} href={href} challenge />
      <div className="feed-notif-body">
        <p className="feed-notif-line">
          <strong>{href ? <Link href={href}>{request.name}</Link> : request.name}</strong> challenged you
        </p>
        <p className="feed-notif-detail" id={termsId} hidden={!open}>
          {challengeTerms(request)}
        </p>
        {error && (
          <p className="feed-notif-detail" role="alert">
            {error}
          </p>
        )}
        <p className="feed-notif-detail feed-notif-meta">
          <span>{request.sentLabel}</span>
          <button type="button" className="feed-notif-more" aria-expanded={open} aria-controls={termsId} onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show more"}
          </button>
        </p>
      </div>
      {declined ? (
        <p className="feed-notif-status" data-answer="declined">
          Declined
        </p>
      ) : (
        <div className="feed-notif-actions">
          <button type="button" className="feed-notif-accept" disabled title="Coming soon — head-to-head rounds aren't live yet">
            Accept
          </button>
          <button type="button" aria-label={`Decline ${request.name}'s challenge`} disabled={pending} onClick={decline}>
            {pending ? "Declining…" : "Decline"}
          </button>
        </div>
      )}
    </li>
  );
}

function describe(notification: Notification): { action: string; detail?: string } {
  switch (notification.kind) {
    case "mention":
      return { action: "mentioned you", detail: `“${notification.text}”` };
    case "copy":
      return { action: "copied your trade", detail: `${notification.market.toUpperCase()} ${notification.side.toLowerCase()}` };
    case "follow":
      return { action: "followed you" };
  }
}

function NotificationRow({ notification }: { notification: Notification }) {
  const profile = getProfile(notification.handle);
  const href = profileHref(notification.handle);
  if (!profile || !href) return null;
  const { action, detail } = describe(notification);
  return (
    <li>
      <Link href={href} className="feed-notif">
        <Avatar initial={profile.avatarInitial} seed={profile.handle} />
        <span className="feed-notif-body">
          <span className="feed-notif-line">
            <strong>{profile.name}</strong> {action}
          </span>
          <span className="feed-notif-detail">{detail ? `${notification.timestamp} · ${detail}` : notification.timestamp}</span>
        </span>
      </Link>
    </li>
  );
}

export function FeedNotifications({ challenges }: { challenges: IncomingChallenge[] }) {
  const labelId = useId();
  return (
    <section className="feed-notifs" aria-labelledby={labelId}>
      <h2 className="feed-notifs-title" id={labelId}>
        Notifications
      </h2>
      <ul className="feed-notif-list">
        {challenges.map((request) => (
          <ChallengeRow key={request.id} request={request} />
        ))}
        {NOTIFICATIONS.map((notification) => (
          <NotificationRow key={notification.id} notification={notification} />
        ))}
      </ul>
    </section>
  );
}
