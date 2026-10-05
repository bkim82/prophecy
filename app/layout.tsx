import type { Metadata } from "next";
import { Cinzel, IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import { ClerkProvider, Show } from "@clerk/nextjs";
import { AccountMenu } from "./AccountMenu";
import { ActiveMatchBar } from "./ActiveMatchBar";
import { BalancePill } from "./BalancePill";
import { MobileBottomNav } from "./MobileBottomNav";
import { QuickTicketBar } from "./QuickTicketBar";
import { TabNav } from "./TabNav";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "./theme";
import { ThemeToggle } from "./ThemeToggle";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
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
              <div className="desktop-header-content">
                <Link href="/" className="brand">PROPHECY</Link>
                <TabNav />
                <div className="header-actions">
                  <ThemeToggle />
                  <Show when="signed-in"><BalancePill /></Show>
                  <AccountMenu />
                </div>
              </div>
              <div className="mobile-header-content">
                <Link href="/" className="brand">PROPHECY</Link>
                <div className="mobile-header-actions">
                  <ThemeToggle />
                  <Show when="signed-in"><BalancePill /></Show>
                  <div className="mobile-account-control">
                    <AccountMenu compact />
                  </div>
                </div>
              </div>
            </div>
          </header>
          {children}
          <MobileBottomNav />
          <QuickTicketBar />
          <ActiveMatchBar />
        </ClerkProvider>
      </body>
    </html>
  );
}
