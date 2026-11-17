# The Golden Owl EA, decoded

Written 2026-11-17 from John's own copy of the robot (iCloud Drive, 2022) and
from public source code. Nothing was run, installed or changed, and the
compiled robot file was not opened up: it holds no readable text, and we did
not need it.

## The short version

- **The Golden Owl is a renamed copy of a free robot called xBest.** 134 of
  its 135 settings have exactly the same names as xBest and its later forks.
  The one that differs is a section header with the brand name in it.
- **xBest's code is public**, and its own header says "THIS EA IS 100 % FREE
  OPENSOURCE". So the system can be read line by line, legally.
- **It is not a bounce robot.** It enters with a short burst of momentum,
  then averages into a losing position with bigger and bigger trades, and
  takes one small profit for the whole pile.
- **What we cannot prove:** that the compiled Owl follows the public code in
  every detail. The settings match; the inside of the file cannot be read.

## Where it comes from

| Check                                           | Result                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Settings in the Owl                             | 135 in each of its 14 preset files                                  |
| Same name as in xBest Rv3.47 (free, public)     | 106                                                                 |
| Same name as in a later fork of the same family | 28 more                                                             |
| Found nowhere else                              | 1: `GOLDENOWLEA_ConfigGrid__` (xBest calls it `XBEST_ConfigGrid__`) |

The shared names include misspellings that nobody would invent twice:
`EnableSinalHILO`, `QtdTradesMinProfit`, `MidleNews`, `ProtectGridLastFist`.
They are Portuguese-flavoured because xBest came from a Brazilian author
("by xJhamil", "modified by Rodolfo", 2018).

- xBest lives in a public project: `github.com/trderx/EA_MindStorms`
  ("Modular EA Mql4 100% Free and OpenSource", 2018). Version Rv3.47 is also
  at `github.com/jinxingshi12/selfuse`.
