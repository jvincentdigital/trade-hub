# Indicator research: what works, what does not, and what we do next

Date: 2026-11-18. Lab research, play money, not financial advice.

## The answer in ten lines

1. Restructure. Keep the floor-and-ceiling idea, cut it down to the one form
   with outside support, and stop using indicators as the reason to trade.
2. Only one chart idea has careful outside tests: price turning at levels,
   most of all round numbers and prior highs and lows (Osler, New York Fed).
3. That lean is small and old: 60.8 bounces in 100 at published levels
   against 56.2 at random levels, 15 minutes later, on 1996 to 1998 data.
   It was weaker in the second half of her sample. Nobody tested profit.
4. Just past a round number, price tends to run faster (stop orders fire),
   for hours, not days (Osler 2002).
5. Slow 12-month trend is the other idea with real evidence, but only as a
   basket of many markets, and a 2020 paper on the same data disputes it
   market by market.
6. No popular indicator (RSI, MACD, moving averages, Bollinger, Supertrend,
   Smart Money Concepts, Squeeze, Fibonacci, pivots, harmonics) has a tested
   direction edge on major pairs today.
7. Our own lab agrees: the Fib pullback was a coin flip before costs, London
   v1 failed its six-year exam, the clock trades faded, the Owl grid loses.
8. So indicators become filters and rulers: a trend label, ATR and ADR for
   stop and target size, the session clock for timing.
9. Order of work: (1) do our levels turn price more often and further than a
   random nearby price; (2) slow trend as a basket; (3) confirmations one at
   a time, only on levels that hold.
10. Costs, one line: holding for hours or days makes the spread a smaller
    part of the move; it does not create an edge by itself.

## What John asked

On 2026-11-17 John asked for "a full research of indicators, how they work,
and what indicators are out there", the most liked and most effective ones
on TradingView and other platforms, whether they fit our strategy, and
whether to "restructure the whole strategy or look for a new strategy".

## How this was done

- Seven readers, one area each: trend and momentum; bands, volume and time;
  levels; popular on TradingView; tested evidence in forex; John's pairs and
  playbooks; John's own course and lab files.
- Two skeptics re-opened the main sources and tried to knock each claim
  down. Where a reader and a skeptic differ, the skeptic wins. Where the two
  skeptics differ, the stricter verdict is given and the other noted.
- "Verified" = full text or full page read. "Abstract only" = summary page
  only. "Not checked" = search result, tool summary, or could not open.

## What has real evidence behind it

### Levels and round numbers (Osler 2000, 2002, 2003)

- **Osler 2000** (New York Fed, verified): support and resistance levels that
  six firms sent to customers, for the mark, yen and pound against the dollar,
  January 1996 to March 1998, one-minute quotes. A "hit" is price within
  0.01% of the level (about 1 pip on EUR/USD at 1.10). A "bounce" is price
  still on the near side of the level 15 minutes later.
- Result: random levels bounced 56.2% of the time, published levels 60.8%.
  The gap was 4.2 points on the mark, 5.6 on the yen, 4.0 on the pound. All
  16 firm-currency pairs beat random; 13 of 16 were significant. The levels
  still worked five business days later, a little weaker.
- Over 70% of the published levels ended in 0 and 96% in 0 or 5. Round
  numbers and local highs and lows had bounce power of their own, but less
  than the best firms' levels. John cannot get those firms' lists, so our
  test can only use the weaker kind.
- **Against it, in the same paper:** in the second half of the sample the
  gap was no longer significant in half the cases. The data are quotes, not
  trades, and quotes bounce back more than real prices. Profit was never
  tested: Osler calls that "an appropriate subject for future research".
- **Osler 2003** (Journal of Finance, abstract only; the working paper was
  verified): about 9,700 orders at one dealing bank, 1999 to 2000.
  Take-profit orders cluster at round numbers (00 first, then 50). Stop-loss
  orders cluster just beyond them. This explains why price might stall at a
  round number and run after it breaks. It is not a trading test.
- **Osler 2002** (Staff Report 150, verified): same three currencies,
  1996 to 1998. Moves are "unusually rapid" where stop-loss orders cluster,
  just past round numbers. "Statistically significant for hours, although
  not for days." No profit test, and no independent re-check on newer data
  was found.
- How small: a 4 to 6 point lean on a 56% base cannot be seen trade by
  trade. It needs hundreds of touches and a random-level baseline. Any level
  test that reports a bounce rate without that baseline will look good and
  mean nothing.
