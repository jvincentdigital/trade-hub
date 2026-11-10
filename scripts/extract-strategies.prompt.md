# Extract trading rules from the course transcripts

You are working in the Trade Hub repo (read CLAUDE.md and AGENTS.md first).
The transcripts folder given below has one `.txt` per course video
(Market Maker / Marvel FX Method, Spanish), with `[mm:ss]` timestamps.

Goal: turn what the course teaches into rules Trade Hub can test, and a short
doc John can read. Write everything **in our own words**. Never paste course
text; short phrases of 5 words or fewer inside a source note are the limit.

1. Read every transcript. Take notes per topic: levels (how they are drawn),
   peak formations (first/second/third peak, M/W), EMA use (which periods,
   what they mean), entries after news, price action, sessions and time of
   day, stop and target placement, risk per trade. Note the video and
   timestamp for every point.
2. Update `docs/strategies/marvel-fx-method.md`: one section per topic,
   plain English (Spanish terms in parentheses where useful), each point
   ending with its source like `(Niveles MFXM @ 12:30)`. End with a section
   "What Trade Hub can and cannot test" (free data is daily-only for forex
   and 1h/4h/1d for crypto; no tick data; no news calendar).
3. Update `src/lib/rules/marvel.ts`: export `MARVEL_RULES: Rule[]` built
   only from the condition kinds in `src/lib/rules/schema.ts` (trend,
   emaStack, rsi, formation, emaTouch, pattern, nearLevel), with `sources`
   pointing at videos + timestamps and `builtIn: true`. If the course needs
   a condition we do not have (e.g. Asian-session range, ADR), describe it
   in the doc under "Conditions to add" instead of faking it.
4. Run `make test`, `make typecheck` and `npm run lint`; fix what you broke.
5. Do not commit, push, deploy, or touch anything outside this repo.

Finish with a 5-line summary of what you extracted and what is missing.
