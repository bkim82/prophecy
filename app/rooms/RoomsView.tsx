"use client";

import { useState } from "react";
import { LockIcon } from "@/app/icons";
import { RoomChat } from "@/app/rooms/RoomChat";
import {
  ROOMS,
  USER_ROOM_ID,
  USER_SUBRANK,
  canChatInRoom,
  roomStatus,
  type RoomId,
} from "@/app/lib/roomsMocks";

export function RoomsView() {
  const [roomId, setRoomId] = useState<RoomId>(USER_ROOM_ID);
  const room = ROOMS.find((r) => r.id === roomId) ?? ROOMS[0];
  const canChat = canChatInRoom(room.id);

  return (
    <main className="feed-shell rooms-shell" data-room={room.id}>
      <div className="feed-main">
        <nav className="room-switcher" aria-label="Rooms">
          {ROOMS.map((r) => {
            const status = roomStatus(r.id);
            return (
              <button
                type="button"
                key={r.id}
                data-room={r.id}
                className={`room-switcher-tab${r.id === room.id ? " is-active" : ""}`}
                aria-pressed={r.id === room.id}
                onClick={() => setRoomId(r.id)}
              >
                <span className="room-gem" aria-hidden="true" />
                {r.rankLabel}
                {status === "locked" && <LockIcon className="room-switcher-lock" />}
              </button>
            );
          })}
        </nav>

        <section className="feed-heading room-hero">
          <div className="room-heading-row">
            <div>
              <span className="eyebrow">{room.eyebrow}</span>
              <h1 className="display-font">{room.label}</h1>
              <span className="muted">{room.tagline}</span>
            </div>
            <span className="room-chip">
              <span className="room-chip-dot" aria-hidden="true" />
              {room.online} online
            </span>
          </div>
        </section>

        <RoomChat key={room.id} room={room} canChat={canChat} userSubrank={USER_SUBRANK} />
      </div>
    </main>
  );
}
