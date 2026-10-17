export function embeddedWalletAuthEnabled() {
  return process.env.EMBEDDED_WALLET_AUTH_ENABLED === "true";
}
