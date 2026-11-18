#!/usr/bin/env python3
"""Independent audit of the levels study trades, written from docs/levels-study.md alone.

Takes a seeded sample of trades from the runner's trades.csv.gz (and of
visits without a trade from visits.jsonl.gz), keeps only what identifies the
trade and its visit (market, kind, what, known_from, side, touch minute, near
and far edge, ATR at the touch), and re-works everything else from the
1-minute development copy: visit end, fill, entry, stop, target, R, cost,
skip, exit and the three results. Every difference from the engine is printed.

Run:  python3 -I scripts/lab/levels_audit.py --trades <trades.csv.gz> --visits <visits.jsonl.gz>
Only the development copies (ending 2018-12-31) are read.
"""
import argparse
import bisect
import collections
import csv
import gzip
import json
import random
import sys
from array import array

DATA = "/Users/jvdos/.local/share/trade-hub/harmonic-dev"
TOL = 1e-9
LAST_ALLOWED = 1546300800  # 2019-01-01 UTC: nothing at or after this may be read

SPREAD_PIPS = {"EURUSD": 0.8, "GBPUSD": 1.0, "EURGBP": 1.0, "USDJPY": 0.9, "EURJPY": 1.3, "GBPJPY": 2.0}
MARKETS = ["EURUSD", "GBPUSD", "EURGBP", "EURJPY", "USDJPY", "GBPJPY", "XAUUSD"]


def pip_size(m):
    if m == "XAUUSD":
        return 0.10
    return 0.01 if m.endswith("JPY") else 0.0001


def ge(a, b):  # a at or above b, tolerance 1e-9
    return a >= b - TOL


def le(a, b):
    return a <= b + TOL


class Bars:
    def __init__(self, market):
        self.market = market
        self.T = array("q")
        self.O = array("d")
        self.H = array("d")
        self.L = array("d")
        self.C = array("d")
        with gzip.open("%s/%s_1m.csv.gz" % (DATA, market), "rt") as f:
            f.readline()
            for line in f:
                p = line.split(",")
                t = int(p[0])
                if t >= LAST_ALLOWED:
                    raise SystemExit("refusing: data at or after 2019 in " + market)
                self.T.append(t)
                self.O.append(float(p[1]))
                self.H.append(float(p[2]))
                self.L.append(float(p[3]))
                self.C.append(float(p[4]))
        self.n = len(self.T)
        for i in range(1, self.n):
            if self.T[i] <= self.T[i - 1]:
                raise SystemExit("bars not strictly increasing in %s at %d" % (market, i))

    def idx(self, t):
        i = bisect.bisect_left(self.T, t)
        return i if i < self.n and self.T[i] == t else None


def spread_for(market, x):
    if market == "XAUUSD":
        return 0.28 * x / 1800.0
    return SPREAD_PIPS[market] * pip_size(market)


def visit_end(b, i0, side, near, far, g):
    """First later minute that turns or breaks the visit (a minute that does both is a break)."""
    T, H, L = b.T, b.H, b.L
    for j in range(i0 + 1, b.n):
        if side == "below":
            brk = ge(H[j], far + g)
            turn = le(L[j], near - g)
        else:
            brk = le(L[j], far - g)
            turn = ge(H[j], near + g)
        if brk:
            return j, "break"
        if turn:
            return j, "turn"
    return None, "open"


