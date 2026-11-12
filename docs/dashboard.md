# Home: "Today"

Added 2026-11-10 night. John asked for the trades we have on the dashboard,
with a small chart, how each one is going, and where the stop is: "a hub I
could use every day, not data dumping".

Rebuilt the same night as the **Cockpit** layout (mockup A, which John
picked, plus the best of mockups B and C; mockups in
`~/jvd-outputs/2026-11-10/trade-hub/mockups/`): one summary card, then one
row per trade that opens in place.

Play money only. Nothing here talks to a broker.

**Since 2026-11-11 Today follows the funded test** (`docs/strategy-race.md`,
"Funded test account and the Lab"): one $10,000 account with FTMO 2-Step
limits that takes only John's London v1 signals (GBP/USD and gold; since
that evening, before it took every strategy's). The How sheet describes
v1's rules (signal, entry, stop, targets) from its frozen settings. Its trades are the race rows on
Today; the 11 strategy accounts keep running as the Lab on the Compare tab
(was Race) and no longer show here. Demo trades still show in the list.

**Since 2026-11-12 the funded test runs in four sizes** ($10K, $50K, $100K,
$200K, same rules, `docs/strategy-race.md` "Four sizes"). A size switch at
the top of the summary card (`SizeSwitch.tsx`, four 44 px buttons, the
chosen one filled) picks which account the card, the race rows, Closed today
and the How sheet show. The choice is saved in localStorage
(`trade-hub-funded-size`, `useFundedSize.ts`, read and written in
try/catch; $10K when nothing valid is saved) and the Compare tab uses the same
one.

**Since 2026-11-12 there are two funded tests**, v1 only and v1 + breakouts
(`docs/strategy-race.md` "Second test"). A "v1 only | v1 + breakouts" switch
sits above the size switch (`TestSwitch` in `SizeSwitch.tsx`, two 44 px
buttons, saved as `trade-hub-funded-test` by `useFundedTest.ts` in
try/catch; v1 only when nothing valid is saved). Test and size together pick
the account the card, the rows, Closed today and the How sheet show; the
card's title names both ("Funded test $10K, v1 + breakouts"). Close now's
confirm says "Only in the $50K v1 + breakouts funded test. The other sizes
and the other test keep their trade."

## What the page shows

Phone: everything in one column. Wide screens (1100 px and up): the summary
column sits on the left and stays in view while the trades scroll on the right.

1. **Header**: "Today", the date, "Play money only", and the **How trades are
   placed** button.
