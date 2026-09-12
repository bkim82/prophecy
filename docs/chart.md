# chart

`app/PriceChart.tsx`. Pure: props→SVG. No fetch, no state, no chart lib (hand-rolled, ~370 lines — cheaper than configuring a lib for tight-zoom axis + edge-pinned prediction labels + round-band shading + wall-clock tick axis).

## Geometry

- `viewBox` 880×400, scaled via CSS `h-auto w-full` (`:33-34`, `:169-170`) — resolution-independent, no DOM measurement.
- `PAD` top 20 / right 78 / bottom 44 / left 12 (`:35`). Right reserves price-label space; bottom reserves the time axis (ticks + clock labels).
- `x()` maps ts→horizontal over the **fixed window**, not the data extent; `y()` maps price→vertical (`:130-131`).

## Time window (fixed width, scrolling)

- `t1` = `max(now, last point)`, `t0` = `t1 - windowMs` (`:101-108`). The domain width is constant from the first frame, so the axis scrolls left instead of compressing as points accumulate.
- `now` comes in as a prop from `usePriceFeed` (`app/page.tsx:226`), which ticks it every `CLOCK_MS`=250ms (`app/usePriceFeed.ts:11`, `:48-51`) — ~1px of travel per tick at the default window. A silent socket scrolls the axis past the last point rather than freezing the chart.
- `frozen` pins `t1` to the last point so a settled chart stops scrolling (`:103-107`).
- `windowSlice()` clips to `[t0, …]` and **interpolates** the price where the line crosses the left edge (`:70-82`), so a scrolled-past segment ends on the axis instead of floating in. Needs one sample of slack outside the window — supplied by `trim()` and `/api/history`, both cutting at `WINDOW_MS + SAMPLE_MS`.
- Every point older than the window → `windowSlice` returns `[]` → placeholder. That is the dead-feed rendering.
- Price scale is computed from the **visible** slice only, so scrolled-off extremes don't hold the axis open.

## Configurable intervals

Props, defaulting to `app/feedConfig.ts` (`:88-95`). A future settings UI overrides per render; nothing else needs to change.

| Prop | Default | Effect |
| --- | --- | --- |
| `windowMs` | `WINDOW_MS` 3min | domain width |
| `xIntervals` | `X_INTERVALS` 6 | labelled time ticks across the window |
| `yIntervals` | `Y_INTERVALS` 4 | gaps between price gridlines (⇒ `yIntervals + 1` lines) |
| `xMinorPerInterval` | `X_MINOR_PER_INTERVAL` 2 | unlabelled subdivisions per major tick |

## Scaling (y)

- Visible range = visible high-to-low `span`, padded 6% each side (`:123-128`). Not zero-anchored — a $5 BTC move must read as a real swing.
- Flat-price edge case: `span` falls back to `rawHigh * 0.0002` (avoids div/0).
- `gridValues` = `yIntervals + 1` values evenly spaced high→low (`:144-147`). Keyed by index — the values are floats, not stable ids.
- Price labels switch to 2 decimals when visible span < $25 (`:55-60`).

## Time axis

- `majorMs` = `niceStep(windowMs / xIntervals)` — snapped up to the next entry in `NICE_STEPS_MS` (1s…1h, `:44-52`). Any `xIntervals` therefore lands on a round unit; the tick *count* can come out ±1 of what was asked (7 intervals over 3min → a 30s step → 6 labels). Round times beat an exact count.
- Minor step = `majorMs / xMinorPerInterval`. Ticks snap to wall-clock boundaries (`Math.ceil(t0/minorMs)*minorMs`, `:149-156`), not to `t0`.
- Because ticks are epoch-aligned and the window slides continuously, the visible count varies by ±1 as the window scrolls. Spacing never changes — that is the property that matters.
- Labelled tick = `t % labelEvery === 0`; label = `HH:MM:SS` local, `hour12: false` (`:62-68`, `:213`).
- `labelEvery` thins to a multiple of `majorMs` if labels would sit closer than `MIN_LABEL_GAP`=42px (`:157-161`). At the defaults → 132px apart → no thinning. `xIntervals=60` → thins to 18 labels.
- Labelled ticks: 8px mark (`#a3a3a3`) + faint full-height gridline (`#f7f7f7`); unlabelled: 5px mark (`#d4d4d4`) (`:210-246`).
- A label is dropped when its tick sits `<22px` from the left edge — centred text would hang off the viewBox (`:213`).
- SSR-safe: `toLocaleTimeString` never runs on the server — the server render has no points and hits the placeholder.

## Layers (back→front)

1. Price gridlines + right-edge price labels (`:144-147`, `:181-201`)
2. Time axis: baseline, minor ticks, major clock labels (`:202-246`)
3. Round band: translucent indigo rect `roundStart`→right edge, "round" label pinned top-right of the band (`:248-283`)
4. Area fill: vertical gradient 22%→0 opacity (`:175-178`, `:285`)
5. Price line: polyline, green if last≥first else rose (`:141-142`, `:286-293`)
6. Lock markers (vertical) — see below
7. Prediction levels (horizontal) — see below
8. Current price marker: 2 concentric circles, outer pings while live, static once frozen (`:376-389`)
9. `settled` chip, top-right above the plot, only when `frozen` (`:391-401`)

## Round band

- Drawn whenever `roundStart <= t1`; its left edge clamps to `t0` (`:163-164`), so a round that started before the window still shades the whole visible stretch.
- Its own dashed boundary is drawn only when `roundStart > t0` (edge actually in view) **and** no lock marker sits within 750ms of `roundStart` (`:260-263`) — the 2nd lock *is* `roundStart`, so drawing both stacked two dashed lines of different colors.

## Lock markers (vertical)

- `PredictionLine.at` = ms timestamp the player locked (`:16`); omit/null → no marker.
- Full-height dashed line in the player's color + a `"P1 locked"` chip (`:296-339`).
- Chips stagger 19px by array index so near-simultaneous locks don't overlap (`:301`).
- Chip flips to the left of its line near the right edge (`:304-306`).
- Skipped when `at` falls outside `[t0, t1]` — the window scrolls locks off the left edge (`:298`).

## Prediction levels (horizontal)

- Dashed horizontal line per locked prediction, P1=blue, P2=amber (`app/page.tsx:9-10`).
- Out-of-range value (common — axis is tight): pin label to top/bottom edge + arrow, don't rescale chart or clip (`:341-374`). Dashed line only drawn if value in view.

## Freezing

Settlement passes frozen snapshot + `frozen={true}` (`app/page.tsx:221-227`). Chart response: pin `t1` to the last point, stop marker ping, show `settled` chip. Chart has no round concept — renders whatever it's given.

## Empty state

Visible slice <2 points → fixed 400px placeholder "Waiting for price data…" (matches rendered chart height, prevents layout jump) (`:112-118`).
