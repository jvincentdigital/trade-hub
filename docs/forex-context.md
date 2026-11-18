# Forex context for the lab

Date: 2026-11-18. Lab research, play money, not financial advice.

The background a forex trader carries in their head, written down so the lab
keeps it in view. Every market fact below comes from the 2026-11-18
indicator research reports (`docs/indicator-research.md` lists them) or from
John's own notes. A number without a source is left out or marked "typical,
not verified".

## The trading day and its sessions

- **Asia** (Tokyo) is the quiet part of the day (typical, not verified).
  **London** opens next, then **New York**. The busiest hours are the
  London open and the London to New York overlap. BIS 2013 (not checked,
  fetch summary): "Liquidity in currency markets is typically highest at
  the London open and in the overlapping hours of London and New York."
  https://www.bis.org/publ/qtrpdf/r_qt1312e.htm
- Where the money trades: about $9.6 trillion a day in April 2025, UK about
  38%, US about 19% (BIS 2025, verified on the page, country table not
  checked). https://www.bis.org/publications/202509-commentary-otc-derivatives
- Ito and Hashimoto (not checked, search summary): activity is concentrated
  in the Tokyo to London and London to New York overlaps, with no rise toward
  the New York close. https://www.nber.org/papers/w12413
- **The day boundary is 17:00 New York.** Open positions roll to the next
  value date there and pay or earn swap. The lab uses it as the daily candle
  edge so every pair lines up.
- Puerto Rico clock (a reader's arithmetic, not a source): Puerto Rico stays
  on UTC-4 all year. London opens at 07:00 UTC in summer and 08:00 UTC in
  winter, which is 3 AM or 4 AM in Puerto Rico. The overlap shifts one hour
  twice a year, so the lab uses clock-repaired files.
- **What is well supported is the volatility clock, not direction.** Moves
  follow a daily activity cycle, which with scheduled news explains most of
  the variability (Andersen and Bollerslev 1998, abstract only; hourly
  numbers not read). That tells you when and how big, not which way. The
  one time-of-day direction effect (a currency weakens in its own hours,
  Breedon and Ranaldo) faded to about +0.3 bp a day in our lab's 2019 to
  2025 check.
- John's course times (New York time): key 15-minute candles 3:30 to 3:45 AM
  (London) and 9:30 to 9:45 AM (New York); dead zone 5 to 8 PM; trade 2 to 4
  hours at most; best days Tuesday to Thursday.

## John's seven markets

The reports say little about what drives each pair. This section keeps only
what they do say. Daily ranges are CMC Markets' 2025 averages (not checked,
fetch summary; other broker blogs disagree a lot, some use ATR, some plain
high minus low). https://www.cmcmarkets.com/en-gb/forex/swing-trading-forex
Spreads are listed broker minimums from search results (not checked).

- **EUR/USD.** Daily range about 75 pips (CMC). One of the two tightest
  spreads: about 0.6 (IG listed minimum) to 0.9 pips (OANDA; OANDA's
  market average 0.6, via BrokerChooser). Moves with GBP/USD because both
  share the dollar. The
  dollar is on one side of 89.2% of all trades, the euro 28.9% (BIS 2025,
  not checked, fetch summary). https://www.bis.org/statistics/rpfx25_fx.htm
- **GBP/USD.** Daily range about 90 pips (CMC; other blogs 100 to 130).
  Spread about 1.6 pips at OANDA (market average 1.2, via BrokerChooser);
  the lab's own note says 0.3 at Kraken (`docs/london-open.md:78`). John's
  own rule: GBP/USD moves like gold against the dollar. Sterling is in 10.2%
  of trades (BIS 2025, not checked).
- **EUR/GBP.** Daily range about 41 pips (CMC), the smallest of his pairs.
  Spread about 0.9 to 1 pip (IG, tastyfx minimums). Both currencies tend to
  move together against the dollar, so the cross often drifts (a reader's
  reading, not a tested finding). Moves against GBP/USD and with EUR/USD
  (blog figures below).
- **USD/JPY.** Daily range about 133 pips (CMC; other blogs 55 to 120).
  One of the two tightest spreads. tastyfx says it "often exhibits the
  largest pip movements" (not checked). In Osler's 1996 to 1998 data the yen
  had the strongest bounce at levels (+5.6 points over random), named in
  advance, so it is a fair first pair for the levels test. The yen is in
  16.8% of trades (BIS 2025, not checked). Holding a long in a low-rate yen
  pair is paid swap, a short costs it.
- **EUR/JPY.** Daily range: no CMC figure; one blog says 100 to 140 (typical,
  not verified). Spread about 1.2 to 1.5 pips (tastyfx, IG minimums).
