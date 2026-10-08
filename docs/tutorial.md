# tutorial

- Route `/duel/tutorial` (`app/duel/tutorial/page.tsx` → client `TutorialView`). Client-only: no `matches` row, no `/api/match/*`, no Embers or balance calls. The only network use is `usePriceFeed("BTC-USD")` (one feed for the whole page, `TutorialView.tsx`) and the live round's `/api/price` settle fallback.
- Lobby entry (`app/duel/page.tsx`): a "New to Pulse?" `.tutorial-callout` above the play controls while `hasFinishedTutorial()` is false (`:460`), and a permanent "How to play" link in `.play-secondary` beside Practice (`:529-535`). Done flag = `localStorage["pulse-tutorial-done"]`, set on reaching the done screen (`app/duel/tutorial/progress.ts`, `TutorialView.tsx:44`); storage failures read as "not done".
- Flow: intro → 6 steps (`STEP_LABELS`, `lessons.ts`) → done screen (recap + "Play ranked" → `/duel`, "More practice vs Sibyl" → solo practice, replay). Stepper buttons jump to any step (`TutorialView.tsx:70`).
- Layout: `.tut-shell` is a named-area grid (`app/globals.css:2478`); lesson components return fragments whose sections land in `head`/`brief`/`chart`/`dock`/`debrief`. ≥1024px a lesson step adds `.is-split` (`TutorialView.tsx:55`, `globals.css:2582`): left column = header (back link, small BTC title, practice-balance chip, stepper) → lesson card → controls → debrief; right column = the chart, `position: sticky`. Narrower, it stacks head → lesson → chart → controls → debrief so the chart is never below the buttons. Intro/done are a single 760px column. In the debrief the lesson card folds to its title (`.is-collapsed`, `ScriptedLesson.tsx:194`). Each step remounts on `key={step-attempt}`, so Replay is a fresh mount with an optional `LessonPreset` (side/leverage).
- Practice balance: `PRACTICE_BALANCE` $1,000 + the latest P&L per lesson (replays replace, `TutorialView.tsx:34`); shown for lessons 1–5 only. The live round gives both sides a fresh $1,000 (`LIVE_STARTING_CASH`, `live.ts:11`).

## Scripted lessons 1–5 (`lessons.ts`, `ScriptedLesson.tsx`, `LessonChart.tsx`)

- Same path for every player: keyframes of % move from entry + seeded wiggle (mulberry32) that fades to 0 at start and bell, so entry = anchor and the final move = last keyframe exactly (`lessonPathPct`, `lessons.ts:156`). Sampled every 0.25 virtual s over a 15 s lead-in + 60 s round.
- Anchor = first live BTC price the lesson sees while in `brief`, frozen on Go; `FALLBACK_ANCHOR` (100,000) only if the feed never arrived (`ScriptedLesson.tsx:83`).
- Clock: always 60 s on screen, played back in `realMs` — 10 s for lessons 1–4, 15 s for Closing (`lessons.ts:111`) — via `requestAnimationFrame`; liquidation is checked on every sample passed, not just rendered frames (`ScriptedLesson.tsx:105`).
- $100 stake (`LESSON_STAKE`) every lesson. P&L/liquidation reuse `lib/pulse.ts` (isolated margin: floored at −stake; liquidation at entry × (1 ∓ 1/leverage)).
- Lesson configs (`LESSONS`, `lessons.ts:56`):
  - Long: 1×, Long only (Short shown locked), +2.4% → +$2.40.
  - Short: 1×, pick a side after a downtrend lead-in, −2.2% → ±$2.20; wrong side's debrief states what Short would have made.
  - Leverage: 1–20× slider (`LeverageSlider`, `ScriptedLesson.tsx:456`) with a live "trades like / 1% your way / 1% against" readout; the 1/5/10/20× table (`LeverageTable`, `:486`) sits under the Go button; path ends exactly +1%.
  - Liquidation: chips 5/10/15/25× (`LeverageChoice`, `:510`); path dips ~4.58% then ends +3% (`lessons.ts:94`), so 25× (4% distance) is liquidated at ~20.5 s and ≤15× survives; y-axis always includes the 15× line (`includePct`, `:105`). Debrief tables every option (held/liquidated, "would have made") and offers "Replay at 15×" / "See it at 25×".
  - Closing: 10×, the only lesson with Close (`canClose`); climbs to a ~+2.31% peak (+$23.13) at 34 s, lower high, ends −0.6% (−$6.00 at the bell). Live "Best so far / off the high" readout. Debrief grades the close vs `peakOf` (`lessons.ts:227`; ≥70% of peak = "Great timing", `GREAT_CLOSE_SHARE`) and lists the four when-to-close rules.
- After a liquidation or early close, playback continues to the bell: the rest of the path draws as a dashed ghost so the player sees what happened after they left.
- `LessonChart`: fixed x = lead-in + round, fixed y per lesson (`lessonDomain`) — never rescales mid-round. Profit/loss zones from the entry price (previewed faintly before entering), the trade's line clipped green above / red below entry (`LessonChart.tsx:118-121`), hatched liquidation zone + labeled line (`:164`), off-chart liquidation shown as an edge note, gold "Best moment" diamond in the Closing debrief (`:241`). Compact viewBox ≤560 px like `PriceChart`.

## Live round, step 6 (`LiveRound.tsx`, `live.ts`)

- Real BTC feed, real 60 s clock starting on the first trade, solo-practice loop shape (setup/open/settling/result) with `PulseStakeStepper`, real `PULSE_LEVERAGE_OPTIONS` chips labelled with their liquidation distance (`LiveRound.tsx:463`), Close/Reverse, `ArenaResultCard` (its playAgain slot = "Finish tutorial" + "Play again"). Scoreboard + price + `PriceChart` form the `chart` area (`:379`); coach + dock the `dock` area (`:434`).
- Liquidation: client-side on every price update, closes at the liquidation price for exactly −stake (`LiveRound.tsx:236`). Settle: `getLivePrice()` → `/api/price?symbol=BTC-USD` fallback (`:258`).
- Sibyl bot (`botDecide`, `live.ts:43`), once a second on the live tape (`runBot`, `LiveRound.tsx:161`): flat → enter by 8 s momentum ($250 at 100×, not in the last 10 s, 3 s cooldown after a close); open → close on a stall (was up ≥6% of stake and gave back 40% of the peak), a stop (−8% of stake), or in profit in the last 5 s. Its chat lines only describe these actions.
- Coach line (`coachTip`, `live.ts:71`; rendered `LiveRound.tsx:352`): one tip, most urgent first — ≥50% of stake lost (near liquidation), profit in the final 10 s, profit slipping off its peak, then in-profit / losing / flat / after-close / after-liquidation.

## Not built

- No server persistence of tutorial progress (per-browser flag only); no rank or Embers reward for finishing.
- Lesson paths are BTC-only; the ETH/DOGE lobby tabs link to the same BTC tutorial.