- Why our data matters: our 1-minute files from 2005 on are a true fresh test
  of a 1996 to 1998 claim. Osler named the yen strongest in advance, so
  testing USD/JPY first is not cherry picking.

### Slow trend, 12 months (and the 2020 counter-paper)

- The rule: long if a market is up over the past 12 months, short if down,
  hold about a month, across many markets at once.
- **For:** Moskowitz, Ooi, Pedersen 2012 (abstract only) found it in all 58
  futures markets they tested, with partial reversal later; the gain is for
  a diversified portfolio. Hurst, Ooi, Pedersen 2017 (AQR page verified,
  paper not checked) report a century of trend gains; the page gives no
  numbers and the "net of costs" claim is not checked. Hutchinson et al. 2022
  (abstract only) say plain trend is the only thing left under currency
  chart rules.
- **Against:** Huang, Li, Wang, Zhou 2020 (abstract only), same data: little
  support market by market, and the strategy did no better than a rule based
  on each market's historical average return. A search summary (not checked)
  says 47 of 55 markets were not significant on their own. Weakness in
  currency trend since 2009 comes from search summaries only (not checked).
- Meaning for us: judge it only as a basket, against always-long and
  historical-average baselines, never pair by pair. It holds for weeks; it
  is not a level trade.

## The indicators, family by family

Verdicts: **worth testing** (a specific lean exists before costs and our
1-minute history can check it), **filter only** (describes trend or
volatility, does not pick direction alone), **skip**.

### Trend and momentum

Almost all of these are smoothed copies of past price. They lag and do not
see the future.

| Indicator                                 | What it measures and how it is built                                                                                                    | How traders use it                                                                                      | What tests say                                                                                                                                                                                                                            | Verdict                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Moving averages and crosses (20, 50, 200) | SMA = plain average of the last N closes. EMA weights recent closes more.                                                               | Trend filter (above the 200 = buys only), fast-over-slow cross as entry, pullback level, trailing exit. | FX MA and filter rules paid in the 1970s and 1980s, gone by the early 1990s (Neely, Weller, Ulrich 2009). No significant developed-currency rules since 1992 to 1996; 2012 to 2015 Sharpe 0.24, not significant (Hsu, Taylor, Wang 2016). | filter only                                                    |
| MACD                                      | EMA(12) minus EMA(26); signal line = EMA(9) of that; histogram = the gap between them.                                                  | Signal-line cross, zero-line cross, divergence.                                                         | Positive results are on stock indexes, no costs in the abstract (Chong and Ng 2008). In FX it sits inside rule sets that did not stay profitable (Zarrabi et al. 2017). Duplicates an MA filter.                                          | skip                                                           |
| ADX and DMI                               | ADX = trend strength, not direction, built from smoothed directional moves over true range, 14 bars. +DI and -DI show which side leads. | ADX above 20 or 25 = trending, use trend rules.                                                         | No peer-reviewed test found; vendor tests only.                                                                                                                                                                                           | no skeptic verdict; reader: no test found                      |
| RSI 30/70                                 | Compares the size of recent up closes with recent down closes, scaled 0 to 100. Default 14 bars.                                        | Sell over 70, buy under 30 in a range.                                                                  | Positive results are on stocks. The 2016 FX "Bollinger and RSI stayed profitable" line is, per its co-author's later paper, "little or no evidence" after costs and data snooping.                                                        | skip                                                           |
| RSI 50 line, bull and bear range          | In uptrends RSI tends to hold about 40 to 90; buy pullbacks to 40 to 50.                                                                | Trend-side filter.                                                                                      | No test found.                                                                                                                                                                                                                            | skip                                                           |
| RSI divergence                            | Price makes a new high, RSI does not.                                                                                                   | Warning of a fading move.                                                                               | No tested result; needs hand-picked swings. Design skeptic: filter only.                                                                                                                                                                  | skip                                                           |
| Stochastic                                | Where the close sits in the last 14 bars' high-to-low range, 0 to 100; %D = 3-bar average. Lines 20 and 80.                             | Overbought and oversold, %K and %D cross.                                                               | Only broad rule studies, which found no net profit (indirect).                                                                                                                                                                            | skip                                                           |
| Stochastic RSI                            | The stochastic formula applied to RSI instead of price.                                                                                 | More, twitchier extremes.                                                                               | No test found.                                                                                                                                                                                                                            | skip                                                           |
| CCI                                       | (Typical price minus its 20-bar average) divided by 0.015 times mean deviation. Lines +100 and -100.                                    | Strong move over +100, reversal on the cross back.                                                      | No test found.                                                                                                                                                                                                                            | skip                                                           |
| Williams %R                               | The fast stochastic upside down, 0 to -100.                                                                                             | Same as stochastic.                                                                                     | No test found.                                                                                                                                                                                                                            | skip                                                           |
| Supertrend                                | A line set ATR (average bar size) times a multiplier from the bar's midpoint, commonly 10 and 3; flips when price closes through it.    | Trend label, trailing stop, flip as entry.                                                              | No FX test. Its own page says it fails in sideways markets.                                                                                                                                                                               | filter only                                                    |
| Parabolic SAR                             | A trailing dot that speeds up toward price; start 0.02, max 0.20.                                                                       | Trailing stop, flip as exit.                                                                            | No peer-reviewed FX test.                                                                                                                                                                                                                 | filter only (design skeptic); evidence skeptic gave no verdict |
| Ichimoku                                  | Five lines from midpoints of highs and lows over 9, 26, 52 bars, plus a cloud drawn forward.                                            | Above the cloud = up; line crosses as entry.                                                            | Parameter sweep found no profitable setting on four currency pairs, 2003 to 2018 (Deng et al. 2021, abstract only).                                                                                                                       | skip                                                           |
| Slow 12-month trend                       | Is the market up or down over 12 months.                                                                                                | Long or short for a month, many markets at once.                                                        | See the evidence section: strong 2012 result, disputed asset by asset in 2020.                                                                                                                                                            | worth testing (basket only)                                    |
| Short-horizon momentum, rate of change    | Close now against N bars ago.                                                                                                           | Momentum entries.                                                                                       | Evidence is monthly; nothing tested at intraday horizons in FX.                                                                                                                                                                           | skip                                                           |
| Currency momentum ranking                 | Rank many currencies by past return, buy winners, sell losers.                                                                          | Monthly portfolio.                                                                                      | Up to about 10% a year spread, but "strong limits to arbitrage" (Menkhoff et al. 2012). Needs dozens of currencies.                                                                                                                       | skip                                                           |

