# embedded wallet as sign-in — plan

Status: repository implementation complete through the fail-closed Send/reconciliation foundation; schema application and credentialed CDP/Base Sepolia/Paymaster/Swap/Onramp/production launch gates remain. The external Coinbase Wallet SDK flow is removed; Clerk remains only as the default cutover fallback until the CDP environment and reset gates pass. Goal: sign in with email, Google, or Apple; create a Base smart account with the account; sponsor approved transactions; offer card/Apple Pay deposits; require an explicit confirmation before every value-moving action.

- Account identity: stable CDP end-user id.
- Canonical wallet: that user's selected Base smart account, stored server-side; an address is an account attribute, not the authentication subject.
- No-custody boundary: Prophecy never receives an owner key, seed phrase, or signing authority. Delegated/server signing is off.
- Out of scope: Embers accounting (`docs/portfolio.md`), anonymous Pulse browser ids (`app/lib/playerId.ts`), and Sanctum's mock trading balance (`docs/sanctum.md`). Their identity-facing UI still migrates because `app/BalancePill.tsx` and `app/sanctum/SanctumView.tsx` use the legacy wallet provider.

## Provider decision

Use Coinbase CDP Embedded Wallets, subject to the Phase -1 compatibility and security spike.

| | CDP Embedded Wallets | Privy |
| --- | --- | --- |
| Base integration | User wallets, smart accounts, Paymaster, Onramp | Embedded wallets; separate gas/onramp integrations |
| Authentication | Built-in email/social auth or custom auth | Email, SMS, social, external-wallet auth |
| Server verification | CDP access-token validation | JWT verification |
| Key export | Supported; launch only after recovery and step-up flows pass review | Supported |

