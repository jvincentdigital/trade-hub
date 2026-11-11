# London open: pound pairs and gold

Added 2026-11-10 night. John: "watch the Forex pairs, the British pound with
the dollar, everything with the British pound... it's gonna move tonight at 3
to 4 a.m. which is London time opened... I usually used to trade heavily on
gold and GBP/USD... trade heavily on that today, obviously with the same
parameters".

**Play money only.** Same race, same sizing: every strategy has its own
$1,000 account, each trade risks 2% of its balance, at most 5 open, at most
10% open risk, margin caps (forex 30:1, gold 20:1). Nothing talks to a broker.

## What runs, and when

Puerto Rico is AST (UTC-4) all year. London is on GMT (UTC+0) until late
March, then BST (UTC+1), when the London open moves to 03:00 AST.

| AST (Puerto Rico) | UTC         | What                                                                        |
| ----------------- | ----------- | --------------------------------------------------------------------------- |
| 20:00 to 02:00    | 00:00-06:00 | Asian session: the London breakout marks its high and low (the Asian range) |
| 02:00             | 06:00       | Frankfurt opens. London breakout trades from here; 15-minute ticks start    |
| 03:45             | 07:45       | Claude's picks: one look, up to 2 trades                                    |
| 04:00             | 08:00       | London opens                                                                |
| 06:00             | 10:00       | Last London breakout entry (the 15m candle that starts 09:45 UTC)           |
| 07:00             | 11:00       | Last 15-minute tick; the hourly tick carries on as always                   |
| every hour, 24/7  |             | The hourly race tick (`com.jvd.trade-hub-race`, unchanged)                  |

Weekdays only for the London jobs (Monday to Friday, launchd `Weekday` 1-5).
Both new jobs use the Mac Mini's clock, which is on AST.

## Data: real 15-minute candles

Kraken's free public OHLC (no key) has these forex pairs with tight books and
thousands of trades a day (checked 2026-11-10):

| Market         | Feed                             | Notes                                                                                                                                   |
| -------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GBP/USD        | Kraken `GBPUSD` (key `ZGBPZUSD`) | 19,000 trades a day, spread 0.3 pips                                                                                                    |
| EUR/GBP        | Kraken `EURGBP`                  | Thinner (about 700 trades a day, a few flat 15m candles at night)                                                                       |
| EUR/USD        | Kraken `EURUSD` (key `ZEURZUSD`) |                                                                                                                                         |
| USD/CAD        | Kraken `USDCAD` (key `ZUSDZCAD`) |                                                                                                                                         |
| USD/CHF        | Kraken `USDCHF`                  |                                                                                                                                         |
| AUD/USD        | Kraken `AUDUSD`                  |                                                                                                                                         |
| Gold (XAU/USD) | Kraken `PAXGUSD`                 | As before (`docs/gold.md`)                                                                                                              |
| GBP/JPY        | Computed: GBP/USD x USD/JPY      | Not on Kraken. See below                                                                                                                |
| USD/JPY        | ECB daily (Frankfurter)          | Kraken has `USDJPY`, but its book was bid 157.36 / ask 161.50 and trades bounce between the two (694 of 721 15m candles flat): unusable |
| NZD/USD        | ECB daily (Frankfurter)          | Not on Kraken                                                                                                                           |

Kraken keeps 720 candles per size: 7.5 days of 15m, 30 days of 1h, 120 days
of 4h, about 2 years of 1d. `src/lib/kraken.ts` spaces calls 1.1 s apart (the
public limit is about 1 a second), caches 5 minutes and retries once. Where
each market comes from: `src/lib/feeds.ts` (`feedOf`, `hasIntraday`).

**GBP/JPY** is GBP/USD (Kraken, any candle size) times the ECB's daily USD/JPY
(`crossCandles`, `CROSSES` in `src/lib/feeds.ts`). The day's ECB rate is used
from 16:00 UTC, after it is published. So inside a day GBP/JPY moves with the
pound only; yen moves show up once a day as a step. Its high and low are the
GBP/USD high and low times that rate. When both legs are real intraday
candles of the same start time, `crossCandles` multiplies open x open and
close x close (exact) and high x high, low x low (approximate: the two highs
may not happen at the same moment). The app labels it "computed from GBP/USD
and USD/JPY". Because it follows GBP/USD inside the day, a GBP/JPY breakout
usually comes with a GBP/USD one: two trades on one pound move (4% risk).

