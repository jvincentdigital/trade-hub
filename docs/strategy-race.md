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

### 2. Live from today (forward test): the funded test and the Lab

Since 2026-11-11 the live part is two things: the **funded test** (one
account fed by every strategy's signals, the account Today follows) and the
**Lab** (every strategy's own account, below). The Race tab shows the funded
test first, then the Lab list.

`make race-tick` (= `npx tsx scripts/race-tick.ts`) runs one tick:

1. Fetches straight from Kraken (crypto and gold: 1h always, for stop and
   target checks, plus each candle size a rule uses; about 1 call a second,
   one retry) and Frankfurter (forex daily, one retry after 30 s).
2. For every strategy and market: `latestSignal` on **closed** candles of the
   rule's timeframe (the forming candle is dropped). A signal newer than the
   last one used opens a trade at the latest price, risking 2% of that
   strategy's one balance (`stepStrategy` in `live.ts`, limits below). One
   signal makes at most one trade; a signal the limits or the two rules for
   new trades (below) leave out is logged as `PASS` and not tried again.
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

## Four rules for new trades (John, 2026-11-11)

John asked for the first two on 2026-11-11, about 09:55 AST, the third about 12:05 and the fourth about 15:05. They are checked in one
place, `newTradeBlock` in `src/lib/race/account.ts`, which `stepStrategy`
(`live.ts`) runs before sizing every new trade. Every account goes through it:
the built-in rules and London breakout (from the tick) and Claude's picks
(from `scripts/claude-picks.ts`). They only stop **new** trades. Trades that
are already open keep running: their prices are still fetched, their stops
and targets still checked, their closes still booked.

**1. No new crypto except Bitcoin.** John: "I don't want you to be trading
crypto unless it's Bitcoin... at the moment, we're just testing with Forex...
Just wait to see if they could hit the stop, but don't execute any more trades
regarding crypto, unless it is Bitcoin or another one that I will mention to
you." A new trade on any other coin is refused in every account. Gold (PAX
Gold is a metal here, not crypto) and all forex are not affected. To allow
another coin later, add its id to `ALLOWED_CRYPTO` (for example
`['bitcoin', 'ethereum']`; ids are the keys of `COIN_MAP` in
`src/lib/coingecko.ts`). The race still fetches every coin, so crypto trades
already open (BNB and POL on 2026-11-11) still close at their stop or target.

**2. One pound/dollar bet per account.** John: "most of the time when you
start doing a pair with Great British Pound, most of the time they go the
same way. I see that you took a trade that goes the other way... when it comes
to pound and dollar, what goes is as much as the same as the gold with the
dollar." Inside one account, GBP/USD, GBP/JPY, EUR/GBP and gold count as one
bet. Each trade gets a side (`POUND_DOLLAR`):

| Trade        | Side of the bet           |
| ------------ | ------------------------- |
| GBP/USD long | + (pound up, dollar down) |
| GBP/JPY long | + (pound up)              |
| EUR/GBP long | - (pound down)            |
| Gold long    | + (dollar down)           |

A short is the other side. A new trade in the group is refused when:

- the account has an open group trade on the other side (a GBP/USD long open
  means no gold short and no EUR/GBP long);
- the account already has 2 open group trades on the same side
  (`MAX_POUND_DOLLAR`);
- it is GBP/JPY while GBP/USD is open in that account, or GBP/USD while
  GBP/JPY is open. In this race GBP/JPY is GBP/USD times a daily USD/JPY rate
  that stays frozen all day (`docs/london-open.md`), so the two were the same
  trade twice: on 2026-11-11 one rule opened both and lost $212 on each.

**3. At most 2 bets the same way on the dollar per account.** Added the
same day (about 12:05 AST) on John's yes, after the 12:00 tick: RSI range
reversal held 4 open trades and MFX level 3 held 3, each all the same bet that
the dollar falls (buy EUR/USD, buy GBP/USD, sell USD/CHF, sell USD/CAD). Each
trade gets a dollar side (`DOLLAR`): a long on EUR/USD, GBP/USD, GBP/JPY,
AUD/USD, NZD/USD or gold is + (dollar down), a long on USD/JPY, USD/CHF or
USD/CAD is - (dollar up), a short is the other side. GBP/JPY counts because
here it moves with GBP/USD (see above). EUR/GBP and crypto have no dollar side.
A new trade is refused when the account already has 2 open trades on its
dollar side (`MAX_DOLLAR`). Opposite dollar bets are allowed: they offset.

**4. No new trades on markets priced once a day.** John, about 15:05 AST:
no new trades on USD/JPY, GBP/JPY and NZD/USD in every account (the funded
test and all Lab accounts) "until a live price exists". The race prices
USD/JPY and NZD/USD from the ECB's daily rate, and GBP/JPY is GBP/USD times
that daily USD/JPY (`docs/london-open.md`), so none of the three has a live
price. One list, `NOT_LIVE` in `account.ts`. Trades already open on them run
to their stop, target or the 12:45 close as before. The GBP/JPY copy rule
above now only keeps a new GBP/USD out of an account that still holds an
older GBP/JPY trade. Red news: no pause, the race trades through it (John,
same answer).

Different accounts may still disagree: one strategy can be long GBP/USD while
another is short gold. Trades already open on both sides stay open until they
close.

The tick log says why, one line per refused signal, like the other `PASS`
lines. For example:

```
  PASS  MM stop hunt reversal binancecoin: no new crypto trades except Bitcoin
  PASS  RSI range reversal pax-gold: against the open GBP-USD long (one pound/dollar bet per account)
  PASS  EMA 50 pullback GBP-USD: GBP-USD is a copy of the open GBP-JPY trade (one pound/dollar bet per account)
  PASS  London breakout pax-gold: 2 pound/dollar trades already open the same way
  PASS  MFX level 3 peak reversal GBP-USD: 2 trades already bet the dollar falls
  PASS  RSI range reversal USD-JPY: no new trades on USD-JPY: priced from a once-a-day rate, not live
```

Claude's picks only trades GBP/USD and gold (no crypto). Its prompt states the
pound/dollar rule, and `checkPicks` applies the same check in Claude's order
(its first pick wins) before anything opens; Claude's log shows a refused
pick as `REJECT`. Its prompt now gives the account's real balance instead of
"$1,000".

## Funded test account and the Lab (John, 2026-11-11)

John: "instead of every account having $10,000, it would be a total account of
$10,000... we're gonna limit our trades". He chose one funded-style account fed
by every strategy's signals, with the 11 strategy accounts kept running as a
quiet **Lab**, and 2% risk per trade. Code: `src/lib/race/funded.ts` (pure,
tested in `funded.test.ts`), stored as `funded` in `race.json`. Today shows it
as the main card (`docs/dashboard.md`); the Race tab shows it above the Lab.

The limits copy FTMO's 2-Step challenge, the best documented fit for John's
markets in `~/jvd-outputs/2026-11-11/funded-accounts/` (REPORT.md, rules.json):

| Rule                 | Value                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start                | $10,000, play money                                                                                                                                                                 |
| Risk per trade       | 2% of the current balance ($200 at the start), size from the fill-to-stop distance like the Lab                                                                                     |
| Open trades          | at most 2, one per market                                                                                                                                                           |
| New trades a day     | at most 3 per FTMO day                                                                                                                                                              |
| Rules for new trades | the Lab's four (`newTradeBlock`): Bitcoin only among crypto, one pound/dollar bet, at most 2 the same way on the dollar, nothing on USD/JPY, NZD/USD or GBP/JPY (once-a-day prices) |
| Day stop (ours)      | no new trades for the rest of the FTMO day once the day is down $400 (4% of the start) from its opening balance                                                                     |
| Daily loss           | **failed** when the day loses $500 (5% of the start, FTMO's rule) from its opening balance, closed and open trades together                                                         |
| Max loss             | **failed** when the balance or the money (with open P&L) is under $9,000 (10% of the start, static)                                                                                 |
| Target               | **passed** with balance and money at $11,000 or more (+10%) and at least 4 trading days                                                                                             |
| Day                  | FTMO's: midnight to midnight in Prague, which is 19:00 AST in winter and 18:00 AST in summer (`session.ts`)                                                                         |

- **Signal order.** Each check collects every strategy's signal in a fixed
  order: the built-in rules in the order of `BUILT_IN_RULES`
  (`src/lib/rules/presets.ts`: MM Confluence v2, EMA 50 pullback, RSI range
  reversal, MM stop hunt reversal, MM three-day exhaustion, MFX level 3 peak
  reversal, MFX EMA 12/36 pullback, MFX second leg at the day high/low, MFX
  EMA 800 pin), then London breakout, then Claude's picks; inside one
  strategy, its markets in its own order. The first signal that passes every
  rule opens. A later one on a market that is already open is logged as
  `PASS ... already open (from <strategy>)`. Claude's picks reach it from
  `scripts/claude-picks.ts`.
- **Money** = balance plus open P&L at the race's prices, minus the entry fees
  open trades still owe (the same as the Lab). The day-start balance is the
  start money plus every trade closed before that day's Prague midnight.
- **A trading day** is an FTMO day on which the account opened a trade.
- **Checked at each race check**, not tick by tick like a real firm: a quick
  dip between two checks that recovers is not seen. Stops and targets are
  still found on the candles in between.
- **Failed or passed** is final: no new trades after it, open trades run to
  their stop, target or the 12:45 close, and the card says which rule broke
  or that it passed. To run a fresh one: `make funded-reset` (backs up
  race.json first, then the next tick starts a new $10,000 account).
- **Start.** The first tick that runs this code starts it with $10,000. Every
  signal already out there at that moment is marked as used, so it only
  trades signals that come after.
- Not built: no check that a new trade's stop would fit under the 5% day
  limit (only the 4% buffer), no consistency rule (FTMO 2-Step has none), no
  news pause (FTMO's challenge has none, and John chose to trade through red
  news, 2026-11-11).

The tick log shows its lines with the name `Funded test`, for example:

```
  OPEN  Funded test GBP-USD long at 1.3123 (signal from london-breakout): 0.15 lots ...
  PASS  Funded test EUR-USD (ema50-pullback): 2 trades already open
  PASS  Funded test USD-JPY (rsi-range-reversal): no new trades on USD-JPY: priced from a once-a-day rate, not live
  Funded test                        $ 10184.20  +$184.20  open 1  closed 2  active, day loss $0.00 of $500.00, 2 of 4 days
```

## Trading day: entries 02:00 to 12:30, daily close 12:45 AST (John, 2026-11-11)

John: "after the New York session ends, close all the trades and take the
profit". He chose 12:45 AST. Every account (the Lab strategies and the funded
test, below) follows the same day, in Puerto Rico time (AST = UTC-4 all year,
no daylight saving), from `src/lib/race/session.ts`:

- **New trades only from 02:00 to 12:30 AST, Monday to Friday**
  (`entryWindowBlock`). 02:00 is the first London-open check; 12:30 leaves
  15 minutes before the close. A signal outside the window is used up and
  logged as `PASS ... new trades only from 02:00 to 12:30 AST` (or `no new
trades on the weekend`), so it can't open later at a stale price. Claude's
  picks go through the same check.
- **Daily close at 12:45 AST, Monday to Friday** (`applyDailyClose` in
  `live.ts`): the first race check at or after 12:45 closes every open trade
  in every account at that check's price (each market's last price), both fees
  booked, reason `session`, shown as "closed at 12:45". It is time-based inside
  the tick, not a launchd job (launchd jobs with an Hour key fire 4 hours late
  on the Mac Mini, see PR #9), so a 12:45 check that is missed or late (12:52,
  13:07) still does it, once. `dailyCloseAt` in `race.json` remembers the
  check that did it. A race that has never had it starts counting at its first
  check, so turning the rule on never closes trades on the spot; the first
  close is the next 12:45.
