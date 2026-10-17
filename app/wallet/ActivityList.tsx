"use client";

import { useEffect, useRef, useState } from "react";
import { reconcileIntents } from "@/app/lib/embeddedWallet/client";
import { shortenAddress } from "@/app/lib/wallet";

// Alchemy activity is metered and rate-limited per IP, so idle polling stays slow;
// a submitted local intent polls faster until reconciliation reaches a terminal state.
const IDLE_POLL_MS = 30_000;
const PENDING_POLL_MS = 15_000;

type IntentStatus = "confirmed_by_user" | "submitted" | "included" | "reverted" | "dropped" | "replaced" | "canceled";

/** One row of GET /api/wallet/activity: confirmed Alchemy transfers plus, for the signed-in account, local intents. */
type ActivityEntry = {
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
const STATUS_LABEL: Record<IntentStatus, { text: string; tone: "pending" | "done" | "failed" }> = {
  confirmed_by_user: { text: "Awaiting signature", tone: "pending" },
  submitted: { text: "Pending", tone: "pending" },
  included: { text: "Confirmed", tone: "done" },
  reverted: { text: "Failed", tone: "failed" },
  dropped: { text: "Dropped", tone: "failed" },
  replaced: { text: "Replaced", tone: "failed" },
  canceled: { text: "Canceled", tone: "failed" },
};

const KIND_LABEL = { sent: "Sent", received: "Received", swapped: "Swapped" } as const;

const amount = (n: number | null, asset: string) =>
  n == null ? asset : `${n < 0.0001 && n > 0 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset}`;

function when(timestamp: number | null) {
  if (timestamp == null) return "";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function explorerHash(entry: ActivityEntry) {
  // A local row's `hash` can be a user-operation hash or intent id, which Basescan cannot resolve.
  return entry.local ? entry.transactionHash ?? null : entry.hash;
}

/**
 * Wallet activity timeline. Receipt status, not the Alchemy index, decides success:
 * local intents keep their pending/failed state across reloads, and a submitted
 * intent triggers POST /api/wallet/reconcile before the list refreshes.
 */
export function ActivityList({ address, onIncluded }: { address: string; onIncluded: () => void }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const onIncludedRef = useRef(onIncluded);
  useEffect(() => { onIncludedRef.current = onIncluded; }, [onIncluded]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hasSubmitted = false;

    const load = async () => {
      clearTimeout(timer);
      if (hasSubmitted) {
        // Transient provider failures leave rows submitted; the next tick retries.
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
      if (!cancelled) timer = setTimeout(tick, hasSubmitted ? PENDING_POLL_MS : IDLE_POLL_MS);
    };
    const tick = () => {
      if (document.visibilityState === "visible") void load();
      else timer = setTimeout(tick, IDLE_POLL_MS);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };

    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [address]);

  if (entries == null) {
    return <p className="wd-empty">{failed ? "Activity is unavailable right now." : "Loading activity…"}</p>;
  }
  if (entries.length === 0) {
    return <p className="wd-empty">No activity on Base yet.</p>;
  }

  return (
    <div>
      {failed && <p className="wd-empty">Couldn&apos;t refresh activity — showing the last loaded list.</p>}
      <ul className="wd-activity-list">
        {entries.map((entry) => {
          const status = entry.local && entry.status ? STATUS_LABEL[entry.status] : null;
          const hash = explorerHash(entry);
          const detail = entry.kind === "swapped"
            ? `${amount(entry.value, entry.asset)} → ${amount(entry.toValue, entry.toAsset ?? "?")}`
            : `${entry.kind === "received" ? "+" : "−"}${amount(entry.value, entry.asset)}`;
          return (
            <li key={`${entry.local ? "local" : "chain"}:${entry.hash}`} className="wd-activity-row">
              <span className="wd-activity-main">
                <strong>{KIND_LABEL[entry.kind]} {entry.asset}</strong>
                <small>
                  {entry.recipient ? `To ${shortenAddress(entry.recipient)} · ` : ""}
                  {when(entry.timestamp)}
                </small>
              </span>
              <span className="wd-activity-side">
                <span className={`tabular-nums ${entry.kind === "received" ? "wd-activity-in" : ""}`}>{detail}</span>
                <small>
                  {status && <span className={`wd-activity-status wd-activity-${status.tone}`}>{status.text}</span>}
                  {hash && (
                    <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="wd-activity-link">
                      Basescan
                    </a>
                  )}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
