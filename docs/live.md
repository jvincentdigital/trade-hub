# Going live (passcode, race relay, deploy)

Set up 2026-11-10 night. Status: **preview only**. Production needs John's yes
(merge PR #1, then deploy). Everything here is $0: Vercel is the team's
existing plan (keep usage tiny: no crons, no image optimization, no analytics
add-ons), Cloudflare is the free plan (it stops at its limits, it never bills).

## Passcode lock

Same approach as Idea OS.

- `src/proxy.ts` runs on every request except `/unlock`, `/_next/*`,
  `/_vercel/*`, `/favicon.ico`, `/manifest.webmanifest` and the four icon
  files by exact name (`/icon-192.png`, `/icon-512.png`,
  `/icon-maskable-512.png`, `/apple-icon.png`; phones fetch those without the
  cookie). A new public file has to be added there by name; a prefix would
  also open any page that starts with it. Without the cookie, pages redirect
  to `/unlock` and `/api/*` answers 401 JSON.
- `/unlock` (`src/app/unlock/`) takes the passcode once per device and sets an
  httpOnly cookie `trade_hub` holding a SHA-256 hash of it (never the
  passcode), for a year. A wrong passcode waits 1.5 s. With a valid cookie,
  `/unlock` sends you straight to `/`.
- Env `TRADE_HUB_PASSCODE`. Not set (local dev) = no lock.
- The passcode lives only in Vercel (sensitive) and in
  `~/.local/share/trade-hub/passcode.env` on the Mac Mini (chmod 600). Read it
  there to give it to John. Never paste it in chat, docs or git.
- Change it: new value with `vercel env add TRADE_HUB_PASSCODE preview|production --sensitive --force`
  (value on stdin), update `passcode.env`, redeploy. Every device has to type the new one.

## Home-screen app

Added 2026-11-10. Trade Hub installs like an app: iPhone Safari, Share, Add to
Home Screen; Android Chrome, menu, Install app (or Add to Home screen).

- `src/app/manifest.ts`: name, `display: standalone`, `start_url: /`, colors
  `#0a0a0a` (`--bg-primary`), icons 192, 512 and a maskable 512.
- Icons: three rising indigo candles on near-black. `public/icon-*.png`,
  `src/app/apple-icon.png` (180, iPhone) and `src/app/favicon.ico` all come
  from `node scripts/make-icons.mjs` (draws one SVG with the installed Chrome
  through Playwright; edit the SVG there and rerun, then commit the files).
- iPhone: `appleWebApp` in `layout.tsx` (status bar `black-translucent`, so
  the page runs under the clock) and `viewport-fit=cover`. The translucent bar
  has no background of its own, so `body::before` in `globals.css` paints a
  strip of page color as tall as the top inset; scrolled content passes under
  it, not under the clock. Safe-area padding (`env(safe-area-inset-*)`) in
  `globals.css` (`.main-content`, sticky `.today-side`), `Sidebar.tsx` and the
  bottom sheets (`HowSheet.tsx`, `RuleEditor.tsx`) keeps content clear of the
  status bar, notch and home bar. A new fixed or sticky element near an edge
  needs the same.
- Landscape on a phone is wider than 768 px, so it shows the sidebar, which
  is taller than the screen there: the sidebar scrolls (`100dvh`,
  `overflow-y: auto`).
- It needs a connection: there is no service worker or offline page. Offline,
  changing tabs shows the browser's own error page, and the installed iPhone
  app has no Reload button, so close it and open it again once back online.
- The installed app has its own cookie jar on iPhone (separate from Safari),
  so the passcode is typed once inside the app; the cookie is server-set and
  lasts a year, so it stays unlocked on reopen.
- Check on a computer: puppeteer at 390x844 with the CDP call
  `Emulation.setSafeAreaInsetsOverride` (`top: 59, bottom: 34`) shows the
  insets the way an iPhone does.

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
- Usage: one KV write per race check (about 70 a day with the 15-minute
  session checks) plus one per Close now tap and one per booked batch (free
  limit 1,000), reads at most two a minute per server instance (free limit
  100,000).

### Close now requests (2026-11-11)

Today has a **Close now** button on each funded test trade. The live site can't
touch `race.json` (the Mac's race check is its only writer), so:

```
Today: Close now ─> Yes ─> POST /api/race/close ─(read key)─> worker POST /close-requests (KV "close-requests")
Mac race check ─(write key)─> GET /close-requests ─> books each one ─> saves, pushes ─> DELETE /close-requests {ids}
```

- `POST /api/race/close` (`src/app/api/race/close/route.ts`) takes
  `{ "id": "<account>|<market>|<entry time>" }` (`funded|GBP-USD|1794406500`;
  `funded-50k` and so on for the other v1 only sizes, `funded-b-10k` and so
  on for v1 + breakouts; or a Lab strategy id instead of `funded`). It checks the passcode cookie
  itself too (`unlocked` in `src/lib/lock.ts`, the same check `src/proxy.ts`
  uses), takes JSON only (with the SameSite=Lax cookie, a cross-site form
  can't send it), and refuses a trade that is not open (404).
- Worker `/close-requests`: GET (either key) returns every pending request
  `{ id: { id, at } }`; POST (either key; the site only has the read key)
  stores one with the worker's own time, and a second tap on the same trade
  keeps the first time; DELETE (write key only) removes the ids the Mac
  booked. At most 50 pending. One KV key holds them all, so reads stay plain
  GETs (KV list calls have a 1,000 a day limit). Two writes at the same
  second could lose one (KV has no transactions): a lost tap shows as not
  requested, so tap again; a lost delete is dropped at the next check.
- `/api/race` returns `closeRequests` with the state (read with no cache), so
  the row shows "Close requested, books at the next check" until it is booked.
  An old worker without the endpoint answers 404, read as no requests.
- The race check (`scripts/race-tick.ts`, logic in
  `src/lib/race/closeRequests.ts`) books requests first, in tap order: each
  closes at the open of the first Kraken 1-minute candle at or after the tap,
  both fees, reason `manual` ("closed by you"). If the trade's stop or target
  was touched between the last check and the tap (1-minute candles), that
  close wins instead. USD/JPY and NZD/USD close at the race's own price,
  GBP/JPY at GBP/USD times the race's USD/JPY leg (the same fallback as
  `make race-close-all`). A trade that is no longer open (its stop, target or
  the 12:45 close came first) drops its request. A request whose minute is
  not printed yet, or whose 1-minute fetch failed, waits for the next check.
  Requests are cleared after the save and push.
- Locally (no `RACE_URL`), the site and the tick use
  `close-requests.json` next to the race file (`RACE_CLOSE_FILE` overrides).
  A tick run with `RACE_FILE` set never talks to the worker for requests, so
  a test run can't book or clear real taps.

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
- **Turn Close now off:** redeploy the previous `worker.js` (no
  `/close-requests`): taps then answer "Could not send the close", and the race
  check reads no requests.
- **Stop the hourly race itself:** see `docs/strategy-race.md` (launchd bootout).
