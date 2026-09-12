export type Portfolio = {
  cash: number;
  btc: number;
};

export type ExecutedTrade = {
  portfolio: Portfolio;
  amount: number;
  qty: number;
};

/**
 * Apply one spot trade to the portfolio. The requested amount is always in
 * dollars; leverage is applied later to the displayed P&L, not to holdings.
 */
export function executeTrade(
  portfolio: Portfolio,
  side: "buy" | "sell",
  desiredAmount: number,
  price: number,
): ExecutedTrade | null {
  if (
    !Number.isFinite(desiredAmount) ||
    desiredAmount <= 0 ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  if (side === "buy") {
    const amount = Math.min(desiredAmount, portfolio.cash);
    if (amount <= 0) return null;

    const qty = amount / price;
    return {
      portfolio: {
        cash: amount === portfolio.cash ? 0 : portfolio.cash - amount,
        btc: portfolio.btc + qty,
      },
      amount,
      qty,
    };
  }

  // Calculate the quantity first. If the request covers the whole position,
  // taking the existing quantity directly avoids a rounding-dust position
  // that could otherwise make a second sell appear valid.
  const requestedQty = desiredAmount / price;
  const qty = Math.min(requestedQty, portfolio.btc);
  if (qty <= 0) return null;

  const amount = qty * price;
  return {
    portfolio: {
      cash: portfolio.cash + amount,
      btc: qty === portfolio.btc ? 0 : portfolio.btc - qty,
    },
    amount,
    qty,
  };
}