2. **Summary card** (the funded test only; demo trades are not in it):
   - **Funded test since <start>**, big: the funded test's result, every
     closed trade after fees, plus the open P&L, minus the entry fees open
     trades still owe (`settledSoFar` in `positions.ts` + the open rows; the
     same as `fundedMoney` minus $10,000). Under it, in whole dollars: "−$145
     open, +$571 closed and fees". Changed 2026-11-11 on John's yes: the big
     number used to be the open P&L only, which looked green (+$966) while 6
     closed trades had lost $1,083 (real result -$162). Before the funded test
     has started it says it starts at the next race check.
   - **Challenge** (`Challenge` in `Summary.tsx`, numbers from `fundedView`
     in `src/lib/race/funded.ts`, priced like the rows): a status pill (Active,
     Passed, Failed) and four tiles with a bar each: **Target** ("+$426 of
     +$1,000"), **Day loss** ("$374 of $500", "3.74% of 5% used"; both of the
     $10,000 start, like FTMO; amber once the day is down $400), **Max loss** ("$0 of $1,000", "0.00% of 10% used")
     and **Trading days** ("2 of 4"). The tiles' group label reads it as one
     line: "Funded test: +$425.93, day loss used 3.74% of 5%, 0.00% of 10% max,
     2 of 4 days, target +$1,000". Under them: "Today 3 of 3 new trades, 2 of 2
     open. The day resets at 7:00 PM (midnight in Prague). A new trade opens
     only if the day's worst case, every open trade hitting its stop, stays
     under $475." Once the day is
     down $400: "no new trades until 7:00 PM". Failed or passed: a red or green
     box with the rule that broke (or the pass) and its time, "No new trades".
   - A small line of the open P&L since the first open trade ("Open trades,
     since 4:59 PM"; at most 7 days back). The line prices each open trade at every
     closed candle since its entry and ends at the live number (`pnlSeries` in
     `today.ts`). It shows only once it has 4 points over 2 hours or more;
     before that it would be a straight ramp.
   - "8 open trades from 2 of 9 strategies" (demo trades counted apart).
   - **Where the result could end**: a bar from every stop hit (left, red) to
     every target hit (right, green), with $0 marked and a "Now" marker at the
     result. Each end is the settled money plus the open trades' sums from
     entry, before exit fees (`ifAllHit` in `positions.ts`), rounded to whole
     dollars. Trades without a stop, a target or a dollar rate are left out,
     with a note that names the reason (`notCountedLine`).
   - **One plain line** instead of status counts: "Nothing needs a look.
     Closest: Gold buy, 43% to target." or "2 trades need a look: AVAX sell
     near stop, Gold buy near target." (`lookLine`).
   - "Closed today: 2 of 2 won, +$13.45 after fees", only when something
     closed today (race and demo, net of fees, local day).
   - The rule: one $10,000 play account takes every strategy's signals and
     risks 2% ($200) per trade; each strategy's own account is in the Lab.
3. (Removed 2026-11-11: the wide-screen "Strategies with open trades" card.
   It showed each Lab account's money, which is not the account Today follows.)
4. **Open trades**: a segmented control **All / Needs a look / By strategy**
   ("Needs a look" = Near stop, Near target or No stop; "By strategy" groups
   rows under the strategy whose signal opened them, with its candle size,
   target ratio and P&L, demo last). Each row, closed:
   - market, Buy or Sell, P&L, the strategy whose signal opened it, and the time;
   - a thin stop-to-target bar with an entry tick and a "now" dot, its ends
     labelled with real dollars ("Stop −$20", "Target +$40") in fixed-width
     label columns, so the bars line up row to row;
   - one plain line: "48% of the way to target" (`rowLine`), or in amber
     "Close requested, books at the next check" while a Close now waits. A forex trade
     still at its entry says "At entry, updates once a day". A row with no bar
     (no stop or no target) keeps "Risk $20 · Goal +$40" in the line instead.
   - a status pill only when it is not plain Running: **Near stop** or **Near
     target** (70% or more of the way, `NEAR` in `positions.ts`) or **No stop**
     (a demo trade without one).
     Rows sort Near stop first, then No stop, Near target, Running, newest first.
5. **A row opened** (tap it): the candle chart (last 48 hourly candles for
   crypto and gold with a dotted line where it opened, last 40 daily for forex)
   with the stop, entry and target as labelled lines and the price as a dot;
   "Now <price> · trade +0.05%" (the trade's move, so a winning sell is
   positive) and entry; **Why these levels** (the strategy's swing stop,
   lookback, buffer and target ratio, from its rule; demo trades say you set
   them); Stop and Target boxes with % away and "-$X / +$Y from here"; the size
   (`src/lib/sizing/sizing.ts`: forex lots and units with $ per pip, gold lots
   of 100 oz with $ per $1 move, crypto coins with $ per 1% move), risk at the
   stop, goal at the target with R:R, position value and margin; "See it in the
   Race" (or "Manage in Demo") and **Hide** (it only folds the row; it was
   called Close until 2026-11-11). Race rows also get **Close now** (below).
   Opening another row replaces it.
   Esc and the browser Back button fold it too: the open row is in the URL
   (`?trade=<key>`, set with `window.history.pushState`, which Next.js syncs
   with `useSearchParams`). Our entries carry `{ todayOverlay: true }` in
   `history.state` (Next keeps extra keys; never pass its `__NA` key, or it
   skips the URL sync), and Hide goes Back only from a tagged entry, so it
   still works after leaving for the race and coming back. A second close
   before the first Back lands is ignored, so double taps never leave Today.
   If the chart's candles fail to load, the row says "Chart not available
   right now."

   **Close now** (John, 2026-11-11), on each funded test row: a red outlined
   button under See it in the Race / Hide. Tap it and a confirm box asks
   "Close this GBP/USD buy now?" with Cancel and **Yes, close it**. Yes posts
   to `/api/race/close` (`requestClose` in `useRace.ts`); the box becomes
   "Close requested at 3:25 PM. It books at the next check, at the price of
   that minute." and stays after a reload (the request comes back with
   `/api/race`). The next race check closes it at the open of the Kraken
   1-minute candle of the tap ("closed by you"), unless its stop or target was
   touched before the tap. A failed send shows the reason under the button.
   How the request travels: `docs/live.md`, "Close now requests".

