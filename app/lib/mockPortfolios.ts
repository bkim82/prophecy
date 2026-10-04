// Mock 24h Portfolio snapshots for the Portfolio tab on /profile/[handle].
// Shaped like a real session (docs/portfolio.md: Base meme coins, spot or
// 1/2/3/5× leverage lots) but static. Only the server page imports this, and
// it hands a portfolio to the client only when the viewer's rank clears the
// gate (app/lib/rank.ts canViewPortfolio), so a locked one never reaches the
// browser.
export type PortfolioLot = {
  symbol: string;
  kind: "spot" | "leverage";
  side?: "long" | "short";
  leverage?: number;
  value: number;
  pnlPct: number;
};

export type ProfilePortfolio = { equity: number; pnlPct: number; endsIn: string; lots: PortfolioLot[] };

export const PORTFOLIOS: Record<string, ProfilePortfolio> = {
  "@vesper": {
    equity: 184200,
    pnlPct: 3.1,
    endsIn: "6h 12m",
    lots: [
      { symbol: "BRETT", kind: "leverage", side: "short", leverage: 5, value: 40000, pnlPct: 18.2 },
      { symbol: "HIGHER", kind: "spot", value: 22500, pnlPct: 6.4 },
      { symbol: "TOSHI", kind: "leverage", side: "long", leverage: 2, value: 15000, pnlPct: -2.8 },
      { symbol: "KEYCAT", kind: "spot", value: 8200, pnlPct: 41.0 },
    ],
  },
  "@juno_dx": {
    equity: 64300,
    pnlPct: 5.6,
    endsIn: "11h 40m",
    lots: [
      { symbol: "DEGEN", kind: "spot", value: 18000, pnlPct: 9.8 },
      { symbol: "BRETT", kind: "leverage", side: "long", leverage: 3, value: 12000, pnlPct: 7.1 },
      { symbol: "MOCHI", kind: "spot", value: 6400, pnlPct: -6.5 },
    ],
  },
  "@nova_trades": {
    equity: 12480,
    pnlPct: 8.4,
    endsIn: "9h 05m",
    lots: [
      { symbol: "BRETT", kind: "spot", value: 4200, pnlPct: 12.3 },
      { symbol: "DEGEN", kind: "leverage", side: "long", leverage: 3, value: 2100, pnlPct: 21.5 },
      { symbol: "TOSHI", kind: "spot", value: 1600, pnlPct: -4.1 },
    ],
  },
  "@zane_lfg": {
    equity: 7950,
    pnlPct: 2.7,
    endsIn: "14h 22m",
    lots: [
      { symbol: "BRETT", kind: "spot", value: 3000, pnlPct: 3.9 },
      { symbol: "SKI", kind: "leverage", side: "long", leverage: 2, value: 1500, pnlPct: 6.2 },
    ],
  },
  "@marcus_calls": {
    equity: 9410,
    pnlPct: -1.3,
    endsIn: "3h 48m",
    lots: [
      { symbol: "DEGEN", kind: "spot", value: 2800, pnlPct: -5.2 },
      { symbol: "BRETT", kind: "leverage", side: "long", leverage: 2, value: 2400, pnlPct: 3.4 },
      { symbol: "TOSHI", kind: "spot", value: 1200, pnlPct: 1.1 },
    ],
  },
  "@ren.eth": {
    equity: 3120,
    pnlPct: -6.2,
    endsIn: "20h 31m",
    lots: [
      { symbol: "DEGEN", kind: "leverage", side: "long", leverage: 5, value: 900, pnlPct: -18.4 },
      { symbol: "TOSHI", kind: "spot", value: 1100, pnlPct: 2.2 },
    ],
  },
  "@priya_p": {
    equity: 2260,
    pnlPct: 14.8,
    endsIn: "7h 56m",
    lots: [
      { symbol: "DOGINME", kind: "spot", value: 900, pnlPct: 31.0 },
      { symbol: "KEYCAT", kind: "spot", value: 400, pnlPct: -8.2 },
    ],
  },
  "@lena_q": {
    equity: 1780,
    pnlPct: 0.6,
    endsIn: "18h 03m",
    lots: [{ symbol: "BRETT", kind: "spot", value: 700, pnlPct: 0.9 }],
  },
  "@8bitkay": {
    equity: 840,
    pnlPct: 1.9,
    endsIn: "22h 10m",
    lots: [
      { symbol: "HIGHER", kind: "spot", value: 300, pnlPct: 4.4 },
      { symbol: "DOGINME", kind: "spot", value: 200, pnlPct: -3.0 },
    ],
  },
  "@tobi.sol": {
    equity: 460,
    pnlPct: -12.4,
    endsIn: "2h 15m",
    lots: [{ symbol: "SKI", kind: "leverage", side: "long", leverage: 5, value: 150, pnlPct: -24.0 }],
  },
};
