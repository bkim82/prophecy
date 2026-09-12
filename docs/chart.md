# Chart

`app/PriceChart.tsx` is a pure component: points in, SVG out. No fetching, no state, no chart library.

## Why hand-rolled

The chart needs three things that are awkward to bolt onto a general-purpose library: a price axis that zooms tight enough for a $5 move to read as a real swing, horizontal prediction levels that turn into edge chips when they fall outside the visible range, and a shaded band marking the live round. At roughly 200 lines of SVG, writing it directly was smaller than configuring a dependency to do the same.

## Geometry

A fixed `viewBox` of 880×260 scaled by CSS (`className="h-auto w-full"`), so it is resolution-independent and responsive without measuring the DOM (`app/PriceChart.tsx:14-18`, `:73-78`). The right padding of 74px reserves room for price labels.

`x()` maps timestamp to horizontal position across the actual data range; `y()` maps price to vertical position (`app/PriceChart.tsx:57-58`).

## Scaling: the tight-range decision

A naive chart anchored at zero, or padded generously, renders a minute of BTC as a flat line — the moves that decide a round are a few dollars against a five-figure price.

So the visible range tracks the actual swing: `span` is the real high-to-low distance, and the axis is padded by only 6% on each side (`app/PriceChart.tsx:52-54`). When the price is genuinely flat, `span` falls back to `rawHigh * 0.0002` to avoid a divide-by-zero and a degenerate axis.

Because the range is that tight, axis labels switch to two decimal places when the visible span is under $25 (`app/PriceChart.tsx:24-28`). At that zoom, whole-dollar labels would show the same number three times.

## Layers

Drawn in order, back to front:

1. **Gridlines and price axis** — three values: high, midpoint, low (`app/PriceChart.tsx:69`, `:87-105`).
2. **Round band** — a translucent indigo rect from `roundStart` to the right edge, with a dashed boundary line and a "locked" label. Only drawn when `roundStart` falls inside the visible window (`app/PriceChart.tsx:108-135`).
3. **Area fill** — a vertical gradient from 22% opacity to transparent, built from the same point list as the line (`app/PriceChart.tsx:80-83`, `:137`).
4. **Price line** — a polyline, green when the last point is at or above the first, rose when below (`app/PriceChart.tsx:66-68`, `:138-145`).
5. **Prediction levels** — see below.
6. **Current price marker** — two concentric circles; the outer one pings while live and sits still once frozen (`app/PriceChart.tsx:184-196`).
7. **Time labels** — "Ns ago"/"Nm ago" on the left, "now" or "settled" on the right (`app/PriceChart.tsx:198-211`).

## Prediction levels

Each locked prediction draws as a dashed horizontal line in that player's colour — blue for P1, amber for P2 (`app/page.tsx:9-10`).

The interesting case is a prediction far outside the current price range, which is common since the axis is zoomed tight. Rather than rescaling the whole chart to fit it (which would flatten the price line back out) or clipping it away, the component pins the label to the top or bottom edge and adds an arrow indicating which way it lies (`app/PriceChart.tsx:148-181`). The dashed line is drawn only when the value is actually in view.

## Freezing

At settlement the page passes a frozen snapshot instead of the live series, plus `frozen={true}` (`app/page.tsx:211-214`). The chart responds by stopping the marker's ping animation and relabelling the right edge from "now" to "settled". The chart itself has no concept of a round — it just renders what it is handed.

## Empty state

Fewer than two points renders a fixed-height placeholder reading "Waiting for price data…", which keeps the layout from jumping when data arrives (`app/PriceChart.tsx:36-42`).