- **GBP/JPY.** Daily range about 160 pips (CMC; blogs 100 to 220). The
  widest spread of his pairs, about 2.5 pips (IG, tastyfx minimums). It is
  mostly GBP/USD plus USD/JPY; one blog says about 90% correlated with
  GBP/USD. John's course prefers GBP crosses for the post-news reversal.
- **Gold (XAU/USD).** No trusted daily range found; compute it from our own
  candles. Spread about $0.38 at OANDA (average $0.32, via BrokerChooser, not
  checked). Gold rose a lot after 2019, which makes any floor-buying rule
  look good unless trades are mirrored. Vendor claims that the overlap gives
  60 to 70% of gold's daily range have no data behind them. Our Owl study:
  after a step of $1 to $10, the next $1 goes back only 47 to 52% of the
  time (47 to 49% on the $1 step), where the candles can see it: a coin
  flip.

## Which pairs move together, and what it means

From education blogs, 2016 to 2021 (not checked, low quality; the numbers
change with the window):

- EUR/USD and GBP/USD share the dollar and tend to move together.
- GBP/JPY is a blend of GBP/USD and USD/JPY.
- EUR/GBP moves against GBP/USD (one source: -0.89) and with EUR/USD
  (+0.64).
- USD/JPY tends to move against EUR/USD, but one table shows -0.42 over six
  months and +0.44 over one month.

What it means: long EUR/USD plus long GBP/USD is close to one dollar bet,
not two. GBP/USD, GBP/JPY, EUR/GBP and gold are, by John's own race rule,
one pound and dollar bet (never opposite, at most two the same way). Using
one pair to confirm another that shares a currency is partly the same data
twice. The seven markets are about four independent bets, so results pooled
across the GBP pairs count for less than they look. The lab should compute
its own rolling 30-day correlations instead of trusting the blog numbers.

## Pips, spread, swap

- **Pip:** the fourth decimal on most pairs (0.0001), the second on yen
  pairs (0.01) (typical, not verified). A round number "00" on EUR/USD is
  every 100 pips.
- **Spread:** the gap between the buy and sell price, paid on every trade.
  Spreads widen at the 17:00 New York rollover and around news. Our
  HistData files are bid prices, so a buy needs the spread added.
- **Swap:** at 17:00 New York every open position is rolled and pays or
  earns the interest gap between the two currencies (Pepperstone, not
  checked, page blocked). On most forex pairs the Wednesday roll carries
  three days to cover the weekend; gold varies by broker. Saxo adds a
  mark-up of 0.45 to 0.60% a year to swap points (not checked, fetch
  summary). Check the broker's own long and short swap before a swing trade.
- **Why holding longer makes the spread matter less:** a 2.5 pip spread is a
  quarter of a 10 pip target, but a small part of a 100 pip move. Holding
  for hours or days does not create an edge; it only shrinks the cost's
  share. Swap then becomes the cost to watch.

## Trading styles and what each asks of an edge

- **Scalp (a few pips, minutes).** The spread is a big share of the target,
  so the edge per trade must be large. Intraday rules found by computer
  search earned gross returns that "realistic transaction costs and trading
  hours" wiped out (Neely and Weller 2003, abstract only). Lien's "figure"
  trade (education, not a test): buy a few pips below a round number, stop
  no more than 20 pips away.
- **Day trade (hours, inside the London to New York window).** John's
  course: stop about 8 to 12 pips on a second-leg entry, 20 to 25 on a first
  leg, targets 30 to 50 pips, close if not working in two hours. Osler's
  level lean lives here: minutes to hours.
- **Swing (days to two weeks).** CMC: weekly chart for trend, daily as the
  anchor, 4-hour for entry, 20 to 100 pips per trade, 2 to 10 trades a week.
  IG Academy: stop 1 to 2 ATR, skip if reward is under twice the risk. No
  source gave a tested win rate for any of these playbooks. Swap and Monday
  gaps are the extra costs.
- **Slow trend (weeks to months).** The one idea with strong outside
  evidence, but only across many markets at once.
- Reward to risk: with a 20 pip stop and a 40 pip target, a trade must win
  more than one time in three before costs.

## Average daily range as a ruler

- ADR is the average of each day's high minus low over 14 to 20 days. ATR is
  the same idea but counts gaps from the prior close.
- Use it to size targets and stops for "a normal day" on each pair. Example:
  a quarter of a 75 pip EUR/USD day is about 19 pips.
- Volatility clusters: a wide recent range makes a wide range tomorrow more
  likely. ADR says nothing about direction.
- Fading or following a move that has used most of its ADR has no paper
  behind it; blog figures for it are unsourced. John's course says "about
  200 pips a day and 600 a week at most"; that is the course's figure, not a
  measurement.

## Round numbers and where orders sit

- Osler 2003 (abstract only; working paper verified): at one dealing bank,
  take-profit orders cluster AT round numbers (00 first, then 50), stop-loss
  buys just above them, stop-loss sells just below (for example 1.6605).
