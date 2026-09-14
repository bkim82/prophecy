"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { DuelIcon } from "@/app/icons";
import type { Market } from "@/app/lib/mockPosts";
import type { RoomCall, RoomMessage } from "@/app/lib/roomsMocks";

type RoomChatProps = {
  initialMessages: RoomMessage[];
};

const MARKET_META: Record<Market, { symbol: string; symbolClass: string }> = {
  btc: { symbol: "₿", symbolClass: "btc-symbol" },
  eth: { symbol: "Ξ", symbolClass: "eth-symbol" },
  doge: { symbol: "Ð", symbolClass: "doge-symbol" },
};

function RoomCallChip({ call }: { call: RoomCall }) {
  const meta = MARKET_META[call.market];
  return (
    <span className="room-call-chip">
      <span className={`market-symbol ${meta.symbolClass}`}>{meta.symbol}</span>
      {call.side === "LONG" ? "↑" : "↓"} {call.price} · {call.window}
    </span>
  );
}

export function RoomChat({ initialMessages }: RoomChatProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, author: "You", text, time: "now" },
    ]);
    setDraft("");
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <section className="panel chat-panel" aria-label="Gold Room group chat">
      <div className="chat-stream" aria-live="polite">
        {messages.map((message) => (
          <div className={`chat-message${message.author === "You" ? " chat-message--self" : ""}`} key={message.id}>
            <span className="chat-avatar" aria-hidden="true">{message.author.slice(0, 1)}</span>
            <div className="chat-message-body">
              <div className="chat-meta">
                <span className="chat-author">{message.author}</span>
                <span className="chat-time">{message.time}</span>
              </div>
              <div className="chat-bubble">
                <p className="chat-text">{message.text}</p>
              </div>
              {(message.call || message.challengeLabel) && (
                <div className="chat-chips">
                  {message.call && <RoomCallChip call={message.call} />}
                  {message.challengeLabel && (
                    <button type="button" className="room-challenge-btn">
                      <DuelIcon /> {message.challengeLabel}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form className="chat-composer" onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="room-message">Message the Gold Room</label>
        <textarea
          id="room-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
          placeholder="Share a prophecy with the room…"
          rows={1}
        />
        <button type="submit" className="chat-send" disabled={!draft.trim()}>
          Send
        </button>
      </form>
      <p className="chat-composer-hint">Press Enter to send · Shift + Enter for a new line</p>
    </section>
  );
}
