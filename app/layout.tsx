import type { Metadata } from "next";
import { Cinzel, IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import { headers } from "next/headers";
import { AccountMenu } from "./AccountMenu";
import { ActiveMatchBar } from "./ActiveMatchBar";
import { AuthProvider, SignedIn, type AuthConfiguration } from "./auth/AuthProvider";
import { BalancePill } from "./BalancePill";
import { HandleGate } from "./HandleGate";
import { LiveChallenges } from "./LiveChallenges";
import { MessagesButton } from "./MessagesButton";
import { MessagesDock } from "./MessagesDock";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileChromeAutoHide } from "./MobileChromeAutoHide";
import { NotificationsMenu } from "./NotificationsMenu";
import { TabNav } from "./TabNav";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "./theme";
import { ThemeToggle } from "./ThemeToggle";
import { embeddedWalletAuthEnabled } from "@/lib/embeddedWalletFeature";
import { handleFor } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";
import "./globals.css";

// Cinzel carries the ancient-inscription weight for headings/brand; Inter
// keeps body copy legible; IBM Plex Mono gives prices, timers, and balances
// a console/oracle-readout feel. See the font-family assignments in
// globals.css (.display-font, .tabular-nums).
const cinzel = Cinzel({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-cinzel" });
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Prophecy — Live market arenas",
  description: "Wager your foresight against the market. Live crypto arenas, decided in seconds.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts sends a per-request nonce CSP; Next.js only stamps that nonce on
  // scripts while rendering a request, so a prerendered page's scripts would
  // all be blocked. Reading headers makes every route render dynamically.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  let authConfig: AuthConfiguration = { provider: "clerk" };
  if (embeddedWalletAuthEnabled()) {
    const projectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID;
    if (!projectId) throw new Error("NEXT_PUBLIC_CDP_PROJECT_ID is required when embedded wallet auth is enabled");
    authConfig = { provider: "cdp", projectId };
  }
  // The account menu heads with your @handle, not the provider's name/email.
  // Profile saves call refresh(), which re-renders this layout with the new one.
  const viewer = await getViewer();
  const handle = viewer ? await handleFor(viewer.userId) : null;

  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      className={`${cinzel.variable} ${inter.variable} ${plexMono.variable}`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider config={authConfig}>
          <header className="app-header">
            <div className="app-header-inner">
              <div className="desktop-header-content">
                <Link href="/" className="brand">PROPHECY</Link>
                <TabNav />
                <div className="header-actions">
                  <ThemeToggle />
                  <SignedIn><BalancePill /></SignedIn>
                  <SignedIn><MessagesButton /></SignedIn>
                  <SignedIn><NotificationsMenu /></SignedIn>
                  <AccountMenu handle={handle} />
                </div>
              </div>
              <div className="mobile-header-content">
                <Link href="/" className="brand">PROPHECY</Link>
                <div className="mobile-header-actions">
                  <ThemeToggle />
                  <SignedIn><BalancePill /></SignedIn>
                  <SignedIn><MessagesButton /></SignedIn>
                  <SignedIn><NotificationsMenu /></SignedIn>
                  <div className="mobile-account-control">
                    <AccountMenu compact handle={handle} />
                  </div>
                </div>
              </div>
            </div>
          </header>
          {/* One heartbeat for both header layouts' bells: presence + incoming challenges + unread messages. */}
          <SignedIn><LiveChallenges /></SignedIn>
          {/* One dock for both header layouts' Messages buttons, bottom-right. */}
          <SignedIn><MessagesDock /></SignedIn>
          {/* Signed in without an @handle: pick one before anything else. */}
          <SignedIn><HandleGate initiallyNeeded={viewer !== null && handle === null} serverSignedIn={viewer !== null} /></SignedIn>
          {children}
          <MobileBottomNav />
          <MobileChromeAutoHide />
          <ActiveMatchBar />
        </AuthProvider>
      </body>
    </html>
  );
}
