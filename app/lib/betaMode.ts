/**
 * Beta mode: the Arena is the home page, and Omens (the feed), the Wallet and
 * the 24h Portfolio are hidden — out of the navs and redirected to `/` by
 * proxy.ts. Public so server components, client components and the proxy all
 * read the same flag; Next.js inlines it at build time, so toggling it needs a
 * rebuild/redeploy.
 */
export function betaModeEnabled() {
  return process.env.NEXT_PUBLIC_BETA_MODE === "true";
}

/** Paths beta mode hides; proxy.ts redirects them (and anything under them) to `/`. */
export const BETA_HIDDEN_PATHS = ["/wallet", "/duel/portfolio", "/exclusive", "/compose", "/post"];

export function isBetaHiddenPath(pathname: string) {
  return BETA_HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
