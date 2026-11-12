# John's Method (JM): the backtest code

Play money research only. No broker. The rules are in the spec, not here:
`~/jvd-outputs/2026-11-12/johns-method/SPEC.md` (section numbers in the code point there).

- Engine (pure, tested): `src/lib/lab/johnsMethod.ts`, tests in `johnsMethod.test.ts`.
- Runner: `scripts/lab/johns-method.ts`.

```bash
npx tsx scripts/lab/johns-method.ts --history ~/jvd-outputs/trading/history-majors \
  --from 2024-11-11 --to 2026-11-10 --out ~/jvd-outputs/2026-11-12/johns-method/design-run [--freeze]
```

Options: `--markets EURUSD,GBPUSD` and `--variant JM-H4H1-X1-C,...` for partial runs (no pick, no freeze).

How it fits together:

- 8 markets with their own costs (`JM_MARKET`): the lab's EUR/USD, GBP/USD and USD/JPY, v1's gold, and stated spreads for AUD/USD, USD/CHF, USD/CAD and NZD/USD. USD/JPY, USD/CHF and USD/CAD are converted to dollars at the stop (sizing) and at the exit fill (results).
- 4-hour and daily candles come from the 1-hour file with `nyCloseBars` (17:00 New York close). The `_4h` and `_1d` files are not read.
- `findSignals` runs the two trackers on one market and structure. Signals do not depend on the account, so they are computed once and shared by the three sizings and both books.
- `simulate` walks one clock of 1-hour opens: decisions at entry-candle closes, then forced closes at the open, then fills at the open (table order), then stop, TP1 and TP2 inside the candle.
- Account book: one $10,000 account, all limits. Signal book: one market at a time, flat $10,000, no limits.
- `rescore` walks a trade again with costs halved or doubled (same fills, levels and sizes).

Guards:

- Design mode refuses any date before 2024-11-11. Warm-up candles from 2023-09-01 are read for indicators only; earlier rows are skipped on their time field.
- Exam mode (`--exam`) refuses to start unless `docs/johns-method-freeze.md` is committed, the tree is clean, nothing but that file changed since the code commit, and SPEC.md and the eight 1-hour files match their hashes.
- The truncation test (600 cuts, everything after each cut scrambled) checks that no decision reads a later candle.
