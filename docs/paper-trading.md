# Demo account (paper trading)

Added 2026-11-10. Page: `/demo` ("Demo", wallet icon in the nav). Play money
only: nothing talks to a broker, nothing can move real money.

## What it does

- Starts with **$10,000** (any amount on reset). Reset wipes positions, orders and history.
- **Market orders** fill at the latest feed price. **Limit orders** wait and fill when the price crosses the limit (a buy limit set above the current price is already "marketable" and fills at once at the better live price).
- **Stop loss / take profit** on every order (optional, but the plan checks nag if you skip the stop). Stops fill at the observed price, which can be worse than the stop, like a real gap. Targets fill at the target.
- **Position sizing**: by risk % (units = equity × risk% ÷ stop distance in USD) or by a dollar amount. The ticket and every open position show the size in lots (forex: 1 lot = 100,000 units, 0.01 lot = 1,000; gold: lots of 100 oz) or coins, with $ per pip (forex) or per $1 move (gold); positions also show risk $ at the stop, goal $ at the target and R:R (`src/lib/sizing/sizing.ts`). Real brokers round to 0.01 lots; the demo keeps the exact size.
- **Costs**: 0.1% per side on crypto (typical taker fee), 0.007% on forex (about a 0.7 pip spread on EUR/USD), 0.02% on gold (about a 40-80 cent spread per ounce).
- **Margin**: crypto is spot-style (1:1, no leverage). Forex uses 30:1, the EU/UK retail cap; gold 20:1, the EU/UK retail cap for gold. The ticket shows the cash it locks.
- **P&L in USD** for every pair: JPY/CHF/CAD/GBP quotes are converted with the live pairs (`quoteToUsd`).
- **Stats**: equity curve, win rate, profit factor, max drawdown, average win/loss, trade history.
- **Plan checks** (`lib/paper/plan.ts`): warnings from John's Trading Plan (max 5R open risk, max 3 trades a day, every trade has a stop, trades come from a tested rule) and the MM Confluence daily -2% stop. They warn, they don't block.
- **One-tap trades from strategies**: a rule's signal on `/strategies` can place a demo market order sized at the rule's risk %, with the rule's stop and target.

## Honest limits

- **Forex prices update about once a day** (free ExchangeRate API). Forex here suits slow swing practice, not intraday. For real-time forex practice see `docs/demo-brokers.md` (OANDA practice).
- **Crypto prices** are CoinGecko, refreshed about once a minute; a stop can be skipped past between checks.
- Orders, stops and targets are processed **only while Trade Hub is open in a tab** (`components/paper/PaperEngine.tsx` in the root layout). Close the tab and nothing fills until you come back; the first price after that decides.
- One browser only (localStorage). Clearing site data wipes it.

## Code map

| File                               | Role                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/paper/engine.ts`          | Pure functions: `placeOrder`, `tick`, `closePosition`, `cancelOrder`, `sizeByRisk`, `equityOf`. Every function returns a new account. |
| `src/lib/paper/schema.ts`          | Zod schema of the stored account (`version: 1`).                                                                                      |
| `src/lib/paper/stats.ts`           | `computeStats` (shared with backtests) and `maxDrawdown`.                                                                             |
| `src/lib/paper/plan.ts`            | Plan-check warnings.                                                                                                                  |
| `src/lib/paper/instruments.ts`     | The 19 markets (10 crypto, gold, 8 forex), `instrumentHref`, `quoteToUsd`, price formatting.                                          |
| `src/lib/hooks/usePaperAccount.ts` | Shared store over localStorage key `trade-hub-paper-account` (cross-tab sync), plus `useLivePrices`.                                  |
| `src/app/demo/page.tsx`            | The page.                                                                                                                             |

Tests: `src/lib/paper/engine.test.ts`, `plan.test.ts`.

## Path to a real backing store (later)

The account is one JSON document validated by `paperAccountSchema`, so moving it is small:

1. Add a table `paper_accounts (id, owner, data jsonb, updated_at)` in Supabase Postgres or Neon (both have free tiers; the workspace default is Supabase).
2. Add `GET/PUT /api/paper` route handlers that validate with the same schema. Needs auth first (the app has none today).
3. Swap `load`/`setPaperAccount` in `usePaperAccount.ts` to read/write through those routes (keep localStorage as an offline cache). Pages don't change.
4. Move `tick` to a scheduled job (Vercel cron calling a route) so stops and limits work with the tab closed.

Or skip steps 1-4 and connect a broker practice account (`docs/demo-brokers.md`), which runs fills on the broker side.
