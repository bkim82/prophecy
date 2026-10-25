"use client";

import { useEffect, useRef, useState } from "react";
import { SwapIcon } from "@/app/icons";
import { hasPendingBroadcasts, reconcileIntents } from "@/app/lib/embeddedWallet/client";
import { shortenAddress } from "@/app/lib/wallet";

// Alchemy activity is metered and rate-limited per IP, so idle polling stays slow;
// a submitted local intent polls faster until reconciliation reaches a terminal state,
// and an open deposit watch (see WalletDashboard) polls faster still until it lands.
const IDLE_POLL_MS = 30_000;
const PENDING_POLL_MS = 15_000;
const WATCH_POLL_MS = 10_000;

type IntentStatus = "confirmed_by_user" | "submitted" | "included" | "reverted" | "dropped" | "replaced" | "canceled";

/** One row of GET /api/wallet/activity: confirmed Alchemy transfers plus, for the signed-in account, local intents. */
export type ActivityEntry = {
  hash: string;
  kind: "sent" | "received" | "swapped";
  asset: string;
  value: number | null;
  toAsset: string | null;
  toValue: number | null;
  timestamp: number | null;
  local?: true;
  status?: IntentStatus;
  recipient?: string;
  transactionHash?: string | null;
};

// Submitted is pending, never success (docs/embedded-wallet-plan.md, transaction status vocabulary).
// Chain rows come from Alchemy's confirmed transfers, so they are always Confirmed.
const STATUS_LABEL: Record<IntentStatus, { text: string; tone: "pending" | "done" | "failed" }> = {
  confirmed_by_user: { text: "Awaiting signature", tone: "pending" },
  submitted: { text: "Pending", tone: "pending" },
  included: { text: "Confirmed", tone: "done" },
  reverted: { text: "Failed", tone: "failed" },
  dropped: { text: "Dropped", tone: "failed" },
  replaced: { text: "Replaced", tone: "failed" },
  canceled: { text: "Canceled", tone: "failed" },
};

// "Withdraw" is the dashboard's name for Send, so a sent row reads as a withdrawal.
const KIND_LABEL = { sent: "Withdrawal", received: "Deposit", swapped: "Swap" } as const;
const KIND_ICON = { sent: ArrowOutIcon, received: ArrowInIcon, swapped: SwapIcon } as const;

export const activityAmount = (n: number | null, asset: string) =>
  n == null ? asset : `${n < 0.0001 && n > 0 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset}`;

const when = (timestamp: number | null) => timestamp == null
  ? null
  : new Date(timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function explorerHash(entry: ActivityEntry) {
  // A local row's `hash` can be a user-operation hash or intent id, which Basescan cannot resolve.
  return entry.local ? entry.transactionHash ?? null : entry.hash;
}

/**
 * Wallet activity feed, shared by the overview's Recent activity, the full
 * Activity view, and the deposit watch. Receipt status, not the Alchemy index,
 * decides success: local intents keep their pending/failed state across reloads,
 * and a submitted intent triggers POST /api/wallet/reconcile before the list refreshes.
 */
export function useWalletActivity(address: string | null, { onIncluded, fast }: { onIncluded: () => void; fast: boolean }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const onIncludedRef = useRef(onIncluded);
  useEffect(() => { onIncludedRef.current = onIncluded; }, [onIncluded]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hasSubmitted = false;

    const load = async () => {
      clearTimeout(timer);
      if (hasSubmitted || hasPendingBroadcasts()) {
        // Transient provider failures leave rows submitted; the next tick retries.
        // Reconcile first re-reports any hash the signer couldn't record.
        const result = await reconcileIntents().catch(() => null);
        if (result?.intents.some((intent) => intent.status === "included")) onIncludedRef.current();
      }
      try {
        const res = await fetch(`/api/wallet/activity?address=${address}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { activity?: ActivityEntry[] };
        if (cancelled) return;
        const activity = data.activity ?? [];
        hasSubmitted = activity.some((entry) => entry.local && entry.status === "submitted");
        setEntries(activity);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) timer = setTimeout(tick, fast ? WATCH_POLL_MS : hasSubmitted ? PENDING_POLL_MS : IDLE_POLL_MS);
    };
    const tick = () => {
      if (document.visibilityState === "visible") void load();
      else timer = setTimeout(tick, IDLE_POLL_MS);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };

    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [address, fast]);

  return { entries, failed };
}

/** Activity rows; `limit` trims to the most recent few for the overview card. */
export function ActivityList({ entries, failed, limit }: { entries: ActivityEntry[] | null; failed: boolean; limit?: number }) {
  if (entries == null) {
    return <p className="wd-card-empty">{failed ? "Activity is unavailable right now." : "Loading activity…"}</p>;
  }
  if (entries.length === 0) {
    return <p className="wd-card-empty">No activity yet. Deposits and withdrawals show up here with a link to their Base record.</p>;
  }

  const shown = limit ? entries.slice(0, limit) : entries;
  return (
    <>
      {failed && <p className="wd-card-empty">Couldn&apos;t refresh activity — showing the last loaded list.</p>}
      <ul className="wd-activity-list">
        {shown.map((entry) => {
          const status = entry.local && entry.status ? STATUS_LABEL[entry.status] : { text: "Confirmed", tone: "done" as const };
          const hash = explorerHash(entry);
          const Icon = KIND_ICON[entry.kind];
          const detail = entry.kind === "swapped"
            ? `${activityAmount(entry.value, entry.asset)} → ${activityAmount(entry.toValue, entry.toAsset ?? "?")}`
            : `${entry.kind === "received" ? "+" : "−"}${activityAmount(entry.value, entry.asset)}`;
          const date = when(entry.timestamp);
          return (
            <li key={`${entry.local ? "local" : "chain"}:${entry.hash}`} className={`wd-activity-row is-${entry.kind}`}>
              <span className="wd-activity-icon" aria-hidden="true"><Icon className="h-4 w-4" /></span>
              <span className="wd-activity-main">
                <strong>{KIND_LABEL[entry.kind]}</strong>
                <small>
                  {date && <>{date} · </>}
                  {entry.recipient && <>To {shortenAddress(entry.recipient)} · </>}
                  <span className={`wd-activity-${status.tone}`}>{status.text}</span>
                </small>
              </span>
              <span className="wd-activity-side">
                <span className={`wd-activity-amount ${entry.kind === "received" ? "wd-activity-in" : ""}`}>{detail}</span>
                {hash && (
                  <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="wd-activity-link">
                    Basescan <ExternalArrow />
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ArrowInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
    </svg>
  );
}

function ArrowOutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h7v7M12 4 4 12" />
    </svg>
  );
}

export function ExternalArrow() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" />
    </svg>
  );
}
