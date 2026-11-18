"""Second, independent finder of levels and visits (docs/levels-study.md).

  python3 -I levels_finder2.py <file.csv.gz> <MARKET> <year> <out dir>
  python3 -I levels_finder2.py --selftest

Written alone from the plan page: "Data and clocks", "Swings", "The levels", "Twins" and
"A visit, and what happens after it". No trades, no counting. Standard library only.

How far back the watch runs (the plan: swings, zones and memory run over the whole file):
  * Candles, ATRs, swings, zones, Fibonacci levels, PD and PW are built over the whole file.
  * A level that is alive during the year is watched minute by minute from ITS OWN first
    watched minute (exact, no warm-up guess), and a round line from the 15th day of the file.
  * A level whose life ended before the year starts cannot have a touch in the year, so it
    is not watched at all.
  * Nothing is walked minute by minute: next-event searches jump over minutes that cannot
    matter with block maxima and minima (32, 1024 and 32768 minutes).
"""
import bisect
import calendar
import csv
import gzip
import os
import sys
import time
from array import array
from bisect import bisect_left, bisect_right
from datetime import date

EPS = 1e-9
LEVEL_HEADER = "kind,what,known_from,first_watched,low,high,atr,left_out".split(",")
VISIT_HEADER = (
    "kind,twin,what,known_from,side,touch,near,far,atr,"
    "r010,r010_t,r025,r025_t,r050,r050_t,r100,r100_t,m15,m60,how_far,end,end_t,"
    "brk_t,b010,b010_t,b025,b025_t,b050,b050_t,b100,b100_t"
).split(",")
PIPS = {"EURUSD": 0.0001, "GBPUSD": 0.0001, "EURGBP": 0.0001, "USDJPY": 0.01, "EURJPY": 0.01, "GBPJPY": 0.01, "XAUUSD": 0.1}

# ---------------------------------------------------------------- New York clock

_dst_cache = {}


def _sunday(y, m, nth):
    """nth Sunday of the month (1-based); nth = -1 for the last."""
    if nth > 0:
        d = date(y, m, 1)
        first = (6 - d.weekday()) % 7
        return date(y, m, 1 + first + 7 * (nth - 1))
    d = date(y, m + 1, 1) if m < 12 else date(y + 1, 1, 1)
    last = date.fromordinal(d.toordinal() - 1)
    return date.fromordinal(last.toordinal() - (last.weekday() + 1) % 7)


def _days(d):
    return d.toordinal() - date(1970, 1, 1).toordinal()


def dst_bounds(y):
    """UTC seconds of the start (2:00 EST) and the end (2:00 EDT) of daylight time in year y."""
    b = _dst_cache.get(y)
    if b is None:
        if y < 2007:
            s, e = _sunday(y, 4, 1), _sunday(y, 10, -1)
        else:
            s, e = _sunday(y, 3, 2), _sunday(y, 11, 1)
        b = (_days(s) * 86400 + 7 * 3600, _days(e) * 86400 + 6 * 3600)
        _dst_cache[y] = b
    return b


def ny_off(t):
    """Offset of America/New_York from UTC, in seconds, at UTC second t."""
    s, e = dst_bounds(time.gmtime(t).tm_year)
    return -14400 if s <= t < e else -18000


def utc_of_local(L):
    """UTC second at which the New York clock reads local second L (the first time, when it reads it twice)."""
    u = L + 14400
    if ny_off(u) == -14400:
        return u
    return L + 18000


