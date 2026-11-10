# Free broker practice accounts (for later)

Researched 2026-11-10, read-only. **Nothing was signed up for.** John signs up
himself when he wants this; every option below is $0 and play money. Full notes
with a source per row: `~/jvd-outputs/2026-11-10/trade-hub/demo-brokers-research.md`.

## Why bother

Trade Hub's own demo account (`docs/paper-trading.md`) is good for practicing
the plan, but its forex prices update about once a day and orders are only
checked while a tab is open. A broker practice account gives real-time quotes
and fills that run 24/7 on the broker's side.

## Which fits

|                  | OANDA practice              | Alpaca paper                                         | Binance Spot Testnet                  |
| ---------------- | --------------------------- | ---------------------------------------------------- | ------------------------------------- |
| Use it for       | **Forex** (pick this)       | **Crypto** (pick this)                               | Plumbing tests only                   |
| Cost / card      | $0, no card found           | $0, email only                                       | $0, GitHub login                      |
| Our markets      | 8 of 8 forex majors         | 9 of 10 coins (no BNB)                               | not checked                           |
| Data             | Real streaming quotes       | Real quotes, crypto data limits unclear              | Simulated, wiped about monthly        |
| US / Puerto Rico | Likely OK; PR not confirmed | Paper is global; live crypto excludes PR             | Binance.com does not serve US persons |
| Stop / target    | Attach on fill (to verify)  | No brackets for crypto (Trade Hub would manage them) | OCO / stop-limit                      |
| API              | REST + stream, Bearer token | REST + WebSocket, key id + secret                    | REST + WS, HMAC signed                |

Key facts (verified on the providers' pages):

- OANDA practice hosts: `api-fxpractice.oanda.com` and `stream-fxpractice.oanda.com`; limit 120 requests/s per IP. Token: OANDA HUB, Tools, API, Generate.
- Alpaca paper: `paper-api.alpaca.markets`, $100k simulated balance, fills against real quotes; paper does not model fees or slippage. No reset button any more (open a new paper account).
- Binance testnet: `testnet.binance.vision`, data is not the real market.

Check by hand at signup (could not confirm online): OANDA practice for a PR resident without ID/funding (stop if it asks for a card); Alpaca paper crypto from PR; Alpaca crypto data limits.

## What an integration needs

Same shape for any broker:

1. **Server-only keys.** Vercel env vars, never `NEXT_PUBLIC_`: `OANDA_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENV=practice` or `ALPACA_KEY_ID`, `ALPACA_SECRET`, `ALPACA_BASE=https://paper-api.alpaca.markets`. Hard-code the practice/paper host so a live key can't be used by mistake.
2. **Route handlers** `src/app/api/broker/<name>/{account,prices,orders,positions}/route.ts`, Zod-validating every response like the existing proxies, behind `checkRateLimit`.
3. **Auth on those routes.** Today the app has no login; once a broker key sits behind an API route, anyone with the URL could place practice orders. Add a passcode or single-user auth first.
4. **Mapping.** Our `OrderRequest` (`lib/paper/engine.ts`: side, market/limit, units, stopLoss, takeProfit) maps to OANDA `units` (negative = sell) + `stopLossOnFill`/`takeProfitOnFill`, instrument `EUR_USD`; to Alpaca `qty`, `side`, `type`, symbol `BTC/USD`.
5. **A broker toggle** on `/demo`: "Trade Hub demo" (local) vs "OANDA practice". Keep the local engine as the default and for backtests.
6. **Prices.** Poll the broker pricing endpoint through our route every few seconds (Vercel functions don't hold long streams well).

Do not connect a live (real money) account. If that ever comes up, it needs John's explicit yes and a separate review.
