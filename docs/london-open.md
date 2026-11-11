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
March, then BST (UTC+1), when the London open moves to 03:00 AST (see "Not
done").

| AST (Puerto Rico) | UTC         | What                                                                        |
| ----------------- | ----------- | --------------------------------------------------------------------------- |
| 20:00 to 02:00    | 00:00-06:00 | Asian session: the London breakout marks its high and low (the Asian range) |
| 02:00             | 06:00       | Pre-open. London breakout trades from here; 15-minute ticks start           |
| 03:00             | 07:00       | Frankfurt opens (08:00 CET)                                                 |
| 03:47             | 07:47       | Claude's picks: one look, up to 2 trades                                    |
| 04:00             | 08:00       | London opens                                                                |
| 06:00             | 10:00       | Last London breakout entry (the 15m candle that starts 09:45 UTC)           |
| 07:00             | 11:00       | Last 15-minute tick; the hourly tick carries on as always                   |
| every hour at :07 |             | The hourly race tick (`com.jvd.trade-hub-race`), 24/7                       |

Since 2026-11-11 the 15-minute ticks run 02:00-12:45 AST (London to New York) and
Claude's picks at 03:47 and 09:47 AST, weekdays only.

**The plists schedule minutes only; the wrappers check the day and the hour.** The
London plist fires at :00, :15, :30 and :45 every hour and sets `RUN_HOURS="2 3 ... 12"`;
the picks plist fires at :47 and sets `RUN_HOURS="3 9"`. Both set `WEEKDAYS_ONLY=1`. The
wrapper exits at once outside those hours and on Saturday and Sunday. Why: on the Mac
Mini launchd ran every `Hour` entry 4 hours late (2026-11-11: the 02:00 tick first fired
at 06:00 AST, the 03:47 picks at 07:47 AST), while the minute-only hourly job ran on
time. The likely cause is that the Mac's time zone was set to Puerto Rico 15 minutes
after it booted (Nov 9), and launchd kept the zone it started with (02:00 in UTC-8 is
06:00 AST). A restart would probably fix it too, but the Mac has FileVault on and no
auto-login, so every agent would wait until someone signs in. Minute-only schedules
are safe either way. Check after install: `race-london.log` should start at 02:00 AST.
All three jobs use the Mac Mini's clock, which is on AST.

- **Breakouts start at 02:00, an hour before Frankfurt.** That is the spec
  (06:00 UTC), and a quiet break in that first hour uses up the day's only
  break. Whether the window should start at 03:00 (07:00 UTC) instead is
  John's call.
- **Picks at 03:47, not 03:45.** The 03:45 London tick spends about a minute
  on Kraken calls; both at once would pass Kraken's limit of about one call a
  second, and a market could drop out of the tick or out of Claude's brief.
- **The hourly tick is pinned to minute 07.** It used `StartInterval 3600`,
  which launchd counts from the end of the last run, so each start came about
  40 s later than the one before (race.log on 2026-11-10: 15:48:14, 16:48:56,
  17:49:35, 18:50:16, ...). It would have walked into the :00, :15, :30 and
  :45 London ticks and made them skip. Now it is `StartCalendarInterval`
  minute 7, and a tick that finds the lock taken waits up to 3 minutes
  instead of skipping.

**Weekends.** The real forex market is shut from Friday 17:00 to Sunday 17:00
New York time (22:00 UTC in November, 21:00 UTC in US summer time). Kraken's
forex books keep printing then, thinly (Saturday 7 Nov: a few hundred GBP/USD
trades an hour). So for forex markets the race leaves out every candle that
starts in that span (`fetchMarket` in `scripts/race-io.ts`, `forexClosed` in
`src/lib/race/candles.ts`) and asks for no forex signal while it is shut.
Stops and targets are not checked on weekend prints either. The Sunday reopen
candle stays: a real broker gaps there too. Gold and crypto trade on as
before.

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

**Spike wicks.** Kraken's forex books are thin, so now and then one trade
prints far from the market. Examples in the 15m candles: AUD/USD at 00:45 UTC
on 11 Nov (open 0.68733, high 0.7977, close 0.68772: a 16% wick), GBP/USD at
20:00 UTC on 8 Nov (high 1.3539, about 200 pips over the body), EUR/GBP lows
5% under the price, USD/CHF 5%. One of them closed a race trade at its stop
on a scratch copy. So every forex candle from Kraken has each wick beyond its
body capped at max(0.3%, 10x the series' median high-low range)
(`capSpikes` in `src/lib/kraken.ts`): about 0.4% on GBP/USD 15m, 0.8% on 1h.
GBP/JPY is built from the capped GBP/USD. Gold and crypto are not touched.
Smaller fake prints inside the cap can remain.

**GBP/JPY** is GBP/USD (Kraken, any candle size) times the ECB's daily USD/JPY
(`crossCandles`, `CROSSES` in `src/lib/feeds.ts`). The day's ECB rate is used
from 16:00 UTC, after it is published. So inside a day GBP/JPY moves with the
pound only; yen moves show up once a day as a step. Its high and low are the
GBP/USD high and low times that rate. When both legs are real intraday
candles of the same start time, `crossCandles` multiplies open x open and
close x close (exact) and high x high, low x low (approximate: the two highs
may not happen at the same moment). The app labels it "computed from GBP/USD
and USD/JPY". Because it follows GBP/USD inside the day (on 10 Nov both
broke above the Asian range on the same 06:00 candle), London breakout and
Claude's picks do not trade it: it would be a second 2% bet on the same pound
move. The built-in rules still trade it, and it stays on Today's "Pound &
gold" tab. On `/forex/GBP-JPY` the chart is the ECB's daily close; a line
under the header says the race and Today use the computed price, so the two
can differ.

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
  the break close, but never closer than 0.5x ATR and never closer than the
  margin floor (below). Target 2R.
- Skip the day when the range is wider than 1.5x the 20-day average Asian
  range (news day) or narrower than 0.3x (dead day). The average uses 1h
  candles (Kraken's 15m history is only 7.5 days) and weekdays only.
- ATR here is the simple average of the last 14 true ranges.
- Markets: GBP/USD, EUR/GBP, gold.
- The trade opens at the latest price when the tick sees the break (like
  every race trade). The stop and target are set that same distance from
  that price, so the R:R stays 2. Before this, they came from the break
  close, and a few pips of drift could turn a 2R plan into risking $20 to
  make $1.59.
- No chase: no trade when that price has run more than half the stop
  distance past the break close, or is back inside the Asian range. The tick
  logs it (`... no chase`, `... back inside the range: pass`); the break can
  still be taken on the next tick while it is fresh.

**Margin floor.** Stops from the overnight 15m ATR are tiny (3.6 pips on
GBP/USD on 10 Nov, $2.93 on gold). With 2% risk the position would be so big
that the margin cap (30:1 forex, 20:1 gold) cut it down: on real 10 Nov data
the 06:00 break sized to 22,306 units, all $1,000 of margin, real risk $8.03
(0.8%) and $4.20 of fees, half the risk. So the stop is never closer than
`minStopForFullRisk` (`src/lib/race/account.ts`): price x 2% / leverage, the
distance at which a full 2% trade just fits the margin. That is 8.9 pips on
GBP/USD at 1.334, 5.6 pips on EUR/GBP, $4.00 on gold at $4,000. At that
floor one trade uses the whole account's margin, so these accounts usually
hold one pound or gold trade at a time. That is the race's own margin rule
("same parameters"), now with the full 2% risk.

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

1. Builds a short brief per market (GBP/USD, gold): the last 12h of 15m
   candles in 3-hour blocks, the Asian range and the London breakout check,
   1h EMA50/EMA200 trend, RSI14 (1h and 15m), ATR14 (15m and 1h), the stop
   distances allowed, the nearest 1h swing highs and lows, the price now and
   every open race trade on that market.
2. Asks `claude -p` on John's subscription (never the API), locked down:
   `--setting-sources "" --strict-mcp-config --mcp-config '{"mcpServers":{}}'
--disable-slash-commands --tools "" --no-session-persistence`, a bare env
   (PATH, HOME, LANG, CLAUDE_CODE_OAUTH_TOKEN), an empty folder
   (`~/.local/share/trade-hub/claude-picks-cwd`, emptied before each run; one
   fixed folder, because claude keeps a `~/.claude/projects` entry per
   folder), 5 minutes at most. It must answer only JSON: up to 2 trades
   `{market, direction, stop, target, reason}` or none.
3. Checks each trade in code: market in the list; long or short; stop and
   target are JSON numbers (a string or a list is thrown away) on the correct
   side of the current price; stop 0.5x to 3x the 1h ATR away and never
   closer than the margin floor (`stopBand`; the brief shows the range); target
   at least 1.5x the stop distance; not against (or on top of) an open
   Claude's picks trade on that market; at most 2, one per market. The 1h ATR
   replaced the 15m one: with the margin floor, GBP/USD's 15m band shrank to
   8.9 to 10.8 pips.
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

The dry run still needs the token, which `~/.zprofile` exports only for
non-interactive shells. From a terminal, run it like this (a bare shell gets
"Not logged in", and no trade):

```bash
zsh -c 'source ~/.zprofile; make claude-picks DRY=1'
```

Claude's reason is stored as Claude wrote it (cleaned of extra spaces, at
most 300 characters) and shown on Today as "Claude's reason". React escapes
it, and reasons are never fed back into later briefs.

## One writer at a time

The hourly tick, the 15-minute London tick and Claude's picks all write
`race.json`. `race.json.lock` (`scripts/race-io.ts`) holds the pid and time of
the run that has it. It is written to a temp file first and hard-linked into
place, so it never exists empty. A tick that finds it taken waits up to 3
minutes, then prints "another race run is still going; skipping this tick"
and exits 0. Claude's picks waits up to 5 minutes. A lock whose process is
gone, or older than 20 minutes (a hung run), is taken over; only one run at a
time may do that (`race.json.lock.takeover`, created exclusively), so two runs
that see the same stale lock never both hold it. Checked with a stale lock and
6 runs starting at once, 6 rounds: one holder each time, no crashes. Ctrl-C
or a launchd stop (SIGINT, SIGTERM) lets the lock go.

## Joining the running race

`syncRaceState` adds London breakout and Claude's picks with fresh $1,000
each; every other strategy keeps its balance, open trades and history.
Checked on a copy of the live `race.json` (2026-11-10, 20:30 AST): all open
trades kept, both new accounts added.

What to expect on the first tick after the merge. Trades opened on the ECB's
daily rate are now judged on Kraken's real candles, and the gap between the
two is the feed change, not the market:

- The two GBP/USD longs opened at 4:59 PM at 1.3423 (stops 1.33315 and
  1.33449) while Kraken was at about 1.3340. They close at the open of the
  first 15m candle, below their stops (a gap fill): 1.33271 (about -$21.37)
  and 1.33405 (about -$21.60). About -$43 in all.
- The EMA 50 pullback USD/CAD buy opened at 20:59 UTC at the ECB's 1.4136,
  while Kraken was at about 1.4197. It keeps that unearned head start (about
  +61 pips, +$4.70) until it closes; Today may call it the "Closest" trade.

A path that moves to smaller candles never checks candles from before a
trade's entry (`exitOf` in `src/lib/race/live.ts`). The race was about 4 hours
and 5 ticks old when this was written. **The clean option is `make race-reset`
right after the merge** (backs up race.json, starts every account over at
$1,000, first tick, push). That is John's call; without it, the numbers above
stay in the results.

## Install (Mac Mini, after the merge, on John's yes)

Every plist points at `~/dev/trade-hub` (the main checkout), so pull first:
installed without the pull, race-london would run the old tick and
claude-picks would fail (no wrapper). Do it before 02:00 AST for that night.

```bash
cd ~/dev/trade-hub && git pull
mkdir -p ~/Library/Logs/trade-hub
# The hourly job moves from StartInterval to minute 07: reload it.
launchctl bootout gui/$(id -u)/com.jvd.trade-hub-race
cp scripts/launchd/com.jvd.trade-hub-race.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-race.plist
# The two new jobs.
cp scripts/launchd/com.jvd.trade-hub-race-london.plist ~/Library/LaunchAgents/
cp scripts/launchd/com.jvd.trade-hub-claude-picks.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-race-london.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jvd.trade-hub-claude-picks.plist
launchctl list | grep trade-hub       # race, race-london, claude-picks
launchctl print gui/$(id -u)/com.jvd.trade-hub-race-london | head -60   # shows its calendar entries (4 minutes; the wrapper checks the hour)
make race-tick                        # one tick now, so both new accounts exist (picks stops without race.json)
zsh -c 'source ~/.zprofile; make claude-picks DRY=1'   # optional: see a brief
```

The Mac Mini has no auto-login: after a power cut and restart, none of these
LaunchAgents run until jvdos logs in. Logs:

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
  02:00 AST ("Breakouts start 2:00 AM, Frankfurt opens 3:00 AM, London 4:00
  AM"), then "Breakouts are on, London in ..." from 02:00, "Frankfurt is
  open, London in ..." from 03:00 and "London is open" until 07:00 AST
  (`src/components/home/LondonStrip.tsx`, times in
  `src/lib/positions/london.ts`). Hidden the rest of the time and on weekends.
  Drawn in the browser only, so its minute text never fights the server render.
- A "Pound & gold" tab next to All / Needs a look / By strategy: GBP/USD,
  GBP/JPY, EUR/GBP and gold trades. On a phone the four tabs sit two by two.
- Claude's picks rows show "Claude's reason" under the row.
- Charts in opened rows use real 1h candles for every pair with intraday data.

## Not done (yet)

- The `/race` past-results leaderboard does not include London breakout or
  Claude's picks, and still runs forex on daily ECB candles. `/strategies`
  does not list them either; `/race` says so and points to "Why these levels"
  on Today.
- European summer time (from 28 March 2027 to late October): Frankfurt and
  London open an hour earlier in UTC (London 07:00 UTC = 03:00 AST), but the
  code keeps the winter hours, so everything runs an hour late against
  London. Nothing breaks, and on those days the strip on Today, the race
  tick log and the picks log all say "London is on summer time ... the London
  hours here have not moved yet" (`londonOnSummerTime`). Then move everything
  an hour earlier: the Asian range to 23:00-05:00 UTC, the window to
  05:00-09:00 UTC (`src/lib/race/londonBreakout.ts`,
  `src/lib/positions/london.ts`, the "08:00 UTC" in the picks prompt), and the
  launchd times to 01:00-06:00 and 02:47 AST. A TODO item is dated 2027-03-26.
- No real yen intraday feed for free without a key (Twelve Data has one with a
  free key; we keep keyless).