def h4_end(t):
    """UTC second of the clock end of the 4-hour candle holding UTC second t (candles start 17, 21, 01, 05, 09, 13 NY)."""
    ls = t + ny_off(t)
    h = (ls // 3600) % 24
    base = ls - ls % 86400
    if h >= 21:
        s = base + 21 * 3600
    elif h >= 17:
        s = base + 17 * 3600
    elif h >= 13:
        s = base + 13 * 3600
    elif h >= 9:
        s = base + 9 * 3600
    elif h >= 5:
        s = base + 5 * 3600
    elif h >= 1:
        s = base + 1 * 3600
    else:
        s = base - 3 * 3600
    return utc_of_local(s + 4 * 3600)


def day_of(t):
    """(name of the day as a day number, UTC second of the day's clock end) for UTC second t."""
    ls = t + ny_off(t)
    N = (ls + 7 * 3600) // 86400
    wd = (N + 3) % 7  # Monday = 0
    if wd == 5:
        N += 2
    elif wd == 6:
        N += 1
    return N, utc_of_local(N * 86400 + 17 * 3600)


def day_end(t):
    return day_of(t)[1]


def year_start(y):
    return calendar.timegm((y, 1, 1, 0, 0, 0))


# ---------------------------------------------------------------- loading


def load(path):
    T = array("q")
    H = array("d")
    L = array("d")
    C = array("d")
    ta, ha, la, ca = T.append, H.append, L.append, C.append
    prev = -1
    with gzip.open(path, "rt") as f:
        f.readline()
        for line in f:
            p = line.split(",")
            t = int(p[0])
            if t <= prev:
                sys.exit("%s: stamps not increasing at %d" % (path, t))
            prev = t
            ta(t)
            ha(float(p[2]))
            la(float(p[3]))
            ca(float(p[4]))
    return T, H, L, C


# ---------------------------------------------------------------- charts


class Chart:
    """Candles of one chart: first minute index, clock end (UTC), effective minute index of the close
    (first minute stamped at or after the clock end, n if there is none), high, low, close, ATR at the candle."""

    def __init__(self, T, H, L, C, end_of):
        n = len(T)
        self.start = []
        self.end = []
        self.eff = []
        self.hi = []
        self.lo = []
        self.cl = []
        i = 0
        while i < n:
            E = end_of(T[i])
            j = bisect_left(T, E, i + 1)
            self.start.append(i)
            self.end.append(E)
            self.eff.append(j)
            self.hi.append(max(H[i:j]))
            self.lo.append(min(L[i:j]))
            self.cl.append(C[j - 1])
            i = j
        m = len(self.start)
        tr = []
        for k in range(m):
            if k == 0:
                tr.append(self.hi[0] - self.lo[0])
            else:
                pc = self.cl[k - 1]
                tr.append(max(self.hi[k], pc) - min(self.lo[k], pc))
        self.tr = tr
        self.atr = [None] * m
        for k in range(13, m):
            s = 0.0
            for x in tr[k - 13:k + 1]:
                s += x
            self.atr[k] = s / 14
        self.n = m


class Lv:
    """A level: life start e, static end sendx (exclusive minute index), bands [(from index, low, high)]."""
    __slots__ = ("kind", "what", "known", "e", "sendx", "bands", "below_ok", "above_ok", "single", "group",
                 "fw", "atr0", "left_out", "_dyn")

    def __init__(self, kind, what, known, e, sendx, bands, below_ok, above_ok, single, group):
        self.kind, self.what, self.known, self.e, self.sendx = kind, what, known, e, sendx
        self.bands, self.below_ok, self.above_ok, self.single, self.group = bands, below_ok, above_ok, single, group
        self.fw = None
        self.atr0 = None
        self.left_out = 0
        self._dyn = None

    def band_at(self, i):
        k = bisect_right([b[0] for b in self.bands], i) - 1
        b = self.bands[k]
        return b[1], b[2]

    def bands_from(self, i):
        """the bands as they are from minute i on: the band in force at i, then later changes"""
        k = bisect_right([b[0] for b in self.bands], i) - 1
        return [(i, self.bands[k][1], self.bands[k][2])] + [b for b in self.bands[k + 1:]]


def find_swings(ch, n):
    """Swings of size 2 on a chart: list of (type 'H'/'L', price, candle that confirmed it, candidate of the other
    kind at that confirmation, candle of the swing). Only candles that close can confirm anything."""
    hi, lo, atr, eff = ch.hi, ch.lo, ch.atr, ch.eff
    out = []
    if ch.n < 2:
        return out
    forming_high = True
    cand, ci = hi[0], 0
    for j in range(1, ch.n):
        if eff[j] >= n:
            break
        a = atr[j]
        if forming_high:
            if hi[j] > cand:
                cand, ci = hi[j], j
                continue
            if a is not None and lo[j] <= cand - 2 * a + EPS:
                seg = lo[ci + 1:j + 1]
                ml = min(seg)
                out.append(("H", cand, j, ml, ci))
                cand, ci = ml, ci + 1 + seg.index(ml)
                forming_high = False
        else:
            if lo[j] < cand:
                cand, ci = lo[j], j
                continue
            if a is not None and hi[j] >= cand + 2 * a - EPS:
                seg = hi[ci + 1:j + 1]
                mh = max(seg)
                out.append(("L", cand, j, mh, ci))
                cand, ci = mh, ci + 1 + seg.index(mh)
                forming_high = True
    return out


class _Zone:
    __slots__ = ("lo", "hi", "turns", "last", "cur")

    def __init__(self, p, j):
        self.lo = self.hi = p
        self.turns = 1
        self.last = j
        self.cur = None


class Ctx:
    def __init__(self, T, H, L, C, market):
        self.T, self.H, self.L, self.C = T, H, L, C
        self.n = n = len(T)
        self.market = market
        self.pip = PIPS[market]
        self.gold = market == "XAUUSD"
        self._make_blocks()
        self.d = Chart(T, H, L, C, day_end)
        self.h4 = Chart(T, H, L, C, h4_end)
        d = self.d
        self.dN = [day_of(T[s])[0] for s in d.start]
        self.dayid = array("i", [0]) * n
        for k in range(d.n):
            a = d.start[k]
            b = d.start[k + 1] if k + 1 < d.n else n
            self.dayid[a:b] = array("i", [k]) * (b - a)
        self.dnext = [d.start[k + 1] if k + 1 < d.n else n for k in range(d.n)]
        self.atrf = [None] + [d.atr[k - 1] for k in range(1, d.n)]
        self.gday = [None if a is None else 0.25 * a for a in self.atrf]
        self.w0 = d.start[14] if d.n > 14 else n
        self.spacing = 10.0 if self.gold else 50 * self.pip

    # ---- searches
    def _make_blocks(self):
        n, H, L = self.n, self.H, self.L

        def blocks(a, f):
            b1 = array("d", [f(a[k:k + 32]) for k in range(0, n, 32)])
            b2 = array("d", [f(b1[k:k + 32]) for k in range(0, len(b1), 32)])
            b3 = array("d", [f(b2[k:k + 32]) for k in range(0, len(b2), 32)])
            return b1, b2, b3

        H1, H2, H3 = blocks(H, max)
        L1, L2, L3 = blocks(L, min)

        def nxt_hi(i, thr, end):
            """first minute in [i, end) whose high is >= thr, else end"""
            while i < end:
                if not (i & 1023):
                    if not (i & 32767) and H3[i >> 15] < thr:
                        i += 32768
                        continue
                    if H2[i >> 10] < thr:
                        i += 1024
                        continue
                if not (i & 31) and H1[i >> 5] < thr:
                    i += 32
                    continue
                if H[i] >= thr:
                    return i
                i += 1
            return end

        def nxt_lo(i, thr, end):
            """first minute in [i, end) whose low is <= thr, else end"""
            while i < end:
                if not (i & 1023):
                    if not (i & 32767) and L3[i >> 15] > thr:
                        i += 32768
                        continue
                    if L2[i >> 10] > thr:
                        i += 1024
                        continue
                if not (i & 31) and L1[i >> 5] > thr:
                    i += 32
                    continue
                if L[i] <= thr:
                    return i
                i += 1
            return end

        self.nxt_hi, self.nxt_lo = nxt_hi, nxt_lo

    # ---- round numbers of the market, for "sits on a round number"
    def round_dist(self, p):
        sp = self.spacing
        return abs(p - round(p / sp) * sp)

    # ---- levels
    def build_levels(self):
        out = []
        self._pd_pw(out)
        for kind, ch in (("Z4", self.h4), ("ZD", self.d)):
            self._zones(out, kind, ch)
        for kind, ch in (("F4", self.h4), ("FD", self.d)):
            self._fib(out, kind, ch)
        out = [lv for lv in out if lv.e < self.n]
        for lv in out:
            self._finalize(lv)
        return out

    def _finalize(self, lv):
        fw = max(lv.e, self.w0)
        if fw >= lv.sendx or fw >= self.n:
            return
        lv.fw = fw
        lo, hi = lv.band_at(fw)
        lv.atr0 = self.atrf[self.dayid[fw]]
        near = min(self.round_dist(lo), self.round_dist(hi))
        lv.left_out = 1 if near <= 0.05 * lv.atr0 + EPS else 0
        assert self.T[fw] >= lv.known, "level known after its first watched minute"

    def _pd_pw(self, out):
        d, n = self.d, self.n
        for k in range(1, d.n):
            e = d.start[k]
            sx = d.start[k + 1] if k + 1 < d.n else n
            known = d.end[k - 1]
            for what, p in (("high", d.hi[k - 1]), ("low", d.lo[k - 1])):
                out.append(Lv("PD", what, known, e, sx, [(e, p, p)], True, True, False, "PD"))
        weeks = []  # [first day index, last day index]
        cur = None
        for k in range(d.n):
            w = self.dN[k] - (self.dN[k] + 3) % 7
            if cur is None or cur[0] != w:
                cur = [w, k, k]
                weeks.append(cur)
            else:
                cur[2] = k
        for w in range(1, len(weeks)):
            a, b = weeks[w - 1][1], weeks[w - 1][2]
            e = d.start[weeks[w][1]]
            sx = d.start[weeks[w + 1][1]] if w + 1 < len(weeks) else n
            known = d.end[b]
            for what, p in (("high", max(d.hi[a:b + 1])), ("low", min(d.lo[a:b + 1]))):
                out.append(Lv("PW", what, known, e, sx, [(e, p, p)], True, True, False, "PW"))

    def _zones(self, out, kind, ch):
        n = self.n
        maxage = 540 if kind == "Z4" else 250
        sw = {s[2]: s for s in find_swings(ch, n)}
        ceil, floor = [], []
        for j in range(ch.n):
            if ch.eff[j] >= n:
                break
            a = ch.atr[j]
            ef = ch.eff[j]
            for lst, up in ((ceil, True), (floor, False)):
                keep = []
                for z in lst:
                    dead = j - z.last >= maxage
                    if not dead and a is not None:
                        if up:
                            dead = ch.cl[j] >= z.hi + 0.25 * a - EPS
                        else:
                            dead = ch.cl[j] <= z.lo - 0.25 * a + EPS
                    if dead:
                        if z.cur is not None:
                            z.cur.sendx = ef
                    else:
                        keep.append(z)
                lst[:] = keep
            s = sw.get(j)
            if s is None:
                continue
            up = s[0] == "H"
            lst = ceil if up else floor
            h = s[1]
            best, bd = None, None
            for z in lst:
                if max(z.hi, h) - min(z.lo, h) <= 0.5 * a + EPS:
                    dist = abs((z.lo + z.hi) / 2 - h)
                    # the older on a tie; middles within 1e-9 of each other are a tie (whole-pip prices, float noise)
                    if bd is None or dist < bd - EPS:
                        best, bd = z, dist
            if best is None:
                lst.append(_Zone(h, j))
                continue
            z = best
            old = (z.lo, z.hi)
            z.lo, z.hi = min(z.lo, h), max(z.hi, h)
            z.turns += 1
            z.last = j
            what = "ceiling" if up else "floor"
            if z.turns == 2:
                z.cur = Lv(kind + "x2", what, ch.end[j], ef, n, [(ef, z.lo, z.hi)], up, not up, False, kind + "x2")
                out.append(z.cur)
            elif z.turns == 3:
                z.cur.sendx = ef
                z.cur = Lv(kind, what, ch.end[j], ef, n, [(ef, z.lo, z.hi)], up, not up, False, kind)
                out.append(z.cur)
            elif (z.lo, z.hi) != old:
                z.cur.bands.append((ef, z.lo, z.hi))

    def _fib(self, out, kind, ch):
        n = self.n
        sw = find_swings(ch, n)
        for q in range(1, len(sw)):
            typ, price, j, cand, _ = sw[q]
            other = sw[q - 1][1]
            ef = ch.eff[j]
            nxt = ch.eff[sw[q + 1][2]] if q + 1 < len(sw) else n
            R = abs(price - other)
            up = typ == "L"  # a low just confirmed: the down-leg gives ceilings
            lines = []
            for r in (0.382, 0.5, 0.618):
                p = price + r * R if up else price - r * R
                lines.append(("C", repr(r), p, p))
            if up:
                lines.append(("J", "J", price + 0.786 * R, price + 0.886 * R))
            else:
                lines.append(("J", "J", price - 0.886 * R, price - 0.786 * R))
            for fam, tag, lo, hi in lines:
                if up:
                    if cand >= lo - EPS:  # candidate high already reached the low edge
                        continue
                else:
                    if cand <= hi + EPS:
                        continue
                if up:
                    t = self.nxt_lo(ef, price + EPS, n)
                else:
                    t = self.nxt_hi(ef, price - EPS, n)
                sx = min(nxt, t + 1 if t < n else n)
                what = ("ceiling:" if up else "floor:") + tag
                lv = Lv(kind + fam, what, ch.end[j], ef, sx, [(ef, lo, hi)], up, not up, True, kind)
                out.append(lv)

    # ---- the watch of one level, line or twin
    def run(self, start, life_end, bands, below_ok, above_ok, single):
        """Watch minute by minute from `start`. New visits may start only before `life_end`; a visit that has
        started runs to its end. Returns visits (touch, side -1 below / +1 above, near, far, atr, end, end kind)
        where end is -1 when the file ended first and the end kind is 0 for a turn, 1 for a break."""
        n, H, L = self.n, self.H, self.L
        nxt_hi, nxt_lo = self.nxt_hi, self.nxt_lo
        dayid, dnext, gday, atrf = self.dayid, self.dnext, self.gday, self.atrf
        out = []
        mem = 0
        i = start
        nb = len(bands)
        bfrom = [b[0] for b in bands]
        while i < life_end:
            bi = bisect_right(bfrom, i) - 1
            lo, hi = bands[bi][1], bands[bi][2]
            seg_end = bands[bi + 1][0] if bi + 1 < nb else life_end
            if seg_end > life_end:
                seg_end = life_end
            while i < seg_end:
                if mem == -1 and below_ok:
                    t = nxt_hi(i, lo - EPS, seg_end)
                    if t >= seg_end:
                        i = seg_end
                        break
                    side, near, far = -1, lo, hi
                elif mem == 1 and above_ok:
                    t = nxt_lo(i, hi + EPS, seg_end)
                    if t >= seg_end:
                        i = seg_end
                        break
                    side, near, far = 1, hi, lo
                else:
                    d = dayid[i]
                    de = dnext[d]
                    if de > seg_end:
                        de = seg_end
                    g = gday[d]
                    if mem == -1:
                        tt = nxt_hi(i, hi + g - EPS, de)
                    elif mem == 1:
                        tt = nxt_lo(i, lo - g + EPS, de)
                    else:
                        tt = nxt_lo(i, lo - g + EPS, de)
                        t2 = nxt_hi(i, hi + g - EPS, tt)
                        if t2 < tt:
                            tt = t2
                    if tt >= de:
                        i = de
                        continue
                    lowhit = L[tt] <= lo - g + EPS
                    highhit = H[tt] >= hi + g - EPS
                    mem = 0 if (lowhit and highhit) else (-1 if lowhit else 1)
                    i = tt + 1
                    continue
                # a visit starts in minute t
                atr = atrf[dayid[t]]
                g = 0.25 * atr
                if side < 0:
                    e_t = nxt_lo(t + 1, near - g + EPS, n)
                    e_b = nxt_hi(t + 1, far + g - EPS, n)
                else:
                    e_t = nxt_hi(t + 1, near + g - EPS, n)
                    e_b = nxt_lo(t + 1, far - g + EPS, n)
                if e_b < n and e_b <= e_t:
                    end, ek = e_b, 1
                    mem = 1 if side < 0 else -1
                elif e_t < n:
                    end, ek = e_t, 0
                    mem = -1 if side < 0 else 1
                else:
                    out.append((t, side, near, far, atr, -1, 0))
                    return out
                out.append((t, side, near, far, atr, end, ek))
                if single:
                    return out
                i = end + 1
        return out

    def first_visit_end(self, lv):
        """Minute index of the end of the level's own first visit (n if none, or if the file ended first)."""
        if lv._dyn is None:
            v = self.run(lv.fw, lv.sendx, lv.bands_from(lv.fw), lv.below_ok, lv.above_ok, True)
            lv._dyn = v[0][5] if v and v[0][5] >= 0 else self.n
        return lv._dyn

    # ---- one visit, with its races and what happens after
    def visit_cells(self, v):
        t, side, near, far, atr, end, ek = v
        T, H, L, C, n = self.T, self.H, self.L, self.C, self.n
        nxt_hi, nxt_lo = self.nxt_hi, self.nxt_lo
        tt = T[t]
        w24 = bisect_left(T, tt + 86400, t + 1)
        w120 = bisect_left(T, tt + 432000, t + 1)
        cells = []
        for dd, w in ((0.10, w24), (0.25, w24), (0.50, w120), (1.00, w120)):
            x = dd * atr
            if side < 0:
                a = nxt_lo(t + 1, near - x + EPS, w)
                b = nxt_hi(t + 1, far + x - EPS, w)
            else:
                a = nxt_hi(t + 1, near + x - EPS, w)
                b = nxt_lo(t + 1, far - x + EPS, w)
            if a >= w and b >= w:
                cells += ["neither", ""]
            elif b <= a:
                cells += ["break", str(T[b])]
            else:
                cells += ["turn", str(T[a])]
        for mins in (15, 60):
            c = C[bisect_left(T, tt + mins * 60, t + 1) - 1]
            if side < 0:
                cells.append("back" if c < near - EPS else ("through" if c > far + EPS else "at"))
            else:
                cells.append("back" if c > near + EPS else ("through" if c < far - EPS else "at"))
        x = 0.25 * atr
        if side < 0:
            bm = nxt_hi(t + 1, far + x - EPS, w24)
            hf = max(0.0, near - min(L[t + 1:bm])) if bm > t + 1 else 0.0
        else:
            bm = nxt_lo(t + 1, far - x + EPS, w24)
            hf = max(0.0, max(H[t + 1:bm]) - near) if bm > t + 1 else 0.0
        cells.append("%.10f" % hf)
        cells += ["open", ""] if end < 0 else [("break" if ek else "turn"), str(T[end])]
        stop = min(w24, n if end < 0 else end + 1)
        if side < 0:
            P = far + 0.10 * atr
            bk = nxt_hi(t, P - EPS, stop)
        else:
            P = far - 0.10 * atr
            bk = nxt_lo(t, P + EPS, stop)
        if bk >= stop:
            cells.append("")
            cells += ["none", ""] * 4
            return cells
        cells.append(str(T[bk]))
        bt = T[bk]
        for dd, hours in ((0.10, 24), (0.25, 24), (0.50, 120), (1.00, 120)):
            w = bisect_left(T, bt + hours * 3600, bk + 1)
            x = dd * atr
            if side < 0:
                run = nxt_hi(bk + 1, P + x - EPS, w)
                fail = nxt_lo(bk + 1, P - x + EPS, w)
            else:
                run = nxt_lo(bk + 1, P - x + EPS, w)
                fail = nxt_hi(bk + 1, P + x - EPS, w)
            if run >= w and fail >= w:
                cells += ["neither", ""]
            elif fail <= run:
                cells += ["fail", str(T[fail])]
            else:
                cells += ["run", str(T[run])]
        return cells

    def visit_row(self, kind, twin, what, known, v):
        t, side, near, far, atr = v[0], v[1], v[2], v[3], v[4]
        head = [kind, twin, what, known, "below" if side < 0 else "above", str(self.T[t]),
                "%.10f" % near, "%.10f" % far, "%.10f" % atr]
        return head + self.visit_cells(v)

    # ---- twins
    def _index_groups(self, levels):
        self.groups = {}
        for lv in levels:
            self.groups.setdefault(lv.group, []).append(lv)
        self.group_e = {}
        self.group_span = {}
        for g, lst in self.groups.items():
            lst.sort(key=lambda x: x.e)
            self.group_e[g] = [x.e for x in lst]
            self.group_span[g] = max(x.sendx - x.e for x in lst)

    def _peers(self, lv):
        """other levels of the same kind that are being watched in the first watched minute of lv"""
        lst = self.groups[lv.group]
        fw = lv.fw
        k = bisect_right(self.group_e[lv.group], fw)
        lowest = fw - self.group_span[lv.group]
        out = []
        for q in range(k - 1, -1, -1):
            y = lst[q]
            if y.e < lowest:
                break
            if y is lv or y.sendx <= fw:
                continue
            if y.single and self.first_visit_end(y) < fw:
                continue
            out.append(y.band_at(fw))
        return out

    def twin_specs(self, lv):
        """the twins that are kept for a level: list of (set number k for m = k / 100, side -1 or 1, shift in price)"""
        lo, hi = lv.band_at(lv.fw)
        atr = lv.atr0
        tol = 0.05 * atr + EPS
        peers = self._peers(lv)
        out = []
        for k in range(40, 86):
            off = (k / 100.0) * atr
            for side, shift in ((-1, -off), (1, off)):
                if side < 0 and not lv.below_ok:
                    continue
                if side > 0 and not lv.above_ok:
                    continue
                a, b = lo + shift, hi + shift
                if min(self.round_dist(a), self.round_dist(b)) <= tol:
                    continue
                bad = False
                for ylo, yhi in peers:
                    da = 0.0 if ylo <= a <= yhi else min(abs(a - ylo), abs(a - yhi))
                    db = 0.0 if ylo <= b <= yhi else min(abs(b - ylo), abs(b - yhi))
                    if min(da, db) <= tol:
                        bad = True
                        break
                if not bad:
                    out.append((k, side, shift))
        return out

    # ---- everything for one year
    def analyze(self, year):
        T, H, L, n = self.T, self.H, self.L, self.n
        levels = self.build_levels()
        self._index_groups(levels)
        ys = bisect_left(T, year_start(year))
        ye = bisect_left(T, year_start(year + 1))
        lrows, vrows = [], []
        for lv in levels:
            if lv.fw is None or lv.fw >= ye or lv.sendx <= ys:
                continue
            lo, hi = lv.band_at(lv.fw)
            if ys <= lv.fw < ye:
                lrows.append([lv.kind, lv.what, str(lv.known), str(T[lv.fw]), "%.10f" % lo, "%.10f" % hi,
                              "%.10f" % lv.atr0, str(lv.left_out)])
            limit = min(lv.sendx, ye)
            vs = self.run(lv.fw, limit, lv.bands_from(lv.fw), lv.below_ok, lv.above_ok, lv.single)
            for v in vs:
                if ys <= v[0] < ye:
                    assert T[v[0]] >= lv.known, "a touch before its level was known"
                    vrows.append(self.visit_row(lv.kind, "level", lv.what, str(lv.known), v))
            base = lv.bands_from(lv.fw)
            for k, side, shift in self.twin_specs(lv):
                bands = [(f, a + shift, b + shift) for f, a, b in base]
                vs = self.run(lv.fw, limit, bands, side < 0, side > 0, lv.single)
                for v in vs:
                    if ys <= v[0] < ye:
                        assert T[v[0]] >= lv.known
                        vrows.append(self.visit_row(lv.kind, "%.2f" % (k / 100.0), lv.what, str(lv.known), v))
        self._round_rows(ys, ye, vrows)
        lrows.sort(key=lambda r: (int(r[3]), r[0], r[1], float(r[4])))
        vrows.sort(key=lambda r: (int(r[5]), r[0], r[1], r[2], int(r[3]) if r[3] else -1, r[4], float(r[6])))
        return lrows, vrows

    def _round_rows(self, ys, ye, vrows):
        w0 = self.w0
        if w0 >= ye or ye <= ys:
            return
        H, L = self.H, self.L
        lo_p, hi_p = min(L[ys:ye]), max(H[ys:ye])
        sp = self.spacing
        grids = []  # (kind or None, offset in price, twin label)
        grids.append((None, 0.0, None))
        for q in range(41):
            if self.gold:
                u = 3.0 + 0.1 * q
                grids.append(("RTW", u, "%.2f" % u))
            else:
                u = 15.0 + 0.5 * q
                grids.append(("RTW", u * self.pip, "%.1f" % u))
        for kind, off, label in grids:
            kmin = int((lo_p - off) // sp) - 1
            kmax = int((hi_p - off) // sp) + 2
            for k in range(kmin, kmax + 1):
                p = k * sp + off
                if p < lo_p - EPS or p > hi_p + EPS:
                    continue
                if kind is None:
                    if self.gold:
                        kd = "R00" if k % 5 == 0 else "R50"
                    else:
                        kd = "R00" if k % 2 == 0 else "R50"
                    tw = "level"
                else:
                    kd, tw = kind, label
                for v in self.run(w0, ye, [(w0, p, p)], True, True, False):
                    if ys <= v[0] < ye:
                        vrows.append(self.visit_row(kd, tw, "", "", v))


def write_lists(lrows, vrows, outdir):
    os.makedirs(outdir, exist_ok=True)
    for name, header, rows in (("levels.csv", LEVEL_HEADER, lrows), ("visits.csv", VISIT_HEADER, vrows)):
        with open(os.path.join(outdir, name), "w", newline="") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(header)
            w.writerows(rows)


def main(argv):
    if len(argv) == 2 and argv[1] == "--selftest":
        selftest()
        return
    if len(argv) != 5:
        sys.exit(__doc__)
    path, market, year, outdir = argv[1], argv[2], int(argv[3]), argv[4]
    if market not in PIPS:
        sys.exit("unknown market %s" % market)
    t0 = time.time()
    T, H, L, C = load(path)
    t1 = time.time()
    ctx = Ctx(T, H, L, C, market)
    t2 = time.time()
    lrows, vrows = ctx.analyze(year)
    t3 = time.time()
    write_lists(lrows, vrows, outdir)
    kinds = {}
    for r in lrows:
        kinds[r[0]] = kinds.get(r[0], 0) + 1
    vk = {}
    for r in vrows:
        k = r[0] if r[1] == "level" else r[0] + " twins"
        vk[k] = vk.get(k, 0) + 1
    print("%s %d: %d minutes, load %.0fs, candles %.0fs, levels and visits %.0fs" % (market, year, len(T), t1 - t0, t2 - t1, t3 - t2))
    print("levels %d: " % len(lrows) + ", ".join("%s %d" % kv for kv in sorted(kinds.items())))
    print("visits %d: " % len(vrows) + ", ".join("%s %d" % kv for kv in sorted(vk.items())))



# ---------------------------------------------------------------- self test: hand-made series

_checks = [0]


def check(cond, msg):
    _checks[0] += 1
    if not cond:
        raise AssertionError("selftest failed: " + msg)


def close(a, b, tol=1e-9):
    return abs(a - b) <= tol


def _D(y, m, d):
    return _days(date(y, m, d))


def _shift(D):
    return 4 if D >= _D(2013, 3, 11) else 5  # New York is UTC-5 until the night of 2013-03-10


def _name(k):
    """name (day number) of the k-th day of the hand-made series, Monday 2013-01-07 first, Monday to Friday"""
    return _D(2013, 1, 7) + (k // 5) * 7 + k % 5


def _stamp(k, off):
    D = _name(k)
    return (D - 1) * 86400 + 17 * 3600 + _shift(D) * 3600 + off * 60


def _dend(k):
    D = _name(k)
    return D * 86400 + 17 * 3600 + _shift(D) * 3600


def _h4end(k):
    D = _name(k)
    return (D - 1) * 86400 + 21 * 3600 + _shift(D) * 3600


def _series(days):
    T, H, L, C = array("q"), array("d"), array("d"), array("d")
    for k, mins in enumerate(days):
        for off, h, l, c in mins:
            T.append(_stamp(k, off))
            H.append(h)
            L.append(l)
            C.append(c)
    return Ctx(T, H, L, C, "EURUSD")


def _dicts(ctx, years):
    lr, vr = [], []
    for y in years:
        a, b = ctx.analyze(y)
        lr += a
        vr += b
    return [dict(zip(LEVEL_HEADER, r)) for r in lr], [dict(zip(VISIT_HEADER, r)) for r in vr]


def _naive(ctx, start, life_end, bands, bo, ao, single):
    """the same watch written minute by minute, straight from the plan's sentences (the check of `run`)"""
    n, H, L = ctx.n, ctx.H, ctx.L
    mem, vis, out, i = 0, None, [], start
    while i < n:
        if vis is None and i >= life_end:
            break
        if vis is not None:
            side, near, far, g, atr, t = vis
            if side < 0:
                tc, bc = L[i] <= near - g + EPS, H[i] >= far + g - EPS
            else:
                tc, bc = H[i] >= near + g - EPS, L[i] <= far - g + EPS
            if bc or tc:
                ek = 1 if bc else 0
                out.append((t, side, near, far, atr, i, ek))
                mem = (1 if side < 0 else -1) if bc else (-1 if side < 0 else 1)
                vis = None
                if single:
                    return out
            i += 1
            continue
        k = max(q for q in range(len(bands)) if bands[q][0] <= i)
        lo, hi = bands[k][1], bands[k][2]
        atr = ctx.atrf[ctx.dayid[i]]
        g = 0.25 * atr
        if mem == -1 and bo and H[i] >= lo - EPS:
            vis = (-1, lo, hi, g, atr, i)
        elif mem == 1 and ao and L[i] <= hi + EPS:
            vis = (1, hi, lo, g, atr, i)
        else:
            lowhit, highhit = L[i] <= lo - g + EPS, H[i] >= hi + g - EPS
            if lowhit and highhit:
                mem = 0
            elif lowhit:
                mem = -1
            elif highhit:
                mem = 1
        i += 1
    if vis is not None:
        out.append((vis[5], vis[0], vis[1], vis[2], vis[4], -1, 0))
    return out


def _random_series(rng, days, per_day):
    import random
    out = []
    p = 1.1000
    for k in range(days):
        offs = sorted(rng.sample(range(0, 1400), per_day))
        mins = []
        for o in offs:
            c = p + rng.gauss(0, 0.0007)
            h = max(p, c) + abs(rng.gauss(0, 0.0003))
            l = min(p, c) - abs(rng.gauss(0, 0.0003))
            mins.append((o, h, l, c))
            p = c
        out.append(mins)
    return _series(out)


def selftest():
    import random
    t0 = time.time()
    # ---- clocks
    tg = calendar.timegm
    check(ny_off(tg((2013, 3, 10, 6, 59, 59))) == -18000 and ny_off(tg((2013, 3, 10, 7, 0, 0))) == -14400, "spring clock change")
    check(ny_off(tg((2013, 11, 3, 5, 59, 59))) == -14400 and ny_off(tg((2013, 11, 3, 6, 0, 0))) == -18000, "autumn clock change")
    check(ny_off(tg((2006, 4, 2, 7, 0, 0))) == -14400 and ny_off(tg((2006, 10, 29, 6, 0, 0))) == -18000, "2006 rules")
    check(h4_end(tg((2013, 3, 10, 6, 30, 0))) == tg((2013, 3, 10, 9, 0, 0)), "01 candle on the spring night ends 05:00 EDT")
    check(h4_end(tg((2013, 11, 3, 5, 30, 0))) == tg((2013, 11, 3, 10, 0, 0)), "01 candle on the autumn night, first 01:30")
    check(h4_end(tg((2013, 11, 3, 6, 30, 0))) == tg((2013, 11, 3, 10, 0, 0)), "01 candle on the autumn night, second 01:30")
    check(h4_end(tg((2013, 11, 3, 4, 30, 0))) == tg((2013, 11, 3, 5, 0, 0)), "21 candle ends at the first 01:00")
    check(day_of(tg((2013, 1, 11, 21, 59, 0))) == (_D(2013, 1, 11), tg((2013, 1, 11, 22, 0, 0))), "Friday before 17:00")
    check(day_of(tg((2013, 1, 11, 22, 0, 0)))[0] == _D(2013, 1, 14), "Friday 17:00 belongs to Monday")
    check(day_of(tg((2013, 1, 13, 21, 59, 0)))[0] == _D(2013, 1, 14), "Sunday before 17:00 belongs to Monday")
    check(day_of(tg((2013, 1, 13, 22, 0, 0))) == (_D(2013, 1, 14), tg((2013, 1, 14, 22, 0, 0))), "Sunday 17:00 starts Monday")

    # ---- series A: PD levels, the first watched minute, the touch, the end, the break and the runs after it
    base = [[(0, 1.1020, 1.0920, 1.0970)] for _ in range(14)]
    day14 = [(0, 1.1030, 1.0990, 1.1010), (1, 1.1015, 1.1005, 1.1010), (2, 1.1022, 1.1000, 1.1020),
             (3, 1.1030, 1.1010, 1.1025), (4, 1.1060, 1.1020, 1.1050), (5, 1.1085, 1.1040, 1.1080),
             (6, 1.1135, 1.1070, 1.1130), (10, 1.1110, 1.1090, 1.1100), (40, 1.1100, 1.1010, 1.1020)]
    A = _series(base + [day14, [(0, 1.1100, 1.1000, 1.1050)], [(0, 1.1100, 1.1000, 1.1050)]])
    lr, vr = _dicts(A, [2013])
    # the ATR in force on a Monday: the ATR at Friday's day, (13 x 0.0100 + 0.0165) / 14
    mon = [r for r in lr if r["kind"] == "PD" and r["what"] == "high" and r["first_watched"] == str(_stamp(15, 0))]
    check(len(mon) == 1, "Monday PD high exists")
    check(close(float(mon[0]["atr"]), 0.1465 / 14, 1e-10), "Monday ATR is Friday's ATR")
    check(close(float(mon[0]["high"]), 1.1135) and mon[0]["known_from"] == str(_dend(14)), "Monday PD high is Friday's high")
    fri = [r for r in lr if r["kind"] == "PD" and r["what"] == "high" and r["first_watched"] == str(_stamp(14, 0))]
    check(len(fri) == 1 and close(float(fri[0]["atr"]), 0.01, 1e-10) and fri[0]["left_out"] == "0", "Friday PD high, ATR of Thursday")
    check(not [r for r in lr if r["kind"] == "PD" and int(r["first_watched"]) < _stamp(14, 0)], "nothing before the 15th day")
    pv = [r for r in vr if r["kind"] == "PD" and r["what"] == "high" and r["twin"] == "level"
          and r["known_from"] == str(_dend(13))]
    first = [r for r in pv if r["side"] == "below"]
    check(len(first) == 1 and first[0]["touch"] == str(_stamp(14, 2)), "no visit in the first watched minute, the first touch is minute 2")
    r = first[0]
    S = lambda off: str(_stamp(14, off))
    want = dict(near="1.1020000000", far="1.1020000000", atr="0.0100000000", r010="break", r010_t=S(3), r025="break",
                r025_t=S(4), r050="break", r050_t=S(5), r100="break", r100_t=S(6), m15="through", m60="at",
                how_far="0.0010000000", end="break", end_t=S(4), brk_t=S(3), b010="fail", b010_t=S(4), b025="run",
                b025_t=S(4), b050="run", b050_t=S(5), b100="run", b100_t=S(6))
    for k, v in want.items():
        check(r[k] == v, "series A visit %s is %s, wanted %s" % (k, r[k], v))
    check(any(x["side"] == "above" and x["touch"] == S(40) for x in pv), "memory set by the end minute: a visit from above at the last minute")

    # ---- series B: away and touch in one minute, and the end minute sets the memory
    day14b = [(0, 1.0980, 1.0915, 1.0970), (1, 1.0955, 1.0918, 1.0930), (2, 1.0950, 1.0890, 1.0900),
              (3, 1.0925, 1.0895, 1.0920)]
    B = _series(base + [day14b, [(0, 1.1000, 1.0900, 1.0950)]])
    lr, vr = _dicts(B, [2013])
    pv = sorted([r for r in vr if r["kind"] == "PD" and r["what"] == "low" and r["twin"] == "level"],
                key=lambda x: int(x["touch"]))
    check([(x["side"], x["touch"]) for x in pv][:2] == [("above", str(_stamp(14, 1))), ("below", str(_stamp(14, 3)))],
          "away and touch never in one minute; a break that also reaches the other side leaves 'away' on the far side")
    check(pv[0]["end"] == "break" and pv[0]["end_t"] == str(_stamp(14, 2)), "both sides in one minute is a break")

    # ---- twins left out near a round number (series A, PD high 1.1020, ATR 0.0100)
    lv = [x for x in A.build_levels() if x.kind == "PD" and x.what == "high" and x.e == A.w0][0]
    A._index_groups(A.build_levels())
    lv = [x for x in A.groups["PD"] if x.what == "high" and x.e == A.w0][0]
    specs = A.twin_specs(lv)
    lower = sorted(k for k, s, _ in specs if s < 0)
    upper = sorted(k for k, s, _ in specs if s > 0)
    check(lower == [k for k in range(40, 86) if not 65 <= k <= 75], "lower twins near 1.0950 are left out: %s" % lower)
    check(upper == [k for k in range(40, 86) if not 75 <= k <= 85], "upper twins near 1.1100 are left out: %s" % upper)

    # ---- series C: zones armed at the third turn, Fibonacci levels, candidate low already at the level
    tops = [1.1200, 1.1150, 1.1100, 1.1050, 1.1000, 1.0950, 1.1000, 1.1050, 1.1100, 1.1150]  # one 10-day cycle
    hs = [1.1000] * 14 + [1.1050, 1.1100, 1.1150]
    while len(hs) < 51:
        hs += tops
    hs = hs[:51]
    C = _series([[(0, h, h - 0.01, h - 0.005)] for h in hs])
    lr, vr = _dicts(C, [2013])
    for zk, fk, endf in (("ZD", "FD", _dend), ("Z4", "F4", _h4end)):
        z = [(r["kind"], r["what"], r["known_from"]) for r in lr if r["kind"] in (zk, zk + "x2")]
        want = {(zk + "x2", "ceiling", str(endf(29))), (zk, "ceiling", str(endf(39))),
                (zk + "x2", "floor", str(endf(34))), (zk, "floor", str(endf(44)))}
        check(set(z) == want, "%s zones: %s" % (zk, sorted(z)))
        for r in lr:
            if r["kind"] == zk and r["known_from"] == str(endf(39)):
                check(r["first_watched"] == str(_stamp(40, 0)) and close(float(r["low"]), 1.12) and close(float(r["high"]), 1.12)
                      and close(float(r["atr"]), 0.01, 1e-10), "%s armed level" % zk)
            if r["kind"] == zk + "x2" and r["known_from"] == str(endf(29)):
                check(r["first_watched"] == str(_stamp(30, 0)), "%s two-turn level starts at its second turn" % zk)
        fl = sorted((r["known_from"], r["what"], r["kind"][-1]) for r in lr if r["kind"] in (fk + "C", fk + "J"))
        # high confirmed at day 29 (leg 1.0850 to 1.1200, candidate low 1.1000): 0.382 and 0.5 are used up; 0.618 and J stay
        f29 = sorted(w for k, w, _ in fl if k == str(endf(29)))
        check(f29 == ["floor:0.618", "floor:J"], "%s floors at day 29: %s" % (fk, f29))
        c24 = sorted(w for k, w, _ in fl if k == str(endf(24)))
        check(c24 == ["ceiling:0.618", "ceiling:J"], "%s ceilings at day 24: %s" % (fk, c24))
        check(not [1 for k, w, _ in fl if k == str(endf(19))], "%s: the first swing high gives no levels" % fk)
        for r in lr:
            if r["kind"] == fk + "J" and r["known_from"] == str(endf(29)):
                check(close(float(r["high"]), 1.12 - 0.786 * 0.035) and close(float(r["low"]), 1.12 - 0.886 * 0.035),
                      "%s J band edges" % fk)

    # ---- `run` against a plain minute by minute copy, on random walks (short and long, so every block size is used)
    rng = random.Random(11)
    for days, per in ((40, 110), (60, 1250)):
        X = _random_series(rng, days, per)
        n = X.n
        lo_p, hi_p = min(X.L), max(X.H)
        for trial in range(70 if days == 40 else 25):
            start = X.w0 + rng.randrange(0, 500)
            life = start + rng.randrange(1, n - start)
            p = rng.uniform(lo_p, hi_p)
            w = rng.choice([0.0, 0.0, 0.001, 0.004])
            bands = [(start, p, p + w)]
            for _ in range(rng.randrange(0, 3)):
                f = rng.randrange(start + 1, n)
                q = rng.uniform(p - 0.004, p + 0.004)
                bands.append((f, q, q + rng.choice([0.0, 0.002])))
            bands.sort()
            bo, ao = rng.choice([(True, True), (True, False), (False, True), (True, True)])
            single = rng.random() < 0.2
            a = X.run(start, life, bands, bo, ao, single)
            b = _naive(X, start, life, bands, bo, ao, single)
            check(a == b, "run differs from the minute by minute copy (trial %d): %s vs %s" % (trial, a[:2], b[:2]))
    print("selftest ok: %d checks, %.0fs" % (_checks[0], time.time() - t0))


if __name__ == "__main__":
    main(sys.argv)
