"""Second pattern finder for the harmonic study (docs/harmonic-study.md).

Written alone from the plan page: "Data", "Finding the pattern, with no knowledge of the
future" (swings, the four points, the patterns table, the confirming-candle rule, the wait)
and Amendment 3 points 1 to 3. No entries beyond the wait, no trades, no statistics.

  python3 -I harmonic_finder2.py <file.csv.gz> <MARKET> <chart minutes: 15|30> <swing size k: 2|3> <year> <out.csv>
  python3 -I harmonic_finder2.py --selftest

The swings run over the whole file from its first candle. The list holds every pattern that
qualifies by the ratios and whose confirming candle's CLOSE time (UTC) falls in <year>.
Standard library only.
"""
import calendar
import csv
import gzip
import os
import sys
import time
from array import array
from bisect import bisect_left

HEADER = "chart,k,pattern,dir,x_time,x,a_time,a,b_time,b,c_time,c,confirm_time,d,stop,outcome,outcome_time".split(",")
TOL = 1e-9
WAIT_CANDLES = 192
ATR_LEN = 14

# name, rB range, d, s, proj range  (plan table; the order is the table's order)
PATTERNS = [
    ("gartley", (0.568, 0.668), 0.786, 1.05, (1.27, 1.618)),
    ("bat", (0.382, 0.5), 0.886, 1.13, (1.618, 2.618)),
    ("butterfly", (0.736, 0.836), 1.27, 1.414, (1.618, 2.618)),
    ("crab", (0.382, 0.618), 1.618, 2.0, (2.24, 3.618)),
]
RC_RANGE = (0.382, 0.886)

# market -> (spread as a function of D, pen).  pen = 0.5 pip.
# Plan "Prices and costs": EUR/USD 0.00008, GBP/USD 0.00010, gold $0.28 x price / $1,800 (Amendment 1
# point 3: during the wait it is taken at D), pen for gold $0.05.  Amendment 2 point 1: USD/JPY 0.9 pip,
# EUR/GBP 1.0, EUR/JPY 1.3, GBP/JPY 2.0; a pip is 0.01 for the yen pairs, 0.0001 for EUR/GBP.
MARKETS = {
    "EURUSD": (lambda d: 0.00008, 0.00005),
    "GBPUSD": (lambda d: 0.00010, 0.00005),
    "XAUUSD": (lambda d: 0.28 * d / 1800.0, 0.05),
    "USDJPY": (lambda d: 0.009, 0.005),
    "EURGBP": (lambda d: 0.0001, 0.00005),
    "EURJPY": (lambda d: 0.013, 0.005),
    "GBPJPY": (lambda d: 0.02, 0.005),
}


class Chart:
    """1-minute columns plus the chart candles built from them on UTC clock boundaries.

    A chart candle exists if it has at least one 1-minute candle.  Bid prices throughout.
    """

    def __init__(self, sec):
        self.sec = sec
        self.mt = array("q")
        self.mh = array("d")
        self.ml = array("d")
        self.ct = array("q")  # chart candle open time (the clock boundary)
        self.ch = array("d")
        self.cl = array("d")
        self.cc = array("d")
        self._cur = -1
        self._bh = self._bl = self._bc = 0.0
        self._last = -1

    def add(self, t, o, h, l, c):
        if t <= self._last:
            raise ValueError("minute stamps are not increasing at %d" % t)
        self._last = t
        self.mt.append(t)
        self.mh.append(h)
        self.ml.append(l)
        b = t - t % self.sec
        if b != self._cur:
            self._flush()
            self._cur = b
            self._bh = h
            self._bl = l
        else:
            if h > self._bh:
                self._bh = h
            if l < self._bl:
                self._bl = l
        self._bc = c

    def _flush(self):
        if self._cur >= 0:
            self.ct.append(self._cur)
            self.ch.append(self._bh)
            self.cl.append(self._bl)
            self.cc.append(self._bc)

    def finish(self):
        self._flush()
        self._cur = -1
        return self


def load_file(path, chart_minutes):
    ch = Chart(chart_minutes * 60)
    with gzip.open(path, "rt") as f:
        head = f.readline().strip().split(",")
        if head[:5] != ["time", "open", "high", "low", "close"]:
            raise ValueError("unexpected header %r" % head)
        add = ch.add
        for line in f:
            p = line.split(",")
            if len(p) < 5:
                continue
            add(int(p[0]), float(p[1]), float(p[2]), float(p[3]), float(p[4]))
    return ch.finish()


