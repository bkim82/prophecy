"use client";

import { useEffect, useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { createSendIntent, confirmIntent, searchRecipients, type WalletRecipient } from "@/app/lib/embeddedWallet/client";
import { walletTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { formatUnits, normalizeAmount } from "@/app/lib/embeddedWallet/intents";
import { useSubmitTypedIntent } from "@/app/lib/embeddedWallet/sign";
import { GAS_ALLOWANCE_RAW, NATIVE_ETH, USDC_BASE } from "@/app/lib/embeddedWallet/tokens";
import { ActionSheet } from "./ActionSheet";
import { ETH_SENTINEL, type Coin } from "./types";

// See docs/wallet.md: Deposit shows the canonical address with copy-to-clipboard;
// Send (any held token, gas in USDC) signs through app/lib/embeddedWallet/sign.ts; Swap is still a UI preview.

export function DepositSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  };
  return (
    <ActionSheet title="Deposit" onClose={onClose}>
      <p className="wd-sheet-copy">Send ETH or any Base token to this address. Other Prophecy users can send to your @username. Keep some USDC here to pay gas when you send.</p>
      <div className="wd-sheet-address">
        <code>{address}</code>
        <button type="button" onClick={copy} className="wd-sheet-primary-button">{copied ? "Copied" : "Copy address"}</button>
      </div>
      <p className="wd-sheet-note">Base network only — sending from another chain may not arrive.</p>
    </ActionSheet>
  );
}

type PreparedSend = {
  id: string;
  symbol: string;
  amount: string;
  recipient: string;
  handle: string | null;
};

/** `handle` is set only when picked from the @handle search (the server re-verifies it). */
type Recipient = { address: string; handle: string | null };

// Shows the provider's own message: paymaster/policy/balance failures all read
// alike, so a friendly rewrite would hide which one happened.
function submitErrorMessage(cause: unknown) {
  console.error("sendUserOperation failed", cause);
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  const code = (cause as { errorType?: unknown; code?: unknown } | null)?.errorType
    ?? (cause as { code?: unknown } | null)?.code;
  return `Could not send${code ? ` (${String(code)})` : ""}: ${message || "unknown error"}`;
}