## Strategies

### London breakout (new, `london-breakout`)

The course's Asian range idea (`docs/strategies/marvel-fx-method.md`). Code:
`src/lib/race/londonBreakout.ts`, tests next to it.

- Asian range: high and low of the 15m candles from 00:00 to 06:00 UTC (at
  least 20 of the 24 must be there).
- Window: 15m candles starting 06:00 to 09:45 UTC (02:00 to 05:45 AST).
- Buy when a 15m candle **closes** above the range high, sell when one closes
  below the low. Only the first break of the day counts (a later break the
  other way is ignored). The break must be one of the last 2 closed candles,
  so a missed tick does not chase an old move.
- Stop: the middle of the range or 1x ATR(14) on 15m, whichever is closer to
  the entry, but never closer than 0.5x ATR. Target 2R.
- Skip the day when the range is wider than 1.5x the 20-day average Asian
  range (news day) or narrower than 0.3x (dead day). The average uses 1h
  candles (Kraken's 15m history is only 7.5 days) and weekdays only.
- ATR here is the simple average of the last 14 true ranges.
- Markets: GBP/USD, GBP/JPY, EUR/GBP, gold.
- The trade opens at the latest price when the tick sees the break (like
  every race trade), with the stop and target from the break candle.

Each tick logs one `LONDON <market>: ...` line per market (range forming, no
break yet, broke above, range too wide, and so on).

Honest note: the course itself says the first move out of Asia is often a
fake (the stop hunt), and "MM stop hunt reversal" bets on that. The two are
opposite bets, and the race will show which one wins.

### The built-in rules on real candles

Every built-in rule that trades all markets now also trades GBP/JPY, and on
the Kraken pairs (GBP/USD, EUR/GBP, EUR/USD, USD/CAD, USD/CHF, AUD/USD) it
reads its own candle size (1h, 4h or daily) instead of the ECB's one daily
rate. Gold already had real candles. Stops and targets on gold and the Kraken
forex pairs are now checked on 15m candles (crypto stays on 1h, ECB-only forex
on daily).

### Claude's picks (new, `claude-picks`)

`scripts/claude-picks.ts`, checks in `src/lib/race/claudePicks.ts`.

1. Builds a short brief per market (GBP/USD, GBP/JPY, gold): the last 12h of
   15m candles in 3-hour blocks, the Asian range and the London breakout
   check, 1h EMA50/EMA200 trend, RSI14 (1h and 15m), ATR14 (15m and 1h), the
   nearest 1h swing highs and lows, the price now and every open race trade on
   that market.
2. Asks `claude -p` on John's subscription (never the API), locked down:
   `--setting-sources "" --strict-mcp-config --mcp-config '{"mcpServers":{}}'
--disable-slash-commands --tools "" --no-session-persistence`, a bare env
   (PATH, HOME, LANG, CLAUDE_CODE_OAUTH_TOKEN), an empty temp folder, 5
   minutes at most. It must answer only JSON: up to 2 trades
   `{market, direction, stop, target, reason}` or none.
3. Checks each trade in code: market in the list; long or short; stop and
   target on the correct side of the current price; stop 0.5x to 3x the 15m
   ATR away; target at least 1.5x the stop distance; not against (or on top
   of) an open Claude's picks trade on that market; at most 2, one per market.
4. Opens the ones that pass at the current price with the race's 2% sizing
   and limits, stores the reason on the trade (Today shows it on the row),
   saves under the race lock (waits up to 5 minutes for a running tick) and
   pushes like a tick.

If Claude fails, times out or answers junk, it logs one line and opens
nothing. Its trades close like any other: every tick checks their stops and
targets.

```bash
make claude-picks DRY=1            # print the brief and Claude's decision, save nothing
npx tsx scripts/claude-picks.ts --dry-run
```

The dry run still needs the token: run it from a shell that sourced
`~/.zprofile` (a bare shell gets "Not logged in").

## One writer at a time

The hourly tick, the 15-minute London tick and Claude's picks all write
`race.json`. `race.json.lock` (`scripts/race-io.ts`) holds the pid and time of
the run that has it. A tick that finds it taken prints "another race run is
still going; skipping this tick" and exits 0. Claude's picks waits for it. A
lock whose process is gone, or older than 20 minutes, is taken over.

## Joining the running race

`syncRaceState` adds London breakout and Claude's picks with fresh $1,000
each; every other strategy keeps its balance, open trades and history.
Checked on a copy of the live `race.json` (2026-11-10, 20:30 AST): all open
trades kept, both new accounts added.

One thing to expect on the first tick after the merge: the two GBP/USD longs
opened at 4:59 PM on the ECB's daily rate (entry 1.3423) had stops at 1.33315
and 1.33449, while the real price was already about 1.334. On real 15m candles
they close at their stops, about -$21 each. A path that moves to smaller
candles never checks candles from before a trade's entry (`exitOf` in
`src/lib/race/live.ts`).

