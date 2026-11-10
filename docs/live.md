# Going live (passcode, race relay, deploy)

Set up 2026-11-10 night. Status: **preview only**. Production needs John's yes
(merge PR #1, then deploy). Everything here is $0: Vercel is the team's
existing plan (keep usage tiny: no crons, no image optimization, no analytics
add-ons), Cloudflare is the free plan (it stops at its limits, it never bills).

## Passcode lock

Same approach as Idea OS.

- `src/proxy.ts` runs on every request except `/unlock`, `/_next/*`,
  `/_vercel/*` and `/favicon.ico`. Without the cookie, pages redirect to
  `/unlock` and `/api/*` answers 401 JSON.
- `/unlock` (`src/app/unlock/`) takes the passcode once per device and sets an
  httpOnly cookie `trade_hub` holding a SHA-256 hash of it (never the
  passcode), for a year. A wrong passcode waits 1.5 s.
- Env `TRADE_HUB_PASSCODE`. Not set (local dev) = no lock.
- The passcode lives only in Vercel (sensitive) and in
  `~/.local/share/trade-hub/passcode.env` on the Mac Mini (chmod 600). Read it
  there to give it to John. Never paste it in chat, docs or git.
- Change it: new value with `vercel env add TRADE_HUB_PASSCODE preview|production --sensitive --force`
  (value on stdin), update `passcode.env`, redeploy. Every device has to type the new one.

## Race relay (Cloudflare Worker + KV)

The live site can't read the Mac's `race.json`, so:

```
Mac Mini hourly tick ──PUT (write key)──> trade-hub-race worker (KV "RACE") <──GET (read key)── Vercel /api/race
```

- Worker: `race-worker/` (`worker.js`, `wrangler.toml`), deployed as
  `trade-hub-race` at `https://trade-hub-race.jvd-tools.workers.dev/race`.
  KV namespace `RACE`, one key `state`. Secrets `WRITE_KEY` (Mac) and
  `READ_KEY` (Vercel). GET needs either key, PUT needs the write key, max 1 MB,
  must look like a race state. No key = 401.
- `scripts/race-tick.ts` PUTs the state after each tick when
  `~/.local/share/trade-hub/race.env` exists (`RACE_PUT_URL`, `RACE_WRITE_KEY`,
  chmod 600). A failed push logs one line; the tick still counts.
  `npx tsx scripts/race-tick.ts --push-only` sends the saved state without a tick.
- `/api/race` reads the worker when `RACE_URL` and `RACE_KEY` are set (Vercel,
  cached 60 s), else the local file. The read key is also in
  `~/.local/share/trade-hub/race-read.env` (chmod 600).
- Usage: 24 KV writes a day (free limit 1,000), reads at most one a minute per
  server instance (free limit 100,000).

Always run wrangler from inside the worker folder, never from `~`:

```bash
cd ~/dev/trade-hub/race-worker
npx -y wrangler@4.160.0 deploy                      # after editing worker.js
printf '%s' "$NEW" | npx -y wrangler@4.160.0 secret put WRITE_KEY   # rotate a key (then update race.env)
npx -y wrangler@4.160.0 tail                        # live logs
```

## Vercel

Project `jvincentdigital-projects/trade-hub` (existed since 2026-04, Git
connected, so every push to a branch builds a preview). Linked locally with
`vercel link --yes --project trade-hub` (`.vercel/` is gitignored).

Env vars, Preview and Production: `TRADE_HUB_PASSCODE` (sensitive),
`RACE_KEY` (sensitive), `RACE_URL`. Set by piping the value on stdin:

```bash
printf '%s' "$VALUE" | vercel env add NAME preview --sensitive --force
```

Previews also sit behind Vercel's own login (Deployment Protection), so from
the CLI check them with `vercel curl`:

```bash
vercel curl /unlock --deployment <preview-url>          # 200, the passcode form
vercel curl / --deployment <preview-url> -- -I          # 307 to /unlock
vercel curl /api/race --deployment <preview-url>        # 401 without the cookie
vercel curl /api/race --deployment <preview-url> -- -H "cookie: trade_hub=<hash>"   # 200 with the state
```

## Deploy to production (only on John's yes)

1. Merge PR #1 into `main`.
2. Production builds from `main` through the Git connection (or `make deploy TARGET=prod`).
3. Open the production URL on the phone, type the passcode once.
4. Optional: a custom domain later (DNS change, ask first).

## Pause or turn off

- **Hide the site:** `vercel env rm TRADE_HUB_PASSCODE production` would OPEN
  it, so don't. To take it down, roll back or remove the deployment in Vercel,
  or pause the project in the Vercel dashboard.
- **Stop the race feed to the site:** `chmod 000` or delete
  `~/.local/share/trade-hub/race.env`; the tick keeps running locally.
- **Stop the worker:** `cd ~/dev/trade-hub/race-worker && npx -y wrangler@4.160.0 delete`
  (the site then shows the race as unavailable).
- **Stop the hourly race itself:** see `docs/strategy-race.md` (launchd bootout).