- So price tends to stall at a round number and run fast just past it.
  Osler 2002 (verified): fast moves at stop clusters, for hours, not days.
- Osler 2000 (verified): over 70% of the levels firms published ended in 0
  and 96% in 0 or 5.
- For the lab: non-yen pairs use x.xx00 and x.xx50; yen pairs xxx.00 and
  xxx.50; gold needs a step that keeps the same size in percent over the
  years, because $10 means very different things at $1,000 and at $2,500.

## News

- Scheduled macro news is one of the main drivers of intraday volatility in
  Andersen and Bollerslev's mark-dollar data (abstract only).
- Spreads widen around news, and a news gap can jump through a stop; the
  lab fills a gapped stop at the first price after the gap.
- John's course: "don't trade the news itself"; it describes a fake move on
  UK news at 4:30 AM New York, then a reversal at the New York open (not
  tested).
- The Owl's sheets say avoid USD news; the lab keeps that as a risk rule.
- The lab has a red-news list for 2019 to 2024 (491 official releases, from
  the v1 older-years exam) and a calendar from November 2024. Nothing
  earlier than 2019. News filters cannot be tested before that.

## What "floor" and "ceiling" mean on each chart

A floor or ceiling is a band where price keeps turning back. It is built
from swing lows or highs, and a swing is known only after the bars to its
right have closed.

- **Daily.** Swings with 3 days on each side; nearby swings clustered within
  half a daily ATR; zone about half a daily ATR wide. A turn is price
  leaving the zone by 1 ATR within 3 closes. Few events: maybe a handful of
  trades a pair a year.
- **4-hour.** Swings with 5 bars on each side (about 20 hours); zone about
  0.4 ATR(4h) wide; a turn within 6 bars. Bars start at 00, 04, 08, 12, 16
  and 20 UTC. Many more events, so this is the main test.
- **15-minute.** Not where the level comes from: it is the confirmation
  chart. A 15-minute bar pokes into the bigger zone and closes back out.
  This is the same time scale as Osler's 15-minute bounce.
- A zone is broken by a close beyond its far edge; a dead zone never comes
  back. Use wicks for touches and closes for breaks.

## John's own method, in short

- Top-down: daily, then 4-hour over days to weeks, then a 1-hour Fib for
  prices. Fib "1" at the open of the first big candle of the move, "0" at
  its end; enter the 0.786 to 0.886 area in two halves; stop past 1; half
  off at 0, the rest at -0.272. Adds after two strong candles and lets it
  ride. Stop is set from 15 minutes or bigger, never from 5.
- Hours: London open (3 to 4 AM Puerto Rico) through the New York morning,
  until about 11 AM to noon.
- Course pieces: M and W at the day high or low, entered on the second leg;
  the Asia range and a stop-hunt zone 25 to 50 pips beyond it; three-push
  levels on 1-hour with a 15-minute entry; the EMA set 5, 13, 50, 200, 800;
  TDI; ADR; pivots; session times; candle patterns, counted only after a
  close.
- Harmonic patterns (Butterfly and family) are the method he half
  remembered; their levels are his Fib levels.
- Risk: 2% a trade; goal 3 to 5% gained per winner (about 1.5R to 2.5R).
  Confident = full size; not confident = thirds into the zone.
- His new idea (2026-11-17): find the floor and ceiling on bigger charts,
  wait for a confirmation, take a quick few pips or hold for hours or days,
  and trade only the pair where the strategy works best.

## What data the lab has

- Free HistData 1-minute bid files for all seven markets: forex 2005 to
  2025, gold 2009 to 2025, converted and clock-checked on
  2026-11-18, in
  `~/.local/share/trade-hub/histdata-1m-clock/`.
- Bid only: buys enter at the ask, so add the typical spread for the
  after-cost line.
- Known hole: in 2023 HistData misses minutes after 10:00 UTC from February
  to July. Skip weekdays with under 90% of London minutes.
- 2019 to 2025 has been looked at for other rules (v1 exam, clock trades),
  so it is fresh for a new rule, not fresh for the lab.
- News: a red-news list for 2019 to 2024 and a calendar from November 2024;
  nothing earlier. No real volume for spot forex.

## How the lab uses this

1. Report effect first: how often price turned, how many pips for and
   against, per pair, then one line on costs.
2. Every level result is compared with random bands of the same width and
   distance at the same moment. "Turned 60% of the time" means nothing on
   its own.
3. Count pairs that share a currency as one bet; mirror trades to remove
   gold's rise.
4. Pick the pair, exit or confirmation on 2005 to 2018 only, then check once
   on 2019 to 2025.
5. Use the session clock, ATR and ADR as rulers for when and how big, never
   as the reason for the direction.
6. Day edge 17:00 New York; levels used only after their confirming bars
   closed.
