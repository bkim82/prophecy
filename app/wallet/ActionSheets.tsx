"use client";

import { useEffect, useRef, useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import {
  cancelIntent,
  confirmIntent,
  createSendIntent,
  createSwapIntent,
  searchRecipients,
  type ClientIntent,
  type SwapToken,
  type WalletRecipient,
} from "@/app/lib/embeddedWallet/client";
import { walletTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { formatUnits, normalizeAmount } from "@/app/lib/embeddedWallet/intents";
import { ClaimedIntentError, useSubmitSwapIntent, useSubmitTypedIntent, useSwapQuote } from "@/app/lib/embeddedWallet/sign";
import { curatedToken, GAS_ALLOWANCE_RAW, NATIVE_ETH, SWAP_SLIPPAGE_BPS, USDC_BASE } from "@/app/lib/embeddedWallet/tokens";
import { shortenAddress } from "@/app/lib/wallet";
import { ActionSheet } from "./ActionSheet";
import { ETH_SENTINEL, type Coin } from "./types";

// See docs/wallet.md: Deposit shows the canonical address with copy-to-clipboard;
// Send (any held token, gas in USDC) and Swap (CDP swap, gas in ETH) sign through app/lib/embeddedWallet/sign.ts.
// Review screens render the server's intent, and the intent is confirmed only by the review's own button.

export function DepositSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  };
  return (
    <ActionSheet title="Deposit" onClose={onClose}>
      <p className="wd-sheet-copy">Send ETH or any Base token to this address. Other Prophecy users can send to your @username. Keep some USDC here to pay gas when you send, and a little ETH for gas when you swap.</p>
      <div className="wd-sheet-address">
        <code>{address}</code>
        <button type="button" onClick={copy} className="wd-sheet-primary-button">{copied ? "Copied" : "Copy address"}</button>
      </div>
      <p className="wd-sheet-note">Base network only — sending from another chain may not arrive.</p>
    </ActionSheet>
  );
}

/** Everything here except `handle` comes from the server's intent, not the form. */
type PreparedSend = {
  id: string;
  token: SwapToken;
  rawAmount: string;
  recipient: string;
  handle: string | null;
};

/** A picked @handle is resolved to its wallet by the server; the search never returns addresses. */
type Recipient = { kind: "handle"; handle: string } | { kind: "address"; address: string };

/**
 * Confirms the intent once, on the review button, then hands the server's
 * confirmed row to the signer. A retry after a pre-claim failure (route,
 * approval, moved price) skips the confirm the server already recorded.
 * A swap confirms with the raw minimum output its review showed.
 */
function useConfirmThenSubmit<Args extends unknown[]>(submit: (intent: ClientIntent, ...args: Args) => Promise<string>) {
  const confirmed = useRef<ClientIntent | null>(null);
  return async (id: string, minimumOutputAmount: string | undefined, ...args: Args) => {
    if (confirmed.current?.id !== id) {
      confirmed.current = (await confirmIntent(id, minimumOutputAmount)).intent;
    }
    return submit(confirmed.current, ...args);
  };
}

/** Contract address under the symbol for anything but ETH/USDC: metadata symbols can impersonate them. */
function TokenContract({ address }: { address: string }) {
  return curatedToken(address) ? null : <code className="wd-sheet-token-contract">{address}</code>;
}

// Shows the provider's own message: paymaster/policy/balance failures all read
// alike, so a friendly rewrite would hide which one happened.
// A ClaimedIntentError means this intent is spent: the sheet goes back to the
// form with the message instead of offering a retry that would 409. Only a
// failure after the signing call warns that the attempt may still land.
function submitErrorMessage(error: unknown, action: "send" | "swap" = "send") {
  const cause = error instanceof ClaimedIntentError ? error.cause : error;
  console.error(`${action} failed`, cause);
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  const code = (cause as { errorType?: unknown; code?: unknown } | null)?.errorType
    ?? (cause as { code?: unknown } | null)?.code;
  const spent = error instanceof ClaimedIntentError && error.mayHaveSubmitted
    ? " — check Activity before trying again: this attempt may still go through."
    : "";
  return `Could not ${action}${code ? ` (${String(code)})` : ""}: ${message || "unknown error"}${spent}`;
}

