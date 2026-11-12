# Makefile — project operations
#
# Single entry point for all project operations: build, run, test, deploy.
# Both humans and AI agents use this as the "how do I do anything" reference.
#
# Usage: make <target>
#
# Convention: keep targets simple. If a target needs more than a few lines of
# shell, put the logic in scripts/ and call it from here.

.PHONY: build test run start lint typecheck deploy logs status docs help extract-strategies race-tick race-reset funded-reset claude-picks lab lab-report

PROJECT_NAME := trade-hub

# ── Build & Run ───────────────────────────────────────────

build: ## Build the project for production
	npm run build

run: ## Run the dev server (http://localhost:3000)
	npm run dev

start: ## Start the production server (after build)
	npm start

# ── Quality ───────────────────────────────────────────────

test: ## Run unit tests (vitest)
	npm test

test-e2e: ## Run Playwright E2E tests (requires `npx playwright install chromium` once)
	npm run test:e2e

lint: ## Lint the codebase
	npm run lint

fmt: ## Format the codebase with Prettier
	npm run fmt

fmt-check: ## Verify formatting without writing changes
	npm run fmt:check

typecheck: ## Run TypeScript type checking
# Local binary, not `npx`: when node is off PATH (any non-interactive shell,
# make included), npx falls through to the Windows npm on /mnt/c and runs the
# wrong tsc, failing on the UNC path while the code is actually clean.
	@command -v node >/dev/null 2>&1 || (echo "node not found on PATH. Using nvm? Run from an interactive shell, or: source ~/.nvm/nvm.sh" && exit 1)
	@test -x ./node_modules/.bin/tsc || (echo "tsc not found. Run: make install" && exit 1)
	./node_modules/.bin/tsc --noEmit

# ── Deploy & Manage ───────────────────────────────────────
# Vercel CLI (jvincentdigital-projects/trade-hub). `.vercel/` holds the link.

deploy: ## Deploy to a target (usage: make deploy TARGET=prod|preview)
	@test -n "$(TARGET)" || (echo "Usage: make deploy TARGET=prod|preview" && exit 1)
ifeq ($(TARGET),prod)
	vercel deploy --prod --yes
else
	vercel deploy --yes
endif

logs: ## Tail logs for the latest deployment (usage: make logs [TARGET=prod])
	vercel logs $(if $(filter prod,$(TARGET)),--scope jvincentdigital-projects,) --follow

status: ## List recent deployments
	vercel ls

# ── Utilities ─────────────────────────────────────────────

docs: ## Serve docs locally (usage: make docs PORT=3000)
	@echo "Serving docs on http://localhost:$${PORT:-8000} ..."
	cd docs && python3 -m http.server $${PORT:-8000}

extract-strategies: ## Turn course transcripts into strategy rules via claude -p (usage: make extract-strategies [DIR=...])
	scripts/extract-strategies $(DIR)

race-tick: ## Strategy race: one live tick for every strategy's play account (state in ~/.local/share/trade-hub/race.json)
	npx tsx scripts/race-tick.ts

race-close-all: ## Strategy race: close every open trade by hand at the first 1-minute price at or after AT (usage: make race-close-all AT=2026-11-11T17:04:31Z [DRY=1])
	npx tsx scripts/race-close-all.ts --at $(AT) $(if $(DRY),--dry-run)

funded-reset: ## Funded tests: back up race.json, start both (v1 only, v1 + breakouts) fresh in all four sizes at this tick (Lab accounts untouched)
	npx tsx scripts/race-tick.ts --funded-reset

race-reset: ## Strategy race: back up race.json, start over at 2% risk per trade, first tick, push (usage: make race-reset [START=1000])
	scripts/race-reset $(START)

claude-picks: ## Claude's picks: brief, ask claude -p, open the trades that pass the checks (usage: make claude-picks [DRY=1] to only print)
	npx tsx scripts/claude-picks.ts $(if $(DRY),--dry-run,)

lab: ## Strategy lab: every bot, walk-forward on the history files, then the report (usage: make lab [OUT=dir]; docs/strategy-lab.md)
	npx tsx scripts/lab/run.ts $(if $(OUT),--out $(OUT),)
	npx tsx scripts/lab/report.ts $(if $(OUT),--dir $(OUT),)

lab-report: ## Strategy lab: rebuild REPORT.md and REPORT.html from results.json (usage: make lab-report [OUT=dir])
	npx tsx scripts/lab/report.ts $(if $(OUT),--dir $(OUT),)

# ── Help ──────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
