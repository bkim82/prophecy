import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTC Duel",
  description: "1v1 Bitcoin price prediction duel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
