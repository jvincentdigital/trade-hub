# Market Maker / Marvel FX Method: notes and testable rules

Our own summary of John's course material. **Not course text**: everything is
paraphrased, with a source after each point. First written 2026-11-10 from the
PDF, extended the same day from the first 8 video transcripts.

Sources so far:

- **PDF**: `Market-Maker-Method-SquirrelFX.pdf`, module 1 (27 pages, Spanish), cited as `p.N`.
- **Videos** (Spanish, transcripts in `~/jvd-outputs/trading/transcripts/`, `[mm:ss]` lines). Used so far, all from the "Lo demas" folder:
  - `Niveles MFXM` (levels and the three-push cycle)
  - `PEAK FORMATIONS 1` (when a peak formation is valid, and when it is not)
  - `Marcar Entradas Y Niveles` (marking levels and entries on past charts)
  - `Exponential Moving Average` (EMA 12/36/200/633 swing technique)
  - `Price Action Parte 1` and `Price Action 2` (support, resistance, trend lines, channels)
  - `Mejores Entradas despues de noticias` (the UK news reversal)
  - `sin titulo` (a daily webinar reviewing the day's trades)
- **Still to come**: 13 more videos (the "practica" sessions and others) were still being transcribed when this was written. Re-run `make extract-strategies` when they finish.

A word on tone: the videos often call setups "guaranteed" (garantizada) or "100%".
We treat every such claim as something to test, not a fact (`PEAK FORMATIONS 1 @ 04:44`, `sin titulo @ 18:12`).

## The idea in one paragraph

Large dealers ("market makers") need retail traders on the wrong side. They
set a range, push price past it to trigger stops (the stop hunt), then move
the real way slowly. The trader's job is to recognize the trap, wait for it
to finish, and trade with the market maker instead of against it (p.2, p.7, p.25).
A calm, steady move is the real trend; a sudden violent move is the trap (`sin titulo @ 30:42`).

## Levels (niveles): how they are drawn

- Price moves in cycles of three pushes (impulsos). Each push is followed by a pause, and a push plus its pause is one level: level 1, level 2, level 3 (`Niveles MFXM @ 00:18`, `@ 15:37`).
- Up cycle: W, then V, V (pullbacks), then M. Down cycle: M, then A, A, then W (`Niveles MFXM @ 03:00`; `PEAK FORMATIONS 1 @ 07:56`; p.16, p.25).
- After the third push, expect a longer pullback, a failed try at a fourth push, then a new cycle the other way. Do not buy (or sell) the fourth push (`Niveles MFXM @ 01:00`, `@ 10:29`).
- In a trend the pattern stays the same, but the counter-moves are smaller than the moves with the trend (`Niveles MFXM @ 04:16`, `@ 05:01`).
- Draw levels mostly on the 1h chart; time the entry on 15m (`Niveles MFXM @ 02:55`, `@ 08:51`).
- Telling the levels apart (`Marcar Entradas Y Niveles @ 01:13`):
  - Level 1: a small, short pause.
  - Level 2: a bigger pause without many wicks.
  - Level 3: a long consolidation that tests the same low (or high) many times; one example sat there about a day and a half (`PEAK FORMATIONS 1 @ 13:43`).
- Level 3 pays the most, because the biggest moves start there (`Marcar Entradas Y Niveles @ 02:02`).
- The EMAs help to tell the level: just starting to cross at level 1, crossing at level 2, far apart at level 3 (`Marcar Entradas Y Niveles @ 17:15`).
- Before level 1 there is often a range whose high and low both get swept, catching breakout traders on both sides (`Niveles MFXM @ 15:07`).
- A real stop-hunt pullback is at least about 20-25 pips. A 10-pip pause usually means the move continues (`Mejores Entradas despues de noticias @ 21:23`).
- Only trade charts where the pattern is clean; skip the messy ones (`Niveles MFXM @ 06:12`; `Marcar Entradas Y Niveles @ 14:47`).
- Consolidation zones create fake support and resistance lines; don't trade them as real levels (p.25).
- Practice: go back on old charts, mark levels and winning entries with the reason, save each as a "flashcard" and compare new setups to it (`Marcar Entradas Y Niveles @ 00:44`, `@ 06:44`; `PEAK FORMATIONS 1 @ 05:04`).

## Peak formations (formación pico) and M/W

- A peak formation is the big M (or W) at the end of a level 3, usually where price makes a new high (or low) of the week and quickly returns inside (`PEAK FORMATIONS 1 @ 07:12`, `@ 22:40`; `sin titulo @ 13:33`).
- Once price leaves a peak formation, never trade back toward it. Only look for trades in the new direction, for about three days (`PEAK FORMATIONS 1 @ 09:56`, `@ 13:24`, `@ 23:50`).
- After a big M comes an A, another A, and only then a W. Do not look for a W right after a big M (`PEAK FORMATIONS 1 @ 16:44`, `@ 19:38`).
- A perfect-looking W fails if it sits against the bigger cycle (price still in its down leg toward level 3) (`PEAK FORMATIONS 1 @ 07:50`, `@ 08:51`).
- Entries always come after a stop hunt. After an upward stop hunt, look for the M's second leg to sell; after a downward one, the W's second leg to buy (`PEAK FORMATIONS 1 @ 20:22`, `@ 22:02`; `Niveles MFXM @ 08:56`).
- Confirmations listed for a good entry (`PEAK FORMATIONS 1 @ 01:49`; `Marcar Entradas Y Niveles @ 12:04`):
  - "Railroad tracks" (vías del tren): two side-by-side candles of similar size in opposite directions, showing a hurried reversal.
  - Price at yesterday's high or low, or the week's high or low.
  - Three pushes, then a stop hunt.
  - A hammer, doji or engulfing candle at that spot.
  - The TDI (RSI-based indicator) pointing the same way or diverging from price.
- Typical trigger: price breaks the day high, but the next candle closes back below it as a railroad pair (`Marcar Entradas Y Niveles @ 11:13`).
- Long wicks that close back under the week high are the market maker; short wicks are not enough (`sin titulo @ 07:19`). A run of lower highs means it is still falling (`sin titulo @ 08:40`).
- The trend continues while the previous swing high (or low) is not broken; breaking it signals a change (`sin titulo @ 31:07`).
- If anything is unclear, don't enter. Not every M or W is a trade (`Marcar Entradas Y Niveles @ 04:56`, `@ 14:11`; `sin titulo @ 32:09`).
- The four setups from the PDF: stop-hunt high with an M, stop-hunt low with a W, sudden rise, sudden drop (p.27).

## EMA use

- The EMA video uses four EMAs: **12, 36, 200 and 633**, on Heikin-Ashi candles (`Exponential Moving Average @ 02:08`, `@ 03:00`). A later video swaps in 50 and 200 because the platform allowed only two (`Mejores Entradas despues de noticias @ 24:24`).
- The 12 follows the trend closely. When price breaks the 12 it usually comes back to test the 36; the 12 and 36 act as moving support and resistance (`Exponential Moving Average @ 01:37`, `@ 04:00`).
- Entry: the 12 and 36 come close and cross, ideally with price crossing several EMAs at once (`Exponential Moving Average @ 10:43`, `@ 20:34`).
- Confirmation builds as candles close past the 12, then the 36, then the 200 and 633 (`Exponential Moving Average @ 11:25`, `@ 12:44`).
- While price stays away from the 36 the trade stays open; a move through the 36 is the exit (`Exponential Moving Average @ 11:02`).
- If the 12 and 36 stay far apart or never cross, there is no entry, even at strong support or resistance (`Exponential Moving Average @ 20:28`, `@ 38:43`, `@ 43:01`).
- It works when a trend turns; it fails in ranges where the EMAs keep crossing (`Exponential Moving Average @ 12:00`).
- The 200 and 633 act as big support or resistance on their own (`Exponential Moving Average @ 16:11`). An 800 EMA also shows up as a level (`Niveles MFXM @ 13:58`).
- The 50 EMA is "home" (volver a casa): price tends to come back to it. Pins at the 50 are entries (`Mejores Entradas despues de noticias @ 25:29`; `Marcar Entradas Y Niveles @ 05:34`). PDF: first target the 50, second the 200 (p.8).
- This is a swing method: it can sit 80 pips red before going 300 green (`Exponential Moving Average @ 44:12`). Analysis goes month, week, day, 4h, then 1h for the entry (`Exponential Moving Average @ 27:19`).

## Entries after news (noticias)

- The setup: UK news at 4:30 AM New York time. Asia consolidates, price makes a fake move, the news pushes it hard one way, then at the New York open it reverses back toward where the day opened (`Mejores Entradas despues de noticias @ 00:27`, `@ 03:40`, `@ 15:11`).
- A move that runs steadily one way into the news usually snaps back after it (`Mejores Entradas despues de noticias @ 06:57`, `@ 18:49`). Not every release moves the market (`@ 14:15`).
- Pairs he prefers: GBP crosses such as GBP/AUD, GBP/CHF, GBP/CAD (`@ 16:05`).
- The pound can overshoot the stop-hunt zone by 75-80 pips; normally 25-40 (`@ 06:42`).
- Confirm with the TDI: the RSI line leaves the Bollinger band, comes back inside and crosses the red signal line. Prefer the second leg; the first leg needs a stop over 25 pips (`@ 08:22`, `@ 08:49`, `@ 10:56`).
- Only take it when there are strong, fast candles; a TDI cross inside a consolidation gets stopped out (`@ 10:28`).
- Target: back to the Asia-range entry level, about 40-50 pips (`@ 24:08`).
- News covers the planned move; the spike is the market maker, not the headline (p.12, p.19). In NFP weeks USD/CAD can run one way all week and turn at the end; expect whipsaws before the release (`sin titulo @ 03:22`, `@ 33:58`).

## Price action

- Start on a bare chart: find weekly support and resistance by counting touches; more touches, stronger level (`Price Action Parte 1 @ 00:22`, `@ 01:06`).
- Levels are zones, not exact lines (`Price Action Parte 1 @ 02:19`; `Exponential Moving Average @ 08:19`).
- Then daily zones, 4h trend lines, 1h channels (`Price Action Parte 1 @ 03:47`, `@ 04:45`).
- A channel break gives a buy stop or sell stop, with the stop on the other side of the channel and the target at the next zone (`Price Action Parte 1 @ 06:42`).
- Fibonacci levels (38.2, 50, 61.8, 100, 161.8) are used to find where zones line up (`Price Action Parte 1 @ 09:10`, `@ 12:20`; `Price Action 2 @ 00:27`, `@ 02:21`).
- Aggressive entry: now. Conservative: wait for a doji or pin bar at the zone (`Price Action Parte 1 @ 13:13`). Never enter without confirmation (`@ 11:04`).
- Trend-line break, then a retest of the broken zone, then entry (`Price Action 2 @ 07:24`).
- Divergence between price and the TDI/RSI is used as an extra confirmation (`PEAK FORMATIONS 1 @ 07:05`; `Marcar Entradas Y Niveles @ 12:15`).

## Sessions and time of day (New York time)

- The MetaTrader day starts at 5 PM (`sin titulo @ 02:07`; p.13).
- Daily structure: the Asia box consolidates; London breaks out one way; New York either continues then flattens, or reverses (`sin titulo @ 04:04`; `Mejores Entradas despues de noticias @ 12:45`).
- The stop-hunt zone is about 25-50 pips beyond the Asia box (`sin titulo @ 40:48`).
- Entries happen leaving Asia into London, or at the New York open; a candle at a "specific hour" (around :45) often leaves the pin (`Marcar Entradas Y Niveles @ 02:44`, `@ 06:13`, `@ 21:51`). PDF: the 15 minutes after the London (about 2:30) and US (about 8:30) opens (p.13, p.23).
- New York is tradable until about 11:00-11:30 AM (`Marcar Entradas Y Niveles @ 22:24`); goes quiet around 12-1 PM (p.13).
- The Tokyo open (around 2 AM platform time) can also bounce a move (`Price Action 2 @ 02:49`).
- Weekly structure: one direction early in the week, a mid-week reversal, or a turn on Friday (`Niveles MFXM @ 21:06`; `sin titulo @ 15:38`). The Sunday gap often sets the low or high of the week (`PEAK FORMATIONS 1 @ 12:16`).
- Use the 1h TDI for tomorrow's direction, the 4h for the bigger trend, 15m for the entry (`Mejores Entradas despues de noticias @ 36:55`; `sin titulo @ 19:44`).
- Don't hold over the weekend (p.5).

## Stop and target placement

- Stop just beyond the stop-hunt extreme (`PEAK FORMATIONS 1 @ 21:22`); PDF says about 15 pips past the low or high of the day (p.18).
- Stops of 20-25 pips right at the obvious spot get hunted (`sin titulo @ 35:26`; `Mejores Entradas despues de noticias @ 21:44`).
- In the EMA and price-action videos: stop 20-30 pips beyond the support or resistance (`Exponential Moving Average @ 17:15`, `@ 28:39`; `Price Action 2 @ 08:05`).
- Trail the stop under the 12 EMA (or the 36) as the trend runs (`Exponential Moving Average @ 23:00`, `@ 21:58`).
- Targets: first at an EMA (50), second at the next EMA (200), also the middle of the range (`PEAK FORMATIONS 1 @ 03:03`, `@ 15:31`; p.8).
- Take partials at the first target (about 25-40 pips), move the stop to break-even, and add on at the next A pullback or accumulation breakout (`Niveles MFXM @ 22:18`, `@ 29:43`; `sin titulo @ 39:56`).
- Typical daily range limit: about 200 pips a day, 600 a week (ADR) (p.14). Once the ADR high and low are both touched, expect the move to stall (`sin titulo @ 22:51`, `@ 23:56`).

## Risk per trade

- None of the 8 videos gives a percent risk per trade. One webinar talks about "good leverage, good lot" and 10-15 pips on a standard lot (`sin titulo @ 33:07`). Trade Hub ignores that and keeps 0.5-1% per trade.
- Small losses, big winners: aim to lose at most about 10 pips per idea, because the winner makes 50-80 (`sin titulo @ 16:35`). Prefer cutting at 17 pips over taking a 25-30 pip stop (`@ 25:35`).
- Time stop: never sit more than about 2 hours in the red; scratch the trade and retry at a better level (`sin titulo @ 15:53`; p.7).
- Three pushes a day give three chances to catch the move, so missing one is fine (`sin titulo @ 25:39`).
- Judge every signal yourself; skip any that do not match (`sin titulo @ 27:22`).

## Rules Trade Hub can test now (`src/lib/rules/marvel.ts`)

| Rule                               | Conditions                                                                                                                                                                           | Stop / target                                                   | Sources                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| **MM stop hunt reversal** (1h)     | W or M with a stop hunt in the last 10 candles; hammer / spike / engulfing in the last 2; London open (2:30-4) or NY open (8:30-10) only                                             | 0.15% past the 12-candle extreme; 2R (stands in for the 50 EMA) | p.27, p.18, p.20, p.8; PEAK FORMATIONS 1, Marcar Entradas         |
| **MM three-day exhaustion** (1d)   | 3 daily candles against the trade, then a reversal candle                                                                                                                            | 0.15% past the 4-day extreme; 2R                                | p.18, p.22, p.25, p.8; PEAK FORMATIONS 1, sin titulo, Niveles     |
| **MFX level 3 peak reversal** (1h) | W or M with a stop hunt; close within 0.5% of the 120-candle (about one week) low / high; RSI(13) below 40 / above 60; reversal candle in the last 2; London 2:30-5 or NY 8:30-11:30 | 0.15% past the 12-candle extreme; 3R                            | Marcar Entradas, PEAK FORMATIONS 1, Noticias, Niveles, sin titulo |
| **MFX EMA 12/36 pullback** (4h)    | EMA 12 above 36 (below for shorts); close above (below) EMA 200; candle tests EMA 36 within 0.3% and closes back on the trend side                                                   | 0.2% past the 6-candle extreme; 2R                              | Exponential Moving Average                                        |

Choices we made that the course does not state:

- RSI 40/60 instead of the course's 20-30 / 70-80, because our check runs on the candle that confirms the W/M, when the RSI has already turned.
- 120 hourly candles as "the week". On crypto (24/7) that is 5 days; it is a rolling window, not Sunday-to-Friday.
- Fixed R targets stand in for "first EMA, second EMA" targets.
- The EMA 12/36 rule enters on a pullback to the 36 in an existing stack, not on the fresh cross, because we have no cross condition.

## What Trade Hub can and cannot test

- **Data**: crypto candles are 1h / 4h / 1d (built from CoinGecko hourly prices, about 90 days). Forex is **daily only**, with estimated highs and lows. So the 1h rules only really run on crypto, and session windows do nothing on daily forex candles.
- Crypto trades 24/7 and has no Asia box, London open or UK news in the forex sense, so the session ideas fit it only loosely.
- No 15m candles: entry timing on 15m, which the course uses for every trigger, cannot be tested.
- No tick data, no spread or slippage model beyond the fee, no volume for forex.
- No news calendar: the UK 4:30 AM news reversal and NFP behavior cannot be tested at all.
- Pips: the course thinks in pips; our stops are in percent, so "15 pips past the low" becomes a small percent buffer.

## Conditions to add (needs new code or better data)

- **Asian range box**: high and low of the Asia session, and "price swept 25-50 pips past it" (needs intraday forex).
- **Day / week reference levels**: yesterday's high and low, this week's high and low on calendar boundaries (5 PM New York), and "broke it but closed back inside". `nearLevel` only approximates this with a rolling window.
- **ADR**: average daily range, and "today's range already used up".
- **Level counting**: count three pushes with consolidations and label level 1 / 2 / 3, beyond the simple 3-candle `streak`. Include the "no trading back toward a peak formation for 3 days" filter.
- **EMA cross and EMA gap**: a fresh EMA 12/36 cross, and "the 12 and 36 are close together" (no trade when far apart).
- **Railroad tracks** candle pattern: two adjacent opposite candles of similar size (not one of our 21 detectors).
- **TDI**: RSI(13) with Bollinger bands on the RSI and a signal line; "RSI left the band, came back inside and crossed the signal line".
- **Divergence**: price makes a new extreme while RSI does not.
- **News calendar**: event time and currency, to test the post-news reversal.
- **Exits**: time stop (close if still red after 2 hours), trailing stop under EMA 12 or 36, EMA-based targets (50 then 200), partials plus break-even, and weekend flat (close before Friday's end).