def atr_series(ch, cl, cc):
    """ATR at candle i = mean of the true ranges of candles i-13..i (exists from i = 13).

    The first candle has no previous close: its true range is high minus low (Amendment 3 point 1).
    Entries before index 13 are 0.0 and must not be used.
    """
    n = len(ch)
    tr = array("d", [0.0]) * n
    atr = array("d", [0.0]) * n
    for i in range(n):
        if i == 0:
            tr[0] = ch[0] - cl[0]
        else:
            pc = cc[i - 1]
            hi = ch[i] if ch[i] > pc else pc
            lo = cl[i] if cl[i] < pc else pc
            tr[i] = hi - lo
        if i >= ATR_LEN - 1:
            s = 0.0
            for j in range(i - (ATR_LEN - 1), i + 1):
                s += tr[j]
            atr[i] = s / ATR_LEN
    return atr


def find_swings(ch, cl, cc, k):
    """Confirmed swings, in order of confirmation.

    Each swing is (is_high, idx, price, conf_idx, opp) where idx is the chart candle holding the
    extreme, conf_idx the candle at whose close it is confirmed, and opp the extreme of the opposite
    side over the candles after idx through conf_idx (the lowest low for a high, the highest high
    for a low): the candidate of the next swing at the moment of confirmation.
    """
    n = len(ch)
    atr = atr_series(ch, cl, cc)
    swings = []
    forming_high = True
    cidx = 0
    cprice = ch[0]
    for i in range(1, n):
        have_atr = i >= ATR_LEN - 1
        if forming_high:
            if ch[i] > cprice:
                cidx = i
                cprice = ch[i]
            elif have_atr and cl[i] <= cprice - k * atr[i]:
                oidx = cidx + 1
                oprice = cl[oidx]
                for j in range(cidx + 2, i + 1):
                    if cl[j] < oprice:
                        oprice = cl[j]
                        oidx = j
                swings.append((True, cidx, cprice, i, oprice))
                forming_high = False
                cidx = oidx
                cprice = oprice
        else:
            if cl[i] < cprice:
                cidx = i
                cprice = cl[i]
            elif have_atr and ch[i] >= cprice + k * atr[i]:
                oidx = cidx + 1
                oprice = ch[oidx]
                for j in range(cidx + 2, i + 1):
                    if ch[j] > oprice:
                        oprice = ch[j]
                        oidx = j
                swings.append((False, cidx, cprice, i, oprice))
                forming_high = True
                cidx = oidx
                cprice = oprice
    return swings


def _in(r, lo, hi):
    return lo - TOL <= r <= hi + TOL


def classify(x, a, b, c, is_buy):
    """Patterns whose ratios hold for the points X, A, B, C: list of (name, d, stop)."""
    if is_buy:
        xa = a - x
        ab = a - b
        if xa <= 0 or ab <= 0:
            return []
        rb = ab / xa
        rc = (c - b) / ab
        bc = c - b
    else:
        xa = x - a
        ab = b - a
        if xa <= 0 or ab <= 0:
            return []
        rb = ab / xa
        rc = (b - c) / ab
        bc = b - c
    if not _in(rc, *RC_RANGE) or bc <= 0:
        return []
    out = []
    for name, rb_range, dd, ss, proj_range in PATTERNS:
        if not _in(rb, *rb_range):
            continue
        if is_buy:
            d = a - dd * xa
            stop = a - ss * xa
            proj = (c - d) / bc
        else:
            d = a + dd * xa
            stop = a + ss * xa
            proj = (d - c) / bc
        if _in(proj, *proj_range):
            out.append((name, d, stop))
    return out


def run_wait(ch, is_buy, d, c, conf, next_conf, spread, pen):
    """What the wait did: (outcome, outcome_time or None).

    Minutes are tested from the first one stamped at or after the confirming candle's close, in
    time order, up to but not including the close of the cancelling chart candle.
    """
    sec = ch.sec
    ct = ch.ct
    n = len(ct)
    cancel_idx = None
    kind = None
    if next_conf is not None:
        cancel_idx = next_conf
        kind = "cancelled_swing"
    t192 = conf + WAIT_CANDLES
    if t192 < n and (cancel_idx is None or t192 < cancel_idx):
        cancel_idx = t192
        kind = "cancelled_time"
    mt, mh, ml = ch.mt, ch.mh, ch.ml
    start = bisect_left(mt, ct[conf] + sec)
    end = len(mt) if cancel_idx is None else bisect_left(mt, ct[cancel_idx] + sec)
    if is_buy:
        trigger = d - spread - pen
        for m in range(start, end):
            if mh[m] > c:
                return "cancelled_c", mt[m]
            if ml[m] <= trigger:
                return "completed", mt[m]
    else:
        trigger = d + pen
        for m in range(start, end):
            if ml[m] < c:
                return "cancelled_c", mt[m]
            if mh[m] >= trigger:
                return "completed", mt[m]
    if cancel_idx is None:
        return "waiting", None
    return kind, ct[cancel_idx] + sec


