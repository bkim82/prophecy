# rooms

Rank-gated group-chat placeholder. UI-only pass: no backend, no persistence, no real-time messaging. Establishes the nav + concept, not the full feature — see [roadmap.md](roadmap.md) "Not built".

- Route: `/rooms` (`app/rooms/page.tsx`), linked from the header's `Feed`/`Rooms` tabs (`app/TabNav.tsx`).
- Deliberately NOT a feed: no follower counts, reposts, or public engagement metrics — messages are plain author/text/optional-chip, not `PostCard`. The loop this stands in for is play Duels → improve rank → unlock better Rooms → play increasingly skilled players.
- `app/lib/roomsMocks.ts` — hardcoded `ROOM_LADDER` (Bronze → Oracle, each `"cleared" | "current" | "locked"`) and `ROOM_MESSAGES` (author, text, optional `RoomCall` market-call chip, optional `challengeLabel`); `CURRENT_ROOM_LABEL`/`CURRENT_ROOM_SUBRANK` back the page heading. No backing computation, no ties to `app/lib/rank.ts`.
- `app/rooms/page.tsx` — reuses the existing `.feed-shell`/`.feed-main`/`.feed-sidebar`/`.panel`/`.sidebar-panel`/`.sidebar-row` layout primitives from [feeds.md](feeds.md) rather than introducing a new shell. Chat messages render via local `.chat-panel`/`.chat-message`/`.chat-author`/`.chat-text`/`.chat-chips`; a market call renders as a compact `.room-call-chip` (not the full `MarketCallCard` from `app/PostCard.tsx` — too heavy for a chat bubble); `⚔ Challenge` buttons (`.room-challenge-btn`) are visual only, same non-handler status as the feed's `⚔ Challenge` (`app/PostMenu.tsx`).
- Rank ladder renders in the sidebar as `.sidebar-row.room-rank-row--{cleared,current,locked}`; locked rooms show a "Locked" pill (`.room-rank-lock`), current room is bolded.
- No gating logic exists yet — the page always renders the Gold Room view regardless of any rank. A real implementation needs a per-user rank (see `app/lib/rank.ts` stub) to pick which room/messages to show and to lock the chat composer.
