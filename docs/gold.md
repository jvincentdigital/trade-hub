# Gold (XAU/USD)

Added 2026-11-10 after John asked "what about forex and gold?". Free and
keyless like everything else.

## Where the price comes from

PAX Gold (PAXG) is a token backed by and tracking one troy ounce of gold.
Live prices come from CoinGecko (id `pax-gold`); candles for rules, backtests
and the race come from Kraken's free public OHLC (pair `PAXGUSD`, real 1h/4h/1d
candles, see `src/lib/kraken.ts`), the same as crypto (unlike forex, which is
daily only). It can
drift a little from spot XAU/USD (token premium, weekends when gold markets are
closed but PAXG still trades). The page says "price tracked by PAX Gold"; its
TradingView button shows the real `OANDA:XAUUSD`.

## In the app

| Place         | What                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/forex`      | A "Gold" card under the pairs, opens `/gold` (the Forex nav item stays highlighted on `/gold`)                                          |
| `/gold`       | Detail page: our candle chart + patterns, TradingView toggle, strategy signals, demo link                                               |
| `/demo`       | "Gold (XAU/USD)" in the market list, sized in ounces                                                                                    |
| `/strategies` | Every rule set to "All (crypto, forex, gold)" (6 of 7 built-ins) can check, backtest and chart gold. MM Confluence v2 stays crypto-only |
| `/race`       | Gold is one more market in each all-markets strategy, in both the past-results and live race                                            |

## Model choices

- Market group `metals` (`Market = 'crypto' | 'forex' | 'metals'`), label "Gold".
- `METAL_MAP` in `src/lib/coingecko.ts`, kept out of `COIN_MAP` so crypto lists,
  sparklines and the crypto scanner stay crypto. Our CoinGecko routes accept
  any id in either map (`isCoinGeckoId`), and `/api/crypto/prices` fetches
  both in one call (`useMetalPrices` reads the same SWR key, no extra request).
- Demo costs: **0.02% per side** (a typical retail XAU/USD spread of 40-80
  cents per ounce at $2,000-4,000) and **20:1 leverage** (the EU/UK retail cap
  for gold CFDs). Constants at the top of `src/lib/paper/engine.ts`.
- Rule schema unchanged: `market: 'both'` now means all markets.

Tests: `src/lib/paper/gold.test.ts`. The old per-market slot migration for gold is gone since the race moved to one account per strategy (`docs/strategy-race.md`, "Sizing").
