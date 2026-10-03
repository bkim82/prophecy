# chart

`app/PriceChart.tsx`. Props→SVG, no fetch, no chart lib. Local state holds independent time and price wheel zoom levels (see below) — view concerns with no caller that cares (hand-rolled — cheaper than configuring a lib for tight-zoom axes + trade markers + round-band shading + wall-clock tick axis).

## Geometry

- At rendered widths â‰¤560px, the chart switches to a 520Ã—440 viewBox with expanded padding and label sizes (`app/PriceChart.tsx:140-162`, `:308-321`) so the full chart remains visible without shrinking mobile text to desktop scale.

- Desktop `viewBox` is 880×400 and scales via CSS `h-auto w-full`; compact mode uses 520×440 (`app/PriceChart.tsx:156-162`, `:308-309`) — resolution-independent; DOM measurement is used only to route wheel events between axes.
- `PAD` top 20 / right 78 / bottom 44 / left 12 (`:40`). Right reserves price-label space; bottom reserves the time axis (ticks + clock labels).
- `x()` maps ts→horizontal over the **fixed window**, not the data extent; `y()` maps price→vertical (`:228-229`).

## Time window (fixed width, scrolling)

- `t1` = `max(now, last point)`, `t0` = `t1 - viewMs` (`:147-152`). The domain width is constant from the first frame, so the axis scrolls left instead of compressing as points accumulate. `viewMs` is `windowMs` unless the wheel has zoomed in — see Zoom.
- `now` comes in as a prop from `usePriceFeed` (`app/duel/[market]/pulse/[matchId]/page.tsx:201`), which ticks it every `CLOCK_MS`=100ms (`app/usePriceFeed.ts:11`, `:48-51`) — ~1px of travel per tick at the default window. A silent socket scrolls the axis past the last point rather than freezing the chart.
- `frozen` pins `t1` to the last point so a settled chart stops scrolling (`:147-151`).
- `windowSlice()` clips to `[t0, …]` and **interpolates** the price where the line crosses the left edge (`:104-112`), so a scrolled-past segment ends on the axis instead of floating in. Needs one sample of slack outside the window — supplied by `trim()` and `/api/history`, both cutting at `WINDOW_MS + SAMPLE_MS`.
- Every point older than the window → `windowSlice` returns `[]` → placeholder. That is the dead-feed rendering.
- Price scale is computed from the **visible** slice only, so scrolled-off extremes don't hold the axis open.

## Zoom (wheel)

- `zoomMs` and `priceScale` are independent local states (`:127-139`). `viewMs` = `clamp(zoomMs, minWindowMs, windowMs)`; every time-geometry read uses `viewMs`, never the prop.
- Range: `windowMs` 1min (widest, the default) -> `minWindowMs` 30s (tightest). Zooming *out* past the default is not offered - `trim()` holds exactly `WINDOW_MS + SAMPLE_MS`, so a wider view would draw an empty left half.
- Scrolling over the plot zooms time; scrolling over the right-side price gutter zooms price (`:161-196`). The gutter is derived from the rendered SVG bounds so it stays correct when responsive CSS scales the viewBox (`:163-171`). A transparent final SVG layer supplies the `ns-resize` cursor and a price-zoom tooltip (`:519-528`).
- Price range starts at auto-fit (`priceScale=1`) and expands symmetrically around the fitted midpoint up to 32× (`:52-55`, `:172-181`, `:220-226`). It never tightens enough to clip visible data.
- Both axes are multiplicative: `scale *= exp(deltaY x px x ZOOM_RATE)`, `ZOOM_RATE`=0.0015 (`:49-58`, `:172-176`, `:185-189`). A notch feels identical at either end of the range; a linear step would not.
- `deltaMode` normalised to px via `DELTA_PX` (`:56-58`) - Firefox reports lines (3), not pixels (100).
- **At an axis limit the event is not consumed** (`:178`, `:190-195`): scrolling resumes moving the page exactly when there is no zoom left in that direction.
- Listener attached manually with `{ passive: false }` (`:198-202`) - React registers `onWheel` passively at the root, where `preventDefault()` silently does nothing.
- `ready` (visible >=2 points) is an effect dep (`:155`, `:201-202`) because the placeholder and the chart are different elements; without it the wheel binds to the placeholder and is lost when the first points arrive. Both carry `containerRef` (`:207`, `:266`).
- Double-click resets time to `windowMs` and price to auto-fit (`:267-272`).
- Current time and price scales render top-left of the plot, opposite the `settled` chip (`:289-293`); `spanLabel()` formats `30s` / `1m 30s` / `3m` (`:81-89`).
- Zoom is *not* reset between rounds and does not affect settlement - it only changes what is drawn.
- Right edge stays pinned to `t1`; zoom eats from the left. Cursor-anchored zoom would be wrong here: on a live feed the right edge has to keep meaning "now".

