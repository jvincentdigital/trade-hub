# Slow trend following on six markets: plan

Lab study, play money only. **Plan written 2026-11-17 before any result of
this study was computed.** The 1-minute files it needs were being downloaded
while it was written. Results go at the bottom; the plan above them is not
edited.

## Why

`docs/strategy-search.md`: after everything else failed, slow trend following
is the one idea left with long evidence behind it. John chose to test it
(2026-11-17) knowing the odds are low: the skeptic rated it weak, its record
has been poor since 2009, and we reach about four independent markets, not
the dozens the long record was built on.

It is not the same test as the lab's earlier trend study (channel breakouts
with stops on 4-hour and daily candles, 2021 to 2026, which lost). This is
the rule from the papers: slow, monthly, no stops.

## The rule

Moskowitz, Ooi and Pedersen (Journal of Financial Economics 2012). At the end
of every month, for each market: if its price is higher than 12 months ago,
be long for the next month; if lower, be short. Nothing else. No chart
reading, no stop, no target.

## Markets and data

Six markets: EUR/USD, GBP/USD, USD/JPY, EUR/GBP, gold and the S&P 500 index.
Bitcoin is left out (no long, clean free history here).

Daily closes are built from HistData's free 1-minute files with the repaired
clock of `docs/clock-trades-study.md` (Amendment 1): a day's close is the
close of the last candle stamped before 17:00 New York. A month ends on its
last day with a close. Files that are new for this study (GBP/USD 2005 to
2018, USD/JPY and EUR/GBP 2005 to 2025) get the same clock repair and check
before use.

A market joins when it has 12 months of history: the currency pairs in early
2006, gold in 2010, the index in late 2011. The portfolio is the plain
average of the markets that have joined.

## How a month is counted

For each market and month:

```
result = size * direction * (price change over the month)
         - trading cost - financing
```

- **Size.** Two versions, both reported. Plain: size 1 (the full value of the
  account in each market, no borrowing). Sized by calm: size = 10% divided by
  the market's yearly volatility, measured on the 60 trading days before the
  month end, at most 3. The sized version is the one the papers use and the
  one the reading below applies to.
- **Trading cost.** One round trip (in and out) costs 1.0 basis point for a
  currency pair, 2.0 for gold, 1.5 for the index. A change of direction pays
  one round trip on the size; a change of size pays half a round trip on the
  change.
- **Financing**, every month a position is open, on its size:
  - a currency pair long earns the first currency's interest rate minus the
    second's; short earns the opposite;
  - gold long pays the dollar rate; short earns it;
  - the index long pays the dollar rate and collects an assumed dividend of
    1.8% a year; short earns the rate and pays the dividend;
  - on top, every open position pays a markup of 1% a year, long or short.
- **Interest rates.** Monthly official short-term rates for the dollar, the
  pound, the euro and the yen, from the central banks' own published series.
  If a download cannot be automated, yearly average policy rates are entered
  by hand from those tables and listed in the results. This is settled and
  written down before the test is run.

## What it is compared with

- **Always long**: the same sizes, costs and financing, never short. This is
  what simply holding each market would have made.
- **Luck**: 1,000 runs in which each market keeps its own sequence of long
  and short months but shifted in time by a random 13 to 120 months (wrapped
  around). The positions change as rarely as the real ones; they just have
  nothing to do with the market's last 12 months. Seed 1.

## Reading fixed now

The papers' data ends in 2009, so 2010 to 2025 is the period after them.
The t-statistic is the average monthly result divided by its standard error.
All of this is after costs and financing, for the sized portfolio.

The rule **passes** when all five hold:

1. 2010 to 2025: the average monthly result is above zero with t of 2 or
   more.
2. 2019 to 2025: the total is above zero, and at least 4 of the 7 years are.
3. 2010 to 2025: it ends ahead of always long.
4. 2010 to 2025: it is above the 95th percentile of the luck runs.
5. 2010 to 2025: still above zero with the markup and the trading costs
   doubled.

- **"Worth a play account"**: passes. Before John is told so, a second
  implementation written without seeing ours must agree, and two reviewers
  must fail to break it.
- **"Not there"**: anything else. The results still say which of the five
  failed, and how each market did on its own.

## What a pass would mean

A slow account whose positions change a few times a year. At the papers'
long-run quality for a handful of markets, roughly 3% to 5% a year at a 10%
risk target, with losing stretches of several years. Not a robot that makes
3% to 5% a trade.

## Limits, said in advance

- Sixteen years after the papers is short for a slow rule: about 190 months,
  and four of the six markets are different views of the dollar and the
  pound.
- One free price feed; assumed costs; an assumed dividend; a flat markup.
- Play money only. No broker is connected. This is not financial advice.

## Amendment 1: 2026 (2026-11-17 night, before any run)

John asked whether the prices reach today. They stop at 2025-12-31: the free
source gives finished years as one file and the running year month by month,
and only finished years were fetched.

Before the run, 2026 is added for all six markets up to the last complete
month the source offers, with the same clock repair and check. It is shown as
its own line in the results. The reading stays on 2010 to 2025 and 2019 to
2025 as fixed above, so a partial year cannot tip it either way.

## Amendment 2: the interest rates (2026-11-18, before any run)

The download can be automated, so no rate is entered by hand.

- **The series.** The monthly central bank policy rates collected by the Bank
  for International Settlements from the Federal Reserve, the European
  Central Bank, the Bank of England and the Bank of Japan (data set "Central
  bank policy rates", end of month), 2004-01 to 2026-10. For the dollar it is
  the middle of the Federal Reserve's target range; for the euro the main
  refinancing rate. Downloaded 2026-11-18 and kept, with its address, in
  `~/.local/share/trade-hub/rates/`.
- **The yen's empty months.** The series has no value for Japan in 66 months
  (2004-01 to 2006-02 and 2013-05 to 2016-08), when the Bank of Japan steered
  by the amount of money and had no rate target. Those months use the monthly
  average of the Bank of Japan's overnight call rate (OECD series
  `IRSTCI01JPM156N`), which lay between -0.06% and +0.08% in them.
- **Which month's rate.** A month's financing uses the rates at the end of
  the month before, the ones in force when the position was opened, as one
  twelfth of the yearly rate.
- **A second look, as description only.** From 2015 to 2022 the euro's
  overnight rate stood about half a point under its main refinancing rate. So
  the results also show the sized portfolio with the overnight rates of all
  four currencies (OECD "call money / interbank rate", monthly averages; the
  euro's ends in 2026-01 and is carried forward). The reading uses the policy
  rates above; if the two differ in any of the five lines, that is said.

## Results

Not run yet.