def find_patterns(ch, market, chart_minutes, k, year):
    spread_of, pen = MARKETS[market]
    sec = ch.sec
    ct = ch.ct
    swings = find_swings(ch.ch, ch.cl, ch.cc, k)
    y0 = calendar.timegm((year, 1, 1, 0, 0, 0))
    y1 = calendar.timegm((year + 1, 1, 1, 0, 0, 0))
    rows = []
    for s in range(3, len(swings)):
        sc = swings[s]
        conf = sc[3]
        close = ct[conf] + sec
        if not (y0 <= close < y1):
            continue
        is_buy = sc[0]
        sx, sa, sb = swings[s - 3], swings[s - 2], swings[s - 1]
        x, a, b, c = sx[2], sa[2], sb[2], sc[2]
        next_conf = swings[s + 1][3] if s + 1 < len(swings) else None
        for name, d, stop in classify(x, a, b, c, is_buy):
            if (is_buy and sc[4] <= d) or (not is_buy and sc[4] >= d):
                outcome, otime = "skipped", None
            else:
                outcome, otime = run_wait(ch, is_buy, d, c, conf, next_conf, spread_of(d), pen)
            rows.append({
                "chart": str(chart_minutes), "k": str(k), "pattern": name, "dir": "buy" if is_buy else "sell",
                "x_time": str(ct[sx[1]]), "x": "%.10f" % x,
                "a_time": str(ct[sa[1]]), "a": "%.10f" % a,
                "b_time": str(ct[sb[1]]), "b": "%.10f" % b,
                "c_time": str(ct[sc[1]]), "c": "%.10f" % c,
                "confirm_time": str(ct[conf]), "d": "%.10f" % d, "stop": "%.10f" % stop,
                "outcome": outcome, "outcome_time": "" if otime is None else str(otime),
            })
    rows.sort(key=lambda r: (int(r["confirm_time"]), r["pattern"], r["dir"]))
    return rows


def write_rows(rows, path):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=HEADER, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


# ---------------------------------------------------------------------------------------------
# Self test: hand-made series.  Every candle spans exactly one unit step of 10 price units
# (open = previous close, close = the next stair), so the true range is always 10 and the ATR is
# 10 from candle 13 on; with k = 2 a reversal of 20 price units confirms a swing.  The expected
# values below were worked out by hand from the plan (see the comments), not by running the code.
# ---------------------------------------------------------------------------------------------

T0 = 1420070400  # 2015-01-01 00:00 UTC, a multiple of 900
SEC = 900


def walk(turns, start=(118, 120)):
    """Heights in units of 10: path[j+1] is the close of candle j, path[j] its open."""
    path = list(start)
    for target in turns:
        step = 1 if target > path[-1] else -1
        while path[-1] != target:
            path.append(path[-1] + step)
    return path


def stairs(path, t0=T0):
    rows = []
    for j in range(len(path) - 1):
        o, c = path[j] * 10.0, path[j + 1] * 10.0
        rows.append((t0 + j * SEC, o, max(o, c), min(o, c), c))
    return rows


def osc(path, last_j, final=None):
    """Extend a path that ends at 137 after an odd index: p_j is 138 for even j and 137 for odd j.

    path[j+1] is p_j, so the next point to add has index j = len(path) - 1.
    """
    while len(path) - 2 < last_j:
        j = len(path) - 1
        path.append(138 if j % 2 == 0 else 137)
    if final is not None:
        path.append(final)
    return path


def _build(rows, chart_min=15):
    ch = Chart(chart_min * 60)
    for r in rows:
        ch.add(*r)
    return ch.finish()


def _mirror(path):
    return [300 - u for u in path]


def _expect(idx, t0=T0):
    return str(t0 + idx * SEC)


