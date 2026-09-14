"use client";

import Link from "next/link";
import { Battle24h } from "../../../Battle24h";

export default function Battle24hPage() {
  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href="/"
        className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]"
      >
        ← Menu
      </Link>

      <div className="mt-4 mb-6">
        <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Make a call · 24hr Battle</p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--text)]">Which way does BTC close today?</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          One call a day, settled against the BTC close at 11:59 PM UTC.
        </p>
      </div>

      <Battle24h feedSymbol="BTC-USD" />
    </main>
  );
}
