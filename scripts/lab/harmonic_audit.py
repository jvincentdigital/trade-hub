#!/usr/bin/env python3
"""Independent audit of the harmonic study's trade list (docs/harmonic-study.md).

Written from the plan page alone, in the standard library. It takes from the
engine's trade file only what identifies a trade (market, chart, swing size,
pattern, direction, the points X A B C with times, the confirming candle) and
works out everything else from the 1-minute development copy:
D and the stop, the completing minute, the trigger candle and entry minute for
C1 and C2, the entry price, R, the skips, and the results of the seven exits
after costs, before costs and at double cost. It then prints every difference
from the engine's numbers.

  python3 -I scripts/lab/harmonic_audit.py --data <dir> --trades <trades.jsonl.gz>
         [--n 5] [--extra 2] [--seed 7] [--end open|close] [--markets A,B]

Offline. Reads only the development copies (files that end 2018-12-31).
"""
import argparse
import bisect
import collections
import datetime as dt
import gzip
import json
import math
import random
import sys
from array import array
from zoneinfo import ZoneInfo

# ------------------------------------------------------------------ constants
PIP = {'EURUSD': 1e-4, 'GBPUSD': 1e-4, 'XAUUSD': 0.10, 'USDJPY': 0.01,
       'EURGBP': 1e-4, 'EURJPY': 0.01, 'GBPJPY': 0.01}
SPREAD_PIPS = {'EURUSD': 0.8, 'GBPUSD': 1.0, 'USDJPY': 0.9, 'EURGBP': 1.0,
               'EURJPY': 1.3, 'GBPJPY': 2.0}
SPREAD_FIXED = {'EURUSD': 0.00008, 'GBPUSD': 0.00010}  # plan: stated as prices
PAT = {  # rB lo, rB hi, d, s, proj lo, proj hi
    'gartley': (0.568, 0.668, 0.786, 1.05, 1.27, 1.618),
    'bat': (0.382, 0.5, 0.886, 1.13, 1.618, 2.618),
    'butterfly': (0.736, 0.836, 1.27, 1.414, 1.618, 2.618),
    'crab': (0.382, 0.618, 1.618, 2.0, 2.24, 3.618),
}
NY = ZoneInfo('America/New_York')
TOL = 1e-9


def spread_of(m, price):
    if m == 'XAUUSD':
        return 0.28 * price / 1800.0
    if m in SPREAD_FIXED:
        return SPREAD_FIXED[m]
    return SPREAD_PIPS[m] * PIP[m]


def extra_cost(m):
    return 0.07 if m == 'XAUUSD' else 0.0


def pen_of(m):
    return 0.05 if m == 'XAUUSD' else 0.5 * PIP[m]


def slip_of(m):
    return 0.2 * PIP[m]