6. **How trades are placed**: a native `<dialog>` sheet (bottom sheet on a
   phone, centered on wide screens), also in the URL (`?how=1`), so Esc, Back,
   the X, the backdrop and "Got it" all close it. It explains signal, entry at
   the next candle, the swing stop and buffer, the target ratio, the 2% size,
   the limits (since 2026-11-11 the funded test's: 2 open, 3 new a day, the
   FTMO limits; one per market, leverage),
   fees, and what is not built (trailing stop, break-even, partial profits).
   The stop and target ranges are read from the built-in rules, and a real
   open forex trade is worked through as an example.
7. **Links** to Forex, Gold and Strategies. The crypto Markets card (up/down
   count, biggest crypto moves) and the Crypto and Watchlist links went on
   2026-11-12 (John: "crypto, I don't care"); `/crypto` and `/watchlist`
   still open by URL.

Looks: inline styles and the CSS variables in `globals.css`; only what changes
with width (two columns, sticky side, row grid by container width, the sheet)
is a few classes at the bottom of `globals.css`. One type scale: 12, 14, 16,
20, 32 and 40 px (`FS` in `src/components/home/ui.ts`). Every tap target is at
least 44 px; no sideways scroll at 390 px.

## Where the numbers come from

| Thing        | Source                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Race trades  | the funded test in `/api/race` (local file, or the race relay worker on the live site, see `docs/live.md`) |
| Demo trades  | the browser's demo account (`localStorage`, `usePaperAccount`)                                             |
| Price now    | `priceFor` in `today.ts`: the live price feeds (`useLivePrices`), falling back to the race's last price    |
| Forex (race) | the race's own last price, the daily ECB rate the trade opened on and closes on (see below)                |
| Candles      | `useCandleMap`: `/api/crypto/candles/[id]?tf=1h` (Kraken) or `/api/forex/ohlc/[pair]?days=90` (ECB daily)  |

Race forex trades are valued at the race's last price, not the live forex
feed: they open and close on that price. The live feed used to be ExchangeRate
API, rounded to 2-3 digits, which showed moves the race never sees (USD/JPY
"-$3.72, 19% of the way to stop" on a trade still at its entry). Since
2026-11-10 the live feed is the same ECB rate via Frankfurter, so demo forex
trades (which fill on the live feed) are priced to 4-5 digits too.

If `/api/race` fails and no trades are known, the summary and the list both
say "Couldn't load your trades. Trying again in a minute." (no $0.00, no "No
trades open"); with demo trades still showing, an amber line above the list
says the race trades could not load.

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
| `src/components/home/Summary.tsx`    | Summary card, the funded test's challenge tiles, its small P&L line      |
| `src/components/home/TradeRow.tsx`   | One trade row, closed and opened, with Close now and Hide                |
| `src/components/home/MiniChart.tsx`  | Light SVG candle chart with labelled entry/stop/target lines             |
| `src/components/home/HowSheet.tsx`   | "How trades are placed" sheet                                            |
| `src/components/home/ui.ts`          | Type scale, card and button styles, small formatters                     |
| `src/lib/hooks/useRace.ts`           | SWR hook for `/api/race`, plus `requestClose` (Close now)                |
| `useCandleMap` in `useMarketData.ts` | Candles for every open market in one SWR fetch                           |

## Gotcha

In the sheet, `<b>Not built yet:</b> trailing ... P&amp;L ...` rendered as
"Not built yet:trailing" (the space after the `</b>` was gone in the server
HTML too). That text also held an `&amp;` entity, the likely trigger. Prettier
folds `{' '}` back into a plain space, so the sheet puts that text in a string
expression instead. Check the rendered text when bold lead-ins sit next to
long JSX text.
