import type { Metadata } from "next";
import Link from "next/link";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import { BalancePill } from "./BalancePill";
import "./globals.css";

export const metadata: Metadata = {
  title: "Duel — Live trading games",
  description: "Compete on live crypto markets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <header className="app-header">
            <div className="app-header-inner">
              <Link href="/" className="brand">DUEL</Link>
              <div className="header-actions">
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
        </ClerkProvider>
      </body>
    </html>
  );
}
