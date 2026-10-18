"use client";

import { useEffect, useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { createSendIntent, confirmIntent, searchRecipients, type WalletRecipient } from "@/app/lib/embeddedWallet/client";
import { walletTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { formatUnits } from "@/app/lib/embeddedWallet/intents";
import { useSubmitTypedIntent } from "@/app/lib/embeddedWallet/sign";
import { GAS_ALLOWANCE_RAW, USDC_BASE, curatedToken } from "@/app/lib/embeddedWallet/tokens";
import { ActionSheet } from "./ActionSheet";
import type { Coin } from "./types";

// See docs/wallet.md: Deposit shows the canonical address with copy-to-clipboard;
// Send (USDC only) signs through app/lib/embeddedWallet/sign.ts; Swap is still a UI preview.

export function DepositSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  };
  return (
    <ActionSheet title="Deposit" onClose={onClose}>
      <p className="wd-sheet-copy">Send USDC on Base to this address. Other Prophecy users can send to your @username.</p>
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
  label: string | null;
};

type Recipient = { address: string; label: string | null };

// AA3x / -32002 come back when the ERC-20 paymaster can't collect the USDC gas fee.
function submitErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  if (/AA3\d|-32002|allowance|insufficient/i.test(message)) return "Not enough USDC to cover the amount plus gas.";
  return message || "Could not submit transaction.";
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
      {error && <p className="wd-sheet-note" role="alert">{error}</p>}
    </>
  );
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function recipientLabel(recipient: WalletRecipient) {
  return recipient.handle ? `@${recipient.handle}` : recipient.displayName ?? recipient.address;
}

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
          <span>{value.label ?? <code>{value.address}</code>}</span>
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
          if (ADDRESS_RE.test(next.trim())) onChange({ address: next.trim().toLowerCase(), label: null });
        }}
        placeholder="@username or 0x address"
        spellCheck={false}
        autoComplete="off"
      />
      {searching && results.length > 0 && (
        <ul className="wd-sheet-recipient-list">
          {results.map((recipient) => (
            <li key={recipient.address}>
              <button type="button" onClick={() => onChange({ address: recipient.address.toLowerCase(), label: recipientLabel(recipient) })}>
                <strong>{recipientLabel(recipient)}</strong>
                {recipient.handle && recipient.displayName && <span>{recipient.displayName}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

export function SendSheet({
  accountAddress,
  coins,
  onClose,
}: {
  accountAddress: string;
  coins: Coin[];
  onClose: () => void;
}) {
  const { provider } = useAppAuth();
  const token = curatedToken(USDC_BASE)!;
  const balance = coins.find((coin) => coin.address.toLowerCase() === USDC_BASE)?.qty ?? 0;
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<PreparedSend | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = walletTransactionsEnabled() && provider === "cdp";

  return (
    <ActionSheet title="Send USDC" onClose={onClose}>
      {hash ? (
        <>
          <p className="wd-sheet-note">Submitted to Base. This is pending until a receipt confirms inclusion.</p>
          <code>{hash}</code>
        </>
      ) : prepared ? (
        <div className="wd-sheet-form">
          <p className="wd-sheet-note">Review every field. Blockchain transfers are irreversible.</p>
          <dl>
            <div><dt>From</dt><dd><code>{accountAddress}</code></dd></div>
            <div><dt>Network</dt><dd>Base (8453)</dd></div>
            <div><dt>Amount</dt><dd>{prepared.amount} {prepared.symbol}</dd></div>
            <div><dt>To</dt><dd>{prepared.label && <>{prepared.label}<br /></>}<code>{prepared.recipient}</code></dd></div>
            <div><dt>Gas</dt><dd>Paid in USDC (usually cents, at most {formatUnits(GAS_ALLOWANCE_RAW, token.decimals)} USDC)</dd></div>
          </dl>
          <CdpSendSubmit prepared={prepared} onSubmitted={setHash} />
          <button type="button" className="wd-sheet-swap-flip" onClick={() => setPrepared(null)}>Back</button>
        </div>
      ) : (
        <form
          className="wd-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!recipient || !enabled) return;
            setPending(true);
            setError(null);
            const idempotencyKey = crypto.randomUUID();
            void createSendIntent({
              idempotencyKey,
              tokenAddress: token.address,
              recipient: recipient.address,
              amount,
            })
              .then(({ intent }) => confirmIntent(intent.id))
              .then(({ intent }) => setPrepared({
                id: intent.id,
                symbol: token.symbol,
                amount,
                recipient: recipient.address,
                label: recipient.label,
              }))
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not prepare send."))
              .finally(() => setPending(false));
          }}
        >
          <RecipientField value={recipient} onChange={setRecipient} />
          <label className="wd-sheet-field">
            <span>Amount (USDC) · balance {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
          </label>
          <button type="submit" className="wd-sheet-primary-button" disabled={!enabled || pending || !recipient || !amount}>
            {pending ? "Preparing…" : "Review send"}
          </button>
          {!enabled && <p className="wd-sheet-note">Sending is currently disabled.</p>}
          {error && <p className="wd-sheet-note" role="alert">{error}</p>}
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
