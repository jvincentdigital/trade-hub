# Strategy lab

Added 2026-11-11. John (asleep, gave the go-ahead): "try a lot of strategies
and see which one is more effective... throw a lot of bots... combining them
all... my Fibonacci... a long trade, a day trade, a swing trade or a scalp
trade... backtest, look at the market a long time ago... use the Forex news
(red = could impact the market)."

The lab runs about 860 play-money bots over up to two years of history,
chooses each bot's few settings on the first 70% and scores it only on the
last 30% (walk-forward). It is offline: it reads local history files, never
the network, a broker, `race.json` or the live race.

```bash
make lab                                   # all bots + report, about 10 seconds on the Mac Mini
make lab OUT=~/jvd-outputs/2026-11-11/strategy-lab
make lab-report OUT=...                    # rebuild REPORT.md / REPORT.html only
npx tsx scripts/lab/run.ts --only "fib-candle|15m"   # a subset, by bot id text
```

Output (default `~/jvd-outputs/<today>/strategy-lab`): `results.json` (every
bot, the top 10 with every trade), `ranking.csv`, `ranking.md`, `REPORT.md`,
`REPORT.html` (phone page). A hand-written `notes.md` in that folder goes into
the report as "What it means".

## Data

`~/jvd-outputs/trading/history` (override with `LAB_HISTORY`); its
`README.md`, `QUALITY.md` and `NEWS.md` say where every file came from.

| Market                                      | 1h, 4h, 1d | 5m, 15m, 30m        |
| ------------------------------------------- | ---------- | ------------------- |
| GBP/USD, gold (Dukascopy)                   | 24 months  | 12 months           |
| Bitcoin (Binance)                           | 24 months  | 24 months           |
| EUR/USD, USD/JPY, EUR/GBP, US30 (Dukascopy) | 24 months  | days only: not used |

Times are UTC, candle open. Dukascopy prices are the BID. The daily files'
short Sunday bar (about 21:00-24:00 UTC) is merged into Monday
(`mergeSundayBars`). News: `news-high-impact.csv` (219 red events, USD, GBP,
EUR, JPY, real release dates, DST-correct UTC times).

## Code

All pure and tested except the loader and the scripts.

| File                         | Role                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `src/lib/lab/load.ts`        | Stream the gzipped CSVs into candles (Node only), merge Sunday bars, read news   |
| `src/lib/lab/markets.ts`     | The 7 markets: spread, slippage, commission, leverage, which timeframes          |
| `src/lib/lab/time.ts`        | UTC clock, London summer time, sessions, style rules (entries, deadlines)        |
| `src/lib/lab/news.ts`        | Red-news windows per market, inside/overlap/next checks                          |
| `src/lib/lab/engine.ts`      | One market, one position at a time; spread, slippage, partial target, time exits |
| `src/lib/lab/fib.ts`         | John's Fib: levels, impulse detection, entries                                   |
| `src/lib/lab/scalper.ts`     | Consolidation scalper: Bollinger squeeze, range, edge fades                      |
| `src/lib/lab/london.ts`      | The race's London breakout run day by day, its fade, the day's London direction  |
| `src/lib/lab/rules.ts`       | The 9 built-in race rules through the race's own `findSignals`                   |
| `src/lib/lab/control.ts`     | Coin flip control (luck check)                                                   |
| `src/lib/lab/candles.ts`     | Reversal-candle series (race detectors on a short window + pin bars), HTF trend  |
| `src/lib/lab/walkforward.ts` | 70/30 split, parameter choice, metrics                                           |
| `src/lib/lab/bots.ts`        | The bot matrix, descriptions, `LabRunner` (load, plan, simulate, walk-forward)   |
| `scripts/lab/run.ts`         | Runner: worker pool (cores minus 3, at most 7), ranking, ensembles, files        |
| `scripts/lab/worker.ts`      | Worker process (forked with `--import tsx`), caches candles between jobs         |
| `scripts/lab/report.ts`      | REPORT.md and REPORT.html from results.json                                      |

## A bot

