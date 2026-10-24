"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { ArenaIcon, BackIcon, CloseIcon, ImageIcon, NewMessageIcon, SearchIcon, SendIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import { clockLabel } from "@/app/lib/challengeRules";
import { acceptIncoming, declineIncoming, useLiveChallenges, useNow } from "@/app/lib/liveChallenges";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_MAX_PHOTOS,
  messagePreview,
  normalizeMessage,
  type ChallengeCard,
  type ChallengeStatus,
  type ConversationView,
  type Folder,
  type MessageView,
  type Peer,
  type SharedPost,
  type ThreadView,
} from "@/app/lib/messageRules";
import { MESSAGES_DOCK_ID, closeMessages, postMessage, resetMessages, setMessageSummary, showMessages, useMessages, usePeople } from "@/app/lib/messages";
import { PICKED_PHOTO_MAX_BYTES, encodePhoto, loadPhoto, type PickedPhoto } from "@/app/lib/pickedPhoto";
import { playedLabel } from "@/app/lib/playedLabel";
import { POST_IMAGE_TYPES } from "@/app/lib/postImage";
import { acceptConversation, deleteConversation, markConversationRead } from "@/app/messages/actions";
import { cancelChallenge } from "@/app/profile/challengeActions";

// The Messages dock: a panel docked to the bottom-right corner (full screen
// on phones), opened from the header's Messages button or a profile's
// Message button, and left open across pages like X's message drawer. Three
// views (app/lib/messages.ts DockView): the Inbox / Requests lists, one
// conversation, and New message. Each fetches when it opens and again when
// the heartbeat reports a newer message (`summary.latest`), so incoming
// messages show within ~2s in a visible tab.

// A gap this long between two messages from one side starts a new run (its own timestamp).
const RUN_GAP_MS = 5 * 60_000;
// How often an open conversation re-reads while one of its challenges is still pending
// — an answer isn't a new message, so the heartbeat's `latest` doesn't move for it.
const CHALLENGE_POLL_MS = 3_000;

type Lists = { inbox: ConversationView[]; requests: ConversationView[] };

// A dock route's JSON, or null when it fails (offline, signed out, 404).
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};

// Messages only count as read while the tab is actually in view.
const useTabVisible = () => useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible", () => false);

// Focus a field on open with a mouse or trackpad; on touch that would throw the keyboard up unasked.
function useFocusOnFinePointer(ref: RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    if (ready && window.matchMedia("(pointer: fine)").matches) ref.current?.focus();
  }, [ref, ready]);
}

const profilePath = (peer: Peer) => `/profile/${peer.handle.slice(1)}`;
const isoTime = (ms: number) => new Date(ms).toISOString();

// Full screen on phones: following a link out of the dock closes it, so the page is actually visible.
const closeOnPhone = () => {
  if (window.matchMedia("(max-width: 768px)").matches) closeMessages();
};

export function MessagesDock() {
  const { open, view } = useMessages();
  // Mounted only while signed in (app/layout.tsx), so this runs on sign-out.
  useEffect(() => resetMessages, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeMessages();
  };

  return (
    <section id={MESSAGES_DOCK_ID} className="messages-dock" role="dialog" aria-label="Messages" hidden={!open} onKeyDown={onKeyDown}>
      {open &&
        (view.kind === "thread" ? (
          <ThreadPane key={view.peer.handle} opened={view.peer} />
        ) : view.kind === "new" ? (
          <NewMessagePane />
        ) : (
          <ListPane folder={view.folder} />
        ))}
    </section>
  );
}

function CloseButton() {
  return (
    <button type="button" className="messages-icon-button" aria-label="Close messages" onClick={closeMessages}>
      <CloseIcon />
    </button>
  );
}

