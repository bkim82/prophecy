# docs index

Agent-readable fact sheets, not prose. Format: flat bullets, `file:line` refs, no narration. Update per [[AGENTS.md]] orchestration rule when `app/**` behavior changes.

- [architecture.md](architecture.md) — module map, data flow, invariants
- [feeds.md](feeds.md) — Global/Exclusive Twitter-style feeds, header nav, rank stub
- [profiles.md](profiles.md) — `/profile/[handle]`: avatar → rank → stats, Omens/Comments/Trades/Portfolio tabs, rank-locked portfolio; archetype, signature asset + per-asset accuracy, highlight reel; own `/profile`: Edit profile (photo, banner, name, handle, bio, location, website → `profiles` table), match history with pinnable wins, mock copy earnings
- [sanctum.md](sanctum.md) — Oracle Room: rank-only live Pulse room (BTC/ETH/daily), room trade feed, mini chat — mock players/funds
- [price-feed.md](price-feed.md) — socket/seed/REST sources, sampling, reconnect
- [game-loop.md](game-loop.md) — phase machine, lock/settle/reset logic
- [pulse-mode.md](pulse-mode.md) — solo trading state, leveraged P&L, settlement
- [practice-mode.md](practice-mode.md) — client-only Pulse practice round
- [tutorial.md](tutorial.md) — `/duel/tutorial`: 5 scripted lessons (long, short, leverage, liquidation, closing) on a fixed teaching chart, then a live 60s round vs the Sibyl bot with a close-timing coach; practice money only
- [portfolio.md](portfolio.md) — 24h Portfolio: solo, freely-tradeable spot/leverage positions on Base meme coins, lazy settlement
- [wallet.md](wallet.md) — Wallet dashboard: connected-wallet balance/holdings/activity, no-auth data routes, mock creator earnings
- [wallet-trading-plan.md](wallet-trading-plan.md) — plan to make Send/Swap real (not built): phases, security protocols, open decisions
- [chart.md](chart.md) — SVG chart geometry, layers, scaling
- [roadmap.md](roadmap.md) — unbuilt features, known gaps
- [multiplayer-plan.md](multiplayer-plan.md) — server-authoritative multiplayer Pulse: match lifecycle, guarded updates, presence, house bots

Multiplayer Pulse is server-authoritative (Neon Postgres `matches` table, anonymous per-browser ids); the chart and price feed stay client-side. Solo Pulse remains client-only. `/api/price` and `/api/history` stay stateless proxies. Solo Pulse needs no auth. The 24h Portfolio is also server-authoritative (Neon Postgres `portfolio_sessions`/`positions` tables) but is Clerk-`userId`-scoped, not anonymous — signing in is required (see [portfolio.md](portfolio.md)).
