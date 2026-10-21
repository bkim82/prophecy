"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { EmojiPicker } from "@/app/compose/EmojiPicker";
import { GifPicker } from "@/app/compose/GifPicker";
import { TopicRow } from "@/app/compose/TopicPicker";
import { TradePicker, useRecentTrades } from "@/app/compose/TradePicker";
import { BackIcon, CloseIcon, EmojiIcon, GifIcon, ImageIcon, PollIcon, TrendIcon } from "@/app/icons";
import { gifById, type GifId } from "@/app/lib/gifs";
import { markFreshPost } from "@/app/lib/freshPost";
import { publishPost } from "@/app/lib/postApi";
import { MAX_POST_PHOTOS, POST_IMAGE_MAX_BYTES, POST_IMAGE_MAX_SIDE } from "@/app/lib/postImage";
import { useInterests } from "@/app/lib/postLists";
import { MAX_POST_TOPICS, isCustomTopicId, mentionedTopics, type TopicId } from "@/app/lib/topics";
import { tradePrompt, tradeTopic, type TradeReceipt } from "@/app/lib/trades";
import { GifShot } from "@/app/PostMedia";
import { TradeCard } from "@/app/TradeCard";

const MAX_CHARS = 280;
const MAX_PHOTOS = MAX_POST_PHOTOS;
// What you can pick; each is shrunk to POST_IMAGE_MAX_BYTES before upload.
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_CHOICE_CHARS = 25;
const POLL_DURATIONS = [
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
];

type Photo = { src: string; width: number; height: number; file: File };
type PollDraft = { choices: string[]; duration: string };
type Panel = "trade" | "gif" | "emoji" | "topics";
// `autoTopic` = the topic attaching the trade added for you; it goes again
// with the trade unless you tapped it yourself.
type Draft = { text: string; trade: TradeReceipt | null; photos: Photo[]; gif: GifId | null; poll: PollDraft | null; topics: TopicId[]; autoTopic: TopicId | null };

// The draft survives leaving /compose without posting (back to the feed and
// in again), for this tab only. Blob URLs in it stay alive with it.
let savedDraft: Draft | null = null;

function loadPhoto(file: File): Promise<Photo | null> {
  return new Promise((resolve) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ src, width: img.naturalWidth || 1, height: img.naturalHeight || 1, file });
    img.onerror = () => {
      URL.revokeObjectURL(src);
      resolve(null);
    };
    img.src = src;
  });
}

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// A photo as POST /api/posts takes it: a GIF that already fits goes as-is
// (keeps its animation); anything else is redrawn no larger than
// POST_IMAGE_MAX_SIDE and saved as JPEG, stepping quality down until it fits
// POST_IMAGE_MAX_BYTES. Null if it still won't fit.
async function encodePhoto(photo: Photo): Promise<{ mime: string; data: string } | null> {
  if (photo.file.type === "image/gif" && photo.file.size <= POST_IMAGE_MAX_BYTES) {
    return { mime: "image/gif", data: await toBase64(photo.file) };
  }
  const img = new Image();
  img.src = photo.src;
  await img.decode();
  const scale = Math.min(1, POST_IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  // JPEG has no transparency; paint it white rather than black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.86, 0.74, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= POST_IMAGE_MAX_BYTES) return { mime: "image/jpeg", data: await toBase64(blob) };
  }
  return null;
}

