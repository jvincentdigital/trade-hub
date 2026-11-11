# John's London v1: freeze record

Written 2026-11-11 (AST), before any clean-year candle was read. SPEC.md section 5 item 3. Play money only.

From the commit that adds this file, every rule, setting and cost is fixed. The clean-year run (`scripts/lab/london-v1.ts --clean`) reads the json block below and refuses to start unless: the working tree is clean, nothing but this file changed since `codeCommit`, SPEC.md and the three data files match their hashes, `holdout-run/FROZEN.txt` is this file byte for byte, and the clean year has not been scored yet.

## 1. Code

- Code commit: `8ea8b1a` (adds the clean mode and its guard to the code of `fbcba32`).
- The 13 design runs were made at `fbcba32`. They were run again at `8ea8b1a`: all 13 trade lists have the same SHA-256 (design mode did not change).

## 2. Spec

- `SPEC.md` SHA-256 `4995791d4c1d2dc9cc3953a4b94dab10ff5e4d56855f5b5ac6062c8a9a9cb801`.

## 3. Picked settings (design year 2025-11-11 to 2026-11-10)

- v1: k = 2, b = 0.5. All 4 pairs eligible; top +24.1R, no other pair within 2R.
- v1-flip: ext = 0.272, g = 2.5. Top +6.6R; ext 0.702 g 2.5 (+6.4R) is within 2R with the same 151 rides, so the tie goes to ext = 0.272. Flip does not beat plain on the design year (its rides lost 14.4R).
- v1-NY: c = 15, w = on. **The design year did not qualify** (every max drawdown over 25%), so the defaults are used.
- Thirds: nothing is picked. Thirds does not beat all at once on the design year (+16.1R against +24.1R).

| Design run              | Trades | Total  | $10,000 became | Max drop | Trade list SHA-256 (first 16) |
| ----------------------- | ------ | ------ | -------------- | -------- | ----------------------------- |
| v1 k=2 b=0.5            | 121    | +24.1R | $15,508        | 13.7%    | `235d582d22978d5e`            |
| v1 k=2 b=1              | 101    | +15.2R | $13,127        | 18.2%    | `8987e3a4b222f6cb`            |
| v1 k=3 b=0.5            | 115    | +5.9R  | $10,858        | 23.7%    | `f01519b5d7ad12cc`            |
| v1 k=3 b=1              | 100    | +5.6R  | $10,870        | 21.6%    | `61fd2f4315828428`            |
| v1-flip ext=0.272 g=1.5 | 478    | -21.0R | $6,152         | 52.3%    | `3b09bbaeb7ac3bdb`            |
| v1-flip ext=0.272 g=2.5 | 266    | +6.6R  | $10,866        | 25.4%    | `a886460bbf494fa9`            |
| v1-flip ext=0.702 g=1.5 | 472    | -24.4R | $5,698         | 49.9%    | `3dbc1937f0411554`            |
| v1-flip ext=0.702 g=2.5 | 266    | +6.4R  | $10,794        | 26.7%    | `c5597727a9f374a3`            |
| v1-NY c=15 w=on         | 222    | -38.2R | $4,537         | 54.6%    | `0717ca81ac938fe7`            |
| v1-NY c=15 w=off        | 333    | -52.3R | $3,319         | 69.2%    | `048d3c1496351669`            |
| v1-NY c=5 w=on          | 234    | -36.7R | $4,622         | 53.8%    | `213f1e7edcb9351b`            |
| v1-NY c=5 w=off         | 329    | -35.1R | $4,646         | 57.9%    | `0be2b380b82063f3`            |
| v1 thirds               | 114    | +16.1R | $13,405        | 12.5%    | `68cb54095a286a02`            |

## 4. Design trade lists

Each run's trade list hash is `sha256(JSON.stringify(trades))` as written in `design-run/results.json` (`tradeListSha256`, full values in the json block). The files themselves:

- `design-run/results.json` SHA-256 `ff0a61ee342ffe82607ce388bdbbcaf84e6fdeda20cbb00f55b47f9a7b32172b`
- `design-run/results.md` SHA-256 `9c9ac3111217208796c492440715c3175392938ecc03c39f6e4d225e66da831a`

## 5. John's answers

Copied from `JOHN-ANSWERS.md` (SHA-256 `c19dd8d88602efa6769531949790da9e764e68c8e43d50141c32116f086149ae`), 2026-11-11:

