# docs index

Agent-readable fact sheets, not prose. Format: flat bullets, `file:line` refs, no narration. Update per [[AGENTS.md]] orchestration rule when `app/**` behavior changes.

- [architecture.md](architecture.md) — module map, data flow, invariants
- [price-feed.md](price-feed.md) — socket/seed/REST sources, sampling, reconnect
- [game-loop.md](game-loop.md) — phase machine, lock/settle/reset logic
- [pulse-mode.md](pulse-mode.md) — solo trading state, leveraged P&L, settlement
- [chart.md](chart.md) — SVG chart geometry, layers, scaling
- [roadmap.md](roadmap.md) — unbuilt features, known gaps
- [multiplayer-plan.md](multiplayer-plan.md) — server-authoritative Quick Play: match lifecycle, guarded updates, presence

Quick Play and multiplayer Pulse are server-authoritative (Neon Postgres `matches` table, anonymous per-browser ids); the chart and price feed stay client-side. Solo Pulse remains client-only. `/api/price` and `/api/history` stay stateless proxies. No auth required to play.