// X-style progress ring: fills toward the limit, shows what's left from 20
// out, turns red past it.
function CharRing({ count }: { count: number }) {
  const left = MAX_CHARS - count;
  const r = 9;
  const circumference = 2 * Math.PI * r;
  const fill = Math.min(1, count / MAX_CHARS);
  const state = left < 0 ? "over" : left <= 20 ? "near" : "ok";
  return (
    <span className="compose-ring" data-state={state} aria-live="polite" aria-label={`${left} characters left`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="compose-ring-track" cx="12" cy="12" r={r} />
        {count > 0 && (
          <circle
            className="compose-ring-fill"
            cx="12"
            cy="12"
            r={r}
            strokeDasharray={`${circumference * fill} ${circumference}`}
            transform="rotate(-90 12 12)"
          />
        )}
      </svg>
      {state !== "ok" && <span className="compose-ring-count">{left}</span>}
    </span>
  );
}

function PollEditor({ poll, onChange, onRemove }: { poll: PollDraft; onChange: (poll: PollDraft) => void; onRemove: () => void }) {
  const setChoice = (index: number, value: string) =>
    onChange({ ...poll, choices: poll.choices.map((choice, i) => (i === index ? value : choice)) });
  return (
    <fieldset className="compose-poll">
      <legend className="sr-only">Poll</legend>
      {poll.choices.map((choice, i) => (
        <label key={i} className="compose-poll-choice">
          <input
            value={choice}
            onChange={(event) => setChoice(i, event.target.value)}
            placeholder={i < 2 ? `Choice ${i + 1}` : `Choice ${i + 1} (optional)`}
            maxLength={MAX_CHOICE_CHARS}
            autoFocus={i === 0 && choice === ""}
          />
          <span className="compose-poll-count" aria-hidden="true">
            {choice.length}/{MAX_CHOICE_CHARS}
          </span>
        </label>
      ))}
      <div className="compose-poll-foot">
        {poll.choices.length < 4 && (
          <button type="button" className="compose-poll-add" onClick={() => onChange({ ...poll, choices: [...poll.choices, ""] })}>
            + Add choice
          </button>
        )}
        <label className="compose-poll-length">
          <span>Poll length</span>
          <select value={poll.duration} onChange={(event) => onChange({ ...poll, duration: event.target.value })}>
            {POLL_DURATIONS.map((duration) => (
              <option key={duration.value} value={duration.value}>
                {duration.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="compose-poll-remove" onClick={onRemove}>
          Remove poll
        </button>
      </div>
    </fieldset>
  );
}

// Closes the open toolbar popover on an outside press or Esc (focus goes back
// to the button that opened it). Presses anywhere in the toolbar are "inside",
// so its buttons can toggle or switch panels themselves.
function useDismiss(open: Panel | null, containerRef: RefObject<HTMLElement | null>, triggers: Record<Panel, RefObject<HTMLButtonElement | null>>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
      triggers[open].current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, containerRef, triggers, close]);
}

/**
 * The full composer at /compose. Trade comes first in the toolbar: it opens
 * your recent trades (prefetched on mount) and a tap turns one into a trade
 * card on the post. Then photos (up to 4, also by paste or drop), a GIF, a
 * poll and emoji. Photos/GIF/poll are one media slot each, as on X; a trade
 * goes with any of them. A topic row (app/compose/TopicPicker.tsx) tags the
 * post with up to MAX_POST_TOPICS feed topics. Posting saves through
 * POST /api/posts (sign-in required) — only the trade's id goes up, never its
 * numbers — then goes back to the feed, where the new omen is pinned on top
 * and flashes (app/lib/freshPost.ts). `ownTopics` = custom topics from your
 * recent saved posts (app/compose/page.tsx), offered for reuse.
 */
export function Composer({ initialText, openTrades, ownTopics }: { initialText: string; openTrades: boolean; ownTopics: TopicId[] }) {
  const router = useRouter();
  const { user, isSignedIn, openSignIn } = useAppAuth();
  const [draft] = useState(() => savedDraft);
  const [text, setText] = useState(initialText || draft?.text || "");
  const [trade, setTrade] = useState<TradeReceipt | null>(draft?.trade ?? null);
  const [photos, setPhotos] = useState<Photo[]>(draft?.photos ?? []);
  const [gif, setGif] = useState<GifId | null>(draft?.gif ?? null);
  const [poll, setPoll] = useState<PollDraft | null>(draft?.poll ?? null);
  const [topics, setTopics] = useState<TopicId[]>(draft?.topics ?? []);
  const [autoTopic, setAutoTopic] = useState<TopicId | null>(draft?.autoTopic ?? null);
  const interests = useInterests();
  const [posting, setPosting] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(openTrades ? "trade" : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const { state: trades, reload: reloadTrades } = useRecentTrades();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const tradeButton = useRef<HTMLButtonElement>(null);
  const gifButton = useRef<HTMLButtonElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const topicsButton = useRef<HTMLButtonElement>(null);
  const triggers = useMemo(() => ({ trade: tradeButton, gif: gifButton, emoji: emojiButton, topics: topicsButton }), []);
  const posted = useRef(false);
  const latest = useRef<Draft>({ text, trade, photos, gif, poll, topics, autoTopic });
  useEffect(() => {
    latest.current = { text, trade, photos, gif, poll, topics, autoTopic };
  });

  const name = user?.firstName ?? user?.username ?? "You";
  const initial = name[0].toUpperCase();

  const close = useCallback(() => setPanel(null), []);
  useDismiss(panel, toolbarRef, triggers, close);

  // Keep the draft when leaving without posting; a posted one is cleared.
  useEffect(() => {
    savedDraft = null;
    return () => {
      const current = latest.current;
      const empty = !current.text.trim() && !current.trade && current.photos.length === 0 && !current.gif && !current.poll;
      savedDraft = posted.current || empty ? null : current;
    };
  }, []);

  useEffect(() => {
    if (!openTrades) textRef.current?.focus();
  }, [openTrades]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const chars = text.length;
  const choices = poll?.choices.map((choice) => choice.trim()) ?? [];
  const pollReady = !poll || choices.filter(Boolean).length >= 2;
  const hasContent = text.trim() !== "" || trade !== null || photos.length > 0 || gif !== null;
  const canPost = hasContent && pollReady && chars <= MAX_CHARS;
  const mediaTaken = gif !== null || poll !== null;
  const tradeTopicId = trade ? tradeTopic(trade) : undefined;
  // Topics you've made yourself: picked now, followed, or on your recent posts.
  const knownTopics = [...new Set([...topics, ...interests.ids, ...ownTopics])].filter(isCustomTopicId);
  // Chip order: the trade's coin, what the text mentions, your feed
  // interests, then your own topics.
  const suggestedTopics = [...new Set([...(tradeTopicId ? [tradeTopicId] : []), ...mentionedTopics(text), ...interests.ids, ...knownTopics])];

  function toggle(next: Panel) {
    setPanel((current) => (current === next ? null : next));
  }

  async function addFiles(files: File[]) {
    if (gif || poll) {
      setNotice(gif ? "Remove the GIF to add photos." : "Remove the poll to add photos.");
      return;
    }
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    const tooBig = images.filter((file) => file.size > MAX_PHOTO_BYTES).length;
    const accepted = images.filter((file) => file.size <= MAX_PHOTO_BYTES).slice(0, Math.max(0, room));
    const loaded = (await Promise.all(accepted.map(loadPhoto))).filter((photo): photo is Photo => photo !== null);
    if (loaded.length > 0) setPhotos((current) => [...current, ...loaded].slice(0, MAX_PHOTOS));
    if (tooBig > 0) setNotice("Photos can be up to 20 MB.");
    else if (images.length > room) setNotice(`Up to ${MAX_PHOTOS} photos per post.`);
    else if (loaded.length < accepted.length) setNotice("Couldn't read that image.");
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index].src);
      return current.filter((_, i) => i !== index);
    });
  }

  function toggleTopic(id: TopicId) {
    if (topics.includes(id)) {
      setTopics(topics.filter((topic) => topic !== id));
      if (id === autoTopic) setAutoTopic(null);
    } else if (topics.length < MAX_POST_TOPICS) {
      setTopics([...topics, id]);
    }
  }

  // Attaching a trade tags its coin (if it has a feed topic and there's room);
  // swapping or removing the trade takes that tag back off.
  function setTradeTopic(next: TradeReceipt | null) {
    const base = autoTopic ? topics.filter((id) => id !== autoTopic) : topics;
    const add = next ? tradeTopic(next) : undefined;
    const adding = add !== undefined && !base.includes(add) && base.length < MAX_POST_TOPICS;
    setTopics(adding ? [...base, add] : base);
    setAutoTopic(adding ? add : null);
  }

  function pickTrade(next: TradeReceipt) {
    setTrade(next);
    setTradeTopic(next);
    setPanel(null);
    textRef.current?.focus();
  }

  function insertEmoji(emoji: string) {
    const area = textRef.current;
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files];
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(false);
    void addFiles([...event.dataTransfer.files]);
  }

  function onDragOver(event: DragEvent<HTMLFormElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  }

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  async function submit(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canPost || posting) return;
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    setPosting(true);
    setNotice(null);
    try {
      const encoded = await Promise.all(photos.map((photo) => encodePhoto(photo).catch(() => null)));
      if (encoded.some((photo) => photo === null)) {
        setNotice("One of the photos couldn't be shrunk to 1 MB. Try a smaller one.");
        return;
      }
      const result = await publishPost({
        content: text.trim(),
        topics,
        tradeId: trade?.id ?? null,
        gif,
        poll: poll && { choices: choices.filter(Boolean), duration: poll.duration },
        photos: encoded as { mime: string; data: string }[],
      });
      if (!result.ok) {
        setNotice(result.error);
        if (result.status === 401) openSignIn();
        return;
      }
      posted.current = true;
      markFreshPost(result.id);
      router.push("/");
      router.refresh();
    } finally {
      setPosting(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  const postHint = !isSignedIn
    ? "Sign in to post"
    : !hasContent
      ? "Write something or attach a trade"
      : !pollReady
        ? "Fill in at least two poll choices"
        : chars > MAX_CHARS
          ? "Too long"
          : undefined;

  return (
    <form
      className={`compose${dragging ? " is-dragging" : ""}`}
      onSubmit={submit}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="compose-head">
        <button type="button" className="post-thread-back" aria-label="Back" onClick={goBack}>
          <BackIcon />
        </button>
        <h1>Create Omen</h1>
        <button type="submit" className="compose-post" disabled={!canPost || posting} title={postHint}>
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
      <div className="compose-panel">
        <div className="compose-row">
          <span className="feed-composer-avatar" aria-hidden="true">
            {initial}
          </span>
          <div className="compose-body">
            <textarea
              ref={textRef}
              className="compose-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={trade ? tradePrompt(trade) : "What's the market telling you?"}
              aria-label="Write a post"
              rows={3}
            />
            {trade && (
              <div className="compose-attachment compose-attachment--trade" key={trade.id}>
                <TradeCard
                  trade={trade}
                  onRemove={() => {
                    setTrade(null);
                    setTradeTopic(null);
                  }}
                />
              </div>
            )}
            {poll && <PollEditor poll={poll} onChange={setPoll} onRemove={() => setPoll(null)} />}
            {photos.length > 0 && (
              <div className={`compose-photos post-media${photos.length > 1 ? " post-media--grid" : ""}`} data-count={photos.length}>
                {photos.map((photo, i) => (
                  <div key={photo.src} className="compose-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview */}
                    <img src={photo.src} alt={`Attached image ${i + 1}`} />
                    <button type="button" className="compose-media-remove" aria-label={`Remove image ${i + 1}`} onClick={() => removePhoto(i)}>
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {gif && (
              <div className="compose-gif post-media">
                <GifShot shot={{ kind: "gif", gif, alt: `${gifById(gif).caption} GIF` }} />
                <button type="button" className="compose-media-remove" aria-label="Remove GIF" onClick={() => setGif(null)}>
                  <CloseIcon />
                </button>
              </div>
            )}
            {notice && (
              <p className="compose-notice" role="status">
                {notice}
              </p>
            )}
          </div>
        </div>
        <div className="compose-controls" ref={toolbarRef}>
          <TopicRow
            selected={topics}
            suggested={suggestedTopics}
            known={knownTopics}
            menuOpen={panel === "topics"}
            moreRef={topicsButton}
            onToggle={toggleTopic}
            onToggleMenu={() => toggle("topics")}
            onCloseMenu={() => {
              setPanel(null);
              topicsButton.current?.focus();
            }}
          />
          <div className="compose-toolbar">
            <div className="compose-tools" role="toolbar" aria-label="Add to your post">
              <button
                ref={tradeButton}
                type="button"
                className={`compose-tool compose-tool--trade${trade ? " is-attached" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={panel === "trade"}
                onClick={() => toggle("trade")}
              >
                <TrendIcon />
                {trade ? "Trade ✓" : "Trade"}
              </button>
              <button
                type="button"
                className="compose-tool"
                aria-label="Add photos"
                title={mediaTaken ? "Photos can't go with a GIF or poll" : photos.length >= MAX_PHOTOS ? `Up to ${MAX_PHOTOS} photos` : "Photos"}
                disabled={mediaTaken || photos.length >= MAX_PHOTOS}
                onClick={() => fileRef.current?.click()}
              >
                <ImageIcon />
              </button>
              <button
                ref={gifButton}
                type="button"
                className="compose-tool"
                aria-label="Add a GIF"
                title={photos.length > 0 || poll ? "A GIF can't go with photos or a poll" : "GIF"}
                aria-haspopup="dialog"
                aria-expanded={panel === "gif"}
                disabled={photos.length > 0 || poll !== null}
                onClick={() => toggle("gif")}
              >
                <GifIcon />
              </button>
              <button
                type="button"
                className="compose-tool"
                aria-label="Add a poll"
                title={photos.length > 0 || gif ? "A poll can't go with photos or a GIF" : "Poll"}
                aria-pressed={poll !== null}
                disabled={photos.length > 0 || gif !== null}
                onClick={() => setPoll((current) => current ?? { choices: ["", ""], duration: "1d" })}
              >
                <PollIcon />
              </button>
              <button
                ref={emojiButton}
                type="button"
                className="compose-tool"
                aria-label="Add emoji"
                title="Emoji"
                aria-haspopup="dialog"
                aria-expanded={panel === "emoji"}
                onClick={() => toggle("emoji")}
              >
                <EmojiIcon />
              </button>
            </div>
            <CharRing count={chars} />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(event) => {
                void addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            {panel === "trade" && (
              <TradePicker state={trades} selectedId={trade?.id ?? null} onPick={pickTrade} onRetry={reloadTrades} onClose={() => {
                setPanel(null);
                tradeButton.current?.focus();
              }} />
            )}
            {panel === "gif" && (
              <GifPicker
                onPick={(id) => {
                  setGif(id);
                  setPanel(null);
                  textRef.current?.focus();
                }}
                onClose={() => {
                  setPanel(null);
                  gifButton.current?.focus();
                }}
              />
            )}
            {panel === "emoji" && (
              <EmojiPicker
                onPick={insertEmoji}
                onClose={() => {
                  setPanel(null);
                  emojiButton.current?.focus();
                }}
              />
            )}
          </div>
        </div>
      </div>
      <p className="compose-hint">
        {isSignedIn ? (
          <>
            Posting as <strong>{name}</strong>
          </>
        ) : (
          "Sign in to post — your draft stays here"
        )}
        <span className="compose-hint-keys">
          {" · "}
          <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> to post
        </span>
      </p>
    </form>
  );
}
