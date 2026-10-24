"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ArenaIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import { challengeTerms, clockLabel, type AcceptedChallenge } from "@/app/lib/challengeRules";
import { NOTIFICATIONS, type Notification } from "@/app/lib/mockNotifications";
import { acceptIncoming, declineIncoming, useLiveChallenges, useNow, type Answer, type LiveIncoming } from "@/app/lib/liveChallenges";
import { getProfile, profileHref } from "@/app/lib/mockProfiles";

// The header bell's Notifications list (app/NotificationsMenu.tsx): your
// accepted challenges waiting for you to join, then real incoming challenges
// (both from app/lib/liveChallenges.ts), then mock mentions
// (app/lib/mockNotifications.ts). Accept opens the challenge's private Pulse
// round and takes you there; the challenger gets a "Join round" row. These
// rows are also the bodies of the popup under the bell.

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

const profileLink = (handle: string | null) => (handle ? `/profile/${handle.slice(1)}` : undefined);

// Collapsed to who + when so the list stays short; "Show more" reveals the
// terms. The popup passes `expanded` to lead with them. `onAccepted` runs
// before heading into the round (the bell closes itself). Counts down to its
// expiry; at zero it shows "Expired" until the next heartbeat drops it.
export function ChallengeRow({ request, expanded = false, onAccepted }: { request: LiveIncoming; expanded?: boolean; onAccepted?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(expanded);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<Answer | null>(null);
  const [pending, startAnswer] = useTransition();
  const answer = useLiveChallenges().answers[request.id];
  const now = useNow();
  const secondsLeft = now === 0 ? null : Math.max(0, Math.ceil((request.expiresAt - now) / 1000));
  const expired = secondsLeft === 0;
  const termsId = useId();
  const href = profileLink(request.handle);
  // 24h Portfolio has no head-to-head round to start (app/lib/challengeRules.ts).
  const acceptable = request.mode === "pulse";

  const respond = (next: Answer) =>
    startAnswer(async () => {
      setError(null);
      setAnswering(next);
      if (next === "declined") return setError(await declineIncoming(request.id));
      const result = await acceptIncoming(request.id);
      if ("error" in result) return setError(result.error);
      onAccepted?.();
      router.push(result.href);
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
          <span>
            {request.sentLabel}
            {secondsLeft !== null && !expired && ` · ${clockLabel(secondsLeft)} left`}
          </span>
          <button type="button" className="feed-notif-more" aria-expanded={open} aria-controls={termsId} onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show more"}
          </button>
        </p>
      </div>
      {answer || expired ? (
        <p className="feed-notif-status" data-answer={answer ?? "expired"}>
          {answer === "accepted" ? "✓ Accepted" : answer === "declined" ? "Declined" : "Expired"}
        </p>
      ) : (
        <div className="feed-notif-actions">
          <button
            type="button"
            className="feed-notif-accept"
            aria-label={`Accept ${request.name}'s challenge`}
            disabled={pending || !acceptable}
            title={acceptable ? undefined : "24h Portfolio challenges can't be accepted — Pulse only for now"}
            onClick={() => respond("accepted")}
          >
            {pending && answering === "accepted" ? "Starting…" : "Accept"}
          </button>
          <button type="button" aria-label={`Decline ${request.name}'s challenge`} disabled={pending} onClick={() => respond("declined")}>
            {pending && answering === "declined" ? "Declining…" : "Decline"}
          </button>
        </div>
      )}
    </li>
  );
}

// The challenger's side: their challenge was accepted and its round is
// holding a seat for them. `onJoin` runs as the link is followed.
export function AcceptedRow({ accepted, onJoin }: { accepted: AcceptedChallenge; onJoin?: () => void }) {
  const href = profileLink(accepted.handle);
  return (
    <li className="feed-notif feed-notif--challenge">
      <Avatar initial={accepted.name.charAt(0).toUpperCase()} seed={accepted.handle ?? accepted.id} href={href} challenge />
      <div className="feed-notif-body">
        <p className="feed-notif-line">
          <strong>{href ? <Link href={href}>{accepted.name}</Link> : accepted.name}</strong> accepted your challenge
        </p>
        <p className="feed-notif-detail">{challengeTerms(accepted)}</p>
        <p className="feed-notif-detail feed-notif-meta">
          <span>They&rsquo;re in the round — take your seat</span>
        </p>
      </div>
      <div className="feed-notif-actions">
        <Link href={accepted.href} className="feed-notif-accept" onClick={onJoin}>
          Join round
        </Link>
      </div>
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

type FeedNotificationsProps = { challenges: LiveIncoming[]; accepted: AcceptedChallenge[]; onAccepted?: () => void };

export function FeedNotifications({ challenges, accepted, onAccepted }: FeedNotificationsProps) {
  const labelId = useId();
  return (
    <section className="feed-notifs" aria-labelledby={labelId}>
      <h2 className="feed-notifs-title" id={labelId}>
        Notifications
      </h2>
      <ul className="feed-notif-list">
        {accepted.map((round) => (
          <AcceptedRow key={round.id} accepted={round} />
        ))}
        {challenges.map((request) => (
          <ChallengeRow key={request.id} request={request} onAccepted={onAccepted} />
        ))}
        {NOTIFICATIONS.map((notification) => (
          <NotificationRow key={notification.id} notification={notification} />
        ))}
      </ul>
    </section>
  );
}