- Do not make launch acceptance criteria depend on a quoted free tier, credit, fee, country limit, or payment-method limit. Recheck [wallet pricing](https://docs.cdp.coinbase.com/wallets/pricing), Paymaster terms, and the runtime Onramp quote at implementation and launch.
- Treat Onramp fees, minimums, limits, payment methods, and eligibility as dynamic. The runtime quote/order is authoritative; UI copy must not promise `0%`, `$5 minimum`, or `$500/week` globally.
- CDP built-in authentication and custom authentication are alternative project modes, not a drop-in fallback that can coexist. Moving later requires a migration plan and a stable, non-reassignable identity claim; it is not assumed to preserve wallets automatically.

## Non-negotiable invariants

- No custody and no server signing. Never accept, log, store, or request a private key or seed phrase.
- The confirmation screen is mandatory UX but is not an independent security boundary. Browser compromise can tamper with client UI; remote CDP policies, the validating Paymaster proxy, CSP, and server authorization are separate controls.
- One application signing boundary. Only `app/lib/embeddedWallet/sign.ts` may invoke CDP sign/send APIs. Other modules submit a typed intent. Enforce the import boundary with ESLint `no-restricted-imports` (ESLint is added in Phase 0; the repo has none today).
- No arbitrary signing surface. V1 exposes typed `send` and `exact-input swap` intents only: no raw calldata, arbitrary contract call, `personal_sign`, or generic typed-data signing UI.
- Build the typed intent once. Confirmation text and calldata are derived from the same immutable raw-unit values. Immediately before signing, decode the final calls and compare every material field to the intent.
- Exact integer math end to end. Amounts, balances, allowances, gas caps, and quote values are decimal strings/`bigint`; floating-point values are display-only. Never reconstruct raw amounts with `Math.round(qty * 10 ** decimals)`.
- Base only. Every intent, quote, account, Paymaster request, receipt, and Onramp session asserts chain id `8453`. Base Sepolia is allowed only in the non-production CDP project and test environment.
- Server identity always comes from the application session. Mutation routes never accept a caller-supplied user id or wallet address. The canonical smart-account address is loaded from the database.
- Before every signature, require the active CDP browser user id and selected smart-account address to match the current application viewer and canonical database row. Mismatch signs out/fails closed.
- Durable, idempotent transaction state. Reloads, retries, two tabs, and delayed receipts must not duplicate a send/swap or lose its status.
- Fail closed on unknown account type, chain, call, selector, token, quote field, status, or policy result.

## Identity and session design

Two sessions exist and must be managed explicitly:

- CDP browser session: required for TEE-backed signing. Access tokens are short lived; CDP refresh state persists independently of the Prophecy session.
- Prophecy application session: required for server authorization. Store only an opaque, random session id in a `Secure`, `HttpOnly`, `SameSite=Lax`, host-only cookie; store its hash, CDP user id, issued/expiry times, and revocation time in `app_sessions`.

Session protocol:

1. Client signs in through CDP and obtains a fresh access token.
2. `POST /api/session` accepts it only in `Authorization: Bearer`, validates it with the server CDP SDK, extracts the stable CDP user id, and never logs or persists the token.
3. Server looks up the CDP end user/accounts, selects a Base smart account by explicit account type and chain, rejects zero or multiple candidates until product has an account-selection flow, and upserts the canonical account row.
4. Server rotates the application session id and cookie. `getViewer()` loads the user and canonical wallet from the database; it does not trust address claims cached in the cookie.
5. `DELETE /api/session` revokes the current application session; `DELETE /api/session/all` authenticates the current token and atomically revokes every live application session for that user. Client logout must also call CDP sign-out. Either side missing/expired, or identities diverging, leaves the app signed out and unable to sign.

Session requirements:

- Obtain CDP first-party-cookie limited access and configure its domain before production. CDP may otherwise fall back to local storage when third-party cookies fail; if first-party cookies cannot be enabled, reopen the provider decision because the no-local-storage requirement is not met.
- Enforce allowed `Origin`/`Host`, JSON content type, CSRF protection for every cookie-authenticated mutation, session rotation on sign-in/linking, absolute and idle expiry, and per-IP plus per-user rate limits.
- Do not merge accounts because email strings match. Linking/unlinking auth methods is an explicit, freshly authenticated operation with CDP-supported proof, audit log, user notification, and a rule that prevents removing the last recovery method.
- Require recent step-up authentication/MFA where CDP supports it for key export, account deletion, auth-method link/unlink, recovery changes, and sends above a configured threshold. If the required assurance is unavailable, defer that feature.
- Account deletion must revoke all app sessions, invoke the supported CDP deletion/revocation flow, define what happens to an onchain smart account and export access, delete personal data, and meet Apple account-deletion requirements before Apple login launches.

## Data model

- `users.id`: stable CDP user id; keep the existing `balance` (Embers) and `created_at` columns. Rows are not kept — the Phase 2 reset empties `users`.
- `users.smart_account_address`: normalized lowercase Base smart-account address; unique.
- `users.owner_address`: normalized lowercase owner EOA address; never use it as the app deposit/trading address.
- `users.wallet_chain_id`: `8453`; database check constraint.
- `users.wallet_status`: `active | locked | deleted`; unknown/non-active blocks signing.
- `users.wallet_created_at`, `users.wallet_updated_at`: audit timestamps.
- `profiles.avatar_image`, `profiles.avatar_mime`: replace the Clerk-hosted avatar, with the same size/type/serving protections as banner images.
- `app_sessions`: hashed opaque session id, `user_id`, issued/expiry/last-seen/revoked timestamps, and minimal device/audit metadata. Never store CDP tokens.
- `transaction_intents`: id, schema version, user id, idempotency key, kind, chain id, smart account, token addresses, recipient, raw input/min-output amounts, quote provider/id/expiry, normalized-call hash, user-op hash, tx hash, status, failure code, and timestamps. Unique `(user_id, idempotency_key)`.
- Normalize/checksum at boundaries, store addresses lowercase, and compare address bytes rather than display strings.
- V1 supports exactly one canonical Base smart account per CDP user. Multiple smart accounts are a blocked state, not “take the first address.”
- Atomicity: `db/index.ts` uses `drizzle-orm/neon-http`, which has no interactive transactions. Every atomic step — session rotation/revocation, intent claim, status transitions, spend counters — is one guarded statement (`UPDATE … WHERE status = <expected> RETURNING`, `INSERT … ON CONFLICT`), the `lib/balance.ts:20 reserveBalance` / `:38 creditPayout` idiom. A step that truly needs multi-statement atomicity adds the Neon WebSocket `Pool` driver for that path only.
- Schema changes: the repo has no migration files (`drizzle/` holds only `meta/`). Tables are edited in `db/schema.ts` and applied with `npm run db:push`, or a targeted `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE … IF NOT EXISTS` as `profiles` was (`docs/profiles.md`). Keep the same mechanism per environment; production applies reviewed SQL, not an unattended `push`.

Transaction status vocabulary: `created | confirmed_by_user | submitted | included | reverted | dropped | replaced | canceled`. “Submitted” is never presented as success.

## Security controls

| Risk | Required control |
| --- | --- |
| Confirmation/calldata mismatch | Immutable typed intent; confirmation rendered from it; signing boundary decodes the final smart-account calls and checks chain, account, target, selector, recipient, tokens, raw amounts, value, spender, minimum output, fee fields, and deadline. |
| XSS or compromised frontend | Strict CSP with nonces/hashes, `frame-ancestors 'none'`, narrow `connect-src`/`frame-src`, no unsafe HTML, dependency review, restricted signing imports, remote wallet policies, and short step-up windows. Document that arbitrary same-origin script is wallet-session compromise. |
| Malicious/stale swap quote | Server chooses a fixed aggregator host and constructs the request; client cannot submit a URL or calldata. Validate response schema, expiry, price impact, slippage cap, router, every decoded call, and simulate immediately before signing. Requote on expiry. |
| Quote replay/cross-user cache leak | Bind quotes/intents to user id, smart account, recipient, chain, raw amount, token pair, and expiry. Do not shared-cache executable calldata; cache only public price metadata. |
| Unbounded approval | V1 exact approval only. Batch approval plus swap atomically when the smart-account execution model guarantees atomicity; otherwise require receipt before swap. Permit2 is deferred until its allowance and signature semantics receive a separate review. No infinite approval. |
| Malicious/unusual token | Launch with a curated token list. Validate decimals and code, handle fee-on-transfer/rebasing/blacklist behavior explicitly, simulate, and reject tokens with unsupported behavior. “Any Base token” is deferred. |
| Paymaster drain | Never expose the upstream Paymaster URL. Client calls an authenticated same-origin proxy that decodes the complete user operation, including nested `execute`/batch calls, and independently enforces account, chain, target, selector, value, token, spender, recipient, raw amount, gas, per-user/day, and global caps before forwarding. Use guarded single-statement Postgres counters (no Redis exists; see Data model → Atomicity), alerts, and a kill switch. Dashboard contract allowlists alone are insufficient because they do not prove selector/calldata safety. |
| Policy bypass/self-paid malicious call | Configure the strongest supported CDP end-user operation policies for chain, contracts, methods, values, and spend limits. Verify capabilities in Phase -1; do not claim a rule the provider cannot enforce. Paymaster policy is defense in depth, not the wallet authorization boundary. |
| Wrong send destination | Validate 20-byte address, chain, zero/self address, and code at destination. Show the full address and irreversible warning. Block known token/router/system contracts in V1; no ENS. |
| Wrong amount/stale balance | Parse decimal input directly to raw units, enforce token decimals and configured limits, then re-read raw balance/allowance immediately before submission. |
| Account/session takeover | Explicit linking, no email auto-merge, recent step-up for sensitive actions, session list/revocation, security notifications, and pre-sign identity/account coherence check. |
| Duplicate submission | Generate one operation id before the first request, reuse it for every retry, enforce a unique database constraint and state-machine transition guards, disable duplicate UI, and recover by the existing user-op/tx hash. |
| Dropped/reverted/replaced transaction | Persist user-op hash and eventual transaction hash, poll bundler and chain receipts, reconcile after reload, record terminal failure, and refresh holdings only after inclusion. |
| Onramp destination tampering | Server creates the Onramp session/order from the authenticated canonical smart account with fixed Base/network and selected asset; client cannot override destination, network, or project id. Track order state and show runtime eligibility/fee/limit data. |
| API/metering abuse | Schema/body-size limits and per-IP plus per-user limits on session, quote, Paymaster, Onramp, holdings, activity, token search/prices, and receipt polling. Use request coalescing/backoff. |
| Secret/log leakage | Server-only keys in the deployment secret store; redact authorization headers, cookies, quote payloads where sensitive, user operations, and provider errors; scan builds/logging config; document rotation. No wallet secret exists. |

- Accepted residual risk: an embedded wallet has no independent wallet-extension confirmation surface, so arbitrary same-origin JavaScript can act within whatever the remote CDP policy permits. V1 therefore needs conservative per-operation and rolling value limits plus step-up for larger sends. If CDP cannot enforce limits that product/security accept, unrestricted arbitrary-recipient Send does not launch; use an external-confirmation architecture instead.

## Phases

### Phase -1 — compatibility and threat-model spike

- Install the current CDP packages in a disposable branch and verify the exact APIs against the installed Next.js version and Node runtime; follow `node_modules/next/dist/docs/` for this repository's Next.js behavior.
- Verify `createOnLogin` actually yields the intended owner plus Base smart account; record the account-object fields used to distinguish account type/chain. Do not infer the smart account from the first address.
- Verify browser-session persistence, first-party-cookie limited access, sign-out, access-token server validation, auth linking/unlinking, recovery, deletion, key export, and available step-up/MFA signals. Record exactly which key is exported and prove whether/how it recovers control of the smart account before describing export as recovery.
- Verify CDP operation-policy expressiveness and whether it can constrain contract method, native value, ERC-20 amount/spender/recipient, rolling spend, and Base-only use. Record unsupported controls.
- Build one Base Sepolia send and one exact-input swap through the intended smart-account call encoder; decode them independently and test simulation, sponsorship, user-op hash, receipt, revert, and retry behavior.
- Prove the Paymaster proxy can decode the complete user operation and nested batch format before sponsorship. No mainnet sponsorship until this is demonstrated.
- Select an aggregator only after checking API authentication, Base support, exact-input quotes, router/version stability, calldata schema, fee fields, deadline, recipient binding, rate limits, and simulation behavior.
- Run `next build` and typecheck without weakening Next's module-resolution/runtime configuration merely to satisfy an SDK. If compatibility requires a broad config downgrade, stop and reassess the provider.
- Exit artifact: recorded API versions, threat model, supported policy matrix, decoded test vectors, and explicit go/no-go decision.

### Phase 0 — CDP projects and production controls

- Create separate CDP projects/credentials for local/Base Sepolia and production/Base. Never add localhost to the production project; restrict production origins to the exact HTTPS domains.
- Configure email, Google, and Apple only after redirect/origin, recovery, account-linking, deletion, and domain ownership flows are tested. SMS stays off initially.
- Configure first-party cookies, strongest supported CDP wallet policies, Paymaster upstream, conservative sponsorship caps, alerts, and global/per-user kill switches.
- Configure Onramp allowed domains and server credentials; product copy reads runtime quotes rather than static marketing claims.
- Configuration: `NEXT_PUBLIC_CDP_PROJECT_ID` may be public; `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, upstream `CDP_PAYMASTER_URL`, `SESSION_SECRET`, and Onramp server credentials are server-only and environment-specific. `APP_ORIGIN` pins the exact public origin. `EMBEDDED_WALLET_AUTH_ENABLED` stays unset until the database and credentialed gates pass, then is set to the exact string `true`.
- Implemented locally: per-request nonce CSP/security headers (`proxy.ts`; root layout reads `x-nonce` so every route renders dynamically and the theme script is nonced, `app/layout.tsx:35`; CDP mode `/sign-in` and `/sign-up` open the CDP modal, `app/auth/EmbeddedSignInPage.tsx`), small wallet audit events/spend counters, and monitoring/incident/rollback/credential-session rotation procedures (`docs/wallet-operations.md`). Production alert wiring and provider project configuration remain external gates.
- Local tooling is present: ESLint enforces the signing/auth import boundaries, Vitest backs `npm test`, and `npm run typecheck` runs Next type generation plus TypeScript 7 (`eslint.config.mjs`, `vitest.config.mts`, `package.json`). Production CSP, monitoring, runbooks, and provider configuration remain open.

### Phase 1 — viewer adapter while Clerk still works (complete)

- Add server-only `lib/viewer.ts getViewer(): Promise<{ userId: string; smartAccountAddress: string | null } | null>` and migrate authorization checks to it before changing providers.
- Migrate all current server Clerk usage: `app/api/balance`, `app/api/match/find-or-create`, `app/api/match/recent`, `app/api/match/[id]`, `join`, `leave`, `app/api/portfolio/**`, `app/api/profile/banner`, `app/api/tokens/**`, `app/profile/actions.ts`, `app/profile/challengeActions.ts`, `app/profile/page.tsx`, and `app/profile/[handle]/page.tsx`.
- Replace `lib/opponentNames.ts` Clerk user lookups with profile/display-name data owned by Prophecy.
- Add authorization regression tests before the provider swap: signed-out rejection, ownership checks, cross-user access denial, and unchanged Embers/match/portfolio behavior.
- Docs: `docs/portfolio.md:17` and `docs/multiplayer-plan.md:13,69` describe the auth gate as Clerk `userId` — repoint to `getViewer()`.

### Phase 2 — CDP authentication and canonical account (server + client boundary feature-gated)

- Add the CDP provider/auth client and implement the dual-session protocol above. Apply the `app_sessions` table and `users` wallet columns (Data model → Schema changes) before routing real users through CDP.
- Implemented but inactive: `POST`/`DELETE /api/session` (`app/api/session/route.ts`) validates same-origin empty JSON requests, accepts the CDP token only as Bearer auth, applies database-backed IP/user limits, selects exactly one smart account plus matching owner, rotates/revokes hashed sessions, and sets/clears the `__Host-prophecy_session` cookie. `lib/viewer.ts` switches to that cookie only when `EMBEDDED_WALLET_AUTH_ENABLED=true`; default remains Clerk. Do not enable before `db/schema.ts` is applied and the credentialed spike clears Base account behavior.
- Implemented but inactive: `app/auth/AuthProvider.tsx` centralizes Clerk/CDP client state; CDP requests email/Google/Apple plus one smart account, exchanges its access token through `/api/session`, checks the returned user/account against the browser identity, and clears both sessions on sign-out or mismatch. The listed client consumers use `useAppAuth()`/`SignInAction`; Clerk remains the default while the gate is unset. CDP linked-account management stays hidden until its later Phase 2 work is complete.
- Implemented, schema unapplied: avatar bytes/MIME live in `profiles`; the client square-crops/re-encodes, the server validates declared MIME, decoded size, byte signature and dimensions, the profile save is atomic, and owner-only routes serve avatar/banner bytes with safe content headers (`app/lib/profileImage.ts`, `app/api/profile/{avatar,banner}/route.ts`).
- Implemented but not exposed: `DELETE /api/session/all` validates same-origin empty JSON, rate-limits by IP, authenticates the current non-expired session, atomically revokes every live session for that user, and clears the cookie (`lib/appSession.ts:210`, `app/api/session/all/route.ts:23`, client helper `app/lib/authSession.ts:85`).
- Implemented where the installed provider supports it: `/account/security` exposes link-auth, MFA enrollment, and session revoke-all; every sensitive change rotates the application session and records a small audit event. Export, unlink, and account deletion remain unexposed because key continuity or a verified end-user provider flow is missing; Apple login and production cutover remain blocked on that provider/operational gate (`app/account/security/AccountSecurity.tsx`, `app/api/account/security-event/route.ts`).
- Remove `app/sign-in`, `app/sign-up`, `proxy.ts` `clerkMiddleware()` and its `/__clerk` matcher entry (keep the file for CSP headers), the `@clerk/nextjs` package, and Clerk environment variables only after `rg` finds no runtime Clerk imports/usages.
- Docs: replace Clerk references in `docs/architecture.md:11,14,43,103,113`, `docs/feeds.md:10,28`, `docs/profiles.md:18,19,24`, `docs/multiplayer-plan.md:82`, and `docs/roadmap.md:47` (Clerk components' appearance row — delete).
- Implemented, not executed: `scripts/prelaunch-account-reset.mjs` defaults to a row-count dry run, requires a non-production `PRELAUNCH_RESET_ENVIRONMENT`, and requires `--apply --confirm=RESET_PRELAUNCH_ACCOUNT_DATA` before truncating account-linked wallet/audit/game/profile/session/user tables. This intentionally removes old anonymous match history and stale sessions too; `request_rate_limits` is not identity data and remains intact.

### Phase 3 — wallet identity integration (repository complete; cutover gated)

- Replace `app/lib/wallet.ts getWalletProvider()` and `app/lib/useWalletConnection.ts` with CDP identity/account hooks plus the canonical server viewer. Delete connect, handshake, switch-wallet, and switch-network flows.
- Update `app/wallet/page.tsx`, `app/wallet/WalletDashboard.tsx`, `app/WalletDesk.tsx`, `app/BalancePill.tsx`, and `app/sanctum/SanctumView.tsx`. Sanctum's mock balance/trading rules stay unchanged; only its identity/address UI changes.
- Signed-out UI says “Sign in”; signed-in UI shows the canonical smart-account address and Base. It never silently displays the owner EOA.
- `app/api/wallet/*` read routes (holdings, activity, eth, history, …) stay public `?address=` routes (`app/api/wallet/holdings/route.ts:7`): the data is public onchain state, so they are not converted to session-derived addresses. The wallet UI passes the canonical smart-account address from the viewer; the routes get the per-IP rate limits from Security controls. Only mutation routes (session, quote, Paymaster, Onramp, intents) derive the address server-side.
- Remove `@coinbase/wallet-sdk` only after `rg` finds no provider imports/usages and the wallet/Sanctum screens pass tests.
- Implemented: the validated application session carries the canonical smart account into `useAppAuth`; all listed consumers use it, always show Base, and use sign-in/sign-out instead of wallet connect/switch flows. `@coinbase/wallet-sdk` is removed and `rg` has no runtime provider usage (`app/lib/useWalletConnection.ts:18`, `app/lib/wallet.ts`).
- Docs: rewrite `docs/wallet.md:3-23` (connected Coinbase Wallet SDK, "never required Clerk sign-in") and `docs/architecture.md:19,83,84` for the CDP sign-in wallet.

### Phase 4 — transaction core and Paymaster boundary (local core complete; Paymaster credential gate open)

- Implement typed intent schemas/builders, raw-unit parsing/formatting, final-call decoding, policy checks, simulations, and the restricted CDP signing module before Send or Swap UI.
- Add `transaction_intents` state machine and idempotent APIs. Persist intent before confirmation, atomically claim it for submission, then store user-op and transaction hashes as they become available.
- Implement the private authenticated Paymaster proxy and atomic spend counters. Reject unknown calls and over-cap requests before contacting CDP.
- Implement background/on-request reconciliation for submitted transactions, receipt backoff, dropped/replaced/reverted handling, and holdings-cache invalidation after inclusion.
- Add a global transaction kill switch that disables signing/sponsorship while leaving read-only balances/activity available.
- Implemented: `transaction_intents`, spend counters, audit events, exact-unit parsing, native/ERC-20 transfer encoding/decoding, single-call/nested-batch rejection, immutable call hashes, idempotent create, guarded confirm/claim/broadcast/terminal transitions, per-token/day limits, reconciliation, and server/browser kill switches (`db/schema.ts:71-134`, `app/lib/embeddedWallet/intents.ts`, `lib/transactionIntents.ts`).
- Replaced: the custom paymaster proxy was dropped; Send is USDC-only and gas is paid in USDC through CDP's ERC-20 paymaster (`useCdpPaymaster` + `paymasterContext.erc20`, approve batched with the transfer; `app/lib/embeddedWallet/sign.ts`).

### Phase 5 — Send (repository complete; launch gated)

- `app/wallet/ActionSheets.tsx SendSheet`: native ETH and curated ERC-20 transfer intents only; sponsored smart-account operation; confirmation; idempotent submission; durable pending row.
- Confirmation shows full recipient, account, network, token contract/symbol, raw-derived amount, sponsorship/fee, and irreversible-action warning.
- Re-read raw balance, validate destination code/risk rules, simulate, and re-check session/account coherence immediately before signing.
- `Max` is computed from raw balance and the actual sponsorship decision; no optimistic success on broadcast.
- Implemented: Base USDC typed intents (USDC-paid gas, `@handle` recipient picker), mandatory full-field confirmation, sole CDP hook import, browser/application identity coherence check, durable pending hash, and no optimistic success. `Max` is intentionally absent until the exact raw token-balance/sponsorship read is available (`app/wallet/ActionSheets.tsx`, `app/lib/embeddedWallet/sign.ts:14`).

### Phase 6 — exact-input Swap (blocked by credentialed quote/decoder decision)

- Launch with a curated Base token list and exact-input swaps. “Any Base token,” exact-output, fee-on-transfer tokens, Permit2, and infinite approvals are deferred.
- `POST /api/wallet/quote` accepts token pair, raw input amount, and bounded slippage only. Server supplies chain, canonical smart account/recipient, aggregator host, and allowed fee configuration.
- Validate and persist the normalized quote/intent; enforce short expiry/deadline, max slippage, max price impact, supported router/version, exact recipient, exact input, minimum output, native value, and no unexpected fee/affiliate/transfer calls.
- Decode and compare every final call and simulate immediately before signing. Never cache executable calldata across users.
- Batch exact approval plus swap only after Phase -1 proves atomic execution. Otherwise wait for approval inclusion and present it as a separate confirmed transaction.
- Wire existing Buy/Sell preset plumbing in `app/wallet/WalletDashboard.tsx` only after the common transaction core is complete.
- The preset plumbing remains, but submission is visibly disabled. No executable quote/calldata is accepted or cached until an aggregator/provider path passes the Phase -1 checks.

### Phase 7 — Deposit (copy-address complete; hosted Onramp blocked)

- Server creates each Onramp session/order from `getViewer()` with the canonical smart-account address, Base, selected supported asset, and exact allowed return URL. Ignore/reject client destination and network fields.
- Show provider-supplied quote, fees, limits, payment methods, geographic/state eligibility, identity requirements, and expiry. Do not hard-code promotional pricing.
- Track order id/status, handle abandonment/failure/refund, reconcile the resulting onchain deposit, and retain “copy address” for crypto deposits with Base warning.
- `onramp_orders` schema and canonical Base copy-address UI exist; hosted session creation remains unexposed until Onramp credentials/access, allowed origins, runtime quote schema, and webhook/order reconciliation are verified.

### Phase 8 — Activity and reconciliation (repository complete)

- Merge durable local transaction intents with confirmed onchain transfers/activity; deduplicate by user-op hash and transaction hash.
- Treat Alchemy activity as an index/view, not transaction truth. Receipt status controls success; local submitted/reverted/dropped records remain visible after reload.
- Backfill missing transaction hashes from user operations, reconcile stale submitted rows, and invalidate holdings/activity caches on terminal transitions.
- Implemented: authenticated bounded CDP reconciliation plus merged/deduplicated local and Alchemy activity (`POST /api/wallet/reconcile`, `GET /api/wallet/activity`), shown in the dashboard Activity tab, which triggers reconciliation for submitted rows and refreshes holdings on inclusion (`app/wallet/ActivityList.tsx`).

### Phase 9 — testnet and launch gate (local gates complete; credentialed/operational gates open)

- Unit: decimal/raw conversion across token decimals, address normalization, typed-intent immutability, calldata decoders, nested batch rejection, expiry/slippage/price-impact limits, policy rules, state transitions, and idempotency.
- Integration on Base Sepolia: sign-in/out/expiry, first-party-cookie behavior, link/unlink/recovery, app/CDP identity mismatch, send, approval/swap, sponsor rejection, duplicate clicks/tabs, reload recovery, revert, dropped request, and rate limits.
- Security: CSRF/origin tests, CSP/clickjacking checks, XSS review around token metadata/errors, authorization/cross-user tests, malicious quote fixtures, Paymaster bypass attempts, secrets/log scan, dependency audit, and account deletion/export review.
- Operational: separate-project verification, upstream quotas/timeouts, per-user/global spend alerts, kill switches, reconciliation job, incident runbook, rollback, and credential/session rotation drill.
- Mainnet signing, sponsorship, and Onramp remain disabled until every gate passes and policy capabilities match the threat model.
- Local unit/type/lint/build gates cover exact-unit conversion, calldata validation, session/auth boundaries, reset guards, and the disabled launch posture. `npm audit` currently reports 16 transitive advisories (5 high, 11 moderate); npm proposes incompatible package downgrades, so dependency remediation remains a launch gate rather than an automatic breaking change.

## Deferred

- Delegated/server signing.
- External-wallet login/linking.
- Multiple smart accounts per user or account selection.
- ENS and cross-chain sends/swaps.
- Arbitrary/unverified Base tokens, exact-output swaps, Permit2, infinite approvals, and generic contract calls.
- Key export unless recovery, recent step-up, user warning, and deletion behavior pass security/product review.
- Custom-auth migration unless identity mapping and wallet continuity are proven in a separate plan.

## Decisions required before implementation

- Confirm the pre-launch Clerk-data reset and exact environment-gated reset script.
- Choose the launch auth-method set after link/recovery/deletion testing; current target is email + Google + Apple, no SMS.
- Set per-transaction, per-user/day, and global sponsorship/spend caps plus the step-up threshold.
- Choose aggregator, curated token list, default/max slippage, max price impact, and quote TTL after Phase -1.
- Obtain CDP first-party-cookie limited access; this is a production blocker.
- Decide whether key export launches. Default is off until its security gate passes.

## Implementation references

- CDP user-wallet authentication and environment warning: <https://docs.cdp.coinbase.com/wallets/quickstart/user-auth>
- CDP session lifecycle: <https://docs.cdp.coinbase.com/wallets/authentication/session-management>
- CDP first-party-cookie behavior: <https://docs.cdp.coinbase.com/wallets/security-and-policies/first-party-cookies>
- Server access-token validation: <https://docs.cdp.coinbase.com/wallets/authentication/implementation-guide#server-side-validation>
- Custom-auth identity requirements: <https://docs.cdp.coinbase.com/wallets/authentication/custom-authentication>
- Paymaster proxy integration: <https://docs.cdp.coinbase.com/paymaster/guides/wagmi-viem-integration>
- CDP policy engine: <https://docs.cdp.coinbase.com/api-reference/v2/rest-api/policy-engine/create-policy>
- Onramp quote semantics: <https://docs.cdp.coinbase.com/onramp/coinbase-hosted-onramp/generating-quotes>
- Apple authentication setup: <https://docs.cdp.coinbase.com/wallets/authentication/social-login/apple>
