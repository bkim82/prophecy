"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RoomChatMessage } from "@/app/lib/roomsMocks";
import { ago } from "@/app/sanctum/RoomFeed";

type RoomChatProps = {
  messages: RoomChatMessage[];
  now: number;
  online: number;
  onSend: (text: string) => void;
};

/** Compact group chat docked under the room feed. Local-only for now. */
export function RoomChat({ messages, now, online, onSend }: RoomChatProps) {
  const [draft, setDraft] = useState("");
  const streamRef = useRef<HTMLDivElement>(null);

  // Stick to the newest message, like any chat.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <section className="panel oracle-chat" aria-label="Room chat">
      <header className="oracle-panel-head">
        <h2 className="display-font">Whispers</h2>
        <span className="oracle-chat-online">{online} Oracles here</span>
      </header>
      <div className="oracle-chat-stream" ref={streamRef} aria-live="polite">
        {messages.map((m) => {
          const self = m.author === "You";
          return (
            <div key={m.id} className={`oracle-chat-msg${self ? " is-self" : ""}`}>
              <span className="oracle-chat-author">{m.author}</span>
              <span className="oracle-chat-text">{m.text}</span>
              <span className="oracle-chat-time">{ago(m.time, now)}</span>
            </div>
          );
        })}
      </div>
      <form className="oracle-chat-composer" onSubmit={send}>
        <label className="sr-only" htmlFor="oracle-chat-input">Message the room</label>
        <input
          id="oracle-chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Whisper to the room…"
          autoComplete="off"
          maxLength={240}
        />
        <button type="submit" disabled={!draft.trim()}>Send</button>
      </form>
    </section>
  );
}