# ------------------------------------------------------------------ data
class Market:
    def __init__(self, name, path):
        self.name = name
        T, O, H, L, C = array('q'), array('d'), array('d'), array('d'), array('d')
        with gzip.open(path, 'rt') as f:
            next(f)
            for line in f:
                p = line.split(',')
                T.append(int(p[0])); O.append(float(p[1])); H.append(float(p[2]))
                L.append(float(p[3])); C.append(float(p[4]))
        self.T, self.O, self.H, self.L, self.C = T, O, H, L, C
        self.n = len(T)
        if T[-1] >= 1546300800:
            sys.exit('refusing: a bar from 2019 on is in %s' % path)
        self.charts = {}
        self._swings = {}
        self._h4 = None

    # chart candles on UTC clock boundaries, existing candles only
    def chart(self, minutes):
        if minutes in self.charts:
            return self.charts[minutes]
        size = minutes * 60
        T, O, H, L, C = self.T, self.O, self.H, self.L, self.C
        ct, co, chh, cl, cc, fi, li = [], [], [], [], [], [], []
        cur = None
        for j in range(self.n):
            b = T[j] - T[j] % size
            if b != cur:
                if cur is not None:
                    cc.append(C[j - 1]); li.append(j - 1)
                cur = b
                ct.append(b); co.append(O[j]); chh.append(H[j]); cl.append(L[j]); fi.append(j)
            else:
                if H[j] > chh[-1]:
                    chh[-1] = H[j]
                if L[j] < cl[-1]:
                    cl[-1] = L[j]
        cc.append(C[self.n - 1]); li.append(self.n - 1)
        ch = types_ns(ct=ct, o=co, h=chh, l=cl, c=cc, fi=fi, li=li, size=size)
        ch.idx = {t: i for i, t in enumerate(ct)}
        n = len(ct)
        # RSI(14) Wilder
        rsi = [None] * n
        if n > 14:
            g = l_ = 0.0
            for i in range(1, 15):
                d = cc[i] - cc[i - 1]
                g += max(d, 0.0); l_ += max(-d, 0.0)
            ag, al = g / 14.0, l_ / 14.0
            rsi[14] = 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)
            for i in range(15, n):
                d = cc[i] - cc[i - 1]
                ag = (ag * 13 + max(d, 0.0)) / 14.0
                al = (al * 13 + max(-d, 0.0)) / 14.0
                rsi[i] = 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)
        ch.rsi = rsi
        ema = [cc[0]] * n
        a = 2.0 / 21.0
        for i in range(1, n):
            ema[i] = a * cc[i] + (1 - a) * ema[i - 1]
        ch.ema = ema
        # true range and ATR
        tr = [chh[0] - cl[0]] + [max(chh[i], cc[i - 1]) - min(cl[i], cc[i - 1]) for i in range(1, n)]
        atr = [None] * n
        for i in range(13, n):
            atr[i] = sum(tr[i - 13:i + 1]) / 14.0
        ch.atr = atr
        self.charts[minutes] = ch
        return ch

    # confirmed swings with size k: list of (point candle idx, price, confirm idx, kind)
    def swings(self, minutes, k):
        key = (minutes, k)
        if key in self._swings:
            return self._swings[key]
        ch = self.chart(minutes)
        n = len(ch.ct)
        out = []
        high_forming = True
        cand_i, cand_p = 0, ch.h[0]
        i = 1
        while i < n:
            if high_forming:
                if ch.h[i] > cand_p:
                    cand_i, cand_p = i, ch.h[i]
                elif ch.atr[i] is not None and ch.l[i] <= cand_p - k * ch.atr[i]:
                    out.append((cand_i, cand_p, i, 'H'))
                    lo_i, lo_p = cand_i + 1, ch.l[cand_i + 1]
                    for q in range(cand_i + 1, i + 1):
                        if ch.l[q] < lo_p:
                            lo_i, lo_p = q, ch.l[q]
                    cand_i, cand_p = lo_i, lo_p
                    high_forming = False
            else:
                if ch.l[i] < cand_p:
                    cand_i, cand_p = i, ch.l[i]
                elif ch.atr[i] is not None and ch.h[i] >= cand_p + k * ch.atr[i]:
                    out.append((cand_i, cand_p, i, 'L'))
                    hi_i, hi_p = cand_i + 1, ch.h[cand_i + 1]
                    for q in range(cand_i + 1, i + 1):
                        if ch.h[q] > hi_p:
                            hi_i, hi_p = q, ch.h[q]
                    cand_i, cand_p = hi_i, hi_p
                    high_forming = True
            i += 1
        self._swings[key] = out
        return out

    # 4-hour candles on New York time (buckets start 01, 05, 09, 13, 17, 21)
    def h4(self):
        if self._h4 is not None:
            return self._h4
        T, O, H, L, C = self.T, self.O, self.H, self.L, self.C
        off_cache = {}
        starts, closes, firstT = [], [], []
        cur = None
        for j in range(self.n):
            t = T[j]
            hr = t // 3600
            off = off_cache.get(hr)
            if off is None:
                off = int(dt.datetime.fromtimestamp(hr * 3600, NY).utcoffset().total_seconds())
                off_cache[hr] = off
            local = t + off
            b = ((local - 3600) // 14400) * 14400 + 3600
            if b != cur:
                if cur is not None:
                    closes.append(C[j - 1])
                cur = b
                starts.append(b); firstT.append(t)
        closes.append(C[self.n - 1])
        ema = [closes[0]] * len(closes)
        a = 2.0 / 51.0
        for i in range(1, len(closes)):
            ema[i] = a * closes[i] + (1 - a) * ema[i - 1]
        self._h4 = (starts, closes, ema, firstT)
        return self._h4

    def trend_ok(self, buy, confirm_close):
        starts, closes, ema, firstT = self.h4()
        i = bisect.bisect_right(firstT, confirm_close) - 1
        while i >= 0:
            end_local = starts[i] + 14400
            naive = dt.datetime(1970, 1, 1) + dt.timedelta(seconds=end_local)
            end_utc = naive.replace(tzinfo=NY).timestamp()
            if end_utc <= confirm_close:
                return closes[i] > ema[i] if buy else closes[i] < ema[i]
            i -= 1
        return False


class types_ns:  # tiny namespace
    def __init__(self, **kw):
        self.__dict__.update(kw)


# ------------------------------------------------------------------ one trade
def audit_trade(M, tr, end_mode):
    """Return (mine: dict, notes: list). Keys mirror the engine's trade fields."""
    mk, chm, k, pat = tr['market'], tr['chart'], tr['k'], tr['pattern']
    buy = tr['dir'] == 1
    ch = M.chart(chm)
    size = ch.size
    X, A, B, C = (tr[p]['price'] for p in 'xabc')
    rBlo, rBhi, dd, ss, pjlo, pjhi = PAT[pat]
    XA = (A - X) if buy else (X - A)
    D = A - dd * XA if buy else A + dd * XA
    stop = A - ss * XA if buy else A + ss * XA
    mine = {'d': D, 'stop': stop}
    notes = []
    # pattern checks from the points
    rB = ((A - B) / XA) if buy else ((B - A) / XA)
    rC = ((C - B) / (A - B)) if buy else ((B - C) / (B - A))
    pj = ((C - D) / (C - B)) if buy else ((D - C) / (B - C))
    if not (rBlo - TOL <= rB <= rBhi + TOL):
        notes.append('rB %.6f outside %s range' % (rB, pat))
    if not (0.382 - TOL <= rC <= 0.886 + TOL):
        notes.append('rC %.6f outside range' % rC)
    if not (pjlo - TOL <= pj <= pjhi + TOL):
        notes.append('proj %.6f outside %s range' % (pj, pat))
    # swings: the points must be the confirmed swings, and C confirmed at confirmTime
    sw = M.swings(chm, k)
    ci = ch.idx.get(tr['confirmTime'])
    if ci is None:
        notes.append('confirmTime is not a chart candle')
        return mine, notes
    kinds = ('L', 'H', 'L', 'H') if buy else ('H', 'L', 'H', 'L')
    pos = None
    for q, s in enumerate(sw):
        if s[2] == ci and ch.ct[s[0]] == tr['c']['time'] and s[3] == kinds[3]:
            pos = q
            break
    if pos is None or pos < 3:
        notes.append('no swing C at the point time confirmed by that candle (my swings)')
    else:
        for name, s in zip('xabc', sw[pos - 3:pos + 1]):
            if ch.ct[s[0]] != tr[name]['time'] or abs(s[1] - tr[name]['price']) > TOL:
                notes.append('point %s differs from my swing: %s %s vs %s %s' % (
                    name, ch.ct[s[0]], s[1], tr[name]['time'], tr[name]['price']))
    close_conf = tr['confirmTime'] + size
    if close_conf != tr['confirmClose']:
        notes.append('confirmClose %s != confirmTime+size %s' % (tr['confirmClose'], close_conf))
    # candidate-low rule: nothing inside the confirming candle may reach D
    cidx_c = ch.idx.get(tr['c']['time'])
    if cidx_c is not None:
        if buy:
            cand = min(ch.l[cidx_c + 1:ci + 1])
            if cand <= D:
                notes.append('pattern should be skipped: candidate low %s <= D %s' % (cand, D))
        else:
            cand = max(ch.h[cidx_c + 1:ci + 1])
            if cand >= D:
                notes.append('pattern should be skipped: candidate high %s >= D %s' % (cand, D))
    # trend flag (C3's test) at the confirming candle's close
    mine['trend'] = M.trend_ok(buy, tr['confirmClose'])
    T, O, H, L, Cl = M.T, M.O, M.H, M.L, M.C
    # ------------------------------------------------------------ the wait
    spW = spread_of(mk, D)
    pen = pen_of(mk)
    lim = None
    if ci + 192 < len(ch.ct):
        lim = ch.ct[ci + 192] + size
    if pos is not None and pos + 1 < len(sw):
        nx = ch.ct[sw[pos + 1][2]] + size
        lim = nx if lim is None else min(lim, nx)
    j = bisect.bisect_left(T, tr['confirmClose'])
    comp = None
    n = M.n
    while j < n:
        if lim is not None and T[j] >= lim:
            break
        if buy:
            c_ = H[j] > C
            d_ = L[j] <= D - spW - pen
        else:
            c_ = L[j] < C
            d_ = H[j] >= D + pen
        if c_:
            break
        if d_:
            comp = j
            break
        j += 1
    if comp is None:
        mine['completeTime'] = None
        mine['status'] = 'wait-cancelled'
        return mine, notes
    mine['completeTime'] = T[comp]
    entry = tr['entry']
    sl_ = slip_of(mk)
    # target levels of X1, X2
    t1 = D + 0.382 * (A - D) if buy else D - 0.382 * (D - A)
    t2 = D + 0.618 * (A - D) if buy else D - 0.618 * (D - A)
    mine['target1'], mine['target2'] = t1, t2
    # ------------------------------------------------------------ the entry
    if entry == 'E0':
        fill = comp
        spE = spW
        if buy:
            ask, bid = D, D - spE
        else:
            bid, ask = D, D + spE
        mine['triggerTime'] = None
    else:
        cc0 = ch.idx[T[comp] - T[comp] % size]
        want_low = buy
        trig = None
        flag = False
        for q in range(cc0, min(cc0 + 12, len(ch.ct))):
            if entry == 'C1':
                r = ch.rsi[q]
                if r is not None and ((r <= 30) if buy else (r >= 70)):
                    flag = True
                ok = flag and ((ch.c[q] > ch.ema[q]) if buy else (ch.c[q] < ch.ema[q]))
            else:  # C2
                rng = ch.h[q] - ch.l[q]
                if q == 0 or rng <= 0:
                    ok = False
                elif buy:
                    ok = ch.c[q] > ch.h[q - 1] and ch.c[q] >= ch.l[q] + rng * 2.0 / 3.0
                else:
                    ok = ch.c[q] < ch.l[q - 1] and ch.c[q] <= ch.l[q] + rng / 3.0
            if ok:
                trig = q
                break
        if trig is None:
            mine['triggerTime'] = None
            mine['status'] = 'noTrigger'
            return mine, notes
        mine['triggerTime'] = ch.ct[trig]
        # cancel: any minute from the completing minute to the trigger's close
        last = ch.li[trig]
        hit = False
        for q in range(comp, last + 1):
            if buy:
                if L[q] <= stop or H[q] >= t1:
                    hit = True
                    break
            else:
                if H[q] + spW >= stop or L[q] + spW <= t1:
                    hit = True
                    break
        if hit:
            mine['status'] = 'cancelled'
            return mine, notes
        if trig + 1 >= len(ch.ct):
            mine['status'] = 'noTrigger'
            notes.append('no candle after the trigger')
            return mine, notes
        fill = ch.fi[trig + 1]
        bid = O[fill]
        spE = spread_of(mk, bid)
        ask = bid + spE
        if buy:
            if ask >= t1 or bid <= stop:
                mine['status'] = 'skipEntry'
        else:
            if bid <= t1 or ask >= stop:
                mine['status'] = 'skipEntry'
    mine['fillTime'] = T[fill]
    entryP = ask if buy else bid
    R = (ask - stop) if buy else (stop - bid)
    cost = spE + extra_cost(mk)
    mine.update(entryPrice=entryP, entryBid=bid, spread=spE, cost=cost, R=R)
    mine['hours'] = 3 <= dt.datetime.fromtimestamp(T[fill], NY).hour <= 11
    if mine.get('status') == 'skipEntry':
        mine['R'] = None
        mine['entryPrice'] = entryP
        return mine, notes
    if R < 5 * cost:
        mine['status'] = 'skipRisk'
        return mine, notes
    mine['status'] = 'filled'
    # ------------------------------------------------------------ the exits
    fci = ch.idx[T[fill] - T[fill] % size]
    tidx = ch.fi[fci + 480] if fci + 480 < len(ch.ct) else None
    last_bar = n - 1

    def stop_hit(q, st):
        return (L[q] <= st) if buy else (H[q] + spE >= st)

    def stop_px(q, st):
        if buy:
            return O[q] if O[q] <= st else st
        a_ = O[q] + spE
        return a_ if a_ >= st else st

    def tgt_hit(q, tg):
        return (H[q] >= tg) if buy else (L[q] + spE <= tg)

    def market_px(q, px):  # a market close at price px (a Bid) -> Bid for buy exit, Ask for sell exit
        return px if buy else px + spE

    def walk(start, st, tg, first_is_fill):
        """returns (how, minute, price, market_slip 0/1)"""
        q = start
        while True:
            if not (first_is_fill and q == start):
                if tidx is not None and q == tidx:
                    return 'time', q, market_px(q, O[q]), 1
                if end_mode == 'open' and q == last_bar:
                    return 'end', q, market_px(q, O[q]), 1
            if stop_hit(q, st):
                return 'stop', q, stop_px(q, st), 1
            if not (first_is_fill and q == start) and tg is not None and tgt_hit(q, tg):
                return 'target', q, tg, 0
            if q == last_bar:
                return 'end', q, market_px(q, Cl[q]), 1
            q += 1

    def gross(px):
        return (px - entryP) if buy else (entryP - px)

    entry_slip = 1 if entry != 'E0' else 0
    ex = []
    for xi in range(7):
        if xi == 0:
            tg = t1
        elif xi == 1:
            tg = t2
        elif xi == 2:
            tg = t1
        else:
            nR = (1, 1.5, 2, 3)[xi - 3]
            tg = entryP + nR * R if buy else entryP - nR * R
        how, q, px, sl = walk(fill, stop, tg, True)
        if xi == 2:
            if how == 'target':
                gr = 0.5 * gross(px)
                slips = entry_slip
                q1 = q
                # the rest: nothing happens in the minute of the first half
                how2, q2, px2, sl2 = walk(q1 + 1, entryP, t2, False) if q1 < last_bar else ('end', q1, market_px(q1, Cl[q1]), 1)
                gr += 0.5 * gross(px2)
                slips += 0.5 * sl2
                how, q = how2, q2
                half = True
            else:
                gr = gross(px)
                slips = entry_slip + sl
                half = False
        else:
            gr = gross(px)
            slips = entry_slip + sl
            half = None
        after = (gr - slips * sl_ - extra_cost(mk)) / R
        adj = (cost + slips * sl_) / R
        ex.append({'how': how, 'time': T[q], 'after': after, 'before': after + adj,
                   'double': after - adj, 'slips': slips, 'half': half})
    mine['exits'] = ex
    return mine, notes


# ------------------------------------------------------------------ comparing
def close(a, b, tol=TOL):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def compare(tr, mine, notes):
    diffs = []
    for n_ in notes:
        diffs.append(('note', n_))
    st = tr['status']
    ms = mine.get('status')
    if st in ('noTrigger', 'cancelled') and ms == 'wait-cancelled':
        diffs.append(('status', 'engine %s but my wait cancelled before completion' % st))
        return diffs
    for key in ('completeTime',):
        if mine.get(key) != tr.get(key):
            diffs.append((key, 'mine %s engine %s' % (mine.get(key), tr.get(key))))
    if ms == 'wait-cancelled':
        return diffs
    for key in ('d', 'stop', 'target1', 'target2'):
        if not close(mine.get(key), tr.get(key)):
            diffs.append((key, 'mine %r engine %r' % (mine.get(key), tr.get(key))))
    if mine.get('trend') != tr.get('trend'):
        diffs.append(('trend', 'mine %s engine %s' % (mine.get('trend'), tr.get('trend'))))
    if tr['entry'] != 'E0' and mine.get('triggerTime') != tr.get('triggerTime'):
        diffs.append(('triggerTime', 'mine %s engine %s' % (mine.get('triggerTime'), tr.get('triggerTime'))))
    if ms in ('noTrigger', 'cancelled'):
        if ms != st:
            if {ms, st} <= {'noTrigger', 'cancelled'}:
                diffs.append(('status-label', 'mine %s engine %s (no trade either way)' % (ms, st)))
            else:
                diffs.append(('status', 'mine %s engine %s' % (ms, st)))
        return diffs
    if ms != st:
        diffs.append(('status', 'mine %s engine %s' % (ms, st)))
    for key in ('fillTime',):
        if mine.get(key) != tr.get(key):
            diffs.append((key, 'mine %s engine %s' % (mine.get(key), tr.get(key))))
    for key in ('entryPrice', 'entryBid', 'spread', 'cost', 'R'):
        if not close(mine.get(key), tr.get(key)):
            diffs.append((key, 'mine %r engine %r' % (mine.get(key), tr.get(key))))
    if tr['entry'] == 'E0' and mine.get('hours') != tr.get('hours'):
        diffs.append(('hours', 'mine %s engine %s' % (mine.get('hours'), tr.get('hours'))))
    if ms == 'filled' and st == 'filled':
        for xi in range(7):
            m, e = mine['exits'][xi], tr['exits'][xi]
            for key in ('how', 'time'):
                if m[key] != e[key]:
                    diffs.append(('X%d.%s' % (xi + 1, key), 'mine %s engine %s' % (m[key], e[key])))
            for key in ('after', 'before', 'double'):
                if not close(m[key], e[key], 1e-6):
                    diffs.append(('X%d.%s' % (xi + 1, key), 'mine %.8f engine %.8f' % (m[key], e[key])))
            if abs(m['slips'] - e['slips']) > 1e-9:
                diffs.append(('X%d.slips' % (xi + 1), 'mine %s engine %s' % (m['slips'], e['slips'])))
    return diffs


# ------------------------------------------------------------------ main
def pick(trades, n, extra, seed, markets):
    rng = random.Random(seed)
    strata = collections.defaultdict(list)
    for t in trades:
        if t['entry'] in ('E0', 'C1', 'C2') and t['market'] in markets:
            strata[(t['market'], t['entry'], t['dir'])].append(t)
    chosen = {}
    for key in sorted(strata):
        lst = strata[key]
        filled = [t for t in lst if t['status'] == 'filled']
        other = [t for t in lst if t['status'] != 'filled']
        for t in rng.sample(filled, min(n, len(filled))):
            chosen[t['id'] + t['entry']] = t
        # the other statuses, spread over the labels present
        by = collections.defaultdict(list)
        for t in other:
            by[t['status']].append(t)
        labels = sorted(by)
        for q in range(min(extra, len(other))):
            lab = labels[q % len(labels)]
            t = rng.choice(by[lab])
            chosen[t['id'] + t['entry']] = t
    # the rare ones: time exits and end of data, from the engine's own list
    rare = [t for t in trades if t['market'] in markets and t['status'] == 'filled'
            and t['entry'] in ('E0', 'C1', 'C2') and any(e['how'] in ('time', 'end') for e in t['exits'])]
    for t in rare:
        chosen[t['id'] + t['entry']] = t
    return list(chosen.values()), len(rare)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--trades', required=True)
    ap.add_argument('--n', type=int, default=5)
    ap.add_argument('--extra', type=int, default=2)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--end', default='open', choices=['open', 'close'])
    ap.add_argument('--markets', default='EURUSD,GBPUSD,XAUUSD,USDJPY,EURGBP,EURJPY,GBPJPY')
    a = ap.parse_args()
    markets = a.markets.split(',')
    trades = [json.loads(l) for l in gzip.open(a.trades, 'rt')]
    sample, nrare = pick(trades, a.n, a.extra, a.seed, markets)
    print('sample %d trades (%d rare time/end exits included)' % (len(sample), nrare))
    by_mk = collections.defaultdict(list)
    for t in sample:
        by_mk[t['market']].append(t)
    count = collections.Counter()
    agree = collections.Counter()
    ndiff = 0
    exits_seen = collections.Counter()
    for mk in markets:
        if mk not in by_mk:
            continue
        M = Market(mk, '%s/%s_1m.csv.gz' % (a.data.rstrip('/'), mk))
        for t in by_mk[mk]:
            mine, notes = audit_trade(M, t, a.end)
            diffs = compare(t, mine, notes)
            kind = (t['entry'], 'buy' if t['dir'] == 1 else 'sell', t['status'])
            count[kind] += 1
            if t['status'] == 'filled':
                for e in t['exits']:
                    exits_seen[e['how']] += 1
            if diffs:
                ndiff += 1
                print('DIFF %s %s %s status=%s fill=%s' % (t['id'], t['entry'], t['pattern'], t['status'], t.get('fillTime')))
                for f, msg in diffs:
                    print('   %-12s %s' % (f, msg))
            else:
                agree[kind] += 1
        del M
    print('compared %d trades, %d with a difference' % (len(sample), ndiff))
    for kind in sorted(count):
        print('  %-28s compared %3d agree %3d' % (' '.join(kind), count[kind], agree[kind]))
    print('engine exits in the sample by kind:', dict(exits_seen))


if __name__ == '__main__':
    main()