strategy x version x candle size x style x markets x news filter, one
$10,000 account. Sizing is the race's (`src/lib/race/account.ts`): 2% of the
balance per trade, at most 5 open, 10% open risk, position value at most free
balance x leverage (forex 30, gold and US30 20, Bitcoin 1). The trades of
every market merge into the account through the race's own
`portfolioBacktest`.

Markets: "all" (every market with that timeframe) and each market alone.

Styles (UTC):

- scalp: entries 00:00-20:00, out by the end of its session (Asia 07:00,
  London 13:00, New York 21:00);
- day: entries 00:00-20:00, flat by 21:00;
- swing: held at most 5 days;
- race (built-in rules): stop or target only, at most 10 days.

News filter: off; block (no new trade from 30 min before to 30 min after a
red event in the market's currencies, open trades kept); close (the same,
and open trades close at the open of the candle where the window starts);
day (scalper only: no new trades on a red-news day). Gold, US30 and Bitcoin
follow USD news.

## Strategies and their free settings

Kept to 6 or fewer combinations each, so the walk-forward has little to fit.

**John's Fib** (`fib.ts`). Levels from his TradingView settings (0, 0.5,
0.618, 0.786, 0.886, 1, 2, -0.272, -0.414, -0.702). SELL: candle j sets the
lowest low of the last 12; walking back, "1" is the high of the most recent
bullish candle that no later bullish candle tops and that is at least k x
ATR(14) above the low (ATR read before it); "0" is the low. While armed, a
new low moves 0 (no entry on that candle), a trade past 1 cancels the setup,
and it expires after 24 candles. Entry: a limit at the 0.786 or 0.886 level
(a buy fills when the ask reaches it). Stop 1 + 0.25 ATR. Half off at 0, the
rest at -0.272. BUY mirrors it. Settings: k = 2, 3, 4; entry = 0.786, 0.886.
Versions: plain; + candle (a reversal candle that reaches the level, enter
at the next open); London session only (08:00-16:00 London time); + candle +
the day's London direction (first close outside the 00:00-06:00 UTC range,
06:00-10:00, on the same candles); + the bigger chart's trend (EMA 50 on 4h,
or daily for 4h bots); + candle + trend. Candle sizes: 5m and 15m scalp, 15m,
30m and 1h day, 4h and daily swing. Tested against John's USD/JPY example
(1 = 163.738, 0 = 152.846: 0.786 = 161.407, 0.886 = 162.496, -0.272 = 149.883).

**Consolidation scalper** (`scalper.ts`), 5m and 15m. Range: the 20 candles
before. Squeeze: the Bollinger width (20, 2) of the candle before is in the
lowest 20% or 35% of its last 200. A reversal candle that reaches the edge's
15% zone and closes back inside (not past the middle) is faded at the next
open; stop 0.25 ATR past the edge or wick; target the middle or 90% across;
skipped under 1:1. A close more than 0.5 ATR outside the range stops fades
for 20 candles. Settings: target middle/far, squeeze 0.2/0.35.

**London breakout** (`london.ts`): the race's `londonBreakout`, unchanged,
called at every 15-minute close from 06:15 to 10:00 UTC with the race's
margin floor; next-open entry; day style. Fade: the opposite trade, same stop
distance. Settings: target 1.5, 2, 3 x (fade 1, 1.5, 2). GBP/USD and gold
(EUR/GBP has no 15m history yet). Fixed winter hours, as in the live race.

**The 9 built-in race rules** (`rules.ts`) on their own candle size with the
race's signals; setting: target 1.5, 2, 3 x the stop.

**Coin flip** (`control.ts`): about 1 entry in 20 candles, random side, stop
1.5 ATR, target 2x. Its 6 seeds are its "settings", so the walk-forward keeps
the luckiest seed in-sample, like a real bot. It shows how far luck alone
goes. Left out of the top 10 and the combined accounts.

**Combined accounts** (`runEnsemble`): several bots in one account, each
with the settings it chose alone in-sample. John's mix (Fib + candle,
scalper, London breakout on 15m, GBP/USD + gold), John's Fib on 15m + 1h +
4h (best in-sample version each) and the top 5 by in-sample money.

