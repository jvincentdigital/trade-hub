# Home: "Today"

Added 2026-11-10 night. John asked for the trades we have on the dashboard,
with a small chart, how each one is going, and where the stop is: "a hub I
could use every day, not data dumping". Ideas taken from Idea OS: picture-first
cards, a status tag per card, filter tabs, one clear next step per card.

Play money only. Nothing here talks to a broker.

## What the page shows, top to bottom

1. **Header**: date, "play money only", and one line: how many trades are open,
   their P&L together, and how many need a look. A second line (added
   2026-11-10 night): "If every open trade hits its target: +$X. If every one
   hits its stop: -$Y." Sums from entry, before fees (`ifAllHit` in
   `positions.ts`); trades without a stop, a target or a dollar rate are left
   out and counted in a short note.
2. **Open trades**: one card per open trade, from every race strategy and the
   demo account. Tabs: All, Needs a look (anything not "Running"), Race, Demo.
   Each card has:
   - market, BUY or SELL, which strategy opened it (or "Demo"), when;
   - a status tag: **Near stop** (70% or more of the way from entry to the stop),
     **Near target** (70% or more of the way to the target), **No stop** (demo
     trade without one), **Running**, or **No price** (feed not loaded);
   - a small candle chart (last 48 hourly candles for crypto and gold, last 40
     daily for forex) with the entry, stop and target as lines and the current
     price as a dot;
   - P&L in dollars and % since entry (before the exit fee), price now and entry;
   - stop and target: the price, how far away in %, and how many dollars that
     move is worth from here;
   - size the way a trader reads it (`src/lib/sizing/sizing.ts`): forex in lots
     and units (1 lot = 100,000 units, 0.01 lot = 1,000) with $ per pip; gold
     in lots of 100 oz and ounces with $ per $1 move; crypto in coins; plus the
     position value, risk $ at the stop, goal $ at the target and R:R;
   - one button: "See it in the Race" or "Manage in Demo".
     Cards sort Near stop first, then No stop, Near target, Running, newest first.
3. **How trades are placed**: a button next to "Open trades" opens a sheet
   that explains signal, entry, stop, target, size, fees, one trade per market,
   and what is not built (trailing stop, break-even, partial profits).
4. **How the race is going**: one line per strategy (money now, P&L, open
   trades), each links to `/race`, with an honest note: none has an edge yet
   (it says how close to $1,000 they all are).
5. **Closed trades**: today and the last 7 days, wins and losses in dollars,
   and the latest 6 closed trades.
6. **Markets**, compact: up/down count, the 6 biggest crypto moves (tap for the
   coin), and links to Crypto, Forex, Gold, Signals (`/strategies`), Watchlist.

The old dashboard tiles (tracked pairs, "bullish signals" that were just 24h
change, saved strategies count) and the two top gainers/losers tables are gone.

## Where the numbers come from

| Thing         | Source                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Race trades   | `/api/race` (local file, or the race relay worker on the live site, see `docs/live.md`)            |
| Demo trades   | the browser's demo account (`localStorage`, `usePaperAccount`)                                     |
| Price now     | the live price feeds (`useLivePrices`); falls back to the race's last tick price                   |
| Chart candles | `/api/crypto/candles/[id]?tf=1h` (Kraken) or `/api/forex/ohlc/[pair]?days=90` (Frankfurter, daily) |

Race trades store their units and the USD value of one quote unit at entry
(`usdPerQuote`), so card P&L = units x price move x that rate, the same as
`openPnl` in `live.ts`. Each risks 2% of its strategy's one $1,000 account
(`docs/strategy-race.md`, "Sizing"). Demo P&L converts the quote currency to
dollars with the live pairs (`quoteToUsd`).

## Files

| File                                     | Role                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `src/app/page.tsx`                       | The page                                                                 |
| `src/lib/positions/positions.ts`         | Pure: race + demo rows, `measure` (P&L, distances, status), closed tally |
| `src/lib/positions/positions.test.ts`    | Tests                                                                    |
| `src/components/home/PositionCard.tsx`   | One trade card                                                           |
| `src/components/home/MiniChart.tsx`      | Light SVG candle chart with entry/stop/target lines                      |
| `src/lib/hooks/useRace.ts`               | SWR hook for `/api/race`                                                 |
| `useRecentCandles` in `useMarketData.ts` | Candles for the small charts (one fetch per market, shared)              |