### Bands and volatility

These draw how wide price is swinging. Volatility clusters (a busy period
tends to stay busy), so they help with size and timing, not direction.

| Indicator                        | What it measures and how it is built                                                                                          | How traders use it                                                   | What tests say                                                                                                                                       | Verdict     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Bollinger Bands                  | 20-bar average of the close, with lines 2 standard deviations (typical wobble) above and below.                               | Fade a band touch back to the middle, or "walk the band" in a trend. | Same correction as RSI: not an after-cost edge. Non-peer-reviewed tests disagree. Evidence skeptic: filter only.                                     | skip        |
| Bollinger squeeze                | Bands at their narrowest: quiet volatility.                                                                                   | Trade the break after a squeeze.                                     | Quiet predicts a bigger next move, not its direction. A 42-futures vendor test found the squeeze filter did not help. Evidence skeptic: filter only. | skip        |
| Squeeze Momentum (LazyBear)      | Squeeze "on" when Bollinger sits inside Keltner, plus a momentum histogram (from John Carter's TTM Squeeze).                  | Trade when the squeeze fires, in the histogram's direction.          | No test found.                                                                                                                                       | skip        |
| Keltner Channels                 | 20-bar EMA with lines 2 times ATR above and below.                                                                            | Trend riding; part of the squeeze.                                   | No test found.                                                                                                                                       | skip        |
| Donchian, n-bar breakout         | Highest high and lowest low of the last N bars (default 20).                                                                  | Buy a new N-bar high, sell a new low.                                | The slow version is the trend basket. Fast intraday breakouts have no support; the lab's London breakout lost.                                       | skip (fast) |
| ATR                              | True range = the biggest of high minus low, high minus prior close, low minus prior close. ATR = its 14-bar smoothed average. | Stops at 1.5 to 3 ATR; position size.                                | A ruler; no test shows ATR stops add profit.                                                                                                         | filter only |
| ATR sizing, volatility targeting | Risk the same amount per trade by dividing it by the stop in ATR.                                                             | Risk control.                                                        | Gains mostly in stocks and credit; "negligible" for currencies (Harvey et al. 2018, not checked).                                                    | filter only |
| Williams Vix Fix                 | A price-built volatility spike gauge for stock sell-offs.                                                                     | Spot bottoms.                                                        | No FX test; built for stock indexes.                                                                                                                 | skip        |

### Volume

Spot forex has no central exchange, so "volume" on a forex chart is a count
of one broker's price updates (tick volume), and feeds differ.

| Indicator              | What it measures and how it is built                                                              | How traders use it                          | What tests say                                                                    | Verdict |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- | ------- |
| VWAP and anchored VWAP | Running sum of price times volume over running volume, reset each session (or from a chosen bar). | Fair-price line; fade stretches back to it. | No signal test found; its real use is judging trade execution. Needs real volume. | skip    |
| Volume profile         | Volume at each price; point of control = the busiest price; value area = 70% of volume.           | Busy prices act as magnets or floors.       | No test found. A price-only touch count does the same job without volume.         | skip    |
| OBV                    | Running total: add the bar's volume on up closes, subtract on down.                               | Divergence warns of a turn.                 | Some stock results; nothing on forex.                                             | skip    |
| Tick volume            | Number of price updates in a bar.                                                                 | Volume proxy.                               | One source calls it "unreliable in many applications". Mostly a volatility proxy. | skip    |

### Time and sessions

| Indicator                                   | What it measures and how it is built                                           | How traders use it                                  | What tests say                                                                                                                                                                | Verdict     |
| ------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Session boxes, time-of-day volatility       | A box around the high and low of a session (often Asia), drawn by clock hours. | Trade the break or the fake-out at the London open. | Activity peaks in London and the London to New York overlap (BIS 2025 shares verified). Size and timing only. No test of box direction rules; the lab's London breakout lost. | filter only |
| Time-of-day direction (Breedon and Ranaldo) | A currency tends to weaken in its own trading hours.                           | Short in local hours, long after.                   | Real before 2019; in our lab it decayed to about +0.3 bp a day in 2019 to 2025.                                                                                               | skip        |

### Levels

This is the family behind John's floor-and-ceiling idea, and the only one
with a measured lean.

| Indicator                                     | What it measures and how it is built                                                                                                                          | How traders use it                                | What tests say                                                                                                                         | Verdict                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Support and resistance                        | A price band where price turned before, built from swing highs or lows clustered together.                                                                    | Fade the touch with a rejection; trade the break. | Published levels bounced 4 to 6 points more than random levels (Osler 2000). Old, small, never profit-tested.                          | worth testing                                                                                                               |
| Round numbers (00, 50)                        | Prices ending 00 or 50 (yen: xxx.00 and xxx.50).                                                                                                              | Magnets and barriers.                             | Take-profits cluster AT them, stop-losses just past them (Osler 2003). Some bounce power (Osler 2000).                                 | worth testing                                                                                                               |
| Run past a round number                       | The move after price clears a round number.                                                                                                                   | Follow the break.                                 | Moves "unusually rapid", for hours, not days (Osler 2002). Same author, no replication.                                                | worth testing                                                                                                               |
| Previous day and week high and low            | Last completed day's or week's extreme (day edge New York 17:00).                                                                                             | Turn, break or sweep there.                       | No direct test; Osler found local highs and lows had some bounce power. Part of the level test.                                        | no skeptic verdict; popular, no direct test found; included in the level study because it is one of John's own course tools |
| "Turned back 3 times" zones                   | A band price has turned from at least three times.                                                                                                            | John's floor or ceiling.                          | No study at all. Design skeptic: worth testing as his own idea.                                                                        | skip as evidence; tested in step 1 against random bands                                                                     |
| Pivot points                                  | Classic: P = (high + low + close) / 3 of yesterday; R1 = 2P minus low; S1 = 2P minus high. Fibonacci and Camarilla versions add fixed fractions of the range. | Buy at supports, sell at resistances.             | One student thesis on three pairs: no support for normal use (abstract only). No order mechanism.                                      | skip                                                                                                                        |
| Fibonacci retracements (incl. 0.786 to 0.886) | Levels at fixed fractions of a swing: high minus ratio times (high minus low).                                                                                | Enter on the pullback to a ratio.                 | Lab: 42 versions, none beat luck. A blog count of 40,243 pullbacks found no bump at Fib ratios. Design skeptic: filter only.           | skip                                                                                                                        |
| Fib "trade with the break" (lab)              | Go with a close past 0.786 on the daily Fib.                                                                                                                  | Follow the break.                                 | Best of 42 tries: 48 trades, +0.25R, not proven. Design skeptic: worth testing inside the break design.                                | skip                                                                                                                        |
| Supply and demand zones                       | A base of small candles followed by a strong move away.                                                                                                       | Fade the first return.                            | No test found.                                                                                                                         | no skeptic verdict; reader: no test found                                                                                   |
| Order blocks                                  | The last opposite candle before a strong move.                                                                                                                | Fade the return.                                  | No test found.                                                                                                                         | skip                                                                                                                        |
| Fair value gaps                               | Three candles where candle 1's high is below candle 3's low.                                                                                                  | Expect a fill or bounce.                          | One self-published placebo test: no difference from random zones.                                                                      | skip                                                                                                                        |
| Liquidity sweeps                              | Price pokes just past an obvious high or low, then closes back.                                                                                               | Trade the reversal.                               | The stop cascade is real; the reversal after it is not shown. Osler finds the move keeps going for hours. Design skeptic: filter only. | skip                                                                                                                        |
| Market structure                              | Higher highs and higher lows; a close past the last swing = "break of structure".                                                                             | Trend side and entries.                           | A swing trend rule, same family as filter rules that faded by the early 1990s.                                                         | filter only                                                                                                                 |
| Trading-range breaks                          | A close beyond a range or level.                                                                                                                              | Breakout entry.                                   | Old evidence only (Curcio and Goodhart 1992, abstract only). The narrow "past a round number" version is above.                        | skip                                                                                                                        |

### Chart and candle patterns

| Indicator                                | What it measures and how it is built                                                 | How traders use it       | What tests say                                                                                                                                                              | Verdict          |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Candlestick patterns                     | Shapes of one to three candles (pin bar, engulfing, morning star).                   | Confirmation at a level. | No value in US stock tests (not checked). Lab bounce candle failed its exam: 146 trades, -0.06R. Design skeptic: filter only. Kept only as one test inside the level study. | skip             |
| Harmonic patterns (Butterfly and family) | Five swing points measured with Fib ratios (Butterfly: B at 0.786, D at 1.27 of XA). | Enter at point D.        | No rigorous test; a student thesis found them rare and low profit. Close cousin of the Fib pullback. Design skeptic: worth testing only because the lab run is planned.     | skip as evidence |
| M and W                                  | A double top or bottom; John's course enters on the second leg.                      | Reversal entry.          | No FX test of M and W found.                                                                                                                                                | skip             |
| Head and shoulders, double tops          | Three-peak or two-peak reversal shapes.                                              | Reversal entry.          | Profitable on daily dollar rates 1973 to 1994 but beaten by simpler rules (Chang and Osler 1999). Stock work (Lo et al. 2000) found some information, no profit test.       | skip             |

## The tools from John's own course

The Market Maker course folder holds compiled MetaTrader files (not opened):
ADR marker, daily high and low, pivot points, TDI, crossover arrows,
sessions, daily and weekly high and low band, a chart template, and two
files not explained anywhere ("BPCT", "WorkTime").

- **EMA set 5, 13, 50, 200, 800** on 15 minutes: the 5 crossing the 13
  shows direction but late; the 50 is "home" and first target, the 200 the
  second; a pin bar through the 800 that closes back is an entry. No study
  of this set; our EMA 12/36 pullback lost in holdout and the MA filter
  added nothing to the Fib. **Skip** as a signal.
- **TDI**: RSI (often 13 bars) with a 2-bar "price line", a 7-bar "signal
  line" and bands around a 34-bar "market base line" (third-party settings;
  the course gives none). The "shark fin" is RSI leaving the bands, coming
  back and crossing the signal line. No test found. **Skip** (design
  skeptic: filter only).
