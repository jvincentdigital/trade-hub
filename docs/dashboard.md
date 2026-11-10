# Home: "Today"

Added 2026-11-10 night. John asked for the trades we have on the dashboard,
with a small chart, how each one is going, and where the stop is: "a hub I
could use every day, not data dumping".

Rebuilt the same night as the **Cockpit** layout (mockup A, which John
picked, plus the best of mockups B and C; mockups in
`~/jvd-outputs/2026-11-10/trade-hub/mockups/`): one summary card, then one
row per trade that opens in place.

Play money only. Nothing here talks to a broker.

## What the page shows

Phone: everything in one column. Wide screens (1100 px and up): the summary
column sits on the left and stays in view while the trades scroll on the right.

1. **Header**: "Today", the date, "Play money only", and the **How trades are
   placed** button.
2. **Summary card**:
   - **Open P&L**, big, with a small line of the open P&L since the first open
     trade ("Since 4:59 PM"; at most 7 days back). The line prices each open
     trade at every closed candle since its entry and ends at the live number
     (`pnlSeries` in `today.ts`).
   - "8 open trades from 2 of 9 strategies" (demo trades counted apart).
   - **Where today could end**: a bar from every stop hit (left, red) to every
     target hit (right, green), with $0 marked and a "Now" marker at the open
     P&L. Sums from entry, before fees (`ifAllHit` in `positions.ts`); trades
     without a stop, a target or a dollar rate are left out and counted in a note.
   - **One plain line** instead of status counts: "Nothing needs a look.
     Closest: Gold buy, 43% to target." or "2 trades need a look: AVAX sell
     near stop, Gold buy near target." (`lookLine`).
   - "Closed today: 2 of 2 won, +$13.45 after fees", only when something
     closed today (race and demo, net of fees, local day).
   - The rule: each strategy has its own $1,000 play account and risks 2%.
3. **Strategies with open trades** (wide screens only, under the summary):
   each strategy's account money now (`summarize` in `race/live.ts`), "3 of 5
   open", candle size and five slot marks; how many others wait for a signal;
   a link to the race.
4. **Open trades**: a segmented control **All / Needs a look / By strategy**
   ("Needs a look" = Near stop, Near target or No stop; "By strategy" groups
   rows under each strategy with its slots, candle size, target ratio and P&L,
   demo last). Each row, closed:
   - market, Buy or Sell, P&L, strategy and time opened;
   - a thin stop-to-target bar with an entry tick and a "now" dot, its ends
     labelled with real dollars ("Stop -$20", "Target +$40");
   - one plain line: "Risk $20 · Goal +$40 · 48% of the way to target"
     (`rowLine`). A forex trade still at its entry says "At entry; forex prices
     update once a day".
   - a status pill only when it is not plain Running: **Near stop** or **Near
     target** (70% or more of the way, `NEAR` in `positions.ts`) or **No stop**
     (a demo trade without one).
     Rows sort Near stop first, then No stop, Near target, Running, newest first.
5. **A row opened** (tap it): the candle chart (last 48 hourly candles for
   crypto and gold with a dotted line where it opened, last 40 daily for forex)
   with the stop, entry and target as labelled lines and the price as a dot;
   price now and entry; **Why these levels** (the strategy's swing stop,
   lookback, buffer and target ratio, from its rule; demo trades say you set
   them); Stop and Target boxes with % away and "-$X / +$Y from here"; the size
   (`src/lib/sizing/sizing.ts`: forex lots and units with $ per pip, gold lots
   of 100 oz with $ per $1 move, crypto coins with $ per 1% move), risk at the
   stop, goal at the target with R:R, position value and margin; "See it in the
   Race" (or "Manage in Demo") and **Close**. Opening another row replaces it.
   Esc and the browser Back button close it too: the open row is in the URL
   (`?trade=<key>`, set with `window.history.pushState`, which Next.js syncs
   with `useSearchParams`).
