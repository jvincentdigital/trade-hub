# TODO

Rank-ordered path from the current working dashboard → production-ready. Start at the top.

Status markers: `[ ]` open · `[~]` in progress · `[x]` done.

## Where we left off (2026-11-10 night)

**Latest (2026-11-10 late night): real candles.** Crypto and gold candles now come from Kraken's free public OHLC (`src/lib/kraken.ts`, no key) instead of CoinGecko's one price per hour. The old 1h candles were flat, every flat candle counted as a Dragonfly and Gravestone Doji, so every 1h rule's reversal check passed: old 1h backtests and the old "Last 90 days" board were misleading. `/race` now shows "Past results" with a window per strategy (1h: 30 days, 4h: 120, daily: 365), the live tick uses real candles, and the pattern detector ignores zero-range candles. BNB is on Kraken too. See `docs/strategy-race.md` "Real candles".

Unattended night run on the Mac Mini. Branch `night/2026-11-10-tradehub`, **draft PR #1** https://github.com/jvincentdigital/trade-hub/pull/1 (do not merge without John). Nothing deployed, no real money or broker touched, no paid APIs.

**What changed**

- **Fixed: live crypto prices were down.** CoinGecko sends `null` for the retired MATIC coin and the strict schema 502'd `/api/crypto/prices` for all coins. Schema is now null-tolerant and MATIC became POL.
- **Fixed: scanner 4H/1D never worked.** CoinGecko `/ohlc` returns 4-day bars above 30 days. Real 1h/4h/1d candles are now built from hourly prices (`/api/crypto/candles/[id]`).
- **New `/demo` demo account** ("Cuenta demo"): play money, market/limit orders, SL/TP, risk sizing, fees, live P&L, equity curve, stats, plan checks from John's Trading Plan. See `docs/paper-trading.md`.
- **New strategy rules** on `/strategies`: check live, backtest, chart signals, one-tap demo trade, editable copies. Two rules come from the Market Maker PDF. See `docs/strategy-rules.md` and `docs/strategies/marvel-fx-method.md`.
- `docs/demo-brokers.md`: OANDA practice (forex) and Alpaca paper (crypto) are the free picks. Research only, no sign-ups.
- Tests went from 37 to 70, and the e2e smoke now has 8 tests covering `/demo`. Typecheck, lint, build and e2e all pass.
- Course: the MacBook transcription had crashed (PyAV bug), so it now runs on the Mac Mini (`scripts/transcribe-course.py`). `make extract-strategies` turned the first 8 videos into rules with timestamped sources, and the Market Maker PDF gave 2 more.