- **ADR marker**: average of daily high minus low over 14 to 20 days. The
  course says "about 200 pips a day and 600 a week at most", then expects a
  reversal. No paper on ADR fades. **Filter only**, as a target ruler; the
  exhaustion fade is skip.
- **Daily and weekly high and low bands**: prior extremes. No skeptic
  verdict; popular, no direct test found (Osler found local highs and lows
  had some bounce power). Included in the level study because it is one of
  John's own course tools.
- **Pivot points** (course M1 to M4): one student thesis found no support.
  **Skip.**
- **Session boxes** (Asia range, stop-hunt zone 25 to 50 pips beyond it):
  the volatility clock is well supported, box direction is untested, our
  London breakout lost. **Filter only**, for timing.

## What is most used and liked on TradingView

TradingView publishes no usage ranking for built-ins. Broker lists (opinion,
not data) put RSI, MACD, moving averages and Bollinger Bands on top, then
Fibonacci, Stochastic, Ichimoku and volume profile.

Community scripts with the biggest first number on their pages, read live on
2026-11-18. The pages do not label the three numbers they show; by position
the first looks like boosts (likes), so these are "as shown", not verified
like counts. No official all-time list could be opened.

| Script                                              | First number shown                 | What it does                                                                 |
| --------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| Smart Money Concepts (LuxAlgo)                      | 182.4K                             | Draws structure breaks, order blocks, fair value gaps, equal highs and lows. |
| Squeeze Momentum (LazyBear)                         | 118.3K                             | Bollinger inside Keltner = squeeze, plus a momentum bar.                     |
| SuperTrend (Kivanc Ozbilgic)                        | 85.8K                              | ATR trailing line, defaults 10 and 3.                                        |
| Support and Resistance Levels with Breaks (LuxAlgo) | 68.2K                              | Pivot highs and lows as lines, marks breaks.                                 |
| CM Williams Vix Fix (ChrisMoody)                    | 66.2K                              | Price-built volatility spike gauge for stock sell-offs.                      |
| UT Bot Alerts (QuantNomad)                          | 62.5K                              | ATR trailing stop; close above = buy, below = sell.                          |
| WaveTrend (LazyBear)                                | 52.3K (July 2025 blog, not opened) | Price against its EMA, scaled; crossovers.                                   |