6. **How trades are placed**: a native `<dialog>` sheet (bottom sheet on a
   phone, centered on wide screens), also in the URL (`?how=1`), so Esc, Back,
   the X, the backdrop and "Got it" all close it. It explains signal, entry at
   the next candle, the swing stop and buffer, the target ratio, the 2% size,
   the limits (5 open per strategy, one per market, 10% open risk, leverage),
   fees, and what is not built (trailing stop, break-even, partial profits).
   The stop and target ranges are read from the built-in rules, and a real
   open forex trade is worked through as an example.
7. **Markets**, compact: up/down count, the 6 biggest crypto moves (tap for the
   coin), and links to Crypto, Forex, Gold, Signals (`/strategies`), Watchlist.

Looks: inline styles and the CSS variables in `globals.css`; only what changes
with width (two columns, sticky side, row grid by container width, the sheet)
is a few classes at the bottom of `globals.css`. One type scale: 12, 14, 16,
20, 32 and 40 px (`FS` in `src/components/home/ui.ts`). Every tap target is at
least 44 px; no sideways scroll at 390 px.

## Where the numbers come from

| Thing        | Source                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Race trades  | `/api/race` (local file, or the race relay worker on the live site, see `docs/live.md`)                   |
| Demo trades  | the browser's demo account (`localStorage`, `usePaperAccount`)                                            |
| Price now    | `priceFor` in `today.ts`: the live price feeds (`useLivePrices`), falling back to the race's last price   |
| Forex (race) | the race's own last price, the daily ECB rate the trade opened on and closes on (see below)               |
| Candles      | `useCandleMap`: `/api/crypto/candles/[id]?tf=1h` (Kraken) or `/api/forex/ohlc/[pair]?days=90` (ECB daily) |

Race forex trades are valued at the race's last price, not the live forex
feed: the live feed (ExchangeRate API) is a different source than the ECB rate
the race opens and closes on, so it showed moves the race never sees (USD/JPY
"-$3.72, 19% of the way to stop" on a trade still at its entry). Demo forex
trades keep the live feed, since the demo account fills on it.

Race trades store their units and the USD value of one quote unit at entry
(`usdPerQuote`), so row P&L = units x price move x that rate, the same as
`openPnl` in `live.ts`. Each risks 2% of its strategy's one $1,000 account
(`docs/strategy-race.md`, "Sizing"). Demo P&L converts the quote currency to
dollars with the live pairs (`quoteToUsd`).

## Files

| File                                 | Role                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `src/app/page.tsx`                   | The page: rows, tabs, URL state, markets                                 |
| `src/lib/positions/positions.ts`     | Pure: race + demo rows, `measure` (P&L, distances, status), closed tally |
| `src/lib/positions/today.ts`         | Pure: summary line, row line, bar positions, P&L line, closed today      |
| `src/lib/positions/*.test.ts`        | Tests                                                                    |
| `src/components/home/Summary.tsx`    | Summary card and its small P&L line                                      |
| `src/components/home/Strategies.tsx` | Wide-screen "Strategies with open trades" card                           |
| `src/components/home/TradeRow.tsx`   | One trade row, closed and opened                                         |
| `src/components/home/MiniChart.tsx`  | Light SVG candle chart with labelled entry/stop/target lines             |
| `src/components/home/HowSheet.tsx`   | "How trades are placed" sheet                                            |
| `src/components/home/ui.ts`          | Type scale, card and button styles, small formatters                     |
| `src/lib/hooks/useRace.ts`           | SWR hook for `/api/race`                                                 |
| `useCandleMap` in `useMarketData.ts` | Candles for every open market in one SWR fetch                           |

## Gotcha

In the sheet, `<b>Not built yet:</b> trailing ... P&amp;L ...` rendered as
"Not built yet:trailing" (the space after the `</b>` was gone in the server
HTML too). That text also held an `&amp;` entity, the likely trigger. Prettier
folds `{' '}` back into a plain space, so the sheet puts that text in a string
expression instead. Check the rendered text when bold lead-ins sit next to
long JSX text.