## Install (Mac Mini, after the merge, on John's yes)

```bash
cd ~/dev/trade-hub && git pull
mkdir -p ~/Library/Logs/trade-hub
cp scripts/launchd/com.jvd.trade-hub-race-london.plist ~/Library/LaunchAgents/
cp scripts/launchd/com.jvd.trade-hub-claude-picks.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-race-london.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-claude-picks.plist
launchctl list | grep trade-hub       # race, race-london, claude-picks
make race-tick                        # optional: one tick now, so both new accounts show up
make claude-picks DRY=1               # optional: see a brief (from a shell with ~/.zprofile)
```

The hourly job (`com.jvd.trade-hub-race`) stays as it is. Logs:

```bash
tail -f ~/Library/Logs/trade-hub/race-london.log
tail -f ~/Library/Logs/trade-hub/claude-picks.log
```

## Pause, resume, remove

```bash
launchctl bootout gui/$(id -u)/com.jvd.trade-hub-race-london      # pause the 15-minute London ticks
launchctl bootout gui/$(id -u)/com.jvd.trade-hub-claude-picks     # pause Claude's picks
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-race-london.plist   # resume
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-claude-picks.plist  # resume
rm ~/Library/LaunchAgents/com.jvd.trade-hub-race-london.plist     # remove for good (after bootout)
rm ~/Library/LaunchAgents/com.jvd.trade-hub-claude-picks.plist
```

Pausing them leaves the London breakout and Claude's picks accounts in the
race; the hourly tick keeps checking their open trades.

## On Today

- A small "London open" line at the top: a countdown from 12 hours before
  02:00 AST, then "Frankfurt is open, London in ..." and "London is open" until
  07:00 AST (`src/components/home/LondonStrip.tsx`, times in
  `src/lib/positions/london.ts`). Hidden the rest of the time and on weekends.
  Drawn in the browser only, so its minute text never fights the server render.
- A "Pound & gold" tab next to All / Needs a look / By strategy: GBP/USD,
  GBP/JPY, EUR/GBP and gold trades. On a phone the four tabs sit two by two.
- Claude's picks rows show "Claude's reason" under the row.
- Charts in opened rows use real 1h candles for every pair with intraday data.

## Not done (yet)

- The `/race` past-results leaderboard does not include London breakout or
  Claude's picks, and still runs forex on daily ECB candles.
- European summer time (late March to late October): Frankfurt and London
  open an hour earlier in UTC (London 07:00 UTC = 03:00 AST), but the code
  keeps the winter hours. Then move everything an hour earlier: the Asian
  range to 23:00-05:00 UTC, the window to 05:00-09:00 UTC
  (`src/lib/race/londonBreakout.ts`, `src/lib/positions/london.ts`), and the
  launchd times to 01:00-06:00 and 02:45 AST.
- No real yen intraday feed for free without a key (Twelve Data has one with a
  free key; we keep keyless).
