"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArenaIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import { challengeTerms } from "@/app/lib/challengeRules";
import { CHALLENGE_REQUESTS, NOTIFICATIONS, type ChallengeRequest, type Notification } from "@/app/lib/mockNotifications";
import { getProfile, profileHref, type Profile } from "@/app/lib/mockProfiles";

// The header bell's Notifications list (app/NotificationsMenu.tsx): incoming
// challenge requests on top, then mentions / copies / follows. All mock
// (app/lib/mockNotifications.ts). Accept and Decline only mark the request
// until reload — there's no match to start against a mock trader.

type Answer = "accepted" | "declined";

function Avatar({ profile, href, challenge = false }: { profile: Profile; href?: string; challenge?: boolean }) {
  const face = (
    <>
      {profile.avatarInitial}
      {challenge && (
        <span className="feed-notif-kind">
          <ArenaIcon />
        </span>
      )}
    </>
  );
  const style = { background: avatarGradient(profile.handle) };
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
function ChallengeRow({ request, answer, onAnswer }: { request: ChallengeRequest; answer?: Answer; onAnswer: (answer: Answer) => void }) {
  const [open, setOpen] = useState(false);
  const termsId = useId();
  const profile = getProfile(request.handle);
  if (!profile) return null;
  const href = profileHref(profile.handle);
  return (
    <li className="feed-notif feed-notif--challenge">
      <Avatar profile={profile} href={href} challenge />
      <div className="feed-notif-body">
        <p className="feed-notif-line">
          <strong>{href ? <Link href={href}>{profile.name}</Link> : profile.name}</strong> challenged you
        </p>
        <p className="feed-notif-detail" id={termsId} hidden={!open}>
          {challengeTerms(request)}
        </p>
        <p className="feed-notif-detail feed-notif-meta">
          <span>{request.timestamp}</span>
          <button type="button" className="feed-notif-more" aria-expanded={open} aria-controls={termsId} onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show more"}
          </button>
        </p>
      </div>
      {answer ? (
        <p className="feed-notif-status" data-answer={answer}>
          {answer === "accepted" ? "✓ Accepted" : "Declined"}
        </p>
      ) : (
        <div className="feed-notif-actions">
          <button type="button" className="feed-notif-accept" aria-label={`Accept ${profile.name}'s challenge`} onClick={() => onAnswer("accepted")}>
            Accept
          </button>
          <button type="button" aria-label={`Decline ${profile.name}'s challenge`} onClick={() => onAnswer("declined")}>
            Decline
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
        <Avatar profile={profile} />
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

export function FeedNotifications() {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const labelId = useId();
  return (
    <section className="feed-notifs" aria-labelledby={labelId}>
      <h2 className="feed-notifs-title" id={labelId}>
        Notifications
      </h2>
      <ul className="feed-notif-list">
        {CHALLENGE_REQUESTS.map((request) => (
          <ChallengeRow
            key={request.id}
            request={request}
            answer={answers[request.id]}
            onAnswer={(answer) => setAnswers((current) => ({ ...current, [request.id]: answer }))}
          />
        ))}
        {NOTIFICATIONS.map((notification) => (
          <NotificationRow key={notification.id} notification={notification} />
        ))}
      </ul>
    </section>
  );
}
