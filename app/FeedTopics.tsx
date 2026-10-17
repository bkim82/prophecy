"use client";

import type { CSSProperties, ReactNode } from "react";
import { NotInterestedIcon } from "@/app/icons";
import { TOPIC_KINDS, TOPICS, topicById, type Topic, type TopicId } from "@/app/lib/topics";

// Interest-topic pieces of the Omens feed (wired up in app/FeedSwitcher.tsx):
// the chip row, the interests picker, a topic's header, the "Mix it up"
// banner, the eyebrow + "See more" that frame each For You cover, and the
// "Not interested" undo notice.

export type TopicView = "forYou" | TopicId;

// Topic icons are neutral; the open topic's header is the one place the
// topic's own color shows (its icon inherits --topic from the header).
const topicStyle = (topic: Topic) => ({ "--topic": topic.color }) as CSSProperties;

export function TopicIcon({ topic }: { topic: Topic }) {
  return (
    <span className="topic-icon" data-kind={topic.kind} aria-hidden="true">
      {topic.glyph}
    </span>
  );
}

// ✦ home chip, one chip per followed topic, then + to edit interests. Chips
// are icons; only the selected one also shows its name (the rest carry it as
// the accessible label + hover title). The row scrolls sideways when it
// overflows.
export function TopicChips({
  interests,
  view,
  homeLabel,
  pickerOpen,
  onSelect,
  onTogglePicker,
}: {
  interests: TopicId[];
  view: TopicView;
  homeLabel: string;
  pickerOpen: boolean;
  onSelect: (view: TopicView) => void;
  onTogglePicker: () => void;
}) {
  // A topic you just unfollowed (or opened from a cover) keeps its chip while
  // it's the one on screen.
  const ids = view !== "forYou" && !interests.includes(view) ? [...interests, view] : interests;
  return (
    <div className="topic-chips">
      <div className="topic-chips-list" role="tablist" aria-label="Topics">
        <TopicChip label={homeLabel} selected={view === "forYou"} onSelect={() => onSelect("forYou")}>
          <span className="topic-chip-spark" aria-hidden="true">✦</span>
        </TopicChip>
        {ids.map((id) => {
          const topic = topicById(id);
          return (
            <TopicChip key={id} label={topic.label} short={topic.short} selected={view === id} onSelect={() => onSelect(id)}>
              <TopicIcon topic={topic} />
            </TopicChip>
          );
        })}
      </div>
      <button type="button" className="topic-chip-add" aria-expanded={pickerOpen} aria-label="Edit your interests" onClick={onTogglePicker}>
        +
      </button>
    </div>
  );
}

function TopicChip({
  label,
  short,
  selected,
  onSelect,
  children,
}: {
  label: string;
  short?: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className="topic-chip"
      aria-label={label}
      title={selected ? undefined : label}
      onClick={onSelect}
    >
      {children}
      {selected && <span className="topic-chip-label">{short ?? label}</span>}
    </button>
  );
}

export function InterestPicker({
  interests,
  muted,
  onToggle,
  onUnmute,
  onClose,
}: {
  interests: TopicId[];
  muted: TopicId[];
  onToggle: (id: TopicId) => void;
  onUnmute: (id: TopicId) => void;
  onClose: () => void;
}) {
  return (
    <section className="interest-picker" aria-labelledby="interest-picker-title">
      <div className="interest-picker-head">
        <div>
          <p className="interest-picker-title" id="interest-picker-title">
            Your interests
          </p>
          <p className="muted">Currencies, coins, companies, people, anything. Each one gets its own cover post at the top of For You.</p>
        </div>
        <button type="button" className="interest-picker-done" onClick={onClose}>
          Done
        </button>
      </div>
      {TOPIC_KINDS.map(({ kind, label }) => (
        <div key={kind} className="interest-group">
          <p className="interest-group-label">{label}</p>
          <div className="interest-options">
            {TOPICS.filter((topic) => topic.kind === kind).map((topic) => {
              const on = interests.includes(topic.id);
              return (
                <button
                  key={topic.id}
                  type="button"
                  className="interest-option"
                  aria-pressed={on}
                  onClick={() => onToggle(topic.id)}
                >
                  <TopicIcon topic={topic} />
                  {topic.label}
                  <span className="interest-option-mark" aria-hidden="true">
                    {on ? "✓" : "+"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {muted.length > 0 && (
        <div className="interest-group">
          <p className="interest-group-label">Not interested · hidden from For You</p>
          <div className="interest-options">
            {muted.map((id) => {
              const topic = topicById(id);
              return (
                <button
                  key={id}
                  type="button"
                  className="interest-option interest-option--muted"
                  aria-label={`Show ${topic.label} again`}
                  onClick={() => onUnmute(id)}
                >
                  <TopicIcon topic={topic} />
                  {topic.label}
                  <span className="interest-option-mark" aria-hidden="true">
                    ✕
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function TopicHeader({
  topic,
  count,
  following,
  onToggle,
  onNotInterested,
}: {
  topic: Topic;
  count: number;
  following: boolean;
  onToggle: () => void;
  onNotInterested: () => void;
}) {
  const kind = TOPIC_KINDS.find((k) => k.kind === topic.kind)!.singular;
  return (
    <div className="topic-header" style={topicStyle(topic)}>
      <TopicIcon topic={topic} />
      <div className="topic-header-text">
        <strong>{topic.label}</strong>
        <span className="muted">
          {kind} · {count} {count === 1 ? "post" : "posts"}
        </span>
      </div>
      <button type="button" className="topic-not-interested" onClick={onNotInterested}>
        <NotInterestedIcon />
        Not interested
      </button>
      <button type="button" className="topic-follow" aria-pressed={following} onClick={onToggle}>
        {following ? "✓ Following" : "+ Follow"}
      </button>
    </div>
  );
}

export function MixBanner({ mixed, topicCount, onToggle }: { mixed: boolean; topicCount: number; onToggle: () => void }) {
  return (
    <p className="mix-banner">
      {mixed ? `Blending all ${topicCount} of your topics, one post from each in turn.` : "Just scrolling and want a mix of all your topics?"}
      <button type="button" onClick={onToggle}>
        {mixed ? "← Back to top picks" : "Mix it up →"}
      </button>
    </p>
  );
}

export function CoverEyebrow({ topic, onNotInterested }: { topic: Topic; onNotInterested: () => void }) {
  return (
    <span className="cover-eyebrow">
      <TopicIcon topic={topic} />
      <span>
        Because you&apos;re interested in <strong>{topic.label}</strong>
      </span>
      <button type="button" className="cover-dismiss" aria-label={`Not interested in ${topic.label}`} onClick={onNotInterested}>
        <NotInterestedIcon />
        <span>Not interested</span>
      </button>
    </span>
  );
}

// Left where a post was when its topic got muted, X-style, with an Undo.
export function MutedNotice({ topic, onUndo }: { topic: Topic; onUndo: () => void }) {
  return (
    <div className="feed-muted-notice" role="status">
      <NotInterestedIcon />
      <p>
        <strong>Got it.</strong> You won&apos;t get <strong>{topic.label}</strong> suggestions in For You anymore.
      </p>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}

export function SeeMore({ topic, onClick }: { topic: Topic; onClick: () => void }) {
  return (
    <button type="button" className="cover-more" onClick={onClick}>
      <span>
        See more on <TopicIcon topic={topic} /> <strong>{topic.label}</strong>
      </span>
      <span aria-hidden="true">→</span>
    </button>
  );
}
