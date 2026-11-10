# Strategy race

Added 2026-11-10. Page: `/race` ("Race", trophy icon in the nav). John asked:
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
- **Fair split:** each strategy's money is split evenly over every market it
  can trade (19 for all-markets rules: 10 crypto, gold, 8 forex; 10 for the crypto-only MM Confluence v2). Each share is
  its own little account running the normal `backtest` (fees, sizing,
  leverage caps as in `docs/strategy-rules.md`). End money = sum of shares. A
  market whose data failed keeps its share as cash.
- **Window per strategy**, set by how far real candles of its size go back
  (`WINDOW_DAYS` in `leaderboard.ts`): 1h rules trade the past 30 days, 4h
  rules 120 days, daily rules 365 days (Kraken has about 2 years of daily, so
  the older year warms up the indicators). Every market of a strategy, forex
  included, trades the same window (`backtest(..., { tradeFrom })`).
- Ranked by end money (ties: fewer trades first). Windows differ, so a 365-day
  rule has had more time to win or lose than a 30-day one: read the a-month
  column too. Each row: end money, profit, window and candle size, about $ a
  month (profit / window days x 30), trades, win rate, max drop of the
  combined money, best market. Tap a row for per-market results and every
  trade in dollars.
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
   last one used opens a trade at the latest price, sized like the backtest
   (risk % of that market's share, capped at share x leverage), paying the
   entry fee now. One signal makes at most one trade.
3. An open trade closes when a later real 1h candle (daily for forex) touches its
   stop (checked first) or target. A gap through the stop fills at the open.
   Exit fee as in the demo engine (0.1% crypto, 0.007% forex per side).
4. Saves state to `~/.local/share/trade-hub/race.json` (atomic write; override
   with `RACE_FILE`).

Options: `npx tsx scripts/race-tick.ts --reset --start 1000` starts a new race.

`/api/race` reads that file (local only; on Vercel it shows "not started") and
the page shows "Live since <date>", ticks so far and the last tick time,
money now, open and closed trades and P&L per strategy. The page's starting
money box scales the live dollars too (everything is proportional).

First tick: 2026-11-10 17:35 UTC (1:35 PM Puerto Rico), 9 trades opened, 1 market
(BNB) skipped by the CoinGecko rate limit.

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

`syncRaceState` (in `live.ts`, run at the start of every tick) adds any market
a strategy should trade but has no slot for. The new slot gets an even share
(start / markets, so $1,000 / 19 = $52.63), and that cash is taken evenly
from the strategy's other slots. Open trades, closed trades and each
strategy's total money are untouched, so P&L carries on. New strategies join
with fresh money. Running it again changes nothing. See `docs/gold.md`.

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

| File                          | Role                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `src/app/race/page.tsx`       | The page (leaderboard + live table)                               |
| `src/app/api/race/route.ts`   | Reads the local race file, reports whether the job is installed   |
| `src/lib/race/leaderboard.ts` | Pure: even split, dollars per trade, ranking, `WINDOW_DAYS`       |
| `src/lib/race/live.ts`        | Pure: state schema, `stepSlot` (open/close/fees), `summarize`     |
| `src/lib/race/candles.ts`     | `closedOnly` (drop the forming candle)                            |
| `src/lib/kraken.ts`           | Kraken OHLC: pairs, parser, spaced + cached fetch                 |
| `src/lib/race/feeds.ts`       | Direct Frankfurter fetch for the script                           |
| `src/lib/frankfurter.ts`      | Daily forex candles, shared with `/api/forex/ohlc/[pair]`         |
| `scripts/race-tick.ts`        | One live tick                                                     |
| `scripts/launchd/*`           | Hourly job (installed)                                            |
| `src/lib/race/race.test.ts`   | Tests: open on signal, stop/target, fees, split, ranking, windows |

## Reading the results

- 30 days of 1h or 120 days of 4h is a few dozen trades per strategy: luck dominates.
- With $1,000 split 18 ways at 0.5% risk, each trade risks about 28 cents, so
  dollar results are small on purpose. That is the real size of the edge (or
  the lack of one) at these risk settings, not a bug.
- Trust a strategy only after weeks of live ticks, many trades, and a positive
  result in both parts.
