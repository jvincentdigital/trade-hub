# Trade checklist (info only)

Added 2026-11-12. John chose it in the morning poll: a confidence checklist on
each race trade that **never blocks or changes a trade**. It only records, at
the moment a trade opens, three leads from the indicator test
(`~/jvd-outputs/2026-11-12/johns-method/INDICATOR-TEST.md`). No filter in that
test was proven; these three pointed the right way in both test years, nothing
more. Every place that shows the list also says: "Leads from our tests, not
proven. They never block a trade."

## The three checks

| Check        | Yes when                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Red news     | No red ("High") news for the market's currencies within 30 minutes of the entry, either side. Forex: both currencies; gold, crypto, US30: USD. A BoJ decision blocks its whole windows, as in the race's news filter.      |
| Calm market  | The 1-hour ATR(14) now is below the 1-hour ATR(14) of the last candle closed when the setup's move started (John's London v1 and the lab's Fib bots: the Fib 1 candle). Strategies with no move: below its 20-day average. |
| Round number | A round level within 0.1 x the daily ATR(14) of the entry or of the stop. Levels: every 50 pips on forex (0.50 on yen pairs), every $10 on gold. Crypto and US30 have no levels, so the line says so.                      |

Each check is a tick (yes) or a dash (no, or could not be checked), with one
short line saying which. "Could not be checked" happens when the news list was
missing at entry, or the market has too few 1-hour candles (the ECB-only pairs
USD/JPY and NZD/USD have daily rates only).

Daily ATR comes from the same 1-hour candles, grouped into days that close at
17:00 New York; the day still running is left out.

## Where it lives

- `src/lib/race/checklist.ts`: the checks (`tradeChecks`) and `withChecks`,
  which adds them to the trades opened this check. Pure, tested in
  `checklist.test.ts`, including that a trade opens exactly as before.
- `scripts/race-tick.ts` and `scripts/claude-picks.ts`: after a strategy or a
  funded account steps, the trades it opened get their checks, from the
  candles and the Forex Factory list the tick already loaded (no new fetches).
  A check that throws leaves that trade without one.
- Stored on the trade as `checks` (`{ news, calm, round }`, each
  `{ ok: true | false | null, text }`) in race.json. Trades from before
  2026-11-12 have none and show "Checklist: not checked (opened before it was
  added)."
- Shown in the details of a trade row on Today (`Checklist at entry`) and under
  each live trade on `/compare` (funded test and every strategy), via
  `src/components/home/Checklist.tsx`.

The calm check reads the 1-hour ATR as asked, which is close to the test's
4-hour ATR ratio but not the same rule. The test also checked the round number
against the 0.786 to 0.886 zone; live it uses the entry price.
