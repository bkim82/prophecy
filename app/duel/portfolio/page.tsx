import Link from "next/link";
import { PortfolioGame } from "./PortfolioGame";

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <Link href="/duel" className="inline-flex min-h-11 items-center text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]">
        ← Menu
      </Link>
      <h1 className="sr-only">24h Portfolio · Base coins</h1>
      <div className="mt-2">
        <PortfolioGame />
      </div>
    </div>
  );
}
