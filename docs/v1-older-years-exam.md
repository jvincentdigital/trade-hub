# John's London v1: one exam on older years it has never seen

Started 2026-11-17. Play money and backtests only. No broker, no live race
state, nothing merged or deployed. Branch `lab/v1-older-years` (on top of
`lab/v1-hold`).

Why: v1 has only ever been scored on 2024-11-11 to 2026-11-10. On 2026-11-16
John was told "no fresh history is left, only live trades can prove anything".
That was wrong: another provider lists free 1-minute history for GBP/USD from
2000 and for gold from 2009. A frozen rule cannot have been tuned on years it
was never run on, so those years are a clean test. John, 2026-11-17, in a
poll: "Older-years exam of v1: plan written first, about 12 free price files
downloaded by hand, one run."

## Plan, written before any older price file is downloaded (pre-registration)

This section is committed and pushed before the first download. Later
sections are added below it and this one is not edited.

### The rule

John's London v1 exactly as frozen (`docs/london-v1-freeze.md`): k = 2,
b = 0.5, 15-minute candles, GBP/USD and gold in one $10,000 account, the
frozen costs. It runs through `runLondon` with no options, the code path that
reproduced the frozen numbers and the design-year trade list fingerprint on
2026-11-17 (`docs/v1-hold-study.md`). No setting is chosen, changed or
compared on the exam years.

### The exam years

2019-01-01 to 2024-11-10 (the day before v1's test year starts), in one run:
about 5.9 years. The account starts cold on the first trading day of 2019, as
the design year did.

### The price files

HistData.com, "Generic ASCII" 1-minute bars for GBPUSD and XAUUSD, one file a
year for 2019 to 2025 (14 files), each downloaded through the site's own
download link, a few at a time. Their FAQ says the bars are built from bid
prices and stamped in Eastern Standard Time with no daylight saving, so UTC is
the stamp plus 5 hours. The data comes with no warranty. The paid FTP route is
not used.

The files are converted to the frozen files' shape (`time,open,high,low,close`
in UTC seconds, gzip) and kept outside `~/jvd-outputs`, in
`~/.local/share/trade-hub/histdata-1m/`, with the SHA-256 of every downloaded
and converted file written into this document before any strategy run.

This is a different feed from the frozen Dukascopy files, so two checks come
before the exam, both on the already seen year 2024-11-11 to 2025-11-10 only.

### Check 1: the two feeds line up (no strategy involved)

On the seen year, for each market, the 1-minute closes of the two feeds are
compared minute by minute:

- the median gap must be under 1 pip for GBP/USD (0.0001) and under $0.50 for
  gold;
- the plus 5 hours conversion must fit better than plus 4 or plus 6 hours.

For the exam years this check only counts candles per month and lists gaps.
It does not run any rule on them.

### Check 2: the splice (the gate)

Frozen v1 runs on the seen year 2024-11-11 to 2025-11-10 with the HistData
candles and the frozen news list. The exam runs only if all three hold:

1. between 78 and 116 trades (the frozen run had 97);
2. a total between +17.6R and +37.6R (the frozen run made +27.6R);
3. at least 60% of the frozen run's trades have a twin: same market, same
   side, entry within 30 minutes.

If the gate fails, the exam is not run and the finding is that v1's result
depends on the price feed. That matters on its own, because the live account
uses a third feed.

### Red news on the exam years

The frozen rule blocks entries and closes trades around red news, and the
frozen news list starts in November 2024. For 2019-01-01 to 2024-11-10 a list
of the same nine kinds of release is built from the same official sources,
scheduled releases only, with their real dates and UTC times: US jobs report,
US CPI, US advance retail sales, FOMC statement, FOMC press conference, FOMC
minutes, US advance GDP, UK CPI, Bank of England rate decision. ISM is added
by the existing rule (`ismEvents`). The list is built by a helper that sees no
prices and no results, spot-checked against the official pages, and its
SHA-256 is written here before the exam.

On the two seen years the news rule moved the frozen totals by 2 to 3R a year
in no fixed direction (measured 2026-11-17: without any news list, +24.4R and
+24.1R against +27.6R and +24.1R). So one more run is declared: the exam
years with no news list at all. It is reported next to the main run and has
no verdict. If the two disagree on pass or fail, the report says the result
depends on the news rule.

### The verdict (decided now)

v1's own six lines, unchanged, on the whole exam period as one run:

1. at least 80 trades
2. ends above $10,000 and averages at least +0.10R
3. profit factor at least 1.20
4. max drawdown at most 25%
5. total R above the 95th percentile of 1,000 coin-flip runs
6. mirror z at least 1.0