def selftest():
    MARKETS["TEST"] = (lambda d: 1.0, 0.5)  # spread 1, pen 0.5 price units
    fails = []

    def check(name, cond, info=""):
        if not cond:
            fails.append("%s %s" % (name, info))

    def same_rows(name, got, want):
        """want: list of dicts using candle indices for times (None = empty)."""
        if len(got) != len(want):
            fails.append("%s: %d rows, expected %d: %r" % (name, len(got), len(want), [(g["pattern"], g["dir"], g["outcome"]) for g in got]))
            return
        for g, w in zip(got, want):
            t0 = w.get("t0", T0)
            for key in ("pattern", "dir", "outcome"):
                if g[key] != w[key]:
                    fails.append("%s: %s is %r, expected %r" % (name, key, g[key], w[key]))
            for key in ("x_time", "a_time", "b_time", "c_time", "confirm_time"):
                if g[key] != str(t0 + w[key] * SEC):
                    fails.append("%s: %s is %s, expected candle %s" % (name, key, g[key], w[key]))
            ot = "" if w["outcome_time"] is None else str(t0 + w["outcome_time"] * SEC)
            if g["outcome_time"] != ot:
                fails.append("%s: outcome_time is %r, expected %r" % (name, g["outcome_time"], ot))
            for key in ("x", "a", "b", "c", "d", "stop"):
                if abs(float(g[key]) - w[key]) > 1e-9:
                    fails.append("%s: %s is %s, expected %s" % (name, key, g[key], w[key]))

    def gart_buy(c, c_idx, conf, d, stop, outcome, otime, **kw):
        w = dict(pattern="gartley", dir="buy", x_time=20, x=1000.0, a_time=70, a=1500.0, b_time=101, b=1190.0,
                 c_time=c_idx, c=c, confirm_time=conf, d=d, stop=stop, outcome=outcome, outcome_time=otime)
        w.update(kw)
        return w

    base_turns = [100, 150, 119, 139]

    # --- unit: the ATR window and the first candle's true range ------------------------------
    rows = stairs(walk(base_turns + [100, 102]))
    ch = _build(rows)
    atr = atr_series(ch.ch, ch.cl, ch.cc)
    # candle 0 spans 1180..1200 (true range 20), candles 1 to 13 have 10: ATR(13) = 150 / 14
    check("atr13", abs(atr[13] - 150.0 / 14.0) < 1e-12, repr(atr[13]))
    check("atr14", abs(atr[14] - 10.0) < 1e-12, repr(atr[14]))

    # --- unit: swings of the base path --------------------------------------------------------
    sw = find_swings(ch.ch, ch.cl, ch.cc, 2)
    want = [(True, 0, 1200.0, 13), (False, 20, 1000.0, 22), (True, 70, 1500.0, 72),
            (False, 101, 1190.0, 103), (True, 121, 1390.0, 123), (False, 160, 1000.0, 162)]
    check("swings", [(s[0], s[1], s[2], s[3]) for s in sw] == want, repr([(s[0], s[1], s[2], s[3]) for s in sw]))
    # no swing is confirmed before candle 13 although the first high was already 20 units above
    check("no_swing_before_13", all(s[3] >= 13 for s in sw))

    # --- unit: ratio boundaries (inclusive, tolerance 1e-9) -----------------------------------
    names = sorted(n for n, _, _ in classify(0.0, 1000.0, 500.0, 943.0, True))
    check("classify_bat_crab", names == ["bat", "crab"], repr(names))
    check("classify_rc_over", classify(0.0, 1000.0, 500.0, 943.001, True) == [])
    names = [n for n, _, _ in classify(0.0, 1000.0, 499.9999, 942.9999, True)]
    check("classify_rb_over", "bat" not in names and "crab" in names, repr(names))
    names = [n for n, _, _ in classify(0.0, 1000.0, 432.0, 800.0, True)]  # rB = 0.568 exactly
    check("classify_gartley_edge", names == ["gartley"], repr(names))
    names = [n for n, _, _ in classify(0.0, 1000.0, 432.1, 800.0, True)]  # rB = 0.5679
    check("classify_gartley_below", "gartley" not in names, repr(names))
    # the mirror image of a buy pattern is the same sell pattern
    b = classify(0.0, 1000.0, 500.0, 943.0, True)
    s = classify(3000.0, 2000.0, 2500.0, 2057.0, False)
    check("mirror", [(n, round(3000.0 - dd, 6), round(3000.0 - st, 6)) for n, dd, st in s] ==
          [(n, round(dd, 6), round(st, 6)) for n, dd, st in b], repr((b, s)))

    # --- unit: chart candles from minutes -----------------------------------------------------
    ch = _build([(0, 1.0, 2.0, 0.5, 1.5), (60, 1.5, 3.0, 1.0, 2.0), (1800 - 60, 2.0, 2.5, 0.2, 0.3),
                 (5400, 5.0, 6.0, 4.0, 5.5)], chart_min=30)
    check("chart_build", list(ch.ct) == [0, 5400] and list(ch.ch) == [3.0, 6.0] and list(ch.cl) == [0.2, 4.0]
          and list(ch.cc) == [0.3, 5.5], repr((list(ch.ct), list(ch.ch), list(ch.cl), list(ch.cc))))

    # --- A: Gartley buy, completes --------------------------------------------------------------
    # X 100 (low), A 150, B 119, C 139: XA 50, rB 31/50 = 0.62, rC 20/31, D = 150 - 0.786 x 50 = 110.7
    # (price 1107), stop 150 - 1.05 x 50 = 97.5 (975), proj (139 - 110.7) / 20 = 1.415.
    # C is confirmed at candle 123 (price 137, two units below).  Buy completes in the first minute with
    # low <= 1107 - 1 - 0.5 = 1105.5: candle 150 (low 1100), not candle 149 (1110).
    rows = stairs(walk(base_turns + [100, 102]))
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("A", got, [gart_buy(1390.0, 121, 123, 1107.0, 975.0, "completed", 150)])
    same_rows("A_year2016", find_patterns(_build(rows), "TEST", 15, 2, 2016), [])
    # k = 3: reversals of 30 units confirm C one candle later (candle 124, low 1360 = 1390 - 3 x 10)
    same_rows("A_k3", find_patterns(_build(rows), "TEST", 15, 3, 2015),
              [gart_buy(1390.0, 121, 124, 1107.0, 975.0, "completed", 150)])

    # the confirming candle closes exactly at 2016-01-01 00:00: its year is 2016
    t0b = 1451494800
    rows_b = stairs(walk(base_turns + [100, 102]), t0b)
    check("year_boundary", t0b + 124 * SEC == 1451606400)
    check("year_boundary_2015", find_patterns(_build(rows_b), "TEST", 15, 2, 2015) == [])
    got = find_patterns(_build(rows_b), "TEST", 15, 2, 2016)
    w = gart_buy(1390.0, 121, 123, 1107.0, 975.0, "completed", 150)
    w["t0"] = t0b
    same_rows("year_boundary_2016", got, [w])

    # --- B: a swing is not used before its confirmation ------------------------------------------
    # the high 139 at candle 121 falls only one unit and then rises to 141 (candle 125): no swing at
    # 139; C is 141, confirmed at candle 127.  rC 22/31, proj 30.3 / 22 = 1.377.  Completes at candle 156.
    rows = stairs(walk(base_turns + [138, 141, 100]))
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("B", got, [gart_buy(1410.0, 125, 127, 1107.0, 975.0, "completed", 156)])

    # --- C: the confirming candle's low passes D: skipped -----------------------------------------
    rows = stairs(walk(base_turns)) + [(T0 + 122 * SEC, 1390.0, 1390.0, 1000.0, 1000.0)]
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("C_skipped", got, [gart_buy(1390.0, 121, 122, 1107.0, 975.0, "skipped", None)])

    # --- D: a minute that completes and goes above C is a cancel -----------------------------------
    rows = stairs(walk(base_turns + [137])) + [(T0 + 124 * SEC, 1370.0, 1400.0, 1090.0, 1100.0)]
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("D_cancel_wins", got, [gart_buy(1390.0, 121, 123, 1107.0, 975.0, "cancelled_c", 124)])

    # --- E: cancelled at the close of the 192nd chart candle (123 + 192 = 315) ----------------------
    path = osc(walk(base_turns + [137]), 315)
    check("E_path", path[-1] == 137 and len(path) - 2 == 315, repr((path[-1], len(path))))
    rows = stairs(path) + [(T0 + 316 * SEC, 1380.0, 1380.0, 1000.0, 1000.0)]  # at the close: never tested
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("E_time", got, [gart_buy(1390.0, 121, 123, 1107.0, 975.0, "cancelled_time", 316)])

    # --- F: the 192nd candle also confirms the next swing: cancelled_swing -----------------------------
    path = osc(walk(base_turns + [137]), 314, final=139)  # candle 315 spans 138..139: its high 1390 is 20 above the low 1370 (and not above C)
    rows = stairs(path) + [(T0 + 316 * SEC, 1380.0, 1380.0, 1000.0, 1000.0)]
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("F_swing_not_time", got, [gart_buy(1390.0, 121, 123, 1107.0, 975.0, "cancelled_swing", 316)])

    # --- F2: the next swing is confirmed earlier (candle 125) than the 192nd: cancelled_swing at its close
    path = walk(base_turns + [137, 139])  # p_124 = 138, p_125 = 139: candle 125 spans 138..139
    rows = stairs(path) + [(T0 + 126 * SEC, 1380.0, 1380.0, 1000.0, 1000.0)]
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("F2_swing", got, [gart_buy(1390.0, 121, 123, 1107.0, 975.0, "cancelled_swing", 126)])

    # --- G: the file ends first: waiting ---------------------------------------------------------------
    path = osc(walk(base_turns + [137]), 130)
    got = find_patterns(_build(stairs(path)), "TEST", 15, 2, 2015)
    same_rows("G_waiting", got, [gart_buy(1390.0, 121, 123, 1107.0, 975.0, "waiting", None)])

    # --- H: the buy trigger is D - spread - pen = 1105.5 -----------------------------------------------
    rows = stairs(walk(base_turns + [137])) + [(T0 + 124 * SEC, 1375.0, 1380.0, 1105.51, 1380.0),
                                               (T0 + 125 * SEC, 1380.0, 1385.0, 1105.49, 1385.0)]
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("H_buy_trigger", got, [gart_buy(1390.0, 121, 123, 1107.0, 975.0, "completed", 125)])

    # --- I, J: the sell mirror image (prices 3000 - p): D = 1500 + 0.786 x 500 = 1893, stop 2025 ----------
    # swings: high 2000 (20), low 1500 (70), high 1810 (101), low 1610 (121) confirmed at 123.  The sell
    # completes at a Bid high of 1893 + 0.5 (no spread): 1893.49 does not, 1893.51 does.
    mir = _mirror(walk(base_turns + [137]))

    def gart_sell(outcome, otime):
        return dict(pattern="gartley", dir="sell", x_time=20, x=2000.0, a_time=70, a=1500.0, b_time=101, b=1810.0,
                    c_time=121, c=1610.0, confirm_time=123, d=1893.0, stop=2025.0, outcome=outcome, outcome_time=otime)

    rows = stairs(mir) + [(T0 + 124 * SEC, 1625.0, 1893.49, 1620.0, 1625.0), (T0 + 125 * SEC, 1625.0, 1893.51, 1620.0, 1893.0)]
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("I_sell_trigger", got, [gart_sell("completed", 125)])
    rows = stairs(mir) + [(T0 + 124 * SEC, 1625.0, 1900.0, 1600.0, 1700.0)]
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    same_rows("J_sell_cancel_wins", got, [gart_sell("cancelled_c", 124)])
    # a sell is skipped when the confirming candle's high passes D
    rows = stairs(_mirror(walk(base_turns))) + [(T0 + 122 * SEC, 1610.0, 2000.0, 1610.0, 2000.0)]
    got = find_patterns(_build(rows), "TEST", 15, 2, 2015)
    check("K_sell_skipped", len(got) == 1 and got[0]["outcome"] == "skipped" and got[0]["dir"] == "sell", repr(got))

    if fails:
        print("SELFTEST FAILED (%d)" % len(fails))
        for f in fails:
            print("  " + f)
        return 1
    print("selftest ok")
    return 0


def main(argv):
    if len(argv) == 2 and argv[1] == "--selftest":
        return selftest()
    if len(argv) != 7:
        print(__doc__)
        return 2
    path, market, chart_min, k, year, out = argv[1], argv[2], int(argv[3]), int(argv[4]), int(argv[5]), argv[6]
    if market not in MARKETS:
        print("unknown market %r" % market)
        return 2
    if chart_min not in (15, 30) or k not in (2, 3):
        print("chart must be 15 or 30 and k 2 or 3")
        return 2
    t = time.time()
    ch = load_file(path, chart_min)
    t_load = time.time() - t
    rows = find_patterns(ch, market, chart_min, k, year)
    write_rows(rows, out)
    counts = {}
    for r in rows:
        counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
    print("%d minutes, %d chart candles, load %.1fs, total %.1fs" % (len(ch.mt), len(ch.ct), t_load, time.time() - t))
    print("%d patterns: %s" % (len(rows), ", ".join("%s %d" % kv for kv in sorted(counts.items()))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