> # John's answers before the freeze (2026-11-11, about 09:35 AST, in the Claude chat)
>
> Asked as toggles with the options from SPEC.md section 9. His picks, verbatim labels:
>
> 1. Where is 1? -> "Last white candle top": top of the last white (bullish) candle before the drop, as his written rule says (163.948 in the USD/JPY sell example). Same as v1 (A). No rule change.
> 2. Targets and stop -> "As written (Recommended)": half off at 0, rest at -0.272, stop past 1 with room. Same as v1 (A). No rule change.
> 3. (asked together with 2) The stop -> as written (A). No rule change.
> 4. Hours -> "London to 11 AM (Recommended)": entries from the London open until 11:00 AM AST (15:00 London), through New York. Same as v1 (A). No rule change.
> 5. The flip -> "Earlier, on the pullback": B. "Ride the wave" means trading the pullback itself, before the Fib entry, then entering the Fib at the better price. This CHANGES v1-flip: the stop-and-reverse version in SPEC.md section 3 is not his idea. Section 3 must be rewritten as the pullback-ride version and its design runs redone before the freeze.
>
> Not asked yet (can wait): 5 "rising sun", 6 EUR/GBP 1-hour test, 8 broker.
>
> ## Follow-up, about 09:55 AST (John, in the chat)
>
> John: "So usually when I see like this big movement, that's when I like decide to ride the wave." Asked to choose (sell example: big drop from 1 to 0, then the climb back up to 0.786 where the Fib sell is), he picked **"Ride the big drop itself": sell while the big move is happening (momentum), then sell again at 0.786 on the pullback as the better position.**
>
> So question 4 is answered: the flip is a MOMENTUM trade WITH the impulse while it is still moving, followed by the normal v1 Fib entry at 0.786 in the same direction. It is not stop-and-reverse, and it is not a trade on the pullback. (The earlier toggle "Earlier, on the pullback" is replaced by this answer.)
>
> Also from John (race rules, not v1 rules): GBP pairs mostly move together, and GBP/USD moves like gold against the dollar. Chosen rule: "One bet per account": inside each account GBP/USD, GBP/JPY, EUR/GBP and gold count as one pound/dollar bet (never opposite sides, at most 2 the same way). v1 must treat GBP/USD and gold as one dollar bet the same way. No new crypto trades except Bitcoin.

## 6. Data gate (manifest only, no candle opened)

`~/jvd-outputs/trading/history-1m-24mo/manifest.json`, generated 2026-11-11 13:08 UTC; the download had ended (`DONE-GBPUSD-XAUUSD`).

| Check                      | GBP/USD                                                        | Gold                                                 |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| 1 Nothing left to download | `problems` empty: pass                                         | `problems` empty: pass                               |
| 2 Whole year               | 2024-11-11 00:00 to 2026-11-10 23:59: pass                     | 2024-11-11 00:00 to 2026-11-10 23:59: pass           |
| 3 At least 95% of days     | 626 non-Saturday days, 626 with 1m, 0 missing (limit 13): pass | 626, 624 with 1m, 2 missing: pass                    |
| 4 No long hole             | gaps of 300+ minutes only on Dec 25 and Dec 31: pass           | gaps of 300+ minutes only on Dec 24 and Dec 31: pass |

Gate: **pass**.

Clean files (size, SHA-256): GBP/USD 1m 9,823,169 bytes `82a58a7b...9b92c13`; gold 1m 12,492,910 bytes `c61130bc...aa836ee5`. The news list `news-high-impact.csv` was copied unchanged from `~/jvd-outputs/trading/history` (30,889 bytes, `ed7bdb0a...e27986289`); it covers 2024-11-01 to 2026-11-10 with the real release dates.

## 7. Second scoring after bug fixes (2026-11-11, evening)

The clean year was scored once already, from `71babf6` (code `8ea8b1a`, SPEC.md `4995791d...a9cb801`), results in `holdout-run/`. A skeptic review then found one bug, in how the results were written up, not in the trades:

- The write-up showed the design year as evidence ("made money on both years", 218 trades and +51.7R for both years together). The design year chose the settings, so only the clean year counts. Fix: code `bba1e49` prints which year counts on every report and labels a second clean scoring "seen twice". SPEC.md section 4 got a note (no rule, setting, cost or pass line changed), so its hash is new. The frozen copy is `SPEC-frozen-4995791d.md`.

What this record changes, by section 5's bug rule:

- Code commit `bba1e49`. The 13 design runs were run again there into `design-run-fixed/`: all 13 trade lists have the same SHA-256 as in section 3, and the pick rule gives the same settings (k = 2, b = 0.5; ext = 0.272, g = 2.5; c = 15, w = on, the design year did not qualify). No clean-year result was used to choose anything.
- The settings are unchanged. The json block now lists the first clean scoring under `cleanYearScoredBefore`, so the next clean run is labelled "seen twice". It can take a pass away. It can never turn a fail or a no verdict into a pass.
- The second clean run goes to `holdout-run-fixed/`, with this file copied there as `FROZEN.txt`.

## Machine-readable record

```json
{
  "codeCommit": "bba1e49971ec7aac3cbc01c626a760408203788f",
  "designRunsMadeAt": "fbcba329737de58866fefa1cb4706e4d746c9f75",
  "designRunsReproducedAt": "bba1e49971ec7aac3cbc01c626a760408203788f",
  "spec": {
    "path": "/Users/jvdos/jvd-outputs/2026-11-11/london-strategy/SPEC.md",
    "sha256": "83de6ea21d8b4123e12e616a3f1bceec923404007065a733f74d8f4368616746"
  },
  "files": {
    "/Users/jvdos/jvd-outputs/trading/history-1m-24mo/GBPUSD/GBPUSD_1m.csv.gz": {
      "size": 9823169,
      "sha256": "82a58a7b63e10f7e82612f827c3b0cdaee04d89ac83460be06803f2cc9b92c13"
    },
    "/Users/jvdos/jvd-outputs/trading/history-1m-24mo/XAUUSD/XAUUSD_1m.csv.gz": {
      "size": 12492910,
      "sha256": "c61130bc7ed0f1d350da2b4fb4482d176c8829b30b1786c34188f644aa836ee5"
    },
    "/Users/jvdos/jvd-outputs/trading/history-1m-24mo/news-high-impact.csv": {
      "size": 30889,
      "sha256": "ed7bdb0affb2b98ad9748e736783a2b0c0cac6d38e682ed787a730fe27986289"
    }
  },
  "settings": {
    "k": 2,
    "b": 0.5,
    "ext": 0.272,
    "g": 2.5,
    "c": 15,
    "w": true
  },
  "designYearQualified": {
    "v1": true,
    "ny": false
  },
  "window": {
    "from": "2024-11-11",
    "to": "2025-11-10"
  },
  "designFiles": {
    "/Users/jvdos/jvd-outputs/2026-11-11/london-strategy/design-run-fixed/results.json": "f5eec3361a5365d7e17fc26f40e0e2e60c7994a8ae48d8fcd4f423857b984c25",
    "/Users/jvdos/jvd-outputs/2026-11-11/london-strategy/design-run-fixed/results.md": "921cdf89cc3b4f4b7752b9b06cc88e1bc6b3dbe404d07b5858dbee2626469235"
  },
  "designRuns": [
    {
      "name": "v1 k=2 b=0.5",
      "trades": 121,
      "totalR": 24.1123,
      "endBalance": 15508.33,
      "maxDrawdown": 0.13686,
      "tradeListSha256": "235d582d22978d5ef42c1690ac9c86a34c14576b8862c107b3dd0e53efea7828"
    },
    {
      "name": "v1 k=2 b=1",
      "trades": 101,
      "totalR": 15.1687,
      "endBalance": 13126.54,
      "maxDrawdown": 0.1821,
      "tradeListSha256": "8987e3a4b222f6cbbdef3174228b6b91a3a7f8e37926891278d623a76588416e"
    },
    {
      "name": "v1 k=3 b=0.5",
      "trades": 115,
      "totalR": 5.9156,
      "endBalance": 10857.85,
      "maxDrawdown": 0.23698,
      "tradeListSha256": "f01519b5d7ad12cc939e0756e96f25db21807a75c3a16a5d0ee16203a2a66b17"
    },
    {
      "name": "v1 k=3 b=1",
      "trades": 100,
      "totalR": 5.6104,
      "endBalance": 10869.88,
      "maxDrawdown": 0.21565,
      "tradeListSha256": "61fd2f4315828428b46ba0b6701c9750307f774e21158d02e36ececa1e1eddc0"
    },
    {
      "name": "v1-flip ext=0.272 g=1.5",
      "trades": 478,
      "totalR": -21.0352,
      "endBalance": 6151.87,
      "maxDrawdown": 0.5231,
      "tradeListSha256": "3b09bbaeb7ac3bdbeaf058c08d1a6dc12f5063ebeca01f903911668791a0d390"
    },
    {
      "name": "v1-flip ext=0.272 g=2.5",
      "trades": 266,
      "totalR": 6.6122,
      "endBalance": 10866.31,
      "maxDrawdown": 0.25431,
      "tradeListSha256": "a886460bbf494fa96b3d8d24624f97a16153489755c547d50c4bc7c29864c0c6"
    },
    {
      "name": "v1-flip ext=0.702 g=1.5",
      "trades": 472,
      "totalR": -24.4155,
      "endBalance": 5698.48,
      "maxDrawdown": 0.49907,
      "tradeListSha256": "3dbc1937f04115546bdf83c5daf39ec9518b41359bf99eeef59fbf3269283c0b"
    },
    {
      "name": "v1-flip ext=0.702 g=2.5",
      "trades": 266,
      "totalR": 6.4118,
      "endBalance": 10794.49,
      "maxDrawdown": 0.26735,
      "tradeListSha256": "c5597727a9f374a3ebb6847c451a3d1449de1ca336fe3fd0e5004a591731ba26"
    },
    {
      "name": "v1-NY c=15 w=on",
      "trades": 222,
      "totalR": -38.1565,
      "endBalance": 4537.4,
      "maxDrawdown": 0.54626,
      "tradeListSha256": "0717ca81ac938fe781bc18f266aee22103b6315c767ec7845317a1d60463bc90"
    },
    {
      "name": "v1-NY c=15 w=off",
      "trades": 333,
      "totalR": -52.3165,
      "endBalance": 3318.66,
      "maxDrawdown": 0.69156,
      "tradeListSha256": "048d3c14963516697448e386207dc8b2adbbc7919c92199c2ab6b995cca65cb6"
    },
    {
      "name": "v1-NY c=5 w=on",
      "trades": 234,
      "totalR": -36.7032,
      "endBalance": 4622.12,
      "maxDrawdown": 0.53779,
      "tradeListSha256": "213f1e7edcb9351bdf1f6fa36a3fcb5d0e07c76851ed45fff3e715c0bbd07e58"
    },
    {
      "name": "v1-NY c=5 w=off",
      "trades": 329,
      "totalR": -35.0838,
      "endBalance": 4646.04,
      "maxDrawdown": 0.57894,
      "tradeListSha256": "0be2b380b82063f3480bddf9b43d46ef72df7df078717d52bd9f4364d0ad2ea8"
    },
    {
      "name": "v1 thirds",
      "trades": 114,
      "totalR": 16.0874,
      "endBalance": 13404.76,
      "maxDrawdown": 0.12517,
      "tradeListSha256": "68cb54095a286a02a1cf2032ddc307d6b69fa45f0b8802bb809ec47f64e36bdf"
    }
  ],
  "johnAnswersSha256": "c19dd8d88602efa6769531949790da9e764e68c8e43d50141c32116f086149ae",
  "dataGate": {
    "manifest": "/Users/jvdos/jvd-outputs/trading/history-1m-24mo/manifest.json",
    "manifestGenerated": "2026-11-11 13:08",
    "doneMarker": "DONE-GBPUSD-XAUUSD",
    "GBPUSD": {
      "problems": [],
      "coverage1m": [
        "2024-11-11 00:00",
        "2026-11-10 23:59",
        742614
      ],
      "daysWith1m": 626,
      "nonSaturdayDays": 626,
      "missingDays": 0,
      "gapsOver300min": [
        "1441 from 2025-12-31 21:58 (Dec 31, does not count)",
        "1441 from 2024-12-31 21:59 (Dec 31, does not count)",
        "884 from 2024-12-25 07:18 (Dec 25, does not count)",
        "854 from 2025-12-25 07:49 (Dec 25, does not count)"
      ],
      "checks": [
        true,
        true,
        true,
        true
      ]
    },
    "XAUUSD": {
      "problems": [],
      "coverage1m": [
        "2024-11-11 00:00",
        "2026-11-10 23:59",
        708854
      ],
      "daysWith1m": 624,
      "nonSaturdayDays": 626,
      "missingDays": 2,
      "gapsOver300min": [
        "1700 from 2025-12-24 18:43 (Dec 24, does not count)",
        "1696 from 2024-12-24 18:43 (Dec 24, does not count)",
        "1501 from 2025-12-31 21:58 (Dec 31, does not count)",
        "1501 from 2024-12-31 21:58 (Dec 31, does not count)"
      ],
      "checks": [
        true,
        true,
        true,
        true
      ]
    },
    "result": "pass"
  },
  "cleanYearScoredBefore": [
    "/Users/jvdos/jvd-outputs/2026-11-11/london-strategy/holdout-run/results.json"
  ]
}
```