- Stops and targets are checked first in that same check, so a trade that hit
  its stop before 12:45 books the stop, not the 12:45 price.

## Stop and target follow the fill (2026-11-11 post-mortem)

A built-in rule's signal comes with a stop and a target measured from the
signal candle's close. The trade opens later, at the live price, so with fixed
levels the plan drifted: BNB was planned at 2R and filled at 1.53R. Since
2026-11-11 the race keeps the rule's own distances and measures them from the
fill (`entryLevels` in `src/lib/race/live.ts`, `reanchor` on the market tick,
set for built-in rules in `scripts/race-tick.ts`):

- stop = fill minus (signal entry minus signal stop), target = fill plus
  (signal target minus signal entry), the same for a sell, mirrored;
- the size still comes from the fill-to-stop distance, so a stop still costs
  exactly 2%, and a target now pays exactly the planned R;
- a signal is still skipped when the price has already passed its original
  stop or target (no chasing a move that is over).

London breakout already sets its levels around the fill price, and Claude's
picks are checked against the price at the fill, so neither is moved.

## Closing every trade by hand (John, 2026-11-11)

At 13:04 AST John asked to "close all the trades and take the profit" after
the New York session. `make race-close-all AT=<ISO time> [DRY=1]`
(`scripts/race-close-all.ts`, pure part `closeAll` in `src/lib/race/live.ts`)
closes every open trade in every account:

