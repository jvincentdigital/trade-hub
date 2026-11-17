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