## Configurable intervals

Props, defaulting to `app/feedConfig.ts` (`:115-125`). A future settings UI overrides per render; nothing else needs to change.

| Prop | Default | Effect |
| --- | --- | --- |
| `windowMs` | `WINDOW_MS` 1min | domain width at full zoom-out; also the zoom ceiling |
| `minWindowMs` | `MIN_WINDOW_MS` 30s | zoom floor (tightest span the wheel reaches) |
| `xIntervals` | `X_INTERVALS` 6 | labelled time ticks across the window |
| `yIntervals` | `Y_INTERVALS` 4 | gaps between price gridlines (⇒ `yIntervals + 1` lines) |
| `xMinorPerInterval` | `X_MINOR_PER_INTERVAL` 2 | unlabelled subdivisions per major tick |

## Scaling (y)

- Fitted range = visible high-to-low `dataSpan`, padded 6% each side; `priceScale` expands that span around its midpoint (`:215-226`). Not zero-anchored — a $5 BTC move must read as a real swing.
- Flat-price edge case: `dataSpan` falls back to `rawHigh * 0.0002` (avoids div/0).
- `gridValues` = `yIntervals + 1` values evenly spaced high→low (`:242-245`). Keyed by index — the values are floats, not stable ids.
- Price labels switch to 2 decimals when visible span < $25 (`:74-79`).

## Time axis

- `majorMs` = `niceStep(viewMs / xIntervals)` — snapped up to the next entry in `NICE_STEPS_MS` (1s…1h, `:63-72`, `:249`). Any `xIntervals` therefore lands on a round unit; the tick *count* can come out ±1 of what was asked (7 intervals over 1min → a 15s step → 4 labels). Round times beat an exact count. This is also what makes zoom cost nothing: the tick *count* holds across the range while the step walks 15s → 10s → 5s.
- Minor step = `majorMs / xMinorPerInterval`. Ticks snap to wall-clock boundaries (`Math.ceil(t0/minorMs)*minorMs`, `:249-254`), not to `t0`.
- Because ticks are epoch-aligned and the window slides continuously, the visible count varies by ±1 as the window scrolls. Spacing never changes — that is the property that matters.
- Labelled tick = `t % labelEvery === 0`; label = `HH:MM:SS` local, `hour12: false` (`:91-97`, `:324-356`).
- `labelEvery` thins to a multiple of `majorMs` if labels would sit closer than `MIN_LABEL_GAP`=42px (`:255-259`). At the defaults → 132px apart → no thinning. `xIntervals=60` → thins to 18 labels.
- Labelled ticks: 8px mark (`#a3a3a3`) + faint full-height gridline (`#f7f7f7`); unlabelled: 5px mark (`#d4d4d4`) (`:324-356`).
- A label is dropped when its tick sits `<22px` from the left edge — centred text would hang off the viewBox (`:327`).
- SSR-safe: `toLocaleTimeString` never runs on the server — the server render has no points and hits the placeholder.

## Layers (back→front)

1. Price gridlines + right-edge price labels (`:242-245`, `:295-314`)
2. Time axis: baseline, minor ticks, major clock labels (`:316-357`)
3. Round band: translucent indigo rect `roundStart`→right edge, "round" label pinned top-right of the band (`:362-396`)
4. Area fill: vertical gradient 22%→0 opacity (`:282-286`, `:399`)
5. Price line: single-color polyline, green when the latest value is ≥ the leftmost visible value, otherwise red (`:240`, `:248-249`, `:409-416`)
6. Trade markers — see below
7. Current price marker: 2 concentric circles, outer pings while live, static once frozen (`:490-502`)
8. `settled` chip, top-right above the plot, only when `frozen` (`:505-516`); zoom labels, top-left of the same strip, always (`:289-293`)

## Round band

- Drawn whenever `roundStart <= t1`; its left edge clamps to `t0` (`:261-262`), so a round that started before the window still shades the whole visible stretch.
- Its own dashed boundary is drawn only when `roundStart > t0` (edge actually in view) (`:392`).

## Trade markers

