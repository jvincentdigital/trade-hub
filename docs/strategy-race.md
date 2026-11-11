# Strategy race

Added 2026-11-10. Page: `/race` ("Race", trophy icon in the nav).

**London open (2026-11-10 night):** real 15m/1h/4h forex candles from Kraken
for GBP/USD, EUR/GBP, EUR/USD, USD/CAD, USD/CHF and AUD/USD, a computed
GBP/JPY, two new live accounts (London breakout, Claude's picks), a 15-minute
tick around the London open and a lock so two runs never write at once. See
`docs/london-open.md`. John asked:
"we have a lot of demo accounts, try the strategies out and see how much money
they could make". The race gives every built-in strategy its own play-money
account and answers in dollars which one makes the most.

**Play money only.** Nothing here connects to a broker, uses a key or costs
anything. Short or past results are mostly luck; the page says so in three
places.

## Two parts

### 1. Past results (backtest leaderboard)

Runs in the browser when `/race` opens (about 45 seconds). Was "Last 90 days"
until 2026-11-10 night, see "Real candles" below.

- Starting money is editable (default $1,000) and the same for every strategy.
- **One account per strategy** (since 2026-11-10 night, see "Sizing" below):
  each strategy trades one account across every market it can trade (19 for
  all-markets rules: 10 crypto, gold, 9 forex; 10 for the crypto-only MM
  Confluence v2). Each market's normal `backtest` gives the trades the rule
  would take there; `portfolioBacktest` (`leaderboard.ts`) merges them in time
  order into that one account, and every trade risks 2% of the balance at its
  entry, with the limits below. A market whose data failed is left out.
- **Window per strategy**, set by how far real candles of its size go back
  (`WINDOW_DAYS` in `leaderboard.ts`): 1h rules trade the past 30 days, 4h
  rules 120 days, daily rules 365 days (Kraken has about 2 years of daily, so
  the older year warms up the indicators). Every market of a strategy, forex
  included, trades the same window (`backtest(..., { tradeFrom })`).
- Ranked by end money (ties: fewer trades first). Windows differ, so a 365-day
  rule has had more time to win or lose than a 30-day one: read the a-month
  column too. Each row: end money, profit, window and candle size, about $ a
  month (profit / window days x 30), trades, trades the limits left out, win
  rate, max drop of the account (balance after each close), best market. Tap
  a row for per-market results and every trade with its size, risk, goal and
  the balance it was sized from.
- A trade the limits leave out does not free its market for that market's
  next signal (each market's backtest already stepped past it). Small effect,
  noted so nobody is surprised.
- **Data, politely:** one fetch at a time. Crypto and gold get one fetch per
  candle size some rule uses (`/api/crypto/candles/[id]?tf=1h|4h|1d`, 33
  fetches for 11 markets), shared by every strategy on that size. Forex loads
  two years of free daily ECB rates once per pair (`days=730`) so a one-year
  window still has a year to warm up the 200 EMA. Each fetch gets one retry
  after 5 s, then it is skipped with a note.
- Only the built-in rules race (9 since the course rules landed). Own copies from `/strategies` are not in it.

### 2. Live from today (forward test)

`make race-tick` (= `npx tsx scripts/race-tick.ts`) runs one tick:

1. Fetches straight from Kraken (crypto and gold: 1h always, for stop and
   target checks, plus each candle size a rule uses; about 1 call a second,
   one retry) and Frankfurter (forex daily, one retry after 30 s).
2. For every strategy and market: `latestSignal` on **closed** candles of the
   rule's timeframe (the forming candle is dropped). A signal newer than the
   last one used opens a trade at the latest price, risking 2% of that
   strategy's one balance (`stepStrategy` in `live.ts`, limits below). One
   signal makes at most one trade; a signal the limits leave out is logged as
   `PASS` and not tried again.
3. An open trade closes when a later real 1h candle (daily for forex) touches its
   stop (checked first) or target. A gap through the stop fills at the open.
   Both fees are paid at the close, as in the demo engine (0.1% crypto, 0.007%
   forex, 0.02% gold per side), and the net P&L goes to the balance.
4. Saves state to `~/.local/share/trade-hub/race.json` (atomic write; override
   with `RACE_FILE`) and pushes it to the live site.

Options:

- `make race-reset` (or `scripts/race-reset 1000`): start over, see "Starting over".
- `npx tsx scripts/race-tick.ts --push-only`: send the saved file to the live site, no tick.
- `--no-push`: tick without sending, for a test file. Always use it with a
  `RACE_FILE` test path, or the test race replaces the real one on the live site.

`/api/race` reads that file locally; on the live site it reads the copy the
tick pushes to the race relay worker (`docs/live.md`). The home page
(`docs/dashboard.md`) shows its open trades; `/race` shows "Live since <date>", ticks so far and the last tick time,
money now, open and closed trades and P&L per strategy. The page's starting
money box scales the live dollars too (everything is proportional).

First tick: 2026-11-10 17:35 UTC (1:35 PM Puerto Rico), 9 trades opened, 1 market
(BNB) skipped by the CoinGecko rate limit.

## Sizing: one $1,000 account, 2% a trade (2026-11-10 night)

John found the old sizing useless to read: $1,000 was split over about 19
markets ($52.63 each) and each trade risked 0.5-1% of that share, so a trade
risked about 26 cents (GBP/USD long, about 30 units, 0.0003 lots). He thinks
in lots ("0.1 lots = $1 per pip on a $1,000 account") and chose the course's
rule: each strategy trades **one full account**, and **every trade risks 2% of
the current balance**.

Rules (`src/lib/race/account.ts`, `RACE_SIZING`; the same for the live race and
the past results):

| Rule           | Value                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Risk per trade | 2% of the balance at entry (start money plus every closed trade's net P&L). Overrides each rule's own `riskPct` here only                       |
| Size           | units = risk $ / (stop distance x USD per quote unit)                                                                                           |
| Leverage cap   | position value at most the free balance x leverage (crypto 1:1, gold 20:1, forex 30:1); free = balance minus the margin open trades already use |
| Open trades    | at most 5 per strategy, and one per market                                                                                                      |
| Open risk      | a new trade is left out if all open stops together would lose more than 10% of the balance                                                      |
| Fees           | both sides paid at the close (so the balance only moves on closes)                                                                              |

The leverage cap counts margin already in use, like a real account: two
crypto trades can't each hold the full $1,000 in spot coins. A trade the cap
shrinks risks less than 2%. After a loss the 10% check can leave out a 5th
trade (4 x $20 open + $19.60 is more than 10% of $980).

`/strategies` backtests one market at a time and still uses each rule's own
`riskPct` (0.5% or 1%).

Worked example (the real GBP/USD trade, entry 1.3423, stop 1.33315, 91.5 pips):
2% of $1,000 = $20 risk, so 2,186 units = 0.0219 lots, $0.219 per pip
(0.0219 lots x $10 a pip per lot; 91.5 x $0.219 = $20), goal $40 at the 2R
target. Sizing helpers and display: `src/lib/sizing/sizing.ts` (forex: 1 lot =
100,000 units, pip 0.0001 or 0.01 on JPY pairs, dollars per pip through the
quote rate; gold: lots of 100 oz and dollars per $1 move; crypto: coins).

### State layout

`race.json` keeps `version: 1` because the relay worker (`race-worker/worker.js`,
not changed) only accepts version 1. The new layout is marked by its `sizing`
field. Each strategy has one `balance`, an `open` list, `lastSignal` per
market and `closed`; each trade stores `units`, `usdPerQuote` (fixed at
entry), `margin` and `entryFee`.

An old file (one slot per market) still reads: `parseRaceState` moves it to the
new layout with every dollar kept (slot cash summed, open entry fees added back
because they are now paid at the close, dollar sizes turned into units). The
tick saves a copy first as `race.json.bak-<date-time>-split`; `/api/race` only
converts it for display. Old trades keep their old small size; new trades use
2%.

## Starting over

`make race-reset` (or `make race-reset START=1000`) on the Mac Mini:

1. copies `race.json` to `race.json.bak-<date-time>` next to it (never deleted);
2. starts a fresh race at the current sizing and runs its first tick;
3. saves it and pushes it to the live site (the same push as `--push-only`).

If the tick fails before saving, `race.json` stays as it was. Best run right
after an hourly tick (or pause the job first, see below) so the two don't
write at the same time. John chose to reset after the sizing change merged.

## Candles per market

| Group             | Candles                                                 | Why it matters                                                  |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Crypto (10)       | Real 1h, 4h and 1d candles from Kraken (free, public)   | Full rule timeframe, window 30/120/365 days                     |
| Gold (1, XAU/USD) | Same as crypto, PAX Gold on Kraken (`PAXGUSD`)          | Full rule timeframe, window 30/120/365 days                     |
| Forex (8)         | One daily candle (free ECB rates), highs/lows estimated | 1h/4h rules run on daily candles: far fewer trades, rough stops |

The page shows this table in both sections.

## Real candles (2026-11-10 night)

Until then crypto and gold candles were built from CoinGecko's free
`market_chart`, which gives **one price per hour**. A 1h candle made from one
price is flat (open = high = low = close), and the pattern detector tagged every
flat candle as both a Dragonfly and a Gravestone Doji, so every 1h rule's
"reversal candle" check passed on every candle. The 1h backtests, the old
90-day leaderboard and the live race's 1h signals were misleading.

Now every crypto and gold candle comes from Kraken's free public OHLC
(`src/lib/kraken.ts`, details in `CLAUDE.md` External Services). Kraken keeps
720 candles per size, which sets the windows above. BNB is on Kraken too
(`BNBUSD`, checked 2026-11-10; daily history starts April 2025, about 570
days), so no market needs the old path. As a safety net the detector now
ignores zero-range candles (high === low), alone or inside a 2/3-candle pattern.

| Rule                        | Old (fake 1h, 90 days) | New (real candles, 2026-11-10) |
| --------------------------- | ---------------------- | ------------------------------ |
| MFX EMA 12/36 pullback (4h) | $1,006 (top)           | $992, 120 days (last)          |
| RSI range reversal (1h)     | $893 (last)            | $997, 30 days                  |
| MM stop hunt reversal (1h)  |                        | $1,002, 30 days (top)          |

`race.json` kept its format; a backup from before the first real-candle tick
is at `~/.local/share/trade-hub/race.json.bak-2026-11-10-precandles`.

## Gold joining a running race (2026-11-10)

`syncRaceState` (in `live.ts`, run at the start of every tick) added any market
a strategy should trade but had no slot for, taking its share evenly from the
other slots. Since the one-account sizing there are no slots: a new market
just starts trading from the shared balance, and `syncRaceState` only adds a
new built-in strategy with fresh money. See `docs/gold.md`.

## Hourly job (installed by John, 2026-11-10)

`com.jvd.trade-hub-race` runs on the Mac Mini. Files:

- `scripts/launchd/com.jvd.trade-hub-race.plist`: hourly (`StartInterval`
  3600), logs to `~/Library/Logs/trade-hub/race.log`.
- `scripts/launchd/run-race-tick`: wrapper that sources `~/.zprofile` for PATH
  (like `~/.local/bin/run-idea-inbox`) and runs the tick from `~/dev/trade-hub`.

The wrapper runs whatever branch is checked out in `~/dev/trade-hub`, so install
after the race is merged (or while the branch with it is checked out).

Install (Mac Mini, on John's yes):

```bash
mkdir -p ~/Library/Logs/trade-hub
cp ~/dev/trade-hub/scripts/launchd/com.jvd.trade-hub-race.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-race.plist
launchctl list | grep trade-hub-race      # should show it
tail -f ~/Library/Logs/trade-hub/race.log # after the first hour
```

Pause / resume / remove:

```bash
launchctl bootout gui/$(id -u)/com.jvd.trade-hub-race           # pause (stops the hourly runs)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-race.plist  # resume
rm ~/Library/LaunchAgents/com.jvd.trade-hub-race.plist          # remove for good (after bootout)
```

Once the plist is in `~/Library/LaunchAgents`, the page stops showing "the
hourly job is not installed yet".

## Files

| File                          | Role                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| `src/app/race/page.tsx`       | The page (leaderboard + live table)                                     |
| `src/app/api/race/route.ts`   | Reads the local race file, reports whether the job is installed         |
| `src/lib/race/account.ts`     | Pure: `RACE_SIZING`, `sizeRaceTrade` (2% risk and the limits)           |
| `src/lib/race/leaderboard.ts` | Pure: `portfolioBacktest`, `scoreStrategy`, ranking, `WINDOW_DAYS`      |
| `src/lib/race/live.ts`        | Pure: state schema, old-file move, `stepStrategy`, `summarize`          |
| `src/lib/sizing/sizing.ts`    | Pure: units, lots, $ per pip or per $1, risk, goal, R:R, text           |
| `scripts/race-reset`          | Back up race.json, fresh race, first tick, push                         |
| `src/lib/race/candles.ts`     | `closedOnly` (drop the forming candle)                                  |
| `src/lib/kraken.ts`           | Kraken OHLC: pairs, parser, spaced + cached fetch                       |
| `src/lib/race/feeds.ts`       | Direct Frankfurter fetch for the script                                 |
| `src/lib/frankfurter.ts`      | Daily forex candles, shared with `/api/forex/ohlc/[pair]`               |
| `scripts/race-tick.ts`        | One live tick                                                           |
| `scripts/launchd/*`           | Hourly job (installed)                                                  |
| `src/lib/race/race.test.ts`   | Tests: sizing limits, open/close, fees, one account, old files, ranking |

## Reading the results

- 30 days of 1h or 120 days of 4h is a few dozen trades per strategy: luck dominates.
- Each trade risks about $20 on $1,000, so one stop is -2% and one 2R target
  is about +4%. Five losers in a row is about -10%. Swings of $50-100 in a
  week are normal at this size and say little about an edge.
- Trust a strategy only after weeks of live ticks, many trades, and a positive
  result in both parts.