- Price: the open of the first 1-minute Kraken candle at or after the time he
  asked (13:05 AST for 13:04:31), so nothing is chosen with hindsight. USD/JPY
  and NZD/USD have no 1-minute candles here and close at the race's own last
  price (the daily ECB rate); GBP/JPY at GBP/USD times the race's USD/JPY leg.
- Both fees are booked like any close; the reason is `manual`, shown as
  "closed by you" on the Race page.
- It takes the race lock and stops without saving when a trade touched its
  stop or target between the last check and the fill minute (that close would
  have come first). `DRY=1` prints without saving.
- Since 2026-11-11 it closes the funded test's open trades too.

John can also close one trade from Today: **Close now** (2026-11-11). The tap
is stored in the relay worker and the next race check books it at the open of
the 1-minute candle of the tap, with the same stop-or-target-first rule and the
same fallback prices (`src/lib/race/closeRequests.ts`, `docs/live.md`).

The past-results leaderboard (part 1) does not use these rules: it still
backtests every market, crypto included, to rank the rules.

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

- `scripts/launchd/com.jvd.trade-hub-race.plist`: hourly at minute 07
  (`StartCalendarInterval`; it was `StartInterval 3600`, which drifted about
  40 s an hour, see `docs/london-open.md`), logs to
  `~/Library/Logs/trade-hub/race.log`.
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

