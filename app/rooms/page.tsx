import type { Market } from "@/app/lib/mockPosts";
import {
  CURRENT_ROOM_LABEL,
  CURRENT_ROOM_SUBRANK,
  ROOM_LADDER,
  ROOM_MESSAGES,
  type RoomCall,
} from "@/app/lib/roomsMocks";

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

export default function RoomsPage() {
  return (
    <main className="feed-shell">
      <div className="feed-main">
        <section className="feed-heading">
          <span className="eyebrow">Your Room</span>
          <h1 className="display-font">{CURRENT_ROOM_LABEL}</h1>
          <span className="muted">{CURRENT_ROOM_SUBRANK}</span>
        </section>

        <div className="panel chat-panel">
          {ROOM_MESSAGES.map((message) => (
            <div className="chat-message" key={message.id}>
              <div className="chat-author">{message.author}</div>
              <p className="chat-text">{message.text}</p>
              {(message.call || message.challengeLabel) && (
                <div className="chat-chips">
                  {message.call && <RoomCallChip call={message.call} />}
                  {message.challengeLabel && (
                    <button type="button" className="room-challenge-btn">
                      <span aria-hidden="true">⚔</span> {message.challengeLabel}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
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
