"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { TopicIcon } from "@/app/FeedTopics";
import { CloseIcon } from "@/app/icons";
import {
  CUSTOM_KIND,
  CUSTOM_TOPIC_MAX,
  MAX_POST_TOPICS,
  TOPIC_KINDS,
  TOPICS,
  isCustomTopicId,
  topicById,
  topicForName,
  type Topic,
  type TopicId,
} from "@/app/lib/topics";

// The composer's topic row: the same topics as the feed's chips
// (app/lib/topics.ts), one tap to tag the post with up to MAX_POST_TOPICS.
// Chips are `suggested` (the attached trade's coin, topics the text mentions,
// your feed interests, your own topics), with picks from the "+" menu (every
// topic, grouped by kind) in front; a tapped chip stays where it is so the
// row doesn't jump under your finger. The menu's search box also makes your
// own topic: a name that isn't a topic yet becomes "#name" (topicForName).
// `known` = custom topics you already have, so they're offered again and
// reused, not doubled. A tagged post shows under those chips on the feed.
export function TopicRow({
  selected,
  suggested,
  known,
  menuOpen,
  moreRef,
  onToggle,
  onToggleMenu,
  onCloseMenu,
}: {
  selected: TopicId[];
  suggested: TopicId[];
  known: TopicId[];
  menuOpen: boolean;
  moreRef: RefObject<HTMLButtonElement | null>;
  onToggle: (id: TopicId) => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
}) {
  const full = selected.length >= MAX_POST_TOPICS;
  // Picks made in the menu lead the row (and scroll it back to the start) so
  // you can see them; chips tapped in the row keep their place.
  const [fromMenu, setFromMenu] = useState<TopicId[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const front = selected.filter((id) => fromMenu.includes(id) || !suggested.includes(id));
  const ids = [...front, ...suggested.filter((id) => !front.includes(id))];

  function toggleFromMenu(id: TopicId) {
    if (!selected.includes(id)) {
      setFromMenu((current) => [...current.filter((other) => other !== id), id]);
      listRef.current?.scrollTo({ left: 0 });
    }
    onToggle(id);
  }

  return (
    <div className="compose-topics">
      <span className="compose-topics-label" id="compose-topics-label">
        Topic
      </span>
      <div className="compose-topics-list" role="group" aria-labelledby="compose-topics-label" ref={listRef}>
        {ids.map((id) => {
          const topic = topicById(id);
          const on = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              className="compose-topic"
              aria-pressed={on}
              disabled={!on && full}
              title={!on && full ? `Up to ${MAX_POST_TOPICS} topics per post` : topic.label}
              onClick={() => onToggle(id)}
            >
              <TopicIcon topic={topic} />
              {topic.short ?? topic.label}
              {on && (
                <span className="compose-topic-mark" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        ref={moreRef}
        type="button"
        className="topic-chip-add compose-topics-more"
        aria-label="All topics, or make your own"
        title="All topics, or make your own"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={onToggleMenu}
      >
        +
      </button>
      {menuOpen && <TopicMenu selected={selected} known={known} onToggle={toggleFromMenu} onClose={onCloseMenu} />}
    </div>
  );
}

function TopicOption({ topic, on, full, onToggle }: { topic: Topic; on: boolean; full: boolean; onToggle: (id: TopicId) => void }) {
  return (
    <button type="button" className="interest-option" aria-pressed={on} disabled={!on && full} onClick={() => onToggle(topic.id)}>
      <TopicIcon topic={topic} />
      {topic.label}
      <span className="interest-option-mark" aria-hidden="true">
        {on ? "✓" : "+"}
      </span>
    </button>
  );
}

const searchKey = (text: string) => text.trim().toLowerCase().replace(/^[#$]/, "");

// Every topic grouped by kind (plus yours), or — once you type — the topics
// matching it, led by a "Create #name" button when the name is new. Enter
// picks what the name means (it's inside the composer's form, so Enter must
// not post).
function TopicMenu({ selected, known, onToggle, onClose }: { selected: TopicId[]; known: TopicId[]; onToggle: (id: TopicId) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const full = selected.length >= MAX_POST_TOPICS;
  const custom = known.filter(isCustomTopicId).map(topicById);
  const typed = query.trim() !== "";
  const match = typed ? topicForName(query, known) : null;
  const isNew = match !== null && isCustomTopicId(match) && !known.includes(match);
  const key = searchKey(query);
  const results = typed
    ? [...TOPICS, ...custom].filter((topic) => searchKey(topic.label).includes(key) || searchKey(topic.short ?? "").includes(key))
    : [];
  if (match && !isNew && !results.some((topic) => topic.id === match)) results.unshift(topicById(match));

  useEffect(() => inputRef.current?.focus(), []);

  function choose(id: TopicId) {
    if (!selected.includes(id)) onToggle(id);
    setQuery("");
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (match && (selected.includes(match) || !full)) choose(match);
  }

  const option = (topic: Topic) => (
    <TopicOption key={topic.id} topic={topic} on={selected.includes(topic.id)} full={full} onToggle={(id) => (typed ? choose(id) : onToggle(id))} />
  );

  return (
    <div className="compose-popover topic-menu" role="dialog" aria-label="Pick topics">
      <div className="compose-popover-head">
        <div>
          <h2>Topics</h2>
          <p>
            Up to {MAX_POST_TOPICS} · your post shows under each one in the feed
          </p>
        </div>
        <button type="button" className="compose-popover-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <input
        ref={inputRef}
        className="gif-picker-search topic-menu-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search, or name your own topic"
        aria-label="Search topics or name your own"
        maxLength={CUSTOM_TOPIC_MAX + 1}
      />
      {typed ? (
        <div className="interest-options">
          {isNew && match && (
            <button
              type="button"
              className="interest-option topic-menu-create"
              disabled={full}
              title={full ? `Up to ${MAX_POST_TOPICS} topics per post` : undefined}
              onClick={() => choose(match)}
            >
              <span aria-hidden="true">+</span> Create <TopicIcon topic={topicById(match)} />
              <strong>{topicById(match).label}</strong>
            </button>
          )}
          {results.map(option)}
          {match === null && (
            <p className="topic-menu-hint">Use letters or numbers, 2–{CUSTOM_TOPIC_MAX} characters.</p>
          )}
        </div>
      ) : (
        <>
          {custom.length > 0 && (
            <div className="interest-group">
              <p className="interest-group-label">{CUSTOM_KIND.label}</p>
              <div className="interest-options">{custom.map(option)}</div>
            </div>
          )}
          {TOPIC_KINDS.map(({ kind, label }) => (
            <div key={kind} className="interest-group">
              <p className="interest-group-label">{label}</p>
              <div className="interest-options">{TOPICS.filter((topic) => topic.kind === kind).map(option)}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
