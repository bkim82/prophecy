# wallet trading (buy/sell/swap) — plan

Status: not built. Send/Swap are UI-only stubs today (`app/wallet/ActionSheets.tsx`,
`docs/roadmap.md` "Wallet Deposit/Send/Swap are UI-only"). This is the plan to make
them real on-chain actions on the connected Base wallet, with the security
protocol baked in rather than bolted on after. Out of scope: the 24h Portfolio
game's Embers economy (`docs/portfolio.md`) and Sanctum's mock balance
(`docs/sanctum.md`) — those stay play-money and untouched.

## Non-negotiable invariants (apply to every phase)

- **No custody, ever.** The server never holds a key, never constructs a tx the
  user didn't see, never has signing authority. Every new `/api/wallet/*` route
  added for this work is a read-only quote/lookup proxy, same shape as
  `app/api/wallet/holdings/route.ts` today — validated input, no auth, cheap to
  abuse-proof (see Security protocols).
- **Signing only through the existing provider boundary.** `app/lib/wallet.ts
  getWalletProvider()` (Coinbase Wallet SDK) is the only place a signature or
  broadcast is requested (`eth_sendTransaction`, `eth_signTypedData_v4`). Never
  add a seed-phrase/private-key input anywhere, never add a second wallet
  connector that bypasses this boundary.
- **Exact integer math, never float round-trip.** `lib/alchemy.ts
  getWalletHoldings` already discards a token's `decimals` into a float `qty`
  (`balance = Number(raw) / 10 ** decimals`), and `app/wallet/types.ts Coin` drops
  `decimals` entirely. Any code that builds a real transaction must reconstruct
  the exact smallest-unit integer from the token's own `decimals` — reusing
  `WalletTokenHolding.decimals` or re-fetching metadata — never
  `Math.round(qty * 10**decimals)` on a value that already lost precision
  going through a float.
- **Chain-bound.** Every send/swap path re-checks `isBaseChain(wallet.chainId)`
  (`app/lib/wallet.ts:60`) immediately before building the tx, not just when the
  sheet opened — `chainChanged` can fire mid-flow (`useWalletConnection.ts:51`).

## Security protocols

| Risk | Protocol |
| --- | --- |
| Malicious/compromised quote response pointing funds at an attacker contract | Pin the router/Permit2 contract address(es) client-side; refuse to build a tx against any `to` address not on that allow-list, even if a quote response says otherwise |
| Stale price between quote and send | Short quote TTL (~20–30s); re-quote automatically if the user pauses past it; enforce `minOut`/`amountOutMinimum` from slippage tolerance in the tx itself, not just shown as a UI estimate |
| Unbounded token approval | Default to exact-amount approval (or Permit2 time-boxed signature allowance) per swap; infinite `MAX_UINT256` approval only behind an explicit opt-in toggle, with a visible "Revoke" action once granted |
| Wrong-amount send from decimal/precision bugs | Exact-integer math invariant above; a client-side "you are sending exactly X.XXXXXX SYMBOL to 0x..." preview rendered from the same integer that goes on-chain, not recomputed separately |
| Sending to the wrong address | Full checksum-validated address required (reuse/extend `ADDRESS_RE` pattern from `app/api/wallet/holdings/route.ts:5`); flag self-send and flag a destination equal to a known token contract address; no ENS resolution in v1 (a resolver is itself a trust dependency — add only with a pinned, audited resolver if ever needed) |
| User trained to blind-approve wallet popups | App-level confirmation screen (amount, destination/route, est. fee) always shown *before* the wallet's own popup, so the wallet popup is a second, independently-readable check, not the only one |
| Chain switched mid-flow | Re-validate `chainId` right before signing; abort and re-prompt rather than silently sending on the wrong chain |
| Reporting a failed/dropped tx as success | Track every submission by hash, poll for a receipt (confirmed/failed/replaced), never flip UI to "success" on broadcast alone |
| Metered endpoint abuse (quote/search proxy run up API costs) | Same no-auth-but-cheap posture as existing wallet routes: strict input validation, short server-side cache for identical quote requests, basic per-IP rate limit before this is exposed to real traffic (carried over from the earlier wallet security review — not yet implemented for the existing no-auth routes either) |
| Future privileged, per-wallet data (trade history, saved contacts) | Do **not** trust a client-supplied `address` query param for anything non-public, ever. If this is needed later, require a SIWE (EIP-4191/4361) signature challenge first — there is no signature-based auth anywhere in the app today, and none of the phases below need one |

## Phases

### Phase 1 — Send (native ETH + ERC-20 `transfer`)

- Extend `app/wallet/ActionSheets.tsx SendSheet` past input-collection: build the
  tx (native value transfer, or ERC-20 `transfer(to, amount)` call data for a
  token), run it through the app-level confirmation screen, then
  `provider.request({ method: "eth_sendTransaction", params: [...] })`.
  Reject/clear on user rejection (same catch-and-message idiom as
  `useWalletConnection.ts connect`).
- Pending state: track `{hash, status}` client-side (new small hook, e.g.
  `app/wallet/usePendingTx.ts`), poll `eth_getTransactionReceipt` via the same
  provider until confirmed/failed. Surface it as a pending row so the UI doesn't
  wait on Alchemy's indexing lag.
- On confirm, invalidate the 20s holdings cache for this address early (new
  tiny server endpoint or just force the client's next poll) instead of waiting
  out `BALANCE_TTL_MS` (`lib/alchemy.ts:12`).

### Phase 2 — Swap (Buy/Sell on any Base token)

- New read-only route, e.g. `GET/POST /api/wallet/quote`, server-side proxy to
  a DEX aggregator for a price + route + router address — provider choice goes
  through the Marketplace flow at implementation time (not decided in this
  doc); the allow-list protocol above applies regardless of which aggregator is
  picked.
- `app/wallet/ActionSheets.tsx SwapSheet`: add slippage tolerance control
  (sane default, capped max), re-quote-on-stale, approval step (check
  `allowance` via `eth_call`, request `approve`/Permit2 signature only if
  short), then build and send the swap tx through the same confirmation +
  pending-tx machinery as Phase 1.
- Wire `WalletDashboard.tsx openBuy`/`openSell` (already preset the sheet with
  `initialFrom`/`initialTo`/`extraToken`, `app/wallet/WalletDashboard.tsx:117-126`)
  and `CoinDetailPanel`'s Buy/Sell straight through — no new entry points needed,
  the preset plumbing already exists.

### Phase 3 — Activity unification

- Resurrect `getWalletActivity`/`GET /api/wallet/activity` (`lib/alchemy.ts`,
  still implemented, just has no UI caller per `docs/roadmap.md`) merged with
  the locally-tracked pending txs from Phases 1–2, so a just-broadcast tx
  appears immediately and later reconciles with the indexed on-chain row
  instead of two disconnected lists.

### Explicitly deferred

- ENS resolution for Send.
- SIWE/signature-based auth for any privileged, non-public data — only add if
  a feature actually needs it, with its own review at that point.
- Cross-chain bridging — stays Base-only, matching `appChainIds: [8453]`
  (`app/lib/wallet.ts:20`).

## Open decisions (need a call before Phase 2 starts)

- Which DEX aggregator/router (via Marketplace discovery at build time).
- Default slippage tolerance and max cap.
- Default approval mode (exact vs. opt-in infinite).
