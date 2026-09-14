import type { Metadata } from "next";
import { Cinzel, IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ActiveMatchBar } from "./ActiveMatchBar";
import { BalancePill } from "./BalancePill";
import { DuelIcon } from "./icons";
import { TabNav } from "./TabNav";
import { ThemeToggle } from "./ThemeToggle";
import { THEME_INIT_SCRIPT } from "./theme";
import "./globals.css";

// Cinzel carries the ancient-inscription weight for headings/brand; Inter
// keeps body copy legible; IBM Plex Mono gives prices, timers, and balances
// a console/oracle-readout feel. See the font-family assignments in
// globals.css (.display-font, .tabular-nums).
const cinzel = Cinzel({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-cinzel" });
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Prophecy — Live market duels",
  description: "Wager your foresight against the market. Live crypto duels, decided in seconds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${cinzel.variable} ${inter.variable} ${plexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ClerkProvider>
          <header className="app-header">
            <div className="app-header-inner">
              <div className="header-left">
                <Link href="/" className="brand">PROPHECY</Link>
                <TabNav />
              </div>
              <div className="header-actions">
                <Link href="/duel" className="duel-cta">
                  <DuelIcon className="duel-cta-icon" /> Duel
                </Link>
                <Link href="/wallet" className="wallet-cta">Wallet</Link>
                <ThemeToggle />
                <Show
                  when="signed-in"
                  fallback={
                    <SignInButton mode="modal">
                      <button className="signin-button">Sign in</button>
                    </SignInButton>
                  }
                >
                  <BalancePill />
                  <UserButton />
                </Show>
              </div>
            </div>
          </header>
          {children}
          <ActiveMatchBar />
        </ClerkProvider>
      </body>
    </html>
  );
}
