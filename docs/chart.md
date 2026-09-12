# chart

`app/PriceChart.tsx`. Pure: points→SVG. No fetch, no state, no chart lib (hand-rolled, ~337 lines — cheaper than configuring a lib for tight-zoom axis + edge-pinned prediction labels + round-band shading + wall-clock tick axis).

## Geometry

- `viewBox` 880×400, scaled via CSS `h-auto w-full` (`:20-21`, `:100-105`) — resolution-independent, no DOM measurement.
- `PAD` top 20 / right 78 / bottom 44 / left 12 (`:22`). Right reserves price-label space; bottom reserves the time axis (ticks + clock labels).
- `x()` maps ts→horizontal over actual data range; `y()` maps price→vertical (`:75-76`).

## Scaling

- Visible range = actual high-to-low `span`, padded 6% each side (`:70-72`). Not zero-anchored — a $5 BTC move must read as a real swing.
- Flat-price edge case: `span` falls back to `rawHigh * 0.0002` (avoids div/0).
- Price labels switch to 2 decimals when visible span < $25 (`:34-38`).

## Time axis

- `TICK_MS = 5000`, `LABEL_MS = 10000`, `MIN_LABEL_GAP = 42` (`:29-31`).
- Ticks snap to wall-clock 5s boundaries (`Math.ceil(t0/TICK_MS)*TICK_MS`, `:90-93`), not to `t0` — labels read as round times.
- Labelled tick = `t % labelEvery === 0`; label = `HH:MM:SS` local, `hour12: false` (`:40-46`, `:147`).
- `labelEvery` thins to a multiple of 10s if 10s labels would sit closer than `MIN_LABEL_GAP` (`:96-98`). At `WINDOW_MS` 3min → 43.9px apart → stays at 10s.
- Labelled ticks: 8px mark (`#a3a3a3`) + faint full-height gridline (`#f7f7f7`); unlabelled: 5px mark (`#d4d4d4`) (`:144-179`).
- A label is dropped when its tick sits `<22px` from the left edge — centred text would hang off the viewBox (`:147`).
- SSR-safe: `toLocaleTimeString` never runs on the server — <2 points on first render hits the placeholder.

## Layers (back→front)

1. Price gridlines + right-edge price labels: high/mid/low (`:87`, `:115-134`)
2. Time axis: baseline, 5s ticks, 10s clock labels (`:136-179`)
3. Round band: translucent indigo rect `roundStart`→right edge, "round" label pinned top-right of the band; drawn only if `roundStart` in visible window (`:181-215`)
4. Area fill: vertical gradient 22%→0 opacity (`:108-113`, `:217`)
5. Price line: polyline, green if last≥first else rose (`:84-86`, `:218-225`)
6. Lock markers (vertical) — see below
7. Prediction levels (horizontal) — see below
8. Current price marker: 2 concentric circles, outer pings while live, static once frozen (`:308-321`)
9. `settled` chip, top-right above the plot, only when `frozen` (`:323-333`)

## Lock markers (vertical)

- `PredictionLine.at` = ms timestamp the player locked (`:10`); omit/null → no marker.
- Full-height dashed line in the player's color + a `"P1 locked"` chip (`:227-270`).
- Chips stagger 19px by array index so near-simultaneous locks don't overlap (`:233`).
- Chip flips to the left of its line near the right edge (`:235-238`).
- Skipped when `at` falls outside `[t0, t1]` — the 3min window can scroll a lock off-screen (`:230`).
- The round band's own dashed boundary is suppressed when a lock marker sits within 750ms of `roundStart` (`:192-195`) — the 2nd lock *is* `roundStart`, so drawing both stacked two dashed lines of different colors.

## Prediction levels (horizontal)

- Dashed horizontal line per locked prediction, P1=blue, P2=amber (`app/page.tsx:9-10`).
- Out-of-range value (common — axis is tight): pin label to top/bottom edge + arrow, don't rescale chart or clip (`:272-306`). Dashed line only drawn if value in view.

## Freezing

Settlement passes frozen snapshot + `frozen={true}` (`app/page.tsx:221-226`). Chart response: stop marker ping, show `settled` chip. Chart has no round concept — renders whatever it's given.

## Empty state

<2 points → fixed 400px placeholder "Waiting for price data…" (matches rendered chart height, prevents layout jump) (`:54-60`).
