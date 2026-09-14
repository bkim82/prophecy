import { RoomChat } from "@/app/rooms/RoomChat";
import {
  CURRENT_ROOM_LABEL,
  CURRENT_ROOM_SUBRANK,
  ROOM_LADDER,
  ROOM_MESSAGES,
} from "@/app/lib/roomsMocks";

export default function RoomsPage() {
  return (
    <main className="feed-shell">
      <div className="feed-main">
        <section className="feed-heading">
          <div className="room-heading-row">
            <div>
              <span className="eyebrow">Your Circle</span>
              <h1 className="display-font">{CURRENT_ROOM_LABEL}</h1>
              <span className="muted">{CURRENT_ROOM_SUBRANK}</span>
            </div>
            <span className="room-chip">
              <span className="room-chip-dot" aria-hidden="true" />
              Gold Prophecies
            </span>
          </div>
        </section>

        <RoomChat initialMessages={ROOM_MESSAGES} />
      </div>

      <aside className="feed-sidebar">
        <section className="panel sidebar-panel">
          <h3>Room Rank</h3>
          {ROOM_LADDER.map((rank) => (
            <div className={`sidebar-row room-rank-row room-rank-row--${rank.status}`} key={rank.id}>
              <span>{rank.label}</span>
              {rank.status === "current" && <span className="sidebar-value">Current</span>}
              {rank.status === "locked" && <span className="sidebar-value room-rank-lock">Locked</span>}
            </div>
          ))}
        </section>
      </aside>
    </main>
  );
}