**Added later (2026-11-10 afternoon): Strategy race, `/race`.** Every built-in strategy gets its own play-money account ($1,000 default, editable). "Last 90 days" ranks them by end money (money split evenly over each strategy's markets, fees on); tap a row for per-market results and trades. "Live from today" is a forward test: `make race-tick` opens/closes trades per strategy into `~/.local/share/trade-hub/race.json`; first tick ran by hand (9 trades opened). The hourly launchd job is written (`scripts/launchd/`) but **not installed**. See `docs/strategy-race.md`.

- [x] Hourly race job installed by John (com.jvd.trade-hub-race).

**Gold (XAU/USD) added (2026-11-10 afternoon).** Priced by PAX Gold on CoinGecko (hourly, free). `/gold` page (card on `/forex`), tradeable in `/demo` (0.02% cost, 20:1), runs on every all-markets rule and in both race sections; existing race.json gets gold slots without losing open trades. See `docs/gold.md`.

**How to review (about 10 min)**

1. Phone screenshots: `~/jvd-outputs/2026-11-10/trade-hub/` (01 to 06).
2. `make run`, then open `/demo`. Buy BTC with a stop and watch the P&L, then close it.
3. `/strategies`: press "All 18" on EMA 50 pullback. Then try "Check now", and "Place demo trade" if a signal shows.

**Choices I made (change if wrong)**

- Demo costs: crypto 0.1% per side, forex about 0.7 pip. Forex margin 30:1, crypto 1:1 (constants at the top of `src/lib/paper/engine.ts`).
- Plan checks warn but don't block.
- Built-in rules are read-only; "Duplicate" makes an editable copy.
- Kept the old trade-plans key `tradehub.strategies.v1` so saved plans survive.
- Forex stays on the free daily feeds; I didn't sign up for Twelve Data or anything else.
- Course rules (BTC only, 90 days, fees on; CoinGecko rate-limited the other coins): none positive yet. Best was MFX level 3 peak reversal (9 trades, 56% wins, -1.0R).
- Disk: my footprint is about 1.1 GB (node_modules + .next). The drop from 162 to about 130 GB free was mostly a separate job downloading a 15 GB FLUX.2 image model into ~/.cache/huggingface at 00:58. I didn't touch it.

**Next steps**

- [ ] @john: review PR #1 on a phone. Say merge or change.
- [x] Course transcripts: all 21 done and extracted 2026-11-10 (2 new rules: MFX second leg at the day high/low, MFX EMA 800 pin; doc rewritten). Not committed; review the diff. Found: 1h crypto candles are flat, so 1h pattern checks always pass (see "What Trade Hub can and cannot test" in the Marvel doc). Original note: running on the Mac Mini into `~/jvd-outputs/trading/transcripts/` (progress in `_progress.md`). When all 21 are done, run `make extract-strategies` on the branch and review the diff to `src/lib/rules/marvel.ts`. At 01:46, 9 of 21 were done (all of "Lo demas" plus 1 practice video); the 8 "Lo demas" ones were already turned into 2 rules tonight (MFX level 3 peak reversal, MFX EMA 12/36 pullback). A second pass is queued for the theory videos that were copied later. Expect all 21 by about 03:00.
- [ ] @john: sign up for OANDA practice (forex, real-time) and/or Alpaca paper (crypto) if you want broker-side demo fills. Stop if either asks for a card. Then we build `docs/demo-brokers.md` step by step (needs a passcode on the app first).
- [ ] Practice in the demo for 2+ weeks with one rule before any real money. No rule has an edge yet after fees (backtest table in `docs/strategy-rules.md`).
- [ ] Rule conditions to add when there's intraday forex data: Asian range / initial high-low of the day, ADR filter, 2-hour time stop, EMA-based targets.
- [x] Pre-existing: dashboard sparklines fire 10 CoinGecko calls at once, and some get rate-limited (500), which leaves blank sparklines. Fix: stagger them or cache them longer. (fixed 2026-11-10, 5c1aa67: one at a time, 10 min refresh, route serves last good candles on 429)
- [ ] Known pre-existing issue: `useStrategies`/`useTradePlans`/`useWatchlist` read localStorage in `useState`, which can log a hydration warning when data is saved.

## Reliability (the app breaks silently today)

- [x] Add `app/error.tsx` and `app/not-found.tsx` with branded, useful UI — currently unhandled errors fall through to Next.js defaults.
- [x] Add `loading.tsx` for each data-fetching route segment (`app/crypto/`, `app/forex/`, `app/watchlist/`, `app/strategies/`) so first paint doesn't flash empty state.
- [x] Fix silent `catch` blocks in `app/api/**/route.ts` — at minimum, log the error and return a typed error response instead of swallowing it.
- [x] Validate upstream API responses with Zod in each route handler (`/api/crypto/prices`, `/api/crypto/ohlc/[id]`, `/api/forex/rates`) before returning them — a schema drift from CoinGecko or ExchangeRate API currently crashes the hooks.
- [x] Wire a request-scoped logger (pino) and replace `console.error` breadcrumbs with structured logs.

## Data & state integrity

- [x] Guard `useStrategies`/`useWatchlist` against corrupt `localStorage` values (Zod-validate on load; reset + warn on invalid).
- [x] Add an export/import flow for strategies + watchlist so a cleared browser doesn't lose months of notes.
- [ ] Decide whether to move strategies to a backing store (Supabase Postgres is the default); document the decision in `docs/architecture.md` before implementing. _(needs product decision)_

## Testing

- [x] Pick Vitest + React Testing Library for units, Playwright for E2E. Wire `make test` to actually run something.
- [x] Unit-test `lib/patterns/patterns.ts` — 21 detectors with hardcoded confidence scores are the highest-value regression surface. Use fixture candles per pattern.
- [x] Unit-test `lib/hooks/useMarketData.ts` transforms (CoinGecko → `PriceData`, ExchangeRate → `ForexRate` with pair inversion).
- [x] Smoke E2E: load `/`, `/crypto`, `/forex`, `/strategies`, `/watchlist`; assert no console errors and the sidebar renders.

## CI/CD

- [x] Add `.github/workflows/ci.yml` running lint, typecheck, unit tests, build, and Playwright smoke on every PR.
- [x] `vercel link` the repo (linked to `jcincnet11s-projects/trade-hub`). Preview deploys per PR happen automatically once the repo is imported in the Vercel dashboard.
- [x] Implement `make deploy TARGET=prod|preview` against the Vercel CLI; `make logs` and `make status` use `vercel logs --follow` / `vercel ls`.

## Observability

- [ ] Add Sentry for server + client error tracking before the first real user touches prod. Scrub any stray upstream API responses from breadcrumbs. _(needs Sentry DSN from user)_
- [x] Add `/api/health` returning `{ status: "ok", sha, env, at }` for uptime monitoring.
- [x] Enable Vercel Analytics (wired via `@vercel/analytics/next` in `app/layout.tsx`; turn it on in the Vercel dashboard if not already).

## Performance

- [x] Profile `/crypto` detail panel: memoize `detectPatterns(candles)` with useMemo keyed on candles + item.patterns.
- [x] Audit images: no raw `<img>` tags in the codebase — `public/` assets are unused at the moment.
- [x] Add `generateMetadata` per route: root layout sets default + template; crypto/forex/strategies/watchlist each ship a `layout.tsx` with route-specific title/description.

## UX polish

- [x] Replace the "Loading..." text on `/crypto` and `/forex` with skeleton cards matching the final layout.
- [x] Surface network/upstream errors in-page on /crypto, /forex, /watchlist.
- [x] Add a confirm step to strategy delete.

## Developer experience

- [x] Add Prettier + shared config; wired into `make fmt` / `make fmt-check` and lint-staged.
- [x] Install Husky + lint-staged to run Prettier + ESLint on staged files pre-commit.
- [x] Add gitleaks secret scan (GitHub Action) ahead of adding any API keys.
- [x] Write `docs/onboarding.md` — clone to running app in under 10 minutes.
