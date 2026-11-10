# Strategy race

Added 2026-11-10. Page: `/race` ("Race", trophy icon in the nav). John asked:
"we have a lot of demo accounts, try the strategies out and see how much money
they could make". The race gives every built-in strategy its own play-money
account and answers in dollars which one makes the most.

**Play money only.** Nothing here connects to a broker, uses a key or costs
anything. Short or past results are mostly luck; the page says so in three
places.

## Two parts

### 1. Last 90 days (backtest leaderboard)

Runs in the browser when `/race` opens (about half a minute).

- Starting money is editable (default $1,000) and the same for every strategy.
- **Fair split:** each strategy's money is split evenly over every market it
  can trade (18 for crypto + forex rules, 10 for crypto-only). Each share is
  its own little account running the normal `backtest` (fees, sizing,
  leverage caps as in `docs/strategy-rules.md`). End money = sum of shares. A
  market whose data failed keeps its share as cash.
- Ranked by end money (ties: fewer trades first). Each row: end money, profit,
  about $ a month (profit / 90 days x 30), trades, win rate, max drop of the
  combined money, best market. Tap a row for per-market results and every
  trade in dollars.
- **Data, politely:** one market at a time. Crypto is fetched once per coin as
  1h candles (`/api/crypto/candles/[id]?tf=1h`) and merged into 4h/1d in the
  browser (`resample`), so 7 strategies share 10 fetches. Forex loads a year of
  free daily ECB rates so the 200 EMA can warm up, but only trades signals from
  the last 90 days (`backtest(..., { tradeFrom })`). Each market gets one retry
  after 5 s, then it is skipped with a note.
- Only the 7 built-in rules race. Own copies from `/strategies` are not in it.

### 2. Live from today (forward test)

`make race-tick` (= `npx tsx scripts/race-tick.ts`) runs one tick:

1. Fetches each market once, straight from CoinGecko (90 days hourly) and
   Frankfurter (daily), 6 s apart, one retry after 30 s.
2. For every strategy and market: `latestSignal` on **closed** candles of the
   rule's timeframe (the forming candle is dropped). A signal newer than the
   last one used opens a trade at the latest price, sized like the backtest
   (risk % of that market's share, capped at share x leverage), paying the
   entry fee now. One signal makes at most one trade.
3. An open trade closes when a later 1h candle (daily for forex) touches its
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

## Hourly job (NOT installed)

John has not approved a background job yet. Ready-made files:

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

| File                          | Role                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `src/app/race/page.tsx`       | The page (leaderboard + live table)                                |
| `src/app/api/race/route.ts`   | Reads the local race file, reports whether the job is installed    |
| `src/lib/race/leaderboard.ts` | Pure: even split, dollars per trade, ranking (`scoreStrategy`)     |
| `src/lib/race/live.ts`        | Pure: state schema, `stepSlot` (open/close/fees), `summarize`      |
| `src/lib/race/candles.ts`     | `resample` 1h to 4h/1d, `closedOnly`                               |
| `src/lib/race/feeds.ts`       | Direct CoinGecko/Frankfurter fetches for the script                |
| `src/lib/frankfurter.ts`      | Daily forex candles, shared with `/api/forex/ohlc/[pair]`          |
| `scripts/race-tick.ts`        | One live tick                                                      |
| `scripts/launchd/*`           | Hourly job, not installed                                          |
| `src/lib/race/race.test.ts`   | Tests: resample, open on signal, stop/target, fees, split, ranking |

## Reading the results

- 90 days on 4h/1d candles is a few dozen trades per strategy: luck dominates.
- With $1,000 split 18 ways at 0.5% risk, each trade risks about 28 cents, so
  dollar results are small on purpose. That is the real size of the edge (or
  the lack of one) at these risk settings, not a bug.
- Trust a strategy only after weeks of live ticks, many trades, and a positive
  result in both parts.