def run_exit(b, jf, d, entry, stop, R, spread, dist, hours, entry_fills, market):
    """Walk a filled trade to its exit. d = +1 buy, -1 sell. Returns a dict."""
    T, O, H, L, C = b.T, b.O, b.H, b.L, b.C
    sell = d < 0
    target = entry + d * dist
    deadline = T[jf] + hours * 3600
    how = None
    price = None
    jx = None
    for j in range(jf, b.n):
        if j > jf and T[j] >= deadline:
            how, jx = "time", j
            price = O[j] + spread if sell else O[j]
            break
        # stop first (and only the stop in the fill minute)
        if sell:
            if ge(H[j] + spread, stop):
                price = O[j] + spread if O[j] + spread > stop else stop
                how, jx = "stop", j
                break
            if j > jf and le(L[j] + spread, target):
                price, how, jx = target, "target", j
                break
        else:
            if le(L[j], stop):
                price = O[j] if O[j] < stop else stop
                how, jx = "stop", j
                break
            if j > jf and ge(H[j], target):
                price, how, jx = target, "target", j
                break
    if how is None:
        jx = b.n - 1
        how = "end"
        price = C[jx] + spread if sell else C[jx]
    fills = entry_fills + (1 if how in ("stop", "time", "end") else 0)
    pz = pip_size(market)
    fee = 0.07 if market == "XAUUSD" else 0.0
    rt = spread + fee
    fillcost = fills * 0.2 * pz
    gross = d * (price - entry)
    after = (gross - fillcost - fee) / R
    before = after + (rt + fillcost) / R
    double = after - (rt + fillcost) / R
    return {
        "how": how, "exit_t": T[jx], "exit_price": price, "fills": fills, "fill_cost": fillcost,
        "r_after": after, "r_before": before, "r_double": double,
        "pips_after": after * R / pz, "pips_before": before * R / pz, "target": target, "jx": jx,
    }


def make_trade(b, name, side, i0, jend, touch, near, far, atr):
    """Returns (status, info) where info holds the common fields; exits are added by the caller."""
    market = b.market
    T, O, H, L, C = b.T, b.O, b.H, b.L, b.C
    sell = side == "below" if name in ("T0", "T1") else side != "below"
    d = -1 if sell else 1
    pz = pip_size(market)
    half = 0.5 * pz
    if name == "T0":
        spread = spread_for(market, near)
        jf = None
        stop = far + 0.25 * atr if sell else far - 0.25 * atr
        top = jend if jend is not None else b.n - 1
        for j in range(i0, top + 1):
            if sell and ge(H[j], near + half):
                jf = j
                break
            if (not sell) and le(L[j] + spread, near - half):
                jf = j
                break
        if jf is None:
            return "no_fill", None
        entry = near
        entry_fills = 0
    elif name == "B0":
        P = far + 0.10 * atr if not sell else far - 0.10 * atr
        spread = spread_for(market, P)
        jf = None
        top = jend if jend is not None else b.n - 1
        for j in range(i0, top + 1):
            if T[j] >= touch + 86400:
                break
            if (not sell) and ge(H[j] + spread, P):
                jf, entry = j, max(P, O[j] + spread)
                break
            if sell and le(L[j], P):
                jf, entry = j, min(P, O[j])
                break
        if jf is None:
            return "no_fill", None
        stop = entry - 0.25 * atr if not sell else entry + 0.25 * atr
        entry_fills = 1
    else:  # T1
        cs = touch // 900 * 900
        count = 0
        trig = None
        while count < 8:
            lo = bisect.bisect_left(T, cs)
            hi = bisect.bisect_left(T, cs + 900)
            if hi == lo:  # no minute in this slot: not a candle
                if lo >= b.n:
                    break
                cs = T[lo] // 900 * 900
                continue
            count += 1
            if hi >= b.n:  # never closes
                break
            close = C[hi - 1]
            ok = le(close, near - 0.05 * atr) if sell else ge(close, near + 0.05 * atr)
            if ok:
                trig = hi
                break
            cs = T[hi] // 900 * 900
        if trig is None:
            return "no_trigger", None
        last = trig - 1
        if sell:
            if any(ge(H[j], far + 0.25 * atr) for j in range(i0, last + 1)):
                return "broke", None
        else:
            if any(le(L[j], far - 0.25 * atr) for j in range(i0, last + 1)):
                return "broke", None
        jf = trig
        op = O[jf]
        if sell and le(op, near - 0.25 * atr):
            return "skip_open", None
        if (not sell) and ge(op, near + 0.25 * atr):
            return "skip_open", None
        spread = spread_for(market, op)
        if sell:
            hi_ = max(far, max(H[j] for j in range(i0, last + 1)))
            stop = hi_ + 0.10 * atr
            entry = op
        else:
            lo_ = min(far, min(L[j] for j in range(i0, last + 1)))
            stop = lo_ - 0.10 * atr
            entry = op + spread
        entry_fills = 1
    R = abs(stop - entry)  # "R is the distance from the entry price to the stop" (Amendment 1, point 13)
    fee = 0.07 if market == "XAUUSD" else 0.0
    if R < 5 * (spread + fee) - TOL:  # a distance test: 'under' with the 1e-9 tolerance (R is exactly 5 costs in some cases)
        return "skip_r", None
    return "trade", {"jf": jf, "fill": T[jf], "entry": entry, "stop": stop, "R": R, "spread": spread,
                     "rt": spread + fee, "d": d, "entry_fills": entry_fills}