| File                            | Role                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/app/race/page.tsx`         | The page (leaderboard + live table)                                                                          |
| `src/app/api/race/route.ts`     | Reads the local race file, reports whether the job is installed                                              |
| `src/lib/race/account.ts`       | Pure: sizing (`sizeRaceTrade`), new-trade rules (`newTradeBlock`)                                            |
| `src/lib/race/leaderboard.ts`   | Pure: `portfolioBacktest`, `scoreStrategy`, ranking, `WINDOW_DAYS`                                           |
| `src/lib/race/live.ts`          | Pure: state schema, old-file move, `stepStrategy`, `summarize`, `closeAll`, `applyDailyClose`, `entryLevels` |
| `src/lib/race/funded.ts`        | Pure: the funded test (limits, `stepFunded`, `checkFunded`, `fundedView`)                                    |
| `src/lib/race/session.ts`       | Pure: entry window, 12:45 AST close, FTMO's Prague day                                                       |
| `src/lib/race/closeRequests.ts` | Pure: Close now ids and booking (`bookCloseRequests`)                                                        |
| `src/lib/race/store.ts`         | Server: reads the race and close requests (worker or local files)                                            |
| `src/lib/sizing/sizing.ts`      | Pure: units, lots, $ per pip or per $1, risk, goal, R:R, text                                                |
| `scripts/race-reset`            | Back up race.json, fresh race, first tick, push                                                              |
| `src/lib/race/candles.ts`       | `closedOnly` (drop the forming candle)                                                                       |
| `src/lib/kraken.ts`             | Kraken OHLC: pairs, parser, spaced + cached fetch                                                            |
| `src/lib/race/feeds.ts`         | Direct Frankfurter fetch for the script                                                                      |
| `src/lib/frankfurter.ts`        | Daily forex candles, shared with `/api/forex/ohlc/[pair]`                                                    |
| `scripts/race-tick.ts`          | One live tick                                                                                                |
| `scripts/launchd/*`             | Hourly job (installed)                                                                                       |
| `src/lib/race/race.test.ts`     | Tests: sizing limits, open/close, fees, one account, old files, ranking                                      |
| `src/lib/race/*.test.ts`        | Tests: funded limits, session clock, Close now and the relay worker                                          |

## Reading the results

- 30 days of 1h or 120 days of 4h is a few dozen trades per strategy: luck dominates.
- Each trade risks about $20 on $1,000, so one stop is -2% and one 2R target
  is about +4%. Five losers in a row is about -10%. Swings of $50-100 in a
  week are normal at this size and say little about an edge.
- Trust a strategy only after weeks of live ticks, many trades, and a positive
  result in both parts.
