# pulse-mode

- Client-only BTC duel route: `app/duel/btc/pulse/page.tsx`. Reached from the lobby mode switcher (`app/page.tsx:62`).
- State machine: `setup` before entry, `open` while a directional position is live, `closed` after an exit while the round continues, `settling` during final-price fetch, `result` after the 60-second round (`app/duel/btc/pulse/page.tsx:20`, `:181-197`).
- Round starts on the first Long/Short press; duration is 60 seconds; starting equity is $100 (`app/duel/btc/pulse/page.tsx:8-12`, `:199-204`).
- Setup dock exposes stake presets and 1×–100× leverage chips, then Long/Short entry; stake and leverage lock into the opened position (`app/duel/btc/pulse/page.tsx:539-633`).
- Open-position dock exposes direction, entry price, live P&L, size, Close, and Reverse only (`app/duel/btc/pulse/page.tsx:635-700`).
- Directional P&L = stake × price move percentage × position leverage; Long benefits from an increase and Short from a decrease (`app/duel/btc/pulse/page.tsx:61-67`).
- Close realizes the current position P&L; Reverse realizes it and opens the opposite side at the same live price (`app/duel/btc/pulse/page.tsx:229-275`).
- Scoreboard shows player and lightweight local AI rival equity/P&L plus remaining match time above the chart (`app/duel/btc/pulse/page.tsx:331-360`).
- Chart markers distinguish directional entry circles, exit squares, and reversal diamonds (`app/PriceChart.tsx:22-27`, `:499-535`).
- Haptic vibration and a short Web Audio tick are progressive enhancements on entry, exit, and reverse (`app/duel/btc/pulse/page.tsx:118-143`).
- Settlement uses the freshest live tick with `/api/price` fallback; final chart point is frozen (`app/duel/btc/pulse/page.tsx:153-179`).
- Styling goes through the shared tokens, not literals: long/short = `--chart-up`/`--chart-down`, P&L sign = `--positive`/`--negative`, panels = `.panel`-equivalent `--surface`/`--line` (`app/duel/btc/pulse/page.tsx:16-17`, `:71`). The global header and theme toggle come from `app/layout.tsx` — the page renders no chrome of its own.
- `app/duel/btc/pulse/trading.ts` holds pure spot buy/sell portfolio accounting with full-position clamping. Not yet wired to the page, which tracks a single leveraged directional position instead — see `docs/roadmap.md`.