function CdpSendSubmit({
  prepared,
  onSubmitted,
  onRestart,
}: {
  prepared: PreparedSend;
  onSubmitted: (hash: string) => void;
  onRestart: (message: string) => void;
}) {
  const submit = useConfirmThenSubmit(useSubmitTypedIntent());
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
          void submit(prepared.id, undefined)
            .then(onSubmitted)
            .catch((cause: unknown) => {
              const message = submitErrorMessage(cause);
              if (cause instanceof ClaimedIntentError) onRestart(message);
              else setError(message);
            })
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
          {value.kind === "handle" ? <strong>@{value.handle}</strong> : <code>{value.address}</code>}
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
          if (ADDRESS_RE.test(next.trim())) onChange({ kind: "address", address: next.trim().toLowerCase() });
        }}
        placeholder="@username or 0x address"
        spellCheck={false}
        autoComplete="off"
      />
      {searching && results.length > 0 && (
        <ul className="wd-sheet-recipient-list">
          {results.map((recipient) => (
            <li key={recipient.handle}>
              <button type="button" onClick={() => onChange({ kind: "handle", handle: recipient.handle })}>
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
  // Backing out of a review cancels its unclaimed intent so it doesn't linger in Activity.
  const leaveReview = () => {
    if (prepared && !hash) void cancelIntent(prepared.id);
    setPrepared(null);
  };

  return (
    <ActionSheet title="Send" onClose={() => { leaveReview(); onClose(); }}>
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
            <strong>{formatUnits(BigInt(prepared.rawAmount), prepared.token.decimals)} {prepared.token.symbol}</strong>
            <TokenContract address={prepared.token.address} />
            <span>to {prepared.handle ? `@${prepared.handle}` : "an external address"}</span>
          </div>
          <dl className="wd-sheet-review">
            <div><dt>To</dt><dd>{prepared.handle && <strong>@{prepared.handle}</strong>}<code>{prepared.recipient}</code></dd></div>
            <div><dt>From</dt><dd><code>{accountAddress}</code></dd></div>
            <div><dt>Network</dt><dd>Base</dd></div>
            <div><dt>Gas</dt><dd>Paid in USDC · usually a cent, at most {formatUnits(GAS_ALLOWANCE_RAW, 6)}</dd></div>
          </dl>
          <p className="wd-sheet-note">Check the address. Blockchain transfers can&apos;t be reversed.</p>
          <CdpSendSubmit
            prepared={prepared}
            onSubmitted={setHash}
            onRestart={(message) => { setPrepared(null); setError(message); }}
          />
          <button type="button" className="wd-sheet-secondary-button" onClick={leaveReview}>Back</button>
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
              ...(recipient.kind === "handle" ? { recipientHandle: recipient.handle } : { recipient: recipient.address }),
              amount: value,
            })
              .then(({ intent, token }) => setPrepared({
                id: intent.id,
                token,
                rawAmount: intent.inputAmount,
                recipient: intent.recipient,
                handle: recipient.kind === "handle" ? recipient.handle : null,
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

type SwapOption = { address: string; symbol: string; priceUsd: number | null; qty: number };

type PreparedSwap = {
  id: string;
  fromToken: SwapToken;
  toToken: SwapToken;
  rawAmount: string;
};

/** Short display for raw token amounts: 4 decimals at or above 1, 4 significant digits below. */
function displayUnits(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  return value >= 1
    ? value.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function SwapReview({
  prepared,
  accountAddress,
  ethBalance,
  onSubmitted,
  onBack,
  onRestart,
}: {
  prepared: PreparedSwap;
  accountAddress: string;
  /** Display-only ETH balance, to flag a swap that can't pay its own gas. */
  ethBalance: number;
  onSubmitted: (hash: string) => void;
  onBack: () => void;
  onRestart: (message: string) => void;
}) {
  const { fromToken, toToken, rawAmount } = prepared;
  const quote = useSwapQuote({ fromToken: fromToken.address, toToken: toToken.address, fromAmount: rawAmount, account: accountAddress });
  const submit = useConfirmThenSubmit(useSubmitSwapIntent());
  const [step, setStep] = useState<"idle" | "approving" | "swapping">("idle");
  const [error, setError] = useState<string | null>(null);
  const price = quote.data?.liquidityAvailable ? quote.data : null;
  const noRoute = quote.data?.liquidityAvailable === false;
  const short = price?.issues?.balance != null;
  const busy = step !== "idle";
  const fee = price?.totalNetworkFee ?? null;
  const feeEth = fee ? Number(formatUnits(BigInt(fee), 18)) : 0;
  const ethSpent = (fromToken.address === NATIVE_ETH ? Number(formatUnits(BigInt(rawAmount), 18)) : 0) + feeEth;
  const noGas = !short && (ethBalance <= 0 || ethSpent >= ethBalance);

  return (
    <div className="wd-sheet-form">
      <div className="wd-sheet-review-amount">
        <strong>{price ? `≈ ${displayUnits(price.toAmount, toToken.decimals)} ${toToken.symbol}` : toToken.symbol}</strong>
        <TokenContract address={toToken.address} />
        <span>for {displayUnits(rawAmount, fromToken.decimals)} {fromToken.symbol}</span>
        <TokenContract address={fromToken.address} />
      </div>
      <dl className="wd-sheet-review">
        <div>
          <dt>At least</dt>
          <dd>{price ? `${displayUnits(price.minToAmount, toToken.decimals)} ${toToken.symbol}` : quote.status === "error" ? "Quote unavailable" : "Getting quote…"}</dd>
        </div>
        <div>
          <dt>Slippage</dt>
          <dd>Up to {SWAP_SLIPPAGE_BPS / 100}%. The price is re-checked right before signing and the swap is sent with a minimum no lower than the one above; if the price has fallen below it, nothing is signed</dd>
        </div>
        <div><dt>Account</dt><dd><code>{accountAddress}</code></dd></div>
        <div><dt>Network</dt><dd>Base · routed by Coinbase (CDP Swap)</dd></div>
        <div><dt>Gas</dt><dd>Paid in ETH from this account{fee ? ` · ≈ ${displayUnits(fee, 18)} ETH` : ""}</dd></div>
      </dl>
      {fromToken.address !== NATIVE_ETH && (
        <p className="wd-sheet-note">The first time you sell {fromToken.symbol}, an exact {fromToken.symbol} approval goes through before the swap, with its own small ETH gas fee.</p>
      )}
      {noRoute && <p className="wd-sheet-error" role="alert">No swap route for this pair right now. Try a different amount or token.</p>}
      {short && <p className="wd-sheet-error" role="alert">Not enough {fromToken.symbol} for this swap.</p>}
      {noGas && (
        <p className="wd-sheet-error" role="alert">
          {fromToken.address === NATIVE_ETH ? "Leave some ETH for gas: swap a smaller amount." : "Swaps pay gas in ETH. Deposit a little ETH on Base first."}
        </p>
      )}
      <button
        type="button"
        className="wd-sheet-primary-button"
        disabled={busy || !price || short || noGas}
        onClick={() => {
          if (!price) return;
          setError(null);
          setStep("swapping");
          void submit(prepared.id, price.minToAmount, setStep)
            .then(onSubmitted)
            .catch((cause: unknown) => {
              const message = submitErrorMessage(cause, "swap");
              if (cause instanceof ClaimedIntentError) onRestart(message);
              else setError(message);
            })
            .finally(() => setStep("idle"));
        }}
      >
        {step === "approving" ? `Approving ${fromToken.symbol}…` : step === "swapping" ? "Swapping…" : "Confirm swap"}
      </button>
      <button type="button" className="wd-sheet-secondary-button" disabled={busy} onClick={onBack}>Back</button>
      {error && <p className="wd-sheet-error" role="alert">{error}</p>}
    </div>
  );
}

const swapKey = (address?: string) => (address === ETH_SENTINEL ? NATIVE_ETH : address?.toLowerCase());

type TokenHit = { address: string; symbol: string; name: string; priceUsd: number | null };

/**
 * Finds any Base token to receive by name, ticker, or contract (the same
 * search as the Advanced tab). A pasted contract with no listed pool can still
 * be picked: the server resolves it on review and CDP decides if it routes.
 */
function TokenSearchField({ onPick }: { onPick: (option: SwapOption) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TokenHit[]>([]);
  const search = query.trim();
  const pasted = ADDRESS_RE.test(search) ? search.toLowerCase() : null;

  useEffect(() => {
    if (search.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/wallet/search?q=${encodeURIComponent(search)}`, { cache: "no-store", signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data: { results?: TokenHit[] }) => setResults((data.results ?? []).slice(0, 8)))
        .catch(() => { /* aborted or rate limited: keep last results */ });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);

  const shown = search.length >= 2 ? results : [];
  const unlisted = pasted !== null && !shown.some((hit) => hit.address === pasted) ? pasted : null;
  const pick = (option: SwapOption) => {
    onPick(option);
    setQuery("");
    setResults([]);
  };

  return (
    <div className="wd-sheet-field">
      <span>Or find any Base token</span>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name, ticker, or 0x contract"
        aria-label="Search any Base token to receive"
        spellCheck={false}
        autoComplete="off"
      />
      {(shown.length > 0 || unlisted) && (
        <ul className="wd-sheet-recipient-list">
          {shown.map((hit) => (
            <li key={hit.address}>
              <button type="button" onClick={() => pick({ address: hit.address, symbol: hit.symbol, priceUsd: hit.priceUsd, qty: 0 })}>
                <strong>{hit.symbol}</strong>
                <span>{hit.name} · {shortenAddress(hit.address)}</span>
              </button>
            </li>
          ))}
          {unlisted && (
            <li>
              <button type="button" onClick={() => pick({ address: unlisted, symbol: shortenAddress(unlisted), priceUsd: null, qty: 0 })}>
                <strong>{shortenAddress(unlisted)}</strong>
                <span>Unlisted contract · checked on review</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Exact-input swap through CDP (docs/wallet.md). Pay with any held coin;
 * receive any Base token (quick picks plus `TokenSearchField`). `extraToken`
 * covers the Advanced tab's case: buying a market token the wallet doesn't
 * hold yet, so it starts out as a target. `initialFrom`/`initialTo` (coin
 * addresses, "eth" for native) preselect a side without locking the picker.
 */
export function SwapSheet({
  accountAddress,
  coins,
  extraToken,
  initialFrom,
  initialTo,
  onClose,
}: {
  accountAddress: string;
  coins: Coin[];
  extraToken?: { address: string; symbol: string; priceUsd: number | null };
  initialFrom?: string;
  initialTo?: string;
  onClose: () => void;
}) {
  const { provider } = useAppAuth();
  const enabled = walletTransactionsEnabled() && provider === "cdp";
  const held: SwapOption[] = coins
    .filter((coin) => coin.qty > 0)
    .map((coin) => ({ address: tokenAddressOf(coin), symbol: coin.symbol, priceUsd: coin.priceUsd, qty: coin.qty }));
  const [found, setFound] = useState<SwapOption | null>(null);
  // Anything held, the market token being bought, a searched token, and USDC/ETH as "sell into" targets.
  const targets: SwapOption[] = [...held];
  const addTarget = (option: SwapOption) => {
    if (!targets.some((target) => target.address === option.address)) targets.push(option);
  };
  const extraKey = swapKey(extraToken?.address);
  if (extraToken && extraKey) addTarget({ address: extraKey, symbol: extraToken.symbol, priceUsd: extraToken.priceUsd, qty: 0 });
  if (found) addTarget(found);
  addTarget({ address: USDC_BASE, symbol: "USDC", priceUsd: 1, qty: 0 });
  addTarget({ address: NATIVE_ETH, symbol: "ETH", priceUsd: null, qty: 0 });

  const wantedFrom = swapKey(initialFrom);
  const startTo = swapKey(initialTo) ?? (wantedFrom === USDC_BASE ? NATIVE_ETH : USDC_BASE);
  const [to, setTo] = useState(startTo);
  // null until the user picks: the default is derived each render, so it fills
  // in once holdings load instead of sticking at "" from an empty first render.
  const [fromChoice, setFrom] = useState<string | null>(null);
  const defaultFrom = (wantedFrom && held.some((option) => option.address === wantedFrom) ? wantedFrom : null)
    ?? held.find((option) => option.address === USDC_BASE && option.address !== startTo)?.address
    ?? held.find((option) => option.address !== startTo)?.address
    ?? held[0]?.address
    ?? "";
  const from = fromChoice !== null && held.some((option) => option.address === fromChoice) ? fromChoice : defaultFrom;
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<PreparedSwap | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromOption = held.find((option) => option.address === from) ?? null;
  const toOption = targets.find((option) => option.address === to) ?? null;
  const ethBalance = held.find((option) => option.address === NATIVE_ETH)?.qty ?? 0;
  const sellingUnheld = wantedFrom !== undefined && !held.some((option) => option.address === wantedFrom);
  const typed = Number(normalizeAmount(amount));
  // Rough USD-price estimate while typing; the review screen shows CDP's real quote.
  const estimate = fromOption?.priceUsd && toOption?.priceUsd && typed > 0
    ? (typed * fromOption.priceUsd) / toOption.priceUsd
    : null;
  const canFlip = held.some((option) => option.address === to);
  // Backing out of a review cancels its unclaimed intent so it doesn't linger in Activity.
  const leaveReview = () => {
    if (prepared && !hash) void cancelIntent(prepared.id);
    setPrepared(null);
  };

  return (
    <ActionSheet title="Swap" onClose={() => { leaveReview(); onClose(); }}>
      {hash ? (
        <div className="wd-sheet-form">
          <p className="wd-sheet-sent-title">Swap submitted — waiting for Base to confirm</p>
          <p className="wd-sheet-note">Track it in the Activity tab. Your new balance shows up once the network includes it.</p>
          <code className="wd-sheet-hash">{hash}</code>
          <button type="button" className="wd-sheet-primary-button" onClick={onClose}>Done</button>
        </div>
      ) : prepared ? (
        <SwapReview
          prepared={prepared}
          accountAddress={accountAddress}
          ethBalance={ethBalance}
          onSubmitted={setHash}
          onBack={leaveReview}
          onRestart={(message) => { setPrepared(null); setError(message); }}
        />
      ) : (
        <form
          className="wd-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!enabled || !fromOption || !toOption) return;
            setPending(true);
            setError(null);
            void createSwapIntent({
              idempotencyKey: crypto.randomUUID(),
              fromToken: fromOption.address,
              toToken: toOption.address,
              amount: normalizeAmount(amount),
            })
              .then(({ intent, fromToken, toToken }) => {
                setPrepared({ id: intent.id, fromToken, toToken, rawAmount: intent.inputAmount });
              })
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not prepare swap."))
              .finally(() => setPending(false));
          }}
        >
          <label className="wd-sheet-field">
            <span>Pay with{fromOption ? ` · balance ${fromOption.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : ""}</span>
            <select value={from} onChange={(event) => setFrom(event.target.value)}>
              {held.length === 0 && <option value="">Nothing to swap yet</option>}
              {held.map((option) => <option key={option.address} value={option.address}>{option.symbol}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="wd-sheet-swap-flip"
            disabled={!canFlip}
            onClick={() => { setFrom(to); setTo(from); }}
            aria-label="Reverse swap direction"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 6h7L9.5 3.5M11 10H4l2.5 2.5" />
            </svg>
          </button>
          <label className="wd-sheet-field">
            <span>Receive</span>
            <select value={to} onChange={(event) => setTo(event.target.value)}>
              {targets.map((option) => <option key={option.address} value={option.address}>{option.symbol}</option>)}
            </select>
          </label>
          <TokenSearchField onPick={(option) => { setFound(option); setTo(option.address); }} />
          <label className="wd-sheet-field">
            <span>
              Amount ({fromOption?.symbol ?? "—"})
              {estimate != null && ` · ≈ ${estimate.toLocaleString(undefined, { maximumSignificantDigits: 4 })} ${toOption?.symbol}`}
            </span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" />
          </label>
          <button type="submit" className="wd-sheet-primary-button" disabled={!enabled || pending || !fromOption || !amount || from === to || ethBalance === 0}>
            {pending ? "Preparing…" : "Review swap"}
          </button>
          {from !== "" && from === to && <p className="wd-sheet-note">Pick two different tokens.</p>}
          {sellingUnheld && <p className="wd-sheet-note">You don&apos;t hold that token, so there&apos;s nothing of it to sell.</p>}
          {held.length === 0 && <p className="wd-sheet-note">Deposit USDC or ETH on Base to start buying.</p>}
          {held.length > 0 && ethBalance === 0 && <p className="wd-sheet-note">Swaps pay gas in ETH. Deposit a little ETH on Base before swapping.</p>}
          {!enabled && <p className="wd-sheet-note">Swapping is currently disabled.</p>}
          {error && <p className="wd-sheet-error" role="alert">{error}</p>}
        </form>
      )}
    </ActionSheet>
  );
}
