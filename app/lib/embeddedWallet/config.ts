export function walletTransactionsEnabled() {
  return process.env.NEXT_PUBLIC_WALLET_TRANSACTIONS_ENABLED === "true";
}

export function walletServerTransactionsEnabled() {
  return process.env.WALLET_TRANSACTIONS_ENABLED === "true";
}

export function walletOnrampEnabled() {
  return process.env.WALLET_ONRAMP_ENABLED === "true";
}
