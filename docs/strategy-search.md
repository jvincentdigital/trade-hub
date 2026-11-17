# Search for a strategy with a real edge (2026-11-17)

Lab research, play money only. Not financial advice.

## Why

Everything tested in this lab so far loses after costs: John's Fib method in
several readings, the London breakout, the scalper, nine indicator rules,
channel trend-following, the three-confirmations idea, John's London v1, and
the Golden Owl both ways (2,160 versions). John asked (2026-11-17) to find a
strategy that can be profitable, from our own work or from a public
repository or any other source, and build a robot on it.

Eight helper agents ran the search: five read the evidence in five areas and
three skeptics re-opened the sources and tried to refute every idea. Their
full record, with every link and exact quote, is in
`~/jvd-outputs/2026-11-17/strategy-search/search-record.md`. Some papers
could not be opened by the helpers; where that matters it is said below.

## The short version

- **Nothing was rated a clear yes.** Of ten ideas with any real evidence, the
  skeptics rated six "weak" (a real effect, but small or uncertain) and four
  "no".
- **No public repository offers a robot with real evidence behind it.** The
  reputable ones are tool boxes and reading lists.
- **Our all-losers result is the normal outcome, not a bug.**
- **Three small effects earned one cheap test each** (plan:
  `docs/clock-trades-study.md`). All three are trades at fixed clock times,
  once or twice a day, with no chart reading at all.

## How hard this is

| Finding                                                                                       | Source                                                                                |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 74% to 89% of retail CFD accounts lose money                                                  | European regulator ESMA, 2018 measures: `esma.europa.eu/cs/node/84933`                |
| Under 1% of day traders reliably earn money after fees (Taiwan, all traders, 1992 to 2006)    | Barber, Lee, Liu, Odean, Journal of Financial Markets 2014                            |
| Of Brazilian futures day traders who kept at it, 97% lost                                     | Chague, De-Losso, Giovannetti, working paper 2019                                     |
| Try enough settings and a great backtest is easy to produce; the number tried must be counted | Bailey, Borwein, Lopez de Prado, Zhu, "Pseudo-mathematics and financial charlatanism" |
| A new finding should clear a t-statistic of about 3, not 2                                    | Harvey, Liu, Zhu, Review of Financial Studies 2016                                    |

## What the public repositories offer

- The well-known ones (awesome-quant, QuantConnect Lean, backtesting.py,
  backtrader) are libraries and link lists. None attaches a tested edge for
  gold or the pound.
- Warning signs the helper actually saw in "profitable bot" repositories: a
  wallet address and a Telegram handle in the README; "passive income" with a
  video link from an account created weeks ago; a gold robot showing a six
  month return badge with no costs and no count of settings tried; a creation
  date older than the thing it trades.
- Licences matter if code is ever reused (backtesting.py is AGPL, backtrader
  GPL). Reading an idea in a paper and writing our own code avoids that.
  Nothing was cloned, installed or run.

## Every idea, and what the skeptic said

| Idea                                                         | Best evidence                                                                                                                                                                       | Skeptic | In short                                                                                                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EUR/USD loses in European hours and gains in US hours        | Breedon and Ranaldo (Journal of Money, Credit and Banking 2013, data 1997 to 2007); a 2019 practitioner re-run; Krohn, Mueller, Whelan (Journal of Finance 2024) point the same way | weak    | Not drift, no overnight financing. On paper about 1.5 to 2 basis points a day after costs; nothing covers 2019 on. **Test 1.**                                                             |
| Gold rises overnight and falls in the New York day session   | Blose and Gondhalekar (Applied Economics Letters 2014; Journal of Economics and Finance 2018)                                                                                       | weak    | Real, but the authors say it "has weakened substantially". About 0 to 1 basis point a day after costs. **Test 2.**                                                                         |
| The stock index's last half-hour follows the rest of the day | Gao, Han, Li, Zhou (Journal of Financial Economics 2018); Baltussen, Da, Lammers, Martens (JFE 2021, 60 futures, 1974 to 2020)                                                      | weak    | Best academic backing of the three. Small (about 2% of the variation explained); one informal re-run on 2015 to 2020 lost. **Test 3.**                                                     |
| 12-month trend following across many markets                 | Moskowitz, Ooi, Pedersen (JFE 2012); AQR's study back to 1880                                                                                                                       | weak    | The long record needs dozens of markets; we reach about four independent ones. Weak since 2009, and Huang and co-authors (JFE 2020) find it close to simply holding what went up. Not now. |
| Currency carry                                               | Daniel, Hodrick, Lu (2017, number not verified)                                                                                                                                     | weak    | Needs about ten currencies, crashes hard, and a small account pays a markup on the interest. Not now.                                                                                      |
| Holding the index around the turn of the month               | McConnell and Xu (2008)                                                                                                                                                             | weak    | Mostly old evidence, partly drift, and CFD financing eats most of it. Later, on daily data, if ever.                                                                                       |
| "Noise area" opening momentum on the S&P 500                 | Zarattini, Aziz, Barbon (2024 paper)                                                                                                                                                | weak    | Big claims with leverage, on the authors' own sample, no independent test. Only if Test 3 passes.                                                                                          |
| Gold with a long moving-average filter                       | A 4,000-rule study (1990 to 2015)                                                                                                                                                   | no      | Mostly gold's own rise, and 4,000 rules were tried.                                                                                                                                        |
| Buying gold in September and November                        | Baur (2013)                                                                                                                                                                         | no      | Reversed after publication (Potrykus and Augustynowicz 2024).                                                                                                                              |
| Buying stocks the day before the Fed                         | Lucca and Moench (New York Fed)                                                                                                                                                     | no      | Essentially gone after 2015 (Kurov, Wolfe, Gilbert 2021).                                                                                                                                  |

Also looked at and dropped: the overnight drift in index futures (flat in
2021 to 2025 per a New York Fed post), trading the London gold fix, currency
moves around the 4 PM fix (negative after spreads, Bank of Canada 2021),
moving-average rules on single currencies (gone since the 1990s: Neely,
Weller, Ulrich 2009), and fast trend rules (collapsed after 2009, in line
with our own failed channel test).

## What a pass would and would not mean

These are small effects: one to two basis points a day is roughly 2.5% to 5%
a year on the money actually exposed. A pass would earn one play-money
account and a second, independent check of the numbers. It would not be a
robot that makes 3% to 5% a trade; nothing in the evidence supports one.
