# Architecture

## Current state

Trade Hub is a working single-user trading dashboard built on Next.js 16 (App Router). There is no backend service, no database, and no auth. All user state (strategies, watchlist) lives in `localStorage`; all market data comes from free-tier third-party APIs proxied through Next.js route handlers. Error/not-found boundaries and per-route loading skeletons are in place; API route handlers log failures via `console.error` before returning typed 500s. The open hardening work is tests, structured logging (pino), Zod response validation, CI, and deploy.

## Stack

| Layer       | Choice                                                    |
| ----------- | --------------------------------------------------------- |
| Framework   | Next.js 16 (App Router)                                   |
| UI          | React 19                                                  |
| Styling     | Tailwind CSS v4 (CSS-first via `app/globals.css`)         |
| Language    | TypeScript 5 (strict)                                     |
| Client data | SWR v2 (`lib/hooks/*`)                                    |
| Server data | Next.js `fetch` with ISR (`revalidate` on route handlers) |
| Charts      | `lightweight-charts` v5                                   |
| Icons       | `lucide-react`                                            |
| Lint        | ESLint 9 + `eslint-config-next`                           |
| Target host | Vercel (default, not yet linked)                          |

## Directory layout

- `app/` — App Router routes, layouts, and route handlers.
  - `app/api/crypto/prices/route.ts` — proxies CoinGecko `/simple/price` for 10 hardcoded coin IDs; `revalidate: 60`.
  - `app/api/crypto/ohlc/[id]/route.ts` — proxies CoinGecko `/coins/{id}/ohlc?days=14`; normalizes tuples to `{time, open, high, low, close}`; `revalidate: 300`.
  - `app/api/forex/rates/route.ts` — proxies Frankfurter (ECB) `/v1/latest?base=USD`; `revalidate: 3600`.
  - `app/api/scanner/route.ts` — MM Confluence v2 setup scanner; parses `tf` (`30min|4H|1D`) and `symbols`, calls `lib/coingecko` helpers for OHLC + volume, runs `detectPatterns` and `scoreSetup`, returns `{ results, skipped }`.
  - `app/error.tsx` / `app/not-found.tsx` — branded error boundary and 404.
  - `app/{crypto,forex,strategies,watchlist}/loading.tsx` — skeleton placeholders.
  - `app/strategies/_components/SetupScanner.tsx` — client component rendering live scanner cards.
  - `app/page.tsx` — dashboard aggregating sentiment across all tracked pairs.
  - `app/crypto/`, `app/forex/`, `app/strategies/`, `app/watchlist/` — feature pages.
- `components/` — UI organized by purpose: `layout/` (Sidebar), `market/` (PairCard, PatternBadge, PriceChart), `ui/` (Badge, Card).
- `lib/`
  - `coingecko.ts` — `COIN_MAP` + `fetchOHLC`/`fetchVolumes` helpers + `Timeframe` → `days` mapping.
  - `hooks/` — SWR + localStorage hooks (`useMarketData`, `useStrategies`, `useWatchlist`).
  - `patterns/` — 21 candlestick detector functions plus the `detectPatterns` orchestrator.
  - `scanner/mmConfluence.ts` — pure indicators and scoring (`ema`, `rsi`, `detectMWFormation`, `scoreSetup`, `checkInvalidation`, `sessionInfo`).
  - `types/` — `market.ts`, `strategy.ts`.
  - `utils/formatters.ts` — price/change/volume/market-cap formatting.
- `public/` — static assets served from `/`.
- `docs/` — living documentation; `docs/strategies/` holds per-strategy specs (e.g. `mm-confluence-v2.md`).
- `.claude/` — Claude Code skills, hooks, and settings.

## Data flow

1. A page route (e.g. `app/crypto/page.tsx`) is a client component that calls a hook from `lib/hooks/useMarketData.ts`.
2. The hook uses SWR to fetch one of our own `/api/*` routes — never the upstream service directly.
3. The route handler calls CoinGecko, Kraken or Frankfurter server-side with `next: { revalidate: N }`, so Next.js caches the upstream response for `N` seconds. This avoids CORS and smooths out rate limits.
4. The hook shapes the raw response into the app's domain types (`PriceData`, `ForexRate`, `OHLCCandle`) and returns `{ data, isLoading, error }`.
5. User state (strategies, watchlist) is read/written via `useStrategies` and `useWatchlist`, which wrap `localStorage`. Components never touch `localStorage` directly.

## Pattern detection

`lib/patterns/patterns.ts` defines 21 detector functions — one per candlestick pattern. Each takes 1–3 candles and returns a `PatternResult` (name, type: bullish/bearish/neutral, confidence, description, signal) or `null`. `lib/patterns/detector.ts` exposes `detectPatterns(candles)` which runs every detector on the most recent candles, filters nulls, sorts by confidence, and returns the top matches. Requires at least 3 candles. Runs fully client-side on OHLC data fetched for the currently selected crypto pair.

## MM Confluence scanner