def audit_visit(b, v):
    """v: dict(market, side, touch, near, far, atr). Returns visit end and the three trades."""
    i0 = b.idx(v["touch"])
    if i0 is None:
        return None
    g = 0.25 * v["atr"]
    je, kind = visit_end(b, i0, v["side"], v["near"], v["far"], g)
    out = {"end": kind, "end_t": b.T[je] if je is not None else None, "trades": {}}
    for name in ("T0", "T1", "B0"):
        out["trades"][name] = make_trade(b, name, v["side"], i0, je, v["touch"], v["near"], v["far"], v["atr"])
    return out


NUM_FIELDS = [
    ("fill", 0), ("entry", 1e-9), ("stop", 1e-9), ("target", 1e-9), ("R", 1e-9), ("spread", 1e-9),
    ("round_trip_cost", 1e-9), ("market_fills", 0), ("fill_cost", 1e-9), ("exit_t", 0),
    ("exit_price", 1e-9), ("r_after", 1e-6), ("r_before", 1e-6), ("r_double", 1e-6),
    ("pips_after", 1e-6), ("pips_before", 1e-6),
]


def row_key(r):
    return (r["market"], r["kind"], r["what"], r["known_from"], r["side"], r["touch"], r["near"], r["far"], r["trade"])


def sample_trades(path, seed, k_kind=2, k_mkt=2, k_special=1):
    rng = random.Random(seed)
    strata = collections.defaultdict(list)  # stratum -> list of (rand, key, row)
    special = collections.defaultdict(list)

    def offer(bucket, k, rnd, key):
        bucket.append((rnd, key))
        bucket.sort()
        del bucket[k:]

    with gzip.open(path, "rt") as f:
        for r in csv.DictReader(f):
            rnd = rng.random()
            key = row_key(r)
            hours = 24 if r["exit"] == "quick" else 120
            offer(strata[("kind", r["trade"], r["dir"], r["kind"])], k_kind, rnd, key) if r["exit"] == "quick" else None
            offer(strata[("mkt", r["market"], r["trade"], r["dir"])], k_mkt, rnd, key) if r["exit"] == "quick" else None
            # hard cases, picked from the engine's own columns only to choose where to look
            if r["how"] == "end":
                offer(special["end"], 12 * k_special, rnd, key)
            if r["fill"] == r["touch"]:
                offer(special["fill_in_touch_minute"], 10 * k_special, rnd, key)
            if r["how"] == "stop" and abs(float(r["exit_price"]) - float(r["stop"])) > 1e-9:
                offer(special["stop_gap"], 12 * k_special, rnd, key)
            if r["how"] == "time" and r["fill"] and int(r["exit_t"]) - int(r["fill"]) - hours * 3600 > 7200:
                offer(special["time_over_gap"], 8 * k_special, rnd, key)
            if r["trade"] == "B0":
                P = float(r["far"]) + (0.1 if r["dir"] == "1" else -0.1) * float(r["atr"])
                if abs(float(r["entry"]) - P) > 1e-9:
                    offer(special["b0_gap_open"], 8 * k_special, rnd, key)
            tt = int(r["touch"])
            if r["trade"] == "T1" and (tt // 86400 + 3) % 7 == 4 and tt % 86400 >= 19 * 3600:
                offer(special["t1_friday_evening"], 30 * k_special, rnd, key)
            if r["trade"] == "T1" and r["fill"] and int(r["fill"]) - tt > 4 * 3600:
                offer(special["t1_long_wait"], 40 * k_special, rnd, key)
            if tt >= LAST_ALLOWED - 4 * 3600:
                offer(special["touch_in_last_4h"], 10 * k_special, rnd, key)
            if r["trade"] == "T1" and r["market"] == "XAUUSD":
                offer(special["t1_gold"], 6 * k_special, rnd, key)
            if r["how"] == "target" and r["fill"] and int(r["exit_t"]) - int(r["fill"]) <= 60:
                offer(special["quick_target"], 6 * k_special, rnd, key)
    picked = {}
    for s, lst in list(strata.items()) + list(special.items()):
        for rnd, key in lst:
            picked.setdefault(key, s)
    return picked


def load_rows(path, keys):
    rows = []
    with gzip.open(path, "rt") as f:
        for r in csv.DictReader(f):
            if row_key(r) in keys:
                rows.append(r)
    return rows


def sample_statuses(path, seed, k=15):
    """Visits whose trade was not taken (no fill, no trigger, broke, skipped), by trade and reason."""
    rng = random.Random(seed + 1)
    buckets = collections.defaultdict(list)
    with gzip.open(path, "rt") as f:
        for line in f:
            v = json.loads(line)
            if v["twin"] != "level":
                continue
            for t in v["trades"]:
                if t["status"] == "trade":
                    continue
                rnd = rng.random()
                tags = [((t["name"], t["status"]), k)]
                if t["name"] == "T1" and (v["touch"] // 86400 + 3) % 7 == 4 and v["touch"] % 86400 >= 19 * 3600:
                    tags.append((("T1friday", t["status"]), 20))
                if v["touch"] >= LAST_ALLOWED - 4 * 3600:
                    tags.append((("lastdata", t["name"] + t["status"]), 10))
                for tag, keep in tags:
                    bk = buckets[tag]
                    bk.append((rnd, v["market"], v["kind"], v["what"], v["knownFrom"], v["side"], v["touch"],
                               v["near"], v["far"], v["atr"], t["name"], t["status"], v["end"], v["endAt"]))
                    bk.sort()
                    del bk[keep:]
    out = {}
    for lst in buckets.values():
        for x in lst:
            out[(x[1], x[2], x[3], x[6], x[7], x[8], x[10])] = {
                "market": x[1], "kind": x[2], "what": x[3], "known_from": x[4], "side": x[5],
                "touch": x[6], "near": x[7], "far": x[8], "atr": x[9], "trade": x[10],
                "status": x[11], "visit_end": x[12], "visit_end_t": x[13]}
    return list(out.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trades", required=True)
    ap.add_argument("--visits", required=True)
    ap.add_argument("--seed", type=int, default=20261118)
    ap.add_argument("--max-lines", type=int, default=400)
    ap.add_argument("--k-kind", type=int, default=2)
    ap.add_argument("--k-mkt", type=int, default=2)
    ap.add_argument("--k-special", type=int, default=1)
    ap.add_argument("--k-status", type=int, default=15)
    a = ap.parse_args()

    keys = sample_trades(a.trades, a.seed, a.k_kind, a.k_mkt, a.k_special)
    rows = load_rows(a.trades, set(keys))
    status_sample = sample_statuses(a.visits, a.seed, a.k_status)
    print("sampled visit-trades: %d  rows (trade, exit): %d  no-trade visit-trades: %d"
          % (len(keys), len(rows), len(status_sample)))

    by_market = collections.defaultdict(list)
    for r in rows:
        by_market[r["market"]].append(("row", r))
    for s in status_sample:
        by_market[s["market"]].append(("status", s))

    diffs = []
    compared = collections.Counter()
    visit_checked = set()
    status_compared = collections.Counter()
    cache = {}
    for market in MARKETS:
        if market not in by_market:
            continue
        b = Bars(market)
        print("%s: %d bars loaded, %d items" % (market, b.n, len(by_market[market])), file=sys.stderr)
        for kind_, item in by_market[market]:
            v = {"market": market, "side": item["side"], "touch": int(item["touch"]),
                 "near": float(item["near"]), "far": float(item["far"]),
                 "atr": float(item["atr"])}
            ck = (market, v["side"], v["touch"], v["near"], v["far"], v["atr"])
            if ck not in cache:
                cache[ck] = audit_visit(b, v)
            res = cache[ck]
            ident = "%s %s %s kf=%s %s touch=%s near=%s far=%s atr=%s" % (
                market, item["kind"], item["what"], item["known_from"], item["side"], item["touch"],
                item["near"], item["far"], item["atr"])
            if res is None:
                diffs.append((ident, "touch minute not in data", None, None))
                continue
            if ck not in visit_checked:
                visit_checked.add(ck)
                e_end = item["visit_end"]
                e_t = item["visit_end_t"]
                e_t = int(e_t) if e_t not in ("", None) else None
                if e_end != res["end"] or e_t != res["end_t"]:
                    diffs.append((ident, "visit end", "mine %s@%s" % (res["end"], res["end_t"]),
                                  "engine %s@%s" % (e_end, e_t)))
            tr = res["trades"][item["trade"]]
            if kind_ == "status":
                status_compared[(item["trade"], item["status"])] += 1
                if tr[0] != item["status"]:
                    diffs.append((ident + " " + item["trade"], "status", tr[0], item["status"]))
                continue
            tag = (item["trade"], item["exit"], "sell" if item["dir"] == "-1" else "buy", item["kind"], market)
            compared[tag] += 1
            if tr[0] != "trade":
                diffs.append((ident + " %s %s" % (item["trade"], item["exit"]), "status", tr[0], "trade"))
                continue
            info = tr[1]
            quick = item["exit"] == "quick"
            dist = (0.25 if quick else 1.0) * v["atr"]
            ex = run_exit(b, info["jf"], info["d"], info["entry"], info["stop"], info["R"], info["spread"],
                          dist, 24 if quick else 120, info["entry_fills"], market)
            mine = dict(info)
            mine.update(ex)
            mine["round_trip_cost"] = info["rt"]
            mine["market_fills"] = ex["fills"]
            for name, tol in NUM_FIELDS:
                if name == "target":
                    mv = ex["target"]
                else:
                    mv = mine[name]
                ev = float(item[name])
                if abs(mv - ev) > tol:
                    diffs.append((ident + " %s %s" % (item["trade"], item["exit"]), name, mv, ev))
            if ex["how"] != item["how"]:
                diffs.append((ident + " %s %s" % (item["trade"], item["exit"]), "how", ex["how"], item["how"]))
        del b

    n_trade_rows = sum(compared.values())
    print("\nCOMPARED trade rows: %d  (no-trade visit decisions: %d)" % (n_trade_rows, sum(status_compared.values())))
    for label, idx in (("trade", 0), ("exit", 1), ("direction", 2), ("kind", 3), ("market", 4)):
        c = collections.Counter()
        for t, n in compared.items():
            c[t[idx]] += n
        print("  by %s: %s" % (label, dict(sorted(c.items()))))
    print("  no-trade decisions: %s" % dict(sorted(("%s/%s" % k, n) for k, n in status_compared.items())))
    print("\nDIFFERENCES: %d" % len(diffs))
    shown = collections.Counter()
    for ident, field, mv, ev in diffs:
        shown[field] += 1
        if sum(shown.values()) <= a.max_lines:
            print("  %s | %s | mine=%s engine=%s" % (ident, field, mv, ev))
    print("by field:", dict(shown))


if __name__ == "__main__":
    main()