Why popularity is not evidence: a like measures liking, not profit. None of
these scripts comes with a test. The Smart Money Concepts page itself says
"there is no supporting data regarding the validity of these teachings".

Repainting warning (TradingView's own Pine docs, verified): "most scripts
based on pivots" are "potentially misleading"; pivot scripts "will often go
back in the past to plot pivot levels"; higher-timeframe data "can return
unconfirmed values on realtime bars". A pivot is only known after its
right-hand bars close, so the chart history shows levels earlier than a live
trader saw them. Any backtest of ours must use a level only after its
confirming bars have closed.

## What our own lab already found

- **Fib pullback:** about 0R a trade before costs on 5 to 30 minute charts:
  a coin flip. 42 versions on 8 markets: none beat luck.
- **The one small plus:** trading WITH the break through 0.786 on the daily
  Fib: 48 trades, +0.25R a trade, luck score 0.22. Not proven: 48 trades is
  too few, and the best of 42 tries is expected to look good by chance.
- **Two strong candles first:** flat (+0.03R, 158 trades). **Fib plus
  bounce candle, 4-hour:** failed its exam (146 trades, -0.06R).
- **London v1:** FAILED its exam on six older years (2019 to 2024): 656
  trades, -18.3R, profit factor 0.95. Its earlier clean year (+27.6R) does
  not stand.
- **Clock trades:** the EUR/USD time-of-day lean was real in 2005 to 2012
  and faded to about +0.3 bp a day in 2019 to 2025; the gold and index clock
  trades were not significant after costs in 2019 to 2025.
- **Golden Owl grid:** after a step of $1 to $10, the next $1 goes back
  only 47 to 52% of the time (47 to 49% on the $1 step), where the candles
  can see it. As sold, it loses in every year 2019 to 2026. None of 1,080
  versions made money after costs in 2019 to 2022 or 2023 to 2026; their
  mirrors (2019 to 2022 only) did not either. The Owl loses to costs, not
  to direction.
- Not run yet: harmonic patterns, slow trend basket, the levels study.

## What we do with this

1. **The floor-and-ceiling test.** Does price turn at our levels (round
   numbers, prior highs and lows, 3-turn zones on 4-hour and daily) more
   often and further than at a random nearby price of the same width and
   distance? Pick on 2005 to 2018 (two halves that must agree), check once
   on 2019 to 2025. If our levels do no better than a random nearby price,
   the level line stops there; that is a real answer. The exact bars are in
   the plan: `docs/levels-study.md` on this branch.
2. **Slow trend as a basket.** Judged on the whole basket, against
   always-long and historical-average baselines. Plan:
   `docs/slow-trend-study.md` on branch `lab/clock-trades` (draft PR #35),
   run planned for 2026-11-19.
3. **Confirmations one at a time**, only on a level type that held in step
   1: close back out, a candle, RSI(14) turning back from 30 or 70, the
   4-hour trend, overlap with the 0.786 to 0.886 Fib band, and a sweep.
   Each one alone against the level-only version, never stacked.

**What we drop:** the hunt for a better oscillator; Fibonacci as the
trigger; pivots; Smart Money tools (order blocks, fair value gaps); tick
volume, VWAP and volume profile; session-box direction rules; time-of-day
direction trades; the Owl grid; picking the best pair after seeing all the
years.

## Sources

Status as the reports give it: verified (full text or full page), abstract
only, or not checked (search result, tool summary, or could not open).

### Levels and round numbers

| Source                                               | Status        | Link                                                                                                                    |
| ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Osler 2000, "Support for Resistance"                 | verified      | https://www.newyorkfed.org/medialibrary/media/research/epr/00v06n2/0007osle.pdf                                         |
| Osler 2003, Journal of Finance                       | abstract only | https://ideas.repec.org/a/bla/jfinan/v58y2003i5p1791-1819.html                                                          |
| Osler 2001, Staff Report 125 (working paper of 2003) | verified      | https://fraser.stlouisfed.org/files/docs/publications/frbnysr/frbny_sr125.pdf                                           |
| Osler 2002, Staff Report 150                         | verified      | https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr150.html                                         |
| Curcio and Goodhart 1992                             | abstract only | https://researchonline.lse.ac.uk/id/eprint/119184                                                                       |
| Johnsson and Frykmer 2019, pivot thesis              | abstract only | https://lup.lub.lu.se/student-papers/record/8979805                                                                     |
| ForexOp Fibonacci count (blog)                       | verified      | https://forexop.com/strategy/fibonacci-fact-or-fiction/                                                                 |
| HKUST student project, Fibonacci                     | not checked   | https://cse.hkust.edu.hk/~rossiter/independent_studies_projects/fibonacci_trading/fibonacci_trading.pdf                 |
| HKUST student project, harmonics                     | not checked   | https://cse.hkust.edu.hk/~rossiter/independent_studies_projects/trading_harmonic_patterns/trading_harmonic_patterns.pdf |
| Fair value gap placebo test (self-published)         | verified      | https://de.tradingview.com/script/Kbq3WncE-Fair-Value-Gap-FVG-Statistics-with-Placebo-Control/                          |

### Chart rules in forex

| Source                                                            | Status        | Link                                                                        |
| ----------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| Neely, Weller, Ulrich 2009                                        | abstract only | https://econpapers.repec.org/RePEc:cup:jfinqa:v:44:y:2009:i:02:p:467-488_09 |
| Hsu, Taylor, Wang 2016                                            | verified      | https://www.cicfconf.org/sites/default/files/paper_412.pdf                  |
| Coakley, Marzano, Nankervis 2016 (also cited as "Nankervis 2015") | abstract only | https://econpapers.repec.org/RePEc:eee:finana:v:45:y:2016:i:c:p:273-282     |
| Zarrabi, Snaith, Coakley 2017                                     | verified      | https://repository.essex.ac.uk/18805/1/1-s2.0-S1057521916301958-main.pdf    |
| Hutchinson et al. 2022                                            | abstract only | https://zenodo.org/records/7326524                                          |
| Neely and Weller 2003 (intraday)                                  | abstract only | https://ideas.repec.org/a/eee/jimfin/v22y2003i2p223-237.html                |

### Trend, momentum and patterns

| Source                                             | Status                           | Link                                                                                                     |
| -------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Moskowitz, Ooi, Pedersen 2012                      | abstract only                    | https://econpapers.repec.org/RePEc:eee:jfinec:v:104:y:2012:i:2:p:228-250                                 |
| Huang, Li, Wang, Zhou 2020                         | abstract only                    | https://econpapers.repec.org/RePEc:eee:jfinec:v:135:y:2020:i:3:p:774-794                                 |
| Hurst, Ooi, Pedersen 2017 (no numbers on the page) | page verified, paper not checked | https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing |
| Menkhoff, Sarno, Schmeling, Schrimpf 2012          | abstract only                    | https://econpapers.repec.org/RePEc:eee:jfinec:v:106:y:2012:i:3:p:660-684                                 |
| Chong and Ng 2008 (MACD, RSI on FT30)              | abstract only                    | https://econpapers.repec.org/RePEc:taf:apeclt:v:15:y:2008:i:14:p:1111-1114                               |
| Deng et al. 2021 (Ichimoku)                        | abstract only                    | https://ideas.repec.org/a/wly/ijfiec/v26y2021i4p5321-5336.html                                           |
| Chang and Osler 1999 (head and shoulders)          | abstract only                    | https://econpapers.repec.org/RePEc:ecj:econjl:v:109:y:1999:i:458:p:636-61                                |
| Lo, Mamaysky, Wang 2000                            | abstract only                    | https://www.nber.org/papers/w7613                                                                        |
| Marshall, Young, Rose 2006 (candlesticks)          | not checked                      | https://econpapers.repec.org/RePEc:eee:jbfina:v:30:y:2006:i:8:p:2303-2323                                |

### Bands, volume, time

| Source                                            | Status        | Link                                                                                          |
| ------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| TradingView help: Bollinger Bands                 | verified      | https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/                 |
| TradingView help: Keltner Channels                | verified      | https://www.tradingview.com/support/solutions/43000502266-keltner-channels-kc/                |
| TradingView help: Donchian Channels               | verified      | https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/               |
| TradingView help: ATR                             | verified      | https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/             |
| TradingView help: VWAP                            | verified      | https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/ |
| TradingView help: volume profile                  | verified      | https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators/          |
| TradingView help: OBV                             | verified      | https://www.tradingview.com/support/solutions/43000502593-on-balance-volume-obv/              |
| Oxford Strategic Consulting squeeze test (vendor) | verified      | https://oxfordstrat.com/trading-strategies/volatility-squeeze/                                |
| Harvey et al. 2018                                | not checked   | https://scholars.duke.edu/publication/1370354                                                 |
| EarnForex on tick volume                          | verified      | https://www.earnforex.com/guides/tick-volume-in-forex                                         |
| BIS 2025 commentary (country table not checked)   | verified      | https://www.bis.org/publications/202509-commentary-otc-derivatives                            |
| Breedon and Ranaldo                               | abstract only | https://www.snb.ch/en/publications/research/working-papers/2011/working_paper_2011_04         |

### TradingView and popularity

| Source                                            | Status                       | Link                                                                                   |
| ------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| Pine Script repainting docs                       | verified                     | https://www.tradingview.com/pine-script-docs/concepts/repainting/                      |
| Smart Money Concepts (LuxAlgo) page               | verified (counts unlabelled) | https://www.tradingview.com/script/CnB3fSph-Smart-Money-Concepts-LUX/                  |
| Squeeze Momentum (LazyBear) page                  | verified (counts unlabelled) | https://www.tradingview.com/script/nqQ1DT5a-Squeeze-Momentum-Indicator-LazyBear/       |
| SuperTrend (Kivanc Ozbilgic) page                 | verified (counts unlabelled) | https://www.tradingview.com/script/r6dAP7yi-SuperTrend/                                |
| Support and Resistance with Breaks (LuxAlgo) page | verified (counts unlabelled) | https://www.tradingview.com/script/JDFoWQbL/                                           |
| CM Williams Vix Fix page                          | verified (counts unlabelled) | https://www.tradingview.com/script/og7JPrRA/                                           |
| UT Bot Alerts page                                | verified (counts unlabelled) | https://www.tradingview.com/script/n8ss8BID-UT-Bot-Alerts/                             |
| Scripts feed and editors' picks                   | verified                     | https://www.tradingview.com/scripts/editors-picks/                                     |
| pickmytrade blog snapshot, July 2025              | not checked                  | https://blog.pickmytrade.io/top-free-indicators-and-strategies-on-tradingview/         |
| CMC Markets indicator list                        | not checked                  | https://www.cmcmarkets.com/en-au/cfd/learn/tradingview/best-indicators-for-tradingview |
| Trade Nation indicator list                       | not checked                  | https://tradenation.com/articles/tradingview-indicators/                               |
| TastyFX indicator list                            | not checked                  | https://www.tastyfx.com/news/top-10-tradingview-indicators-for-forex-trading/          |
| MQL5 free indicator market                        | not checked                  | https://www.mql5.com/en/market/mt4/indicator/free                                      |

Our own lab: Fib study
`/Users/jvdos/jvd-outputs/2026-11-16/trade-fib-study/REPORT.md`; London v1,
clock, Owl, harmonic and slow-trend files as listed in the johns-own-sources
report and the trade-hub memory notes.

## Not checked

- No re-test of Osler's bounce on post-2005 electronic FX data was found.
  Her results are bounce rates; no pip size or profit exists.
- From search summaries only: Huang et al.'s 47 of 55 figure, Hurst et
  al.'s "net of costs", weak currency trend since 2009.
- Cost treatment in Coakley 2016 and Hutchinson 2022 not seen.
- Like counts: no official all-time list; page numbers are unlabelled.
- No peer-reviewed test found ("not tested", not "failed"): ADX, Supertrend,
  Parabolic SAR, CCI, Williams %R, StochRSI, TDI, RSI divergence, the EMA
  set, Keltner, VWAP, volume profile, ADR fades, session boxes, supply and
  demand zones, order blocks, M and W.
- No 2018 to 2026 peer-reviewed intraday forex test of levels or patterns.
- How many 3-turn zones each pair gets a year is not known yet.