export function PeerAvatar({ peer, small = false }: { peer: Peer; small?: boolean }) {
  return (
    <span className={`messages-avatar${small ? " messages-avatar--sm" : ""}`} style={{ background: avatarGradient(peer.handle) }} aria-hidden="true">
      {peer.name.charAt(0).toUpperCase()}
      {/* Our own route or Clerk-hosted; a plain img avoids allow-listing its domain for next/image. */}
      {peer.imageUrl && <img src={peer.imageUrl} alt="" />}
    </span>
  );
}

function UnreadCount({ count }: { count: number }) {
  return (
    <span className="messages-count">
      {count > 9 ? "9+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

function ListPane({ folder }: { folder: Folder }) {
  const { summary } = useMessages();
  // `at` is when the lists arrived, the "now" their timestamps are relative to.
  const [loaded, setLoaded] = useState<{ lists: Lists | null; at: number } | null>(null);

  useEffect(() => {
    let live = true;
    void getJson<Lists>("/api/messages").then((lists) => {
      // A failed refresh keeps what's already showing.
      if (live) setLoaded((current) => ({ lists: lists ?? current?.lists ?? null, at: Date.now() }));
    });
    return () => {
      live = false;
    };
  }, [summary.latest]);

  const conversations = loaded?.lists ? (folder === "inbox" ? loaded.lists.inbox : loaded.lists.requests) : null;
  const tab = (id: Folder, label: string, unread: number) => (
    <button type="button" aria-pressed={folder === id} onClick={() => showMessages({ kind: "list", folder: id })}>
      {label}
      {unread > 0 && <UnreadCount count={unread} />}
    </button>
  );

  return (
    <>
      <header className="messages-head">
        <h2>Messages</h2>
        <button type="button" className="messages-icon-button" aria-label="New message" title="New message" onClick={() => showMessages({ kind: "new" })}>
          <NewMessageIcon />
        </button>
        <CloseButton />
      </header>
      <div className="messages-tabs" role="group" aria-label="Folders">
        {tab("inbox", "Inbox", summary.inbox)}
        {tab("request", "Requests", summary.requests)}
      </div>
      <div className="messages-scroll">
        {!loaded ? (
          <p className="messages-empty">Loading…</p>
        ) : !conversations ? (
          <p className="messages-empty" role="alert">
            Couldn&rsquo;t load your messages — try again in a moment.
          </p>
        ) : conversations.length === 0 ? (
          folder === "inbox" ? (
            <div className="messages-empty">
              <strong>You have no messages</strong>
              <span>Message someone from their profile, or start a new message.</span>
            </div>
          ) : (
            <div className="messages-empty">
              <strong>No message requests</strong>
              <span>Messages from people you don&rsquo;t follow each other with wait here until you accept them.</span>
            </div>
          )
        ) : (
          <ul className="messages-list">
            {conversations.map((conversation) => (
              <ConversationRow key={conversation.peer.handle} conversation={conversation} now={loaded.at} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ConversationRow({ conversation: { peer, last, unread }, now }: { conversation: ConversationView; now: number }) {
  return (
    <li>
      <button type="button" className="messages-row" data-unread={unread > 0} onClick={() => showMessages({ kind: "thread", peer })}>
        <PeerAvatar peer={peer} />
        <span className="messages-row-body">
          <span className="messages-row-top">
            <strong>{peer.name}</strong>
            <span className="muted">{peer.handle}</span>
            <time dateTime={isoTime(last.sentAt)}>{playedLabel(last.sentAt, now)}</time>
          </span>
          <span className="messages-row-preview">
            {last.mine && "You: "}
            {messagePreview(last)}
          </span>
        </span>
        {unread > 0 && <UnreadCount count={unread} />}
      </button>
    </li>
  );
}

// A post shared into the conversation: author, text and its first photo, linking to the post.
function SharedPostCard({ post }: { post: SharedPost | null }) {
  if (!post) return <p className="messages-post is-gone">This post is no longer available.</p>;
  return (
    <Link href={post.href} className="messages-post" onClick={closeOnPhone}>
      <span className="messages-post-head">
        <span className="messages-avatar messages-avatar--xs" style={{ background: avatarGradient(post.handle || post.author) }} aria-hidden="true">
          {post.avatarInitial}
        </span>
        <strong>{post.author}</strong>
        {post.handle && <span className="muted">{post.handle}</span>}
      </span>
      {post.content && <span className="messages-post-text">{post.content}</span>}
      {post.imageUrl && <img className="messages-post-image" src={post.imageUrl} alt="" loading="lazy" />}
    </Link>
  );
}

// A message's photos, X-style: one full width, 2–4 in a grid; each opens full size in a new tab.
function MessagePhotos({ message, from }: { message: MessageView; from: string }) {
  return (
    <div className="messages-photos" data-count={message.photos.length}>
      {message.photos.map((photo, index) => (
        <a key={photo.src} href={photo.src} target="_blank" rel="noopener noreferrer">
          {/* Sized up front so the thread can scroll to the bottom before the bytes arrive. */}
          <img
            src={photo.src}
            alt={`Photo ${index + 1} from ${from}`}
            loading="lazy"
            style={message.photos.length === 1 ? { aspectRatio: `${photo.width} / ${photo.height}` } : undefined}
          />
        </a>
      ))}
    </div>
  );
}

const CHALLENGE_STATUS: Record<Exclude<ChallengeStatus, "pending">, string> = {
  accepted: "✓ Accepted",
  declined: "Declined",
  expired: "Expired",
  canceled: "Canceled",
  closed: "No longer open",
};

// A challenge posted into the conversation as it was sent. Live like the
// bell's row (app/FeedNotifications.tsx), sharing its answers
// (app/lib/liveChallenges.ts): the one challenged accepts — into the private
// round, closing the dock — or declines here; the sender sees the countdown
// and can cancel, then "Join round" once it's accepted (from the heartbeat's
// `accepted`). `loadedAt` is when the server measured `expiresInMs`.
function ChallengeMessage({
  card,
  mine,
  peerName,
  loadedAt,
  onCanceled,
}: {
  card: ChallengeCard | null;
  mine: boolean;
  peerName: string;
  loadedAt: number;
  onCanceled: () => void;
}) {
  const router = useRouter();
  const { accepted, answers } = useLiveChallenges();
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [answering, startAnswer] = useTransition();
  if (!card) return <p className="messages-challenge is-gone">This challenge is no longer available.</p>;

  // Unset until you answer it here or in the bell.
  const answered = card.id in answers ? answers[card.id] : undefined;
  const secondsLeft = now === 0 ? null : Math.max(0, Math.ceil((loadedAt + card.expiresInMs - now) / 1000));
  const status: ChallengeStatus = answered ?? (card.status === "pending" && secondsLeft === 0 ? "expired" : card.status);
  const join = mine && status === "accepted" ? accepted.find((round) => round.id === card.id) : undefined;
  const respond = (run: () => Promise<string | null>) =>
    startAnswer(async () => {
      setError(null);
      setError(await run().catch(() => "Something went wrong — try again."));
    });

  return (
    <div className="messages-challenge" data-status={status}>
      <p className="messages-challenge-head">
        <ArenaIcon />
        {mine ? `You challenged ${peerName}` : `${peerName} challenged you`}
      </p>
      <p className="messages-challenge-terms">{card.terms}</p>
      {status === "pending" ? (
        <>
          <p className="messages-challenge-meta">
            {mine ? `Waiting for ${peerName}` : "Answer before it expires"}
            {secondsLeft !== null && ` · ${clockLabel(secondsLeft)} left`}
          </p>
          <div className="messages-challenge-actions">
            {mine ? (
              <button
                type="button"
                disabled={answering}
                onClick={() =>
                  respond(async () => {
                    const result = await cancelChallenge(card.id);
                    if (!result.ok) return result.error;
                    onCanceled();
                    return null;
                  })
                }
              >
                {answering ? "Canceling…" : "Cancel challenge"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="messages-accept"
                  disabled={answering || card.mode !== "pulse"}
                  title={card.mode === "pulse" ? undefined : "24h Portfolio challenges can't be accepted — Pulse only for now"}
                  onClick={() =>
                    respond(async () => {
                      const result = await acceptIncoming(card.id);
                      if ("error" in result) return result.error;
                      closeMessages();
                      router.push(result.href);
                      return null;
                    })
                  }
                >
                  Accept
                </button>
                <button type="button" disabled={answering} onClick={() => respond(() => declineIncoming(card.id))}>
                  Decline
                </button>
              </>
            )}
          </div>
        </>
      ) : join ? (
        <Link href={join.href} className="messages-challenge-join" onClick={closeMessages}>
          They&rsquo;re in the round — join
        </Link>
      ) : (
        <p className="messages-challenge-status">{CHALLENGE_STATUS[status]}</p>
      )}
      {error && (
        <p className="messages-challenge-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ThreadPane({ opened }: { opened: Peer }) {
  const { summary } = useMessages();
  const [loaded, setLoaded] = useState<{ thread: ThreadView; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tabVisible = useTabVisible();
  const thread = loaded?.thread ?? null;
  const peer = thread?.peer ?? opened;
  const [poll, setPoll] = useState(0);

  useEffect(() => {
    let live = true;
    void getJson<ThreadView>(`/api/messages/thread?handle=${encodeURIComponent(opened.handle)}`).then((next) => {
      if (!live) return;
      if (next) setLoaded({ thread: next, at: Date.now() });
      setFailed(!next);
    });
    return () => {
      live = false;
    };
  }, [opened.handle, summary.latest, poll]);

  const challengePending = thread?.messages.some((message) => message.challenge?.status === "pending") ?? false;
  useEffect(() => {
    if (!challengePending) return;
    const timer = setInterval(() => setPoll((n) => n + 1), CHALLENGE_POLL_MS);
    return () => clearInterval(timer);
  }, [challengePending]);

  const setChallengeStatus = (id: string, status: ChallengeStatus) =>
    setLoaded((current) =>
      current && {
        ...current,
        thread: {
          ...current.thread,
          messages: current.thread.messages.map((message) =>
            message.challenge?.id === id ? { ...message, challenge: { ...message.challenge, status, expiresInMs: 0 } } : message,
          ),
        },
      },
    );

  // Picked photos' previews are blob: URLs; let them go with the pane.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.src)), []);

  // Seeing their newest message reads the conversation; the badge drops with the returned counts.
  const newestUnreadId = thread?.newestUnreadId ?? null;
  useEffect(() => {
    if (!newestUnreadId || !tabVisible) return;
    markConversationRead(opened.handle, newestUnreadId).then(
      (result) => {
        if (result.ok) setMessageSummary(result.summary);
      },
      () => {},
    );
  }, [opened.handle, newestUnreadId, tabVisible]);

  const count = thread?.messages.length ?? 0;
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [count]);

  const canReply = thread?.folder === "inbox" && !thread.blocked;
  useFocusOnFinePointer(inputRef, canReply);

  const act = (run: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await run();
      } catch {
        setError("Something went wrong — try again.");
      }
    });

  async function addPhotos(files: File[]) {
    const images = files.filter((file) => POST_IMAGE_TYPES.includes(file.type));
    if (images.length === 0) return;
    const room = MESSAGE_MAX_PHOTOS - photos.length;
    const fits = images.filter((file) => file.size <= PICKED_PHOTO_MAX_BYTES);
    const picked = (await Promise.all(fits.slice(0, Math.max(0, room)).map(loadPhoto))).filter((photo): photo is PickedPhoto => photo !== null);
    setPhotos((current) => [...current, ...picked].slice(0, MESSAGE_MAX_PHOTOS));
    setError(fits.length < images.length ? "Photos can be up to 20 MB." : images.length > room ? `Up to ${MESSAGE_MAX_PHOTOS} photos per message.` : null);
  }

  const removePhoto = (src: string) => {
    URL.revokeObjectURL(src);
    setPhotos((current) => current.filter((photo) => photo.src !== src));
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addPhotos(files);
    }
  };

  const ready = Boolean(normalizeMessage(draft)) || photos.length > 0;
  const send = () => {
    if (!ready || pending) return;
    const body = normalizeMessage(draft);
    const sending = photos;
    act(async () => {
      const encoded = await Promise.all(sending.map((photo) => encodePhoto(photo).catch(() => null)));
      if (encoded.some((photo) => photo === null)) return setError("One of the photos couldn't be shrunk to 1 MB. Try a smaller one.");
      const result = await postMessage({ handle: opened.handle, body, photos: encoded as { mime: string; data: string }[] });
      if (!result.ok) return setError(result.error);
      setDraft("");
      sending.forEach((photo) => URL.revokeObjectURL(photo.src));
      setPhotos((current) => current.filter((photo) => !sending.includes(photo)));
      // Writing back accepts a request; the next heartbeat refetches the thread anyway.
      setLoaded((current) => current && {
        at: Date.now(),
        thread: { ...current.thread, folder: "inbox", messages: [...current.thread.messages.filter((message) => message.id !== result.message.id), result.message] },
      });
    });
  };

  const accept = () =>
    act(async () => {
      const result = await acceptConversation(opened.handle);
      if (!result.ok) return setError(result.error);
      setLoaded((current) => current && { ...current, thread: { ...current.thread, folder: "inbox" } });
    });

  const remove = () =>
    act(async () => {
      const result = await deleteConversation(opened.handle);
      if (!result.ok) return setError(result.error);
      setMessageSummary(result.summary);
      showMessages({ kind: "list", folder: "request" });
    });

  let footer: React.ReactNode = null;
  if (thread?.blocked) {
    footer = (
      <p className="messages-blocked">
        {thread.blocked === "by-you" ? (
          <>
            You blocked {peer.handle}.{" "}
            <Link href={profilePath(peer)} onClick={closeOnPhone}>
              Unblock them on their profile
            </Link>{" "}
            to message each other.
          </>
        ) : (
          <>You can&rsquo;t message {peer.handle}.</>
        )}
      </p>
    );
  } else if (thread?.folder === "request") {
    footer = (
      <div className="messages-request">
        <p>
          <strong>{peer.name} wants to message you.</strong> You don&rsquo;t follow each other, so this is a request. Accept to move it to your inbox
          and reply.
        </p>
        <div className="messages-request-actions">
          <button type="button" className="messages-accept" disabled={pending} onClick={accept}>
            Accept
          </button>
          <button type="button" disabled={pending} onClick={remove}>
            Delete
          </button>
        </div>
      </div>
    );
  } else if (thread) {
    footer = (
      <form
        className="messages-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {photos.length > 0 && (
          <ul className="messages-attachments" aria-label="Photos to send">
            {photos.map((photo, index) => (
              <li key={photo.src}>
                <img src={photo.src} alt={`Photo ${index + 1} to send`} />
                <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => removePhoto(photo.src)}>
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="messages-composer-row">
          <button
            type="button"
            className="messages-icon-button"
            aria-label="Add photos"
            title="Add photos"
            disabled={pending || photos.length >= MESSAGE_MAX_PHOTOS}
            onClick={() => fileRef.current?.click()}
          >
            <ImageIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={POST_IMAGE_TYPES.join(",")}
            multiple
            hidden
            onChange={(event) => {
              void addPhotos([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder="Write a message"
            aria-label={`Message ${peer.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={onPaste}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a new line.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" className="messages-send" aria-label={pending ? "Sending" : "Send"} disabled={pending || !ready}>
            <SendIcon />
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <header className="messages-head">
        <button
          type="button"
          className="messages-icon-button"
          aria-label="Back to messages"
          onClick={() => showMessages({ kind: "list", folder: thread?.folder ?? "inbox" })}
        >
          <BackIcon />
        </button>
        <Link href={profilePath(peer)} className="messages-peer" onClick={closeOnPhone}>
          <PeerAvatar peer={peer} small />
          <span className="messages-peer-text">
            <strong>{peer.name}</strong>
            <span>{peer.handle}</span>
          </span>
        </Link>
        <CloseButton />
      </header>
      <div className="messages-scroll" ref={scrollRef}>
        {!thread ? (
          <p className="messages-empty" role={failed ? "alert" : undefined}>
            {failed ? "This conversation isn’t available." : "Loading…"}
          </p>
        ) : thread.messages.length === 0 ? (
          thread.blocked ? null : (
            <div className="messages-empty">
              <strong>No messages yet</strong>
              <span>Say hi to {peer.name}.</span>
            </div>
          )
        ) : (
          <ol className="messages-thread" aria-label={`Conversation with ${peer.name}`}>
            {thread.messages.map((message, index) => {
              const next = thread.messages[index + 1];
              // Timestamp under the last bubble of each run from one side.
              const endsRun = !next || next.mine !== message.mine || next.sentAt - message.sentAt > RUN_GAP_MS;
              const from = message.mine ? "you" : peer.name;
              return (
                <li key={message.id} className="messages-bubble-row" data-mine={message.mine}>
                  {message.challenge !== undefined && loaded && (
                    <ChallengeMessage
                      card={message.challenge}
                      mine={message.mine}
                      peerName={peer.name}
                      loadedAt={loaded.at}
                      onCanceled={() => message.challenge && setChallengeStatus(message.challenge.id, "canceled")}
                    />
                  )}
                  {message.post !== undefined && <SharedPostCard post={message.post} />}
                  {message.photos.length > 0 && <MessagePhotos message={message} from={from} />}
                  {message.body && (
                    <p className="messages-bubble">
                      <span className="sr-only">{message.mine ? "You: " : `${peer.name}: `}</span>
                      {message.body}
                    </p>
                  )}
                  {endsRun && loaded && (
                    <time className="messages-bubble-time" dateTime={isoTime(message.sentAt)}>
                      {playedLabel(message.sentAt, loaded.at)}
                    </time>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {error && (
        <p className="messages-error" role="alert">
          {error}
        </p>
      )}
      {footer}
    </>
  );
}

function NewMessagePane() {
  const [query, setQuery] = useState("");
  const found = usePeople(query);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusOnFinePointer(searchRef, true);

  return (
    <>
      <header className="messages-head">
        <button type="button" className="messages-icon-button" aria-label="Back to messages" onClick={() => showMessages({ kind: "list", folder: "inbox" })}>
          <BackIcon />
        </button>
        <h2>New message</h2>
        <CloseButton />
      </header>
      <label className="messages-search">
        <SearchIcon />
        <span className="sr-only">Search people</span>
        <input ref={searchRef} type="search" value={query} placeholder="Search by name or @handle" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="messages-scroll">
        {!found ? (
          <p className="messages-empty">Loading…</p>
        ) : !found.people ? (
          <p className="messages-empty" role="alert">
            Couldn&rsquo;t search right now — try again in a moment.
          </p>
        ) : found.people.length === 0 ? (
          <p className="messages-empty">
            {found.query
              ? `No one matches “${found.query}”.`
              : "Friends (you follow each other) show up here — or search for anyone by name or @handle."}
          </p>
        ) : (
          <>
            {!found.query && <p className="messages-section">Friends</p>}
            <ul className="messages-list">
              {found.people.map((peer) => (
                <li key={peer.handle}>
                  <button type="button" className="messages-row" onClick={() => showMessages({ kind: "thread", peer })}>
                    <PeerAvatar peer={peer} />
                    <span className="messages-row-body">
                      <span className="messages-row-top">
                        <strong>{peer.name}</strong>
                      </span>
                      <span className="messages-row-preview">{peer.handle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
