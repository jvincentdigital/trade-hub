# Trade Hub — Product Scope

## What it is

Personal trading dashboard for crypto and forex markets. Single-user, no auth, no backend database.

## Core features

1. Live crypto prices — CoinGecko free API (BTC, ETH, SOL, XRP, BNB, ADA, AVAX, DOGE, DOT, MATIC)
2. Live forex rates — ECB daily rates via Frankfurter, free (EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD, EUR/GBP)
3. Candlestick pattern detection engine — 21 patterns, runs on real OHLC data
4. Personal strategy notes — saved to localStorage
5. Custom watchlist — saved to localStorage

## What it is NOT

- No auth
- No database
- No user accounts
- No trading execution
- No financial advice

## Storage

- localStorage key: trade-hub-strategies
- localStorage key: trade-hub-watchlist
- localStorage key: trade-hub-preferences

## Data sources

- CoinGecko /simple/price → live prices + 24h change
- CoinGecko /coins/{id}/ohlc → OHLC candles for pattern detection
- Frankfurter (ECB) /v1/latest?base=USD → forex rates
- All API calls go through Next.js route handlers in app/api/ to avoid CORS