- The 28 extra settings are a news filter (its source code, by a third party,
  ships inside the Owl's own folder), a cap on the number of trades, a far
  stop per trade, a "protect grid" switch and a "remove the robot" switch.
- The Owl's own preset files are public too
  (`github.com/abhijeet-codes/mt4_Experts`, folder "23. GoldOwl").
- A helper searched the web for the Owl's seller, price, reviews and track
  record. It found resale listings at low prices and one promotional
  "review", and no independent results at all. Nobody says in public that the
  Owl is xBest: that rests on our own comparison of the files.

## How it trades

These rules are read from xBest Rv3.47 and checked by a second reader. They
are given for gold on the 1-minute chart with the Owl's **passive** files,
the ones the seller calls safer.

1. **The signal.** On every price change it asks two questions. Is the price
   above the 3-candle average of the highs? Is it above the 34-candle average
   of the opens? (Both are exponential averages and include the candle still
   forming.) Two yeses are a buy signal. The mirror image (below the average
   of the lows, below the 34 average) is a sell signal. Anything else is no
   signal.
2. **Two engines.** Engine A only buys, engine B only sells. Each keeps its
   own pile of trades, and both piles can be open at once. An engine only
   acts at moments when its own signal is on.
3. **First trade.** When an engine has nothing open and its signal is on, it
   opens one trade. Passive files: a fixed size (0.02 lots, which is 2 ounces,
   on the 50k file).
4. **Adding.** If the price is at least $1.00 worse than that side's last
   trade, and the signal for that side is on again at that moment, it adds a
   trade. Each added trade is bigger: first size times 1.357 for every trade
   already open, rounded to 0.01 lot, up to a largest size. On the 50k file:
   0.02, 0.03, 0.04, 0.05, 0.07, 0.09, 0.12, 0.17, 0.23, 0.31, 0.42, then
   0.50 for every trade after that.
5. **Exit.** One target for the whole pile: the average entry price (weighted
   by size) plus $1.00. It sits at the broker and is only recalculated when a
   trade is added. The passive files have no stop on single trades.
6. **Pause.** When one side's open loss passes 2% of the account, no new
   trades are opened. A pause on the buy side also blocks the sell side.
7. **Stop.** When the total open loss passes 4% of the account, everything is
   closed. "Remove the robot" is on in the passive and aggressive files, so
   the Owl most likely switches itself off at that point (this last part is
   read from the later fork, medium confidence).
8. **A hidden rule, not a setting.** If the open profit is $1 or more in
   total and either side holds more than 12 trades, it closes everything.
9. **"After Level Change Lot A to B" = 2.** When one side already holds 3 or
   more trades and the other side starts fresh, the fresh side's first trade
   is not the normal size: it is the deep side's last trade divided by 1.357.
10. **Nothing else closes trades.** Not an opposite signal, not the clock,
    not Friday. Hours and news are left to the user: the time filter and the
    news filter are off in the passive and aggressive files.

**The aggressive files** change the character a lot: steps of $2.00, each
added trade 4 times the size of the one before (2 times on the 100k file), at
most one new trade per candle, trades added in both directions, a trailing
stop 20 cents behind the price, a move to break-even 3 cents past the average,
a rule that closes winners early once 10 trades are open, and a far stop of
$100 per trade.

**The universal files** (May 2022) switch the news filter and a Monday to
Friday clock on, cut the stop to 2% (gold) or 1% (US30), and leave the robot
running after a stop.

## Every preset file

Values exactly as in the files. Pips here are the robot's own unit: on gold
100 pips is $1.00.

### Aggressive files ("Metrix")

| Setting                                                                                  | 25K   | 50k   | 100k  | 200k  | 500k  |
| ---------------------------------------------------------------------------------------- | ----- | ----- | ----- | ----- | ----- |
| How the first trade is sized (1 = fixed size, 2 = percent of the account) (`InpLotMode`) | 2     | 2     | 2     | 2     | 2     |
| First trade, fixed size (lots; 0.01 lot = 1 ounce) (`InpFixedLot`)                       | 0.28  | 0.28  | 0.25  | 0.48  | 0.48  |
| First trade, percent setting (`InpPercentLot`)                                           | 0.5   | 0.5   | 0.5   | 0.5   | 0.5   |
| Distance between added trades (pips; 100 = $1.00 on gold) (`InpGridSize`)                | 200   | 200   | 200   | 200   | 200   |
| Take profit (pips) (`InpTakeProfit`)                                                     | 100   | 100   | 100   | 100   | 100   |
| How added trades grow (2 = multiply, 3 = step) (`TypeGridLot`)                           | 2     | 2     | 2     | 2     | 2     |
| Multiplier for each added trade (`InpGridFactor`)                                        | 4     | 4     | 2     | 4     | 4     |
| Largest single trade (lots) (`InpMaxLot`)                                                | 0.5   | 1     | 2     | 4     | 8     |
| Grid on both sides switch (`GridAllDirect`)                                              | on    | on    | on    | on    | on    |
| At most one new trade per candle (`InpOpenOneCandle`)                                    | on    | on    | on    | on    | on    |
| Close early at a small profit (`InpEnableMinProfit`)                                     | on    | on    | on    | on    | on    |
| Grid protection (close last with first trades) (`ProtectGridLastFist`)                   | on    | on    | on    | on    | on    |
| Small profit that triggers it (dollars) (`MinProfit`)                                    | 10    | 10    | 10    | 10    | 10    |
| Open trades needed before it applies (`QtdTradesMinProfit`)                              | 10    | 10    | 10    | 10    | 10    |
| Trailing stop (`InpUseTrailingStop`)                                                     | on    | on    | on    | on    | on    |
| Trailing starts at (pips) (`InpTrailStart`)                                              | 20    | 20    | 20    | 20    | 20    |
| Trailing distance (pips) (`InpTrailStop`)                                                | 20    | 20    | 20    | 20    | 20    |
| Move stop to break-even (`InpUseBreakEven`)                                              | on    | on    | on    | on    | on    |
| Break-even starts at (pips) (`InpBreakEvenStart`)                                        | 15    | 15    | 15    | 15    | 15    |
| Break-even step (pips) (`InpBreakEvenStep`)                                              | 3     | 3     | 3     | 3     | 3     |
| Hard stop per trade (points; 0 = none) (`HardSL`)                                        | 10000 | 10000 | 10000 | 10000 | 10000 |
| Pause at this loss (percent) (`InpTotalEquityRiskCaution`)                               | 2     | 2     | 2     | 2     | 2     |
| Period for that loss (minutes; 1440 = one day) (`InpTimeframeEquityCaution`)             | 1440  | 1440  | 1440  | 1440  | 1440  |
| Close everything at this loss (percent) (`InpTotalEquityRisk`)                           | 4     | 4     | 4     | 4     | 4     |
| Switch the robot off afterwards (`InpCloseRemoveEA`)                                     | on    | on    | on    | on    | on    |
| News filter (`UseNewsFilter`)                                                            | off   | off   | off   | off   | off   |
| Hours filter (`InpUtilizeTimeFilter`)                                                    | off   | off   | off   | off   | off   |
| Start time (`InpStartHour`)                                                              | 0     | 0     | 0     | 0     | 0     |
| End time (`InpEndHour`)                                                                  | 0     | 0     | 0     | 0     | 0     |

### Passive files ("NewProp")

| Setting                                                                                  | 10K   | 20k   | 50k   | 100k  | 200k  | 500k  |
| ---------------------------------------------------------------------------------------- | ----- | ----- | ----- | ----- | ----- | ----- |
| How the first trade is sized (1 = fixed size, 2 = percent of the account) (`InpLotMode`) | 1     | 1     | 1     | 1     | 1     | 1     |
| First trade, fixed size (lots; 0.01 lot = 1 ounce) (`InpFixedLot`)                       | 0.01  | 0.01  | 0.02  | 0.05  | 0.1   | 0.2   |
| First trade, percent setting (`InpPercentLot`)                                           | 0.1   | 0.1   | 0.1   | 0.1   | 0.1   | 0.15  |
| Distance between added trades (pips; 100 = $1.00 on gold) (`InpGridSize`)                | 100   | 100   | 100   | 100   | 100   | 100   |
| Take profit (pips) (`InpTakeProfit`)                                                     | 100   | 100   | 100   | 100   | 100   | 100   |
| How added trades grow (2 = multiply, 3 = step) (`TypeGridLot`)                           | 2     | 2     | 2     | 2     | 2     | 2     |
| Multiplier for each added trade (`InpGridFactor`)                                        | 1.357 | 1.357 | 1.357 | 1.357 | 1.357 | 1.357 |
| Largest single trade (lots) (`InpMaxLot`)                                                | 0.1   | 0.2   | 0.5   | 1     | 2     | 5     |
| Grid on both sides switch (`GridAllDirect`)                                              | off   | off   | off   | off   | off   | off   |
| At most one new trade per candle (`InpOpenOneCandle`)                                    | off   | off   | off   | off   | off   | off   |
| Close early at a small profit (`InpEnableMinProfit`)                                     | off   | off   | off   | off   | off   | off   |
| Grid protection (close last with first trades) (`ProtectGridLastFist`)                   | off   | off   | off   | off   | off   | off   |
| Small profit that triggers it (dollars) (`MinProfit`)                                    | 0     | 0     | 0     | 0     | 0     | 0     |
| Open trades needed before it applies (`QtdTradesMinProfit`)                              | 0     | 0     | 0     | 0     | 0     | 0     |
| Trailing stop (`InpUseTrailingStop`)                                                     | off   | off   | off   | off   | off   | off   |
| Trailing starts at (pips) (`InpTrailStart`)                                              | 0     | 0     | 0     | 0     | 0     | 0     |
| Trailing distance (pips) (`InpTrailStop`)                                                | 0     | 0     | 0     | 0     | 0     | 0     |
| Move stop to break-even (`InpUseBreakEven`)                                              | off   | off   | off   | off   | off   | off   |
| Break-even starts at (pips) (`InpBreakEvenStart`)                                        | 0     | 0     | 0     | 0     | 0     | 0     |
| Break-even step (pips) (`InpBreakEvenStep`)                                              | 0     | 0     | 0     | 0     | 0     | 0     |
| Hard stop per trade (points; 0 = none) (`HardSL`)                                        | 0     | 0     | 0     | 0     | 0     | 0     |
| Pause at this loss (percent) (`InpTotalEquityRiskCaution`)                               | 2     | 2     | 2     | 60    | 2     | 4     |
| Period for that loss (minutes; 1440 = one day) (`InpTimeframeEquityCaution`)             | 1440  | 1440  | 1440  | 1440  | 1440  | 1440  |
| Close everything at this loss (percent) (`InpTotalEquityRisk`)                           | 4     | 4     | 4     | 4     | 4     | 2     |
| Switch the robot off afterwards (`InpCloseRemoveEA`)                                     | on    | on    | on    | on    | on    | on    |
| News filter (`UseNewsFilter`)                                                            | off   | off   | off   | off   | off   | off   |
| Hours filter (`InpUtilizeTimeFilter`)                                                    | off   | off   | off   | off   | off   | off   |
| Start time (`InpStartHour`)                                                              | 00:00 | 00:00 | 00:00 | 00:00 | 00:00 | 00:00 |
| End time (`InpEndHour`)                                                                  | 00:00 | 00:00 | 00:00 | 00:00 | 00:00 | 00:00 |

### Universal files (May 2022)

| Setting                                                                                  | Gold  | Us30  | Ethereum |
| ---------------------------------------------------------------------------------------- | ----- | ----- | -------- |
| How the first trade is sized (1 = fixed size, 2 = percent of the account) (`InpLotMode`) | 2     | 1     | 2        |
| First trade, fixed size (lots; 0.01 lot = 1 ounce) (`InpFixedLot`)                       | 0.1   | 0.1   | 0.1      |
| First trade, percent setting (`InpPercentLot`)                                           | 1     | 1     | 0.5      |
| Distance between added trades (pips; 100 = $1.00 on gold) (`InpGridSize`)                | 100   | 1000  | 1000     |
| Take profit (pips) (`InpTakeProfit`)                                                     | 100   | 1000  | 1000     |
| How added trades grow (2 = multiply, 3 = step) (`TypeGridLot`)                           | 2     | 3     | 2        |
| Multiplier for each added trade (`InpGridFactor`)                                        | 1.357 | 1.357 | 1.357    |
| Largest single trade (lots) (`InpMaxLot`)                                                | 2     | 2     | 6        |
| Grid on both sides switch (`GridAllDirect`)                                              | off   | off   | off      |
| At most one new trade per candle (`InpOpenOneCandle`)                                    | off   | off   | off      |
| Close early at a small profit (`InpEnableMinProfit`)                                     | off   | off   | off      |
| Grid protection (close last with first trades) (`ProtectGridLastFist`)                   | off   | off   | off      |
| Small profit that triggers it (dollars) (`MinProfit`)                                    | 0     | 0     | 0        |
| Open trades needed before it applies (`QtdTradesMinProfit`)                              | 0     | 0     | 0        |
| Trailing stop (`InpUseTrailingStop`)                                                     | off   | on    | off      |
| Trailing starts at (pips) (`InpTrailStart`)                                              | 0     | 100   | 0        |
| Trailing distance (pips) (`InpTrailStop`)                                                | 0     | 20    | 0        |
| Move stop to break-even (`InpUseBreakEven`)                                              | off   | off   | off      |
| Break-even starts at (pips) (`InpBreakEvenStart`)                                        | 0     | 0     | 0        |
| Break-even step (pips) (`InpBreakEvenStep`)                                              | 0     | 0     | 0        |
| Hard stop per trade (points; 0 = none) (`HardSL`)                                        | 0     | 0     | 0        |
| Pause at this loss (percent) (`InpTotalEquityRiskCaution`)                               | 1     | 0.5   | 1        |
| Period for that loss (minutes; 1440 = one day) (`InpTimeframeEquityCaution`)             | 60    | 60    | 60       |
| Close everything at this loss (percent) (`InpTotalEquityRisk`)                           | 2     | 1     | 4        |
| Switch the robot off afterwards (`InpCloseRemoveEA`)                                     | off   | off   | off      |
| News filter (`UseNewsFilter`)                                                            | on    | on    | on       |
| Hours filter (`InpUtilizeTimeFilter`)                                                    | on    | on    | on       |
| Start time (`InpStartHour`)                                                              | 00:00 | 01:30 | 00:00    |
| End time (`InpEndHour`)                                                                  | 23:55 | 22:55 | 23:59    |

Settings that are the same in all 14 files: both engines on; the signal as
described (3 and 34, exponential, not inverted); no cap on the number of
trades; no daily target; hedge mode off; "After Level Change Lot A to B" 2.

## The seller's own rules for using it

From the five guides in the folder:

- Gold on the 1-minute chart. Asian session only, Monday to Wednesday
  (Thursday "if you're an experienced trader"). One guide says 6:00 PM to
  12:00 AM Florida time, another says 18:00 to 12:00 GMT-5.
- Switch it on and off by hand, and close open trades by hand at the end of
  the session.
- Avoid major USD news. Have a daily profit goal and stop when it is reached.
- A raw-spread account, a cent account under $10,000, a rented server.
- Change the two ID numbers and the first trade size to numbers "unique to
  you", and run each prop firm account on a different server.
- The robot "will permanently SHUT-DOWN" if used on accounts under more than
  two names, and editing or reselling it is forbidden.

## Things the public code does that the labels do not say

- **The spread limit does nothing on gold.** "Max Spread 2400" is compared in
  the smallest price step, so it only blocks spreads over $24.
- **The pause switch is decoration.** The code never reads "EquityCaution?";
  the pause is always on.
- **Two start settings are ignored.** Because of a unit mix-up, "Trailing
  start 20" and "Break-even start 15" have no effect; break-even acts as soon
  as the price is 3 cents past the average.
- **The 4% is really 3.85%.** The stop is measured against the account value
  after the loss.
- **Two passive files look mistyped.** The 100k file pauses at 60% (so the
  pause never acts) and the 500k file pauses at 4% with a stop at 2% (same).
- **"One trade per candle" wastes candles.** The first look in a candle uses
  it up even when nothing is opened.
- **The "Martingale Lot" label is honest, the sales pages are not.** The
  setting itself is called "Martingale Lot 0.01 / 0.02 / 0.04 / 0.08 / 0.16";
  resale pages found by the helper claim "no martingale".

## What we could not confirm

- Whether the compiled Owl kept every detail of the public code: the hidden
  numbers (the 12-trade rule, a 2-cent allowance in the average), and the
  rule that an engine only acts while its own signal is on.
- How the five extra features behave inside the Owl. They were read from a
  later fork whose own origin is unclear, so they are marked medium or low
  confidence in the full record.
- The Owl was not run. The only way to settle the points above is to watch
  the real file trade on a free demo account.

## One note on prop firms

FTMO's own FAQ warns that a third-party robot may be run by many traders with
"exactly the same strategy" and that the account can be denied if its capital
limit is passed. That is what the seller's "make your robot unique" advice is
working around. Check a firm's current rules before running any shared robot
there; this is a description, not advice.

## Files

- Full record of every rule, with code line numbers and the checker's
  corrections: `~/jvd-outputs/2026-11-17/owl-decoded/decode-record.md`
  (68 rules read; the checker confirmed 54 and
  corrected 14, none thrown out).
- Our own copy of these rules and its test on gold history:
  `docs/owl-copy-study.md` in the Trade Hub lab branch.
