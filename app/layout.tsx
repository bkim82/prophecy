import type { Metadata } from "next";
import Link from "next/link";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ActiveMatchBar } from "./ActiveMatchBar";
import { BalancePill } from "./BalancePill";
import { TabNav } from "./TabNav";
import { ThemeToggle } from "./ThemeToggle";
import { THEME_INIT_SCRIPT } from "./theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Duel — Live trading games",
  description: "Compete on live crypto markets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ClerkProvider>
          <header className="app-header">
            <div className="app-header-inner">
              <div className="header-left">
                <Link href="/" className="brand">DUEL</Link>
                <TabNav />
              </div>
              <div className="header-actions">
                <Link href="/duel" className="duel-cta">
                  <span aria-hidden="true">⚔</span> DUEL
                </Link>
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
