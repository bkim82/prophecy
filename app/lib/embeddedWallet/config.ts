export function walletTransactionsEnabled() {
  return process.env.NEXT_PUBLIC_WALLET_TRANSACTIONS_ENABLED === "true";
}

export function walletServerTransactionsEnabled() {
  return process.env.WALLET_TRANSACTIONS_ENABLED === "true";
}

export function walletOnrampEnabled() {
  return process.env.WALLET_ONRAMP_ENABLED === "true";
}

/**
 * Free gas: CDP's Paymaster sponsors every send and swap (the CDP project pays),
 * so accounts need no USDC or ETH for gas. Public so the server-built send batch
 * and the browser's signing/UI read the same flag; changing it needs a rebuild.
 */
export function walletFreeGasEnabled() {
  return process.env.NEXT_PUBLIC_WALLET_FREE_GAS === "true";
}