All six: **pass**. Otherwise **fail**, with "made money, not proven" when it
ends above $10,000.

How much this exam can tell: v1 took about 100 trades a year, so about 570
are expected. With a spread of about 1.15R per trade the average is known to
about plus or minus 0.05R (one standard error). A rule with no edge would
clear the +0.10R line about 1 time in 50. A rule with half of v1's test-year
edge (+0.14R) would clear it about 4 times in 5, and one with the full edge
almost always. The 25% drop line is the one a real edge can still fail over
six years; a fail on that line alone will be reported as exactly that.

Also reported, as description: each calendar year's trades and total, each
market, how trades ended, and the cost-doubled rescore.

### One more declared run, no verdict

The same exam years with the hold rule and overnight costs
(`runLondon(..., { hold: 'costs' })`), because that is what the live account
does. It is reported next to the main run. The verdict belongs to the frozen
rule only.

### What each result will mean

- **Pass:** v1 is no longer "one good year". It has held on about six years
  it never saw. The live account stays a plumbing check in play money, and
  nothing about real money follows from this without a separate talk with
  John.
- **Fail:** the test year was most likely luck or a passing market mood. The
  recommendation to John will be to stop treating the live v1 account as a
  proof in progress. No rule is tuned on the exam years afterwards.

Either way the exam years are used up for v1 and its close relatives.

### One run

The exam is run once. The runner writes a marker next to the data
(`~/.local/share/trade-hub/histdata-1m/EXAM-DONE.json`) and refuses to run
when it exists. Checks 1 and 2 may be repeated; they touch only the seen year.

## Amendment 1, 2026-11-17, before any rule was run on the new files

Written after the download, the conversion and Check 1, and before Check 2
and the exam. Nothing here comes from a trade or a result: it comes from time
stamps, from the minute-by-minute comparison with the frozen files on the
already seen year, and from official calendars.

### The files' clock is not what the provider says

The plan said "UTC is the stamp plus 5 hours", from the provider's FAQ
("Eastern Standard Time ... WITHOUT Day Light Savings"). Check 1 showed that
is wrong for half the year. With plus 5 hours the closes matched the frozen
files to 0.00 pips in the winter months, and were 6 pips apart in the summer
months, where plus 4 hours matched to 0.00.

Day by day on the seen year, the fit changes on 2025-03-31 and 2025-10-27:
the days after European clocks change, not the US dates (2025-03-09 and
2025-11-02). So the files' clock runs 7 hours behind European broker time:

- **UTC = stamp + 4 hours in European summer time** (last Sunday of March
  01:00 UTC to last Sunday of October 01:00 UTC), **stamp + 5 hours otherwise.**

With that rule, on the seen year:

| Market  | Minutes in the frozen file | Also in HistData | Closes identical | Median gap |
| ------- | -------------------------- | ---------------- | ---------------- | ---------- |
| GBP/USD | 371,215                    | 371,150          | 100.0%           | 0.00 pips  |
| Gold    | 354,470                    | 354,345          | 100.0%           | $0.00      |

A shift of one hour either way is 6 pips (or $3 to $4) off, and a shift of
one minute is 0.8 pips off. So Check 1 passes, and more than that: where they
overlap, the two feeds are the same prices. In every year from 2019 to 2025
the first candle after a weekend falls at 21:00 UTC in New York summer time
and 22:00 UTC in winter (gold one hour later), which is the market's real
opening hour, so the rule holds for the exam years too. 420 duplicate stamps
per market (60 on each last Sunday of October) carry identical prices and are
dropped.

### Thin days in 2023 sit out

From February to July 2023 the files are missing about half of the minutes
after 10:00 UTC on many days. Counted per weekday as the share of the London
window (07:00 to 16:30 London, 570 minutes) that is present:

| Year | GBP/USD weekdays under 90% | Gold weekdays under 90% |
| ---- | -------------------------- | ----------------------- |
| 2019 | 3                          | 4                       |
| 2020 | 3                          | 5                       |
| 2021 | 2                          | 4                       |
| 2022 | 1                          | 2                       |
| 2023 | 116                        | 118                     |
| 2024 | 2                          | 3                       |
| 2025 | 2                          | 3                       |

Outside 2023 these are holidays. In 2023 nearly all of them are under 75%, so
the line between a normal and a thin day is clear. A rule run on a day with
half its minutes missing would close trades at the next candle it finds,
hours later, so:

- **A market sits out any weekday on which fewer than 90% of the 570 London
  minutes are present in its file.** That day's candles are removed for that
  market before the run, in Check 2 and in the exam alike.

