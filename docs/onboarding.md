# Onboarding

From fresh clone to running app in under 10 minutes.

## Prerequisites

- **Node.js 20+** (`node -v` to check). If you use nvm: `nvm use 20`.
- **npm** (ships with Node).
- **Git**, plus a terminal you're comfortable in.

No database, no API keys, no Docker — Trade Hub runs as a single Next.js app against free-tier public APIs.

## Bootstrap

```bash
git clone <this-repo-url> trade-hub
cd trade-hub
npm install
```

`npm install` also runs husky's `prepare` script, installing the pre-commit hook. If you forked the repo, remotes and `gh` auth are on you.

## Run the app

```bash
make run          # Next dev server on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000). The dashboard should render immediately with live crypto + forex prices. If you see empty cards, check the dev-server logs — the free-tier CoinGecko / Kraken / Frankfurter APIs are rate-limited and occasionally hiccup.

## The Makefile is the interface

Everything runs through `make <target>`. Human or AI, this is the one reference:

```bash
make help         # list everything
make run          # dev server
make build        # production build
make start        # run the production build
make lint         # eslint
make typecheck    # tsc --noEmit
make fmt          # prettier --write .
make test         # vitest (unit tests)
make test-e2e     # playwright smoke (requires `npx playwright install chromium` once)
```

First-time E2E setup:

```bash
npx playwright install chromium
```

## Where things live

- `app/` — routes (App Router). `api/*` are server handlers; `*/page.tsx` are feature pages (mostly `'use client'`).
- `components/` — `layout/`, `market/`, `ui/`.
- `lib/` — `coingecko.ts` (upstream fetch helpers), `hooks/`, `patterns/` (21 candlestick detectors), `scanner/` (MM Confluence v2 math), `schemas.ts` (Zod), `logger.ts` (pino), `types/`, `utils/`.
- `docs/` — living docs. Start with `docs/architecture.md` and `docs/product.md`. Strategy specs in `docs/strategies/`.
- `TODO.md` — ranked production-readiness backlog.
- `CLAUDE.md` / `AGENTS.md` — conventions for AI agents.

## Daily workflow

1. Pull, branch off master.
2. Write code. Run `make run` in one terminal, `make test:watch` (via `npm run test:watch`) in another.
3. Before committing:
   - `make lint` — ESLint.
   - `make typecheck` — TypeScript.
   - `make test` — unit tests.
   - The pre-commit hook will also run Prettier + ESLint on staged files.
4. Open a PR. CI runs the same checks plus Playwright smoke and gitleaks.

## Deploy

Not wired yet. Planned target is Vercel — run `vercel link` once, then `make deploy TARGET=prod` will be live. Until then the app is local-dev only.

## Gotchas

- **Next.js 16 is newer than most AI training data.** Before writing framework code, read `node_modules/next/dist/docs/` and honor deprecation warnings. See `AGENTS.md`.
- **No 1H scanner timeframe.** CoinGecko's free `/ohlc` endpoint locks granularity to the `days` param — see `docs/strategies/mm-confluence-v2.md`.
- **Forex scanner is disabled.** No OHLC source wired up yet. Watchlist forex entries get `forex-no-ohlc`.
- **Client components can't export `metadata`.** Each feature route has a `layout.tsx` that exists purely to export metadata; the page itself is `'use client'`.
- **State is localStorage-only.** Strategies and watchlist live in the browser. Clearing site data wipes them. Use the Export button on `/strategies` if you care about your notes.

## Where to ask questions

- AI agent? Read `docs/architecture.md` first, then the relevant file under `lib/` or `app/`. Most answers are inline.
- Human? Check `TODO.md` to see what's known to be broken or missing before filing something.