function CdpSendSubmit({
  prepared,
  onSubmitted,
}: {
  prepared: PreparedSend;
  onSubmitted: (hash: string) => void;
}) {
  const submit = useSubmitTypedIntent();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="wd-sheet-primary-button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void submit(prepared.id)
            .then(onSubmitted)
            .catch((cause: unknown) => setError(submitErrorMessage(cause)))
            .finally(() => setPending(false));
        }}
      >
        {pending ? "Submitting…" : "Confirm and send"}
      </button>
      {error && <p className="wd-sheet-error" role="alert">{error}</p>}
    </>
  );
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** "@handle" / name search over Prophecy users, or a pasted 0x address. */
function RecipientField({
  value,
  onChange,
}: {
  value: Recipient | null;
  onChange: (next: Recipient | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WalletRecipient[]>([]);
  const search = query.trim();
  const searching = search !== "" && !search.startsWith("0x");

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchRecipients(search, controller.signal)
        .then(({ recipients }) => setResults(recipients))
        .catch(() => { /* aborted or rate limited: keep last results */ });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, searching]);

  if (value) {
    return (
      <div className="wd-sheet-field">
        <span>To</span>
        <div className="wd-sheet-recipient">
          {value.handle ? <strong>@{value.handle}</strong> : <code>{value.address}</code>}
          <button type="button" className="wd-sheet-recipient-clear" onClick={() => { onChange(null); setQuery(""); }}>Change</button>
        </div>
      </div>
    );
  }

  return (
    <label className="wd-sheet-field">
      <span>To</span>
      <input
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (ADDRESS_RE.test(next.trim())) onChange({ address: next.trim().toLowerCase(), handle: null });
        }}
        placeholder="@username or 0x address"
        spellCheck={false}
        autoComplete="off"
      />
      {searching && results.length > 0 && (
        <ul className="wd-sheet-recipient-list">
          {results.map((recipient) => (
            <li key={recipient.address}>
              <button type="button" onClick={() => onChange({ address: recipient.address.toLowerCase(), handle: recipient.handle })}>
                <strong>@{recipient.handle}</strong>
                {recipient.displayName && <span>{recipient.displayName}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

const tokenAddressOf = (coin: Coin) => (coin.address === ETH_SENTINEL ? NATIVE_ETH : coin.address.toLowerCase());

export function SendSheet({
  accountAddress,
  coins,
  initialAsset,
  onClose,
}: {
  accountAddress: string;
  coins: Coin[];
  /** Coin address (or "eth") to preselect, e.g. from a coin's detail panel. */
  initialAsset?: string;
  onClose: () => void;
}) {
  const { provider } = useAppAuth();
  const sendable = coins.filter((coin) => coin.qty > 0);
  const [asset, setAsset] = useState(() => {
    const preferred = sendable.find((coin) => coin.address === initialAsset)
      ?? sendable.find((coin) => tokenAddressOf(coin) === USDC_BASE)
      ?? sendable[0];
    return preferred ? tokenAddressOf(preferred) : USDC_BASE;
  });
  const coin = sendable.find((candidate) => tokenAddressOf(candidate) === asset) ?? null;
  const symbol = coin?.symbol ?? "USDC";
  const balance = coin?.qty ?? 0;
  const usdcBalance = coins.find((candidate) => tokenAddressOf(candidate) === USDC_BASE)?.qty ?? 0;
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<PreparedSend | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = walletTransactionsEnabled() && provider === "cdp";

  return (
    <ActionSheet title="Send" onClose={onClose}>
      {hash ? (
        <div className="wd-sheet-form">
          <p className="wd-sheet-sent-title">Sent — waiting for Base to confirm</p>
          <p className="wd-sheet-note">Track it in the Activity tab. It shows as Pending until the network includes it.</p>
          <code className="wd-sheet-hash">{hash}</code>
          <button type="button" className="wd-sheet-primary-button" onClick={onClose}>Done</button>
        </div>
      ) : prepared ? (
        <div className="wd-sheet-form">
          <div className="wd-sheet-review-amount">
            <strong>{prepared.amount} {prepared.symbol}</strong>
            <span>to {prepared.handle ? `@${prepared.handle}` : "an external address"}</span>
          </div>
          <dl className="wd-sheet-review">
            <div><dt>To</dt><dd>{prepared.handle && <strong>@{prepared.handle}</strong>}<code>{prepared.recipient}</code></dd></div>
            <div><dt>From</dt><dd><code>{accountAddress}</code></dd></div>
            <div><dt>Network</dt><dd>Base</dd></div>
            <div><dt>Gas</dt><dd>Paid in USDC · usually a cent, at most {formatUnits(GAS_ALLOWANCE_RAW, 6)}</dd></div>
          </dl>
          <p className="wd-sheet-note">Check the address. Blockchain transfers can&apos;t be reversed.</p>
          <CdpSendSubmit prepared={prepared} onSubmitted={setHash} />
          <button type="button" className="wd-sheet-secondary-button" onClick={() => setPrepared(null)}>Back</button>
        </div>
      ) : (
        <form
          className="wd-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!recipient || !enabled) return;
            const value = normalizeAmount(amount);
            setPending(true);
            setError(null);
            const idempotencyKey = crypto.randomUUID();
            void createSendIntent({
              idempotencyKey,
              tokenAddress: asset,
              recipient: recipient.address,
              ...(recipient.handle ? { recipientHandle: recipient.handle } : {}),
              amount: value,
            })
              .then(({ intent }) => confirmIntent(intent.id))
              .then(({ intent }) => setPrepared({
                id: intent.id,
                symbol,
                amount: value,
                recipient: recipient.address,
                handle: recipient.handle,
              }))
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not prepare send."))
              .finally(() => setPending(false));
          }}
        >
          <label className="wd-sheet-field">
            <span>Asset</span>
            <select value={asset} onChange={(event) => setAsset(event.target.value)}>
              {sendable.map((candidate) => (
                <option key={candidate.address} value={tokenAddressOf(candidate)}>{candidate.symbol}</option>
              ))}
            </select>
          </label>
          <RecipientField value={recipient} onChange={setRecipient} />
          <label className="wd-sheet-field">
            <span>Amount ({symbol}) · balance {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
          </label>
          <button type="submit" className="wd-sheet-primary-button" disabled={!enabled || pending || !recipient || !amount}>
            {pending ? "Preparing…" : "Review send"}
          </button>
          {usdcBalance === 0 && <p className="wd-sheet-note">Gas is paid in USDC. Deposit a little USDC on Base before sending.</p>}
          {!enabled && <p className="wd-sheet-note">Sending is currently disabled.</p>}
          {error && <p className="wd-sheet-error" role="alert">{error}</p>}
        </form>
      )}
    </ActionSheet>
  );
}

/**
 * `extraToken` covers the Advanced tab's case: buying/selling a token that
 * isn't (yet) in `coins` (the wallet's owned holdings), so it still shows up
 * as a pickable option. `initialFrom`/`initialTo` preselect a side (e.g. the
 * token a Buy/Sell button was pressed on) without locking the picker.
 */
export function SwapSheet({
  coins,
  extraToken,
  initialFrom,
  initialTo,
  onClose,
}: {
  coins: Coin[];
  extraToken?: { symbol: string };
  initialFrom?: string;
  initialTo?: string;
  onClose: () => void;
}) {
  const options = Array.from(new Set([...coins.map((coin) => coin.symbol), ...(extraToken ? [extraToken.symbol] : [])]));
  const [from, setFrom] = useState(initialFrom ?? options[0] ?? "ETH");
  const [to, setTo] = useState(initialTo ?? options[1] ?? options[0] ?? "ETH");
  const [amount, setAmount] = useState("");
  const [swapped, setSwapped] = useState(false);

  return (
    <ActionSheet title="Swap" onClose={onClose}>
      {swapped ? (
        <p className="wd-sheet-note">Swapping isn&apos;t wired up yet — this is a preview of the flow, no funds moved.</p>
      ) : (
        <form
          className="wd-sheet-form"
          onSubmit={(event) => { event.preventDefault(); setSwapped(true); }}
        >
          <label className="wd-sheet-field">
            <span>From</span>
            <select value={from} onChange={(event) => setFrom(event.target.value)}>
              {options.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </label>
          <button type="button" className="wd-sheet-swap-flip" onClick={() => { setFrom(to); setTo(from); }} aria-label="Reverse swap direction">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 6h7L9.5 3.5M11 10H4l2.5 2.5" />
            </svg>
          </button>
          <label className="wd-sheet-field">
            <span>To</span>
            <select value={to} onChange={(event) => setTo(event.target.value)}>
              {options.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </label>
          <label className="wd-sheet-field">
            <span>Amount</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.0" />
          </label>
          <button type="submit" className="wd-sheet-primary-button" disabled>Review swap</button>
          <p className="wd-sheet-note">Swaps remain disabled until the credentialed quote, calldata-decoder, simulation, and Paymaster gates pass.</p>
        </form>
      )}
    </ActionSheet>
  );
}