About 45% of 2023 is lost that way, so the exam expects about 525 trades, not 570. Each year's result is reported separately, 2023 with its count of days
sat out. The declared hold run can carry a trade across a day that sits out;
its 2023 numbers are weaker for that and will be marked.

### The red news list

Built by a helper that saw no prices and no results: 491 scheduled releases
from 2019-01-04 to 2024-11-07 (71 US jobs reports, 70 US CPI, 70 US retail
sales, 46 FOMC statements, 46 press conferences, 47 minutes, 24 advance GDP,
70 UK CPI, 47 Bank of England decisions), each with an official source page.
Emergency actions of March 2020 are left out: nobody could have known them 30
minutes ahead.

Checked by me before use:

- Every row's local release time is the expected one for its kind after the
  US and UK clock changes (US 08:30, 14:00 and 14:30 New York; UK CPI 09:30
  London until March 2020 and 07:00 from 2020-04-22; Bank of England noon).
- All 46 FOMC meeting dates and all 47 Bank of England dates match the
  official calendars, with none extra. A sample of 13 jobs report dates match.
- Two Bank of England times were corrected from the Bank's own notices: the
  decisions of 2020-08-06 and 2020-11-05 came out at 07:00 London, not noon.
- Left as they are and marked uncertain in the helper's notes: the time of
  the 2020-05-07 decision (noon in the list), eleven 2019 UK CPI times
  inferred from neighbouring months, and which month each of the four delayed
  2019 retail sales releases belongs to (the dates themselves are official).

### The files, fixed before Check 2

Stored in `~/.local/share/trade-hub/histdata-1m/`.

| File                                       | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `GBPUSD/GBPUSD_1m.csv.gz` (2,553,590 rows) | `fdd7ff9806ef0aca5991479a3ea648a2d10f66d492b9799f6d7682899deed577` |
| `XAUUSD/XAUUSD_1m.csv.gz` (2,433,168 rows) | `918b9c8113a1812acc1861cb043df8b62840950c74df5a4f8457a76f09bcbcf3` |
| `news-2019-2024/news-high-impact.csv`      | `162bba6066ebd9eff740fd2348cd7971499ff2853ff90cf5e4a38412fd421897` |

The 14 downloaded zips (`raw/<MARKET>_<year>/`):

| Zip         | SHA-256                                                            |
| ----------- | ------------------------------------------------------------------ |
| GBPUSD 2019 | `bc6d390e539d267fcd7856851db463fc098de5d7f7d732ddca75604f4a259bf2` |
| GBPUSD 2020 | `07ad9524551d1b5bc617cd6971e5a6f38156f92e7046fa368abd22cbe7d9a044` |
| GBPUSD 2021 | `5ce226e9e1cabcb8d3cab7d5c64135da2c864b0d79a559c8a08c6e1e3d47866e` |
| GBPUSD 2022 | `6c3134133d24effe9ebae1ee02c7b0db3bff8f60f92bd9add846abc54d00a86e` |
| GBPUSD 2023 | `4e7031d841a953ae76d1ba056780838bddd08e0d5eac62dd21c64b28b7b1a68b` |
| GBPUSD 2024 | `030b05b4c670c7e152bf4aa4112488c96695d2dcc2b31ca13a3b4834b8431077` |
| GBPUSD 2025 | `7b69c334eadd10568168634cff3ca37b06e5fb9057db4da9b590e2ef2034854e` |
| XAUUSD 2019 | `0ba9fcfbe1a0b640329de9f2b3682d67449d708a92b144f19e51e74480201d79` |
| XAUUSD 2020 | `4942ba4cc97b85b8fa3ec62a6a35925632722910eeb5478b1a87d728d62a3d11` |
| XAUUSD 2021 | `312229c9db5b39138c41b1e488d00ed32e158a0d1fc3f23a225b223c3271c0a4` |
| XAUUSD 2022 | `e752b9d83a14b934099de372c1419ab476278e7cd949c313c3af06207960b1d8` |
| XAUUSD 2023 | `89a4f3f7ec2a52b29fbce8d4ca2ab650971817ae371b332f5fe471a488bcffc2` |
| XAUUSD 2024 | `6d47f5cb269e0c4f35c63c7532713aae7dcf98901f605458b00dd6a69e7105de` |
| XAUUSD 2025 | `dd0b4dc6983c07fafd89ba83b0c7f514aa16977654eaeb4c9fc8884ed359d98e` |

The download, conversion and check scripts are kept next to the results in
`~/jvd-outputs/2026-11-17/v1-older-years/tools/`.

### What stays exactly as planned

The rule, the exam years, Check 2's three lines, the six-line verdict, the two
declared runs without a verdict, what each result means, and one run.
