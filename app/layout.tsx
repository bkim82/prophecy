import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Duel Menu",
  description: "Pick a duel type and mode",
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