## Engine (`engine.ts`)

The race's backtest rules: a signal enters at the next candle's open; when a
candle touches both stop and target, the stop counts; a gap through a level
fills at the open. Added:

- **Spread**: prices are BID, so a buy pays bid + spread and sells at the
  bid; a short sells at the bid and buys back at the ask, so its stop and
  target are checked on the ask.
- **Slippage** on every market fill (entry at the open, stop, time and news
  exits); none on limit fills (Fib entries, targets).
- A limit fill never reaches its target inside its own candle (it may be
  stopped there).
- Half off at a first target; the trade's exit is the blended price, which
  gives exactly the same dollars in `portfolioBacktest`.

| Market  | Spread  | Slippage | Commission / side |
| ------- | ------- | -------- | ----------------- |
| GBP/USD | 1.0 pip | 0.2 pip  | 0.0025%           |
| EUR/USD | 0.8 pip | 0.2 pip  | 0.0025%           |
| EUR/GBP | 1.2 pip | 0.2 pip  | 0.0025%           |
| USD/JPY | 1.0 pip | 0.2 pip  | 0.0025%           |
| Gold    | $0.30   | $0.05    | 0.001%            |
| US30    | 2 pts   | 0.5 pt   | none              |
| Bitcoin | 0.02%   | 0.01%    | 0.1%              |

The race's own fee rates (forex 0.007%, gold 0.02% a side) assume no spread;
on top of a spread they would count the cost twice, so the lab uses an
ECN-style commission (about $3.50 per lot a side) instead. Bitcoin keeps the
race's 0.1% taker fee. Not modelled: wider spreads at the 21:00-22:00 UTC
rollover and around news (beyond the filter), swap.

## Walk-forward (`walkforward.ts`)

A bot's span is the time all its markets have candles. Trades are split by
entry time: first 70% in-sample, last 30% out-of-sample, each scored in its
own fresh $10,000 account. The settings with the most in-sample money among
those with at least 20 in-sample trades are kept (else the most-traded);
out-of-sample results never feed back. Ranked by out-of-sample $ a month,
bots with at least 30 out-of-sample trades. Reported: trades, win rate,
profit factor, net, max drawdown (closed-trade balance), $ a month, trades a
month, average R after costs, worst month, % gained per winner, a t-stat,
and the in-sample numbers next to them. The shortlist: made money in both
halves and beat the best coin flip.

## First run (2026-11-11)

Report: `~/jvd-outputs/2026-11-11/strategy-lab/REPORT.md` (and `.html`).

- 821 bots + 40 coin flips; 473 had 30+ out-of-sample trades; 52 made money
  out-of-sample, 26 in both halves. The best coin flip made +$500 a month and
  would rank 7th; 6 real bots beat it.
- Shortlist: RSI range reversal (the race's baseline rule), 1h, on US30
  ($10,000 to $15,205 in 7.2 months, +$5,478 in-sample) and USD/JPY ($13,849,
  +$1,137 in-sample). It lost or was flat on the other markets.
- John's Fib: lost on 5m to 1h (median -$390 to -$840 a month per chart
  size); 15m made money before costs in the test months (+$4,695 plain, day
  style) and lost $3,644 after them; 4h about flat; daily too few trades.
  Candle confirmation did not help; the bigger-chart trend made it worse.
- London breakout (race rules): -$4,336 in-sample, +$598 out-of-sample; the
  fade lost in both. The scalper lost everywhere.
- News filter: closing before red news helped 163 of 271 pairs, hurt 81;
  "no new trades" alone mostly changed nothing (red news is about 2% of
  hours); skipping red-news days helped the scalper in all 8 pairs.

## Not done

- 5-30 minute history for EUR/USD, USD/JPY, US30 and EUR/GBP (only days
  so far; `~/jvd-outputs/trading/history/README.md` has the resume steps).
- Tick-level fills inside a candle (the 1m files could settle stop-or-target
  order on the small charts).
- Nothing from the lab is in the live race. Adding the shortlist bot would
  need its own race account and a US30 feed.
