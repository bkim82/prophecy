# pulse-mode

- Client-only BTC duel route: `app/duel/btc/pulse/page.tsx`.
- State machine: `setup` before entry, `open` while a directional position is live, `closed` after an exit while the round continues, `settling` during final-price fetch, `result` after the 60-second round (`app/duel/btc/pulse/page.tsx:17-18`, `:174-194`).
- Round starts on the first Long/Short press; duration is 60 seconds; starting equity is $100 (`app/duel/btc/pulse/page.tsx:8-12`, `:200-218`).
- Setup dock exposes stake presets, 1x-100x leverage chips, and press-and-hold Long/Short controls; stake and leverage lock into the opened position (`app/duel/btc/pulse/page.tsx:459-501`).
- Open-position dock exposes direction, entry price, live P&L, Close, and Reverse only (`app/duel/btc/pulse/page.tsx:503-523`).
- Directional P&L = stake × price move percentage × position leverage; Long benefits from an increase and Short from a decrease (`app/duel/btc/pulse/page.tsx:59-65`).
- Close realizes the current position P&L; Reverse realizes the current position and opens the opposite side at the same live price (`app/duel/btc/pulse/page.tsx:221-276`).
- Scoreboard shows player and lightweight local AI rival equity/P&L plus remaining match time above the chart (`app/duel/btc/pulse/page.tsx:312-334`).
- Chart markers distinguish directional entry circles, exit squares, and reversal diamonds (`app/PriceChart.tsx:19-23`, `:385-422`).
- Haptic vibration and a short Web Audio tick are progressive enhancements on entry, exit, and reverse (`app/duel/btc/pulse/page.tsx:97-124`).
- Settlement uses the freshest live tick with `/api/price` fallback; final chart point is frozen (`app/duel/btc/pulse/page.tsx:145-169`).