- `TradeMarker` uses `side: long|short` and `action: entry|exit|reverse` (`:22-27`).
- Entries render as circles with `L`/`S`, exits as squares with `×`, reversals as diamonds with `R` (`:499-535`).
- Stroke is the `UP`/`DOWN` token by side; the glyph sits on a `var(--surface)` fill so it stays legible in both themes.

## Freezing

Settlement passes frozen snapshot + `frozen={true}` (`app/duel/[market]/pulse/[matchId]/page.tsx:132`, `:201`). Chart response: pin `t1` to the last point, stop marker ping, show `settled` chip. Chart has no round concept — renders whatever it's given.

## Empty state

Visible slice <2 points → fixed 400px placeholder "Waiting for price data…" (matches rendered chart height, prevents layout jump) (`:204-212`).

## Lobby chart (`app/MarketChart.tsx`)

Separate from `PriceChart`; renders in the lobby `market-overview` (`app/duel/page.tsx`).

- Time-based x over a fixed `MARKET_CHART_WINDOW_MS`=30s window ending at `max(now, last point)`; left edge interpolated via `priceAt`/`windowSlice`. Not index-based.
- Pixel viewBox from a `ResizeObserver` width × `height` prop (default 148, or `"fill"` = observed box height, `.market-chart.is-fill` min 220px). Lobby passes `"fill"` — no `preserveAspectRatio="none"` stretching.
- Axis/pill/tooltip prices at the market's tick precision (`formatChartPrice(value, tickSize)`).
- y fits the visible slice, padded `Y_PAD`=14% each side, span floored at `MIN_SPAN_TICKS`=10 × the market's `tickSize` prop (Coinbase quote_increment, set in `MARKETS` in `app/duel/page.tsx`: $0.01 BTC/ETH, $0.00001 DOGE) so a one-tick flicker doesn't fill the height.
- Line: monotone cubic (Fritsch–Carlson, no overshoot) + blurred glow. Line, glow, area tint, orb, pill, sparks in the market colour (`--chart-line`/`--chart-point`, set per `[data-market]`: BTC soft amber `#f0a868` — pure `#f7931a` glared on navy; chips keep it —, ETH blue, DOGE gold), stroke faint at left → full at head; area fades to `--violet` and in from the left. Stars, fan, "now" line, loading beam stay brand teal/violet.
- Seeded starfield (`STARS`, 54, twinkling) behind; panel gets teal/violet radial glows (`.pulse-stage .market-overview.panel`, `app/globals.css`).
- Head at `1 - FUTURE_FRAC`=84% of plot width; right of it a fan of possible paths (green up / red down cone + flowing dashed `RAYS`) and a vertical "now" line. Head = orb (radial gradient) + aura + spinning halo + ping + trailing sparks.
- Dashed open line at the window's first price.
- Live price pill in the right gutter on a dashed line from the pulsing head; grid labels within 14px of the pill are dropped.
- Clock ticks every 10s (`HH:MM:SS`), dropped within 24px of either edge.
- Scrub (pointer move/down, touch with `touch-action: pan-y`): crosshair, dot, tooltip with time + Δ vs open. `onScrub` lifts the point so the lobby headline price/% shows the scrubbed value; 24h stats stay on the live price.
- Lobby headline price = chart head (midpoint), not last trade, so it matches the pill. 24h high/low/change from feed `day` (were fabricated as price ×1.018/×0.982).
- Lobby `change` % is measured from the chart's left edge (`priceAt(points, now - MARKET_CHART_WINDOW_MS)`), so it matches the fill colour.
- No "waiting" text. <2 visible points → same starfield with a scanning beam (`.mc-loading`). Feed dead long enough that the live window is empty → window freezes on the last data, greyed, with a "Reconnecting…" chip (`is-stale`) — never blank.
- Entrance (CSS, on SVG mount; `key={label}` replays it per market): stars → grid stagger → line/area sweep (`clip-path`, `backwards` fill so no clip remains) → orb pops + shockwave → fan unfolds → pill slides in (~1.9s). Lobby panels rise in (`stage-rise`).
- Motion (`prefers-reduced-motion` disables all): own rAF clock (`useFrameClock`) scrolls per frame instead of the feed's 100ms steps; feed's live edge (within `EDGE_SLACK_MS`) re-pinned to the frame clock. Head price eased (`HEAD_TAU_MS`=140) and y-range eased (`RANGE_TAU_MS`=320), never clipping the line; ease state reset on market switch.
- Live price change → pill flashes and head ripples green/red (keyed remount restarts the CSS animation). Lobby headline price flashes too, on whole-tick changes (`app/duel/page.tsx`).