`/api/scanner` is the server side of the MM Confluence v2 strategy (spec in `docs/strategies/mm-confluence-v2.md`). For each crypto symbol in the watchlist it fetches entry-TF OHLC, higher-TF OHLC (for EMA 200 alignment), and a volume series from `/market_chart`; runs `detectPatterns` and then `scoreSetup` to produce a 7-point checklist and a grade (A ≥ 6, B 4–5, C ≤ 3). `SetupScanner.tsx` on `/strategies` polls this route every 60s via SWR, filters to A/B grades, and renders checklist cards. Pure indicator math (`ema`, `rsi`, `detectMWFormation`, `scoreSetup`) lives in `lib/scanner/mmConfluence.ts` so both the route and the component consume the same source — the component re-exports it for discoverability. Forex symbols are skipped with `forex-no-ohlc` until an OHLC provider is wired up.

## Demo account and strategy rules

Added 2026-11-10. Both are pure TypeScript modules with tests, used by client pages:

- `lib/paper/` is the demo ("paper") account: `engine.ts` (orders, fills, stops/targets, fees, margin, equity), `stats.ts` (win rate, profit factor, max drawdown), `plan.ts` (trading-plan warnings), `instruments.ts` (the 18 tradable markets and USD conversion). State lives in localStorage via `lib/hooks/usePaperAccount.ts`, a small shared store; `components/paper/PaperEngine.tsx` in the root layout feeds live prices into it while a tab is open. Details: `docs/paper-trading.md`.
- `lib/rules/` is the strategy engine: `schema.ts` (Zod rule format), `engine.ts` (signals, backtest), `presets.ts` + `marvel.ts` (built-in rules), `data.ts` (which candles a rule runs on). UI: `app/strategies/_components/StrategyRules.tsx` and `components/market/RuleSignals.tsx` on detail pages. Details: `docs/strategy-rules.md`.

## External services

| Service           | Endpoint                                                  | Auth | Cache (revalidate) | Notes                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------- | ---- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CoinGecko         | `api.coingecko.com/api/v3/simple/price`                   | none | 60s                | 10 coins from `COIN_MAP`: BTC, ETH, SOL, XRP, BNB, ADA, AVAX, DOGE, DOT, POL (MATIC retired 2026-11-10: its feed returns nulls)                                             |
| CoinGecko         | `api.coingecko.com/api/v3/coins/{id}/ohlc?days=N`         | none | 300s               | Detail panel uses `days=14`; scanner uses variable `days` (1/30/180). Granularity is locked by `days` (1→30min, 2–30→4H, 31+→**4-day**, not daily; checked 2026-11-10).     |
| CoinGecko         | `api.coingecko.com/api/v3/coins/{id}/market_chart?days=N` | none | 300s               | Volume series for the scanner; `days=90` gives hourly prices that `fetchCandles` buckets into 1h/4h/1d candles (`/api/crypto/candles/[id]`, scanner 4H/1D, strategy rules). |
| Frankfurter (ECB) | `api.frankfurter.dev/v1/latest?base=USD`                  | none | 3600s              | 8 pairs from USD rates: xxx/USD = 1 / rate, USD/xxx = rate, a cross like EUR/GBP = GBP rate / EUR rate (`transformForexRates`). Daily ECB rates, the race's source too.     |

No `.env` files are required today. When a service that needs a key is added, document it in `.env.example` and load via `process.env` in the route handler only — never ship a key to the client.

## Persistent state (localStorage)

| Key                       | Shape                                                       | Owner hook        |
| ------------------------- | ----------------------------------------------------------- | ----------------- |
| `trade-hub-strategies`    | `Strategy[]`                                                | `useStrategies`   |
| `trade-hub-watchlist`     | `string[]` (pair IDs)                                       | `useWatchlist`    |
| `trade-hub-paper-account` | `PaperAccount` (demo account)                               | `usePaperAccount` |
| `trade-hub-rules`         | `Rule[]` (user's own rules)                                 | `useRules`        |
| `tradehub.strategies.v1`  | `TradePlan[]` (older key name, kept so saved plans survive) | `useTradePlans`   |
| `trade-hub-preferences`   | reserved (not yet populated)                                | —                 |

Because all user data is browser-local, clearing site data wipes the user's strategies and watchlist. A future migration to a backing store (Supabase, etc.) is a likely next step; when it happens, keep the hook surface stable so pages don't change.

## Next.js 16 caveats

This is **not** the Next.js most AI training data knows. Before writing framework code (routing, data fetching, caching, metadata, middleware, etc.), read the relevant file under `node_modules/next/dist/docs/`. Pay attention to deprecation notices at build time. See `AGENTS.md`.

## Known gaps

Tracked in `TODO.md`; listed here for architectural awareness (refreshed 2026-11-10):

- Forex data is daily only (free ECB rates via Frankfurter, for the live rates and the candles alike). Forex highs/lows are synthesized at ±0.1%, so forex backtests and demo stops are rough. Real intraday forex needs a key (Twelve Data route exists, unset) or a broker practice feed (`docs/demo-brokers.md`).
- The demo account only processes orders while a browser tab is open, and lives in one browser's localStorage.
- localStorage hooks read storage in `useState` initializers, so pages with saved data can log a hydration mismatch warning on first load (pre-existing pattern; `usePaperAccount` uses `useSyncExternalStore` and avoids it).
- Sentry DSN still needs to be set by John.

Update this doc as real architectural decisions are made.
