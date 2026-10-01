import type { PositionKind, PositionSide } from "@/lib/portfolioRules";

export type SessionView = {
  id: string;
  startingBalance: number;
  committedCash: number;
  realizedPnl: number;
  availableCash: number;
  equity: number;
  status: "active" | "settled";
  startAt: number;
  endAt: number;
};

export type OpenPositionView = {
  id: string;
  kind: PositionKind;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  side: PositionSide | null;
  leverage: number | null;
  qty: number | null;
  entryPrice: number;
  committedCash: number;
  markPrice: number;
  unrealizedPnl: number;
  priceStale: boolean;
  openedAt: string;
  imageUrl: string | null;
  change24h: number | null;
};

export type ClosedPositionView = {
  id: string;
  kind: PositionKind;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  side: PositionSide | null;
  leverage: number | null;
  qty: number | null;
  entryPrice: number;
  committedCash: number;
  exitPrice: number | null;
  realizedPnl: number | null;
  closeReason: string | null;
  closedAt: string | null;
  imageUrl: string | null;
};

export type SessionHistoryEntry = {
  id: string;
  startingBalance: number;
  realizedPnl: number;
  startAt: string;
  settledAt: string | null;
};

export type SessionState = {
  serverNow: number;
  session: SessionView | null;
  positions: OpenPositionView[];
  closedPositions: ClosedPositionView[];
  history: SessionHistoryEntry[];
};

export type TokenSearchResult = {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  liquidityUsd: number;
  imageUrl: string | null;
  change24h: number | null;
  marketCapUsd: number | null;
  pairAddress: string | null;
};
