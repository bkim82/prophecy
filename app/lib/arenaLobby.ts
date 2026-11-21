// What GET /api/arena/lobby returns for the Arena page (app/duel/page.tsx):
// the live-wins ticker, the featured live match, today's top callers and the
// online count. Read by lib/arenaLobby.ts from real play only. Client-safe: no
// DB import. Every list may be empty; the page hides whatever has nothing in it.

export type LobbyWin = {
  id: string;
  /** "@handle" — only accounts with a handle, never house bots. */
  handle: string;
  /** What the winner took: both wagers. */
  amount: number;
  market: string;
  timerSeconds: number;
  /** Server ms the round ended. */
  endedAt: number;
};

export type FeaturedSeat = {
  /** "@handle", display name, or a house bot's persona name. */
  name: string;
  /** Net direction of their open positions; null when flat. */
  side: "long" | "short" | null;
  /** Realized + open P&L in round dollars; null when the spot price couldn't be read. */
  pnl: number | null;
};

export type FeaturedMatch = {
  id: string;
  market: string;
  timerSeconds: number;
  /** Time left as of `serverNow`. */
  msLeft: number;
  seats: [FeaturedSeat, FeaturedSeat];
};

export type TopCaller = { handle: string; won: number; lost: number; net: number };

/** GET /api/market-stats: Coinbase's rolling 24h figures per market; a market it couldn't read is absent. */
export type MarketDay = { open: number; high: number; low: number; last: number };
export type MarketStats = Partial<Record<"btc" | "eth" | "hype", MarketDay>>;

export type ArenaLobby = {
  wins: LobbyWin[];
  featured: FeaturedMatch | null;
  leaders: TopCaller[];
  /** Signed-in accounts with the app open (presence heartbeat); null if it couldn't be read. */
  playersOnline: number | null;
  serverNow: number;
};
