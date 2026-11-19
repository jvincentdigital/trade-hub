"""Slow trend following on six markets (docs/slow-trend-study.md, Amendments 1 to 3).

Python standard library only. Play money research; nothing here talks to a broker.

  python3 -I scripts/lab/slow_trend.py selftest
  python3 -I scripts/lab/slow_trend.py daily <1-minute .csv.gz> [<more .csv.gz> ...] --out <daily.csv>
  python3 -I scripts/lab/slow_trend.py run --daily <dir> --rates <dir> --out <dir>

daily: a day's close is the close of the last 1-minute candle stamped before
17:00 New York (a candle at 17:00 or later belongs to the next day).
run: the rule, both sizes, always long, 1,000 luck runs, the five lines, the
reading, each market alone, 2026 as its own line, the overnight-rate second
look. Writes slow-trend.json and slow-trend.md once; refuses if they exist.
"""

import csv
import gzip
import json
import math
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')

# Markets: (name, kind, base currency, quote currency, round-trip cost in basis points)
MARKETS = [
    ('EURUSD', 'pair', 'EUR', 'USD', 1.0),
    ('GBPUSD', 'pair', 'GBP', 'USD', 1.0),
    ('USDJPY', 'pair', 'USD', 'JPY', 1.0),
    ('EURGBP', 'pair', 'EUR', 'GBP', 1.0),
    ('XAUUSD', 'gold', None, 'USD', 2.0),
    ('SPXUSD', 'index', None, 'USD', 1.5),
]
TARGET_VOL = 0.10
MAX_SIZE = 3.0
VOL_DAYS = 60
DAYS_PER_YEAR = 261  # Amendment 3, reading 2
DIVIDEND = 0.018
MARKUP = 0.01
LUCK_RUNS = 1000
LUCK_SEED = 1
SHIFT_MIN, SHIFT_MAX = 13, 120
MAIN = ((2010, 1), (2025, 12))
LATE = ((2019, 1), (2025, 12))
PART_2026 = ((2026, 1), (2026, 12))
CCY_BIS = {'USD': 'US', 'EUR': 'XM', 'GBP': 'GB', 'JPY': 'JP'}
CCY_OECD = {'USD': 'US', 'EUR': 'EZ', 'GBP': 'GB', 'JPY': 'JP'}


# ---------------------------------------------------------------- daily closes


def session_date(t):
    """The trading day of a 1-minute candle stamped t (UTC seconds): candles from 17:00 New York on belong to the next day."""
    local = datetime.fromtimestamp(t, timezone.utc).astimezone(NY)
    return (local + timedelta(hours=7)).date()


def daily_closes(rows):
    """rows: (time, close) in time order. Returns [(date, close)], one per trading day, the last candle's close."""
    out = []
    for t, c in rows:
        d = session_date(t)
        if out and out[-1][0] == d:
            out[-1] = (d, c)
        elif out and d < out[-1][0]:
            raise SystemExit('candles out of order at %d' % t)
        else:
            out.append((d, c))
    return out


def read_minutes(paths):
    rows = []
    for p in paths:
        with gzip.open(p, 'rt') as f:
            head = next(f)
            if not head.startswith('time,'):
                raise SystemExit('unexpected header in %s' % p)
            for line in f:
                parts = line.split(',')
                rows.append((int(parts[0]), float(parts[4])))
    rows.sort()
    dedup = []
    for r in rows:
        if dedup and dedup[-1][0] == r[0]:
            raise SystemExit('the same minute twice: %d' % r[0])
        dedup.append(r)
    return dedup


# ---------------------------------------------------------------- months


def month_ends(days):
    """[(date, close)] -> list of (year, month, last date with a close, close), in order."""
    out = []
    for d, c in days:
        if out and (out[-1][0], out[-1][1]) == (d.year, d.month):
            out[-1] = (d.year, d.month, d, c)
        else:
            out.append((d.year, d.month, d, c))
    return out


def ym_index(y, m):
    return y * 12 + (m - 1)


def yearly_vol(days, end_date):
    """Yearly volatility of daily log changes over the VOL_DAYS trading days up to and including end_date."""
    closes = [c for d, c in days if d <= end_date]
    if len(closes) < VOL_DAYS + 1:
        return None
    window = closes[-(VOL_DAYS + 1):]
    rets = [math.log(window[i] / window[i - 1]) for i in range(1, len(window))]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(DAYS_PER_YEAR)


def market_months(days):
    """Per position month: the signal from the month end before, the month's change and the calm size.

    Returns {ym: dict(change, direction, size_sized, prev_end)} for every month m that has
    a month-end close at m and at m-1 and at m-13 (a market joins with 12 months of history).
    """
    ends = month_ends(days)
    by = {ym_index(y, m): (d, c) for y, m, d, c in ends}
    out = {}
    for k in sorted(by):
        if k - 1 not in by or k - 13 not in by:
            continue
        d0, p0 = by[k - 1]
        _, p1 = by[k]
        _, p_old = by[k - 13]
        if p0 > p_old:
            direction = 1
        elif p0 < p_old:
            direction = -1
        else:
            direction = 0  # Amendment 3, reading 3: no position on an exact tie
        vol = yearly_vol(days, d0)
        size = None if vol is None or vol <= 0 else min(MAX_SIZE, TARGET_VOL / vol)
        out[k] = {'change': p1 / p0 - 1.0, 'direction': direction, 'size_sized': size, 'prev_end': d0.isoformat()}
    return out


# ---------------------------------------------------------------- rates


def read_bis(path):
    """{area: {ym: rate in percent}} from the BIS file (end of month)."""
    out = {}
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            v = r['OBS_VALUE'].strip()
            if not v or v.upper() == 'NAN':
                continue
            y, m = r['TIME_PERIOD'].split('-')
            out.setdefault(r['REF_AREA'], {})[ym_index(int(y), int(m))] = float(v)
    return out


def read_fred(path):
    out = {}
    with open(path, newline='') as f:
        rd = csv.reader(f)
        next(rd)
        for d, v in rd:
            if v in ('', '.'):
                continue
            y, m, _ = d.split('-')
            out[ym_index(int(y), int(m))] = float(v)
    return out


def policy_rates(rates_dir):
    """Amendment 2: BIS end-of-month policy rates; Japan's empty months from the OECD overnight call rate."""
    bis = read_bis(os.path.join(rates_dir, 'bis_cbpol_monthly_US_XM_GB_JP.csv'))
    jp_call = read_fred(os.path.join(rates_dir, 'fred_IRSTCI01JPM156N.csv'))
    out = {}
    for ccy, area in CCY_BIS.items():
        out[ccy] = dict(bis[area])
    filled = []
    first, last = min(bis['US']), max(bis['US'])
    for k in range(first, last + 1):
        if k not in out['JPY']:
            out['JPY'][k] = jp_call[k]
            filled.append(k)
    return out, filled


def overnight_rates(rates_dir):
    """Amendment 2, the second look: OECD call money / interbank monthly averages; a missing month carries the last value."""
    out = {}
    for ccy, area in CCY_OECD.items():
        out[ccy] = read_fred(os.path.join(rates_dir, 'fred_IRSTCI01%sM156N.csv' % area))
    return out


def rate_at(series, k):
    """The rate for month k, carrying the last published value forward when k is past the end."""
    if k in series:
        return series[k]
    earlier = [x for x in series if x <= k]
    if not earlier:
        raise SystemExit('no rate at or before month %d' % k)
    return series[max(earlier)]


def carry(kind, base, quote, rates, k):
    """Yearly carry of a long position (fraction), rates of the month before k (Amendment 2)."""
    prev = k - 1
    if kind == 'pair':
        return (rate_at(rates[base], prev) - rate_at(rates[quote], prev)) / 100.0
    if kind == 'gold':
        return -rate_at(rates['USD'], prev) / 100.0
    return DIVIDEND - rate_at(rates['USD'], prev) / 100.0


# ---------------------------------------------------------------- results


def position_results(months, positions, kind, base, quote, rt_bps, rates, cost_x=1.0, markup_x=1.0):
    """Monthly result of one market for given positions {k: signed size}. Cost: half a round trip on every change of position."""
    out = {}
    prev = 0.0
    for k in sorted(positions):
        x = positions[k]
        cost = 0.5 * rt_bps / 10000.0 * cost_x * abs(x - prev)
        fin = (x * carry(kind, base, quote, rates, k) - abs(x) * MARKUP * markup_x) / 12.0
        out[k] = x * months[k]['change'] - cost + fin
        prev = x
    return out


def positions_of(months, sized, directions=None, always_long=False):
    out = {}
    for k, v in months.items():
        size = v['size_sized'] if sized else 1.0
        if size is None:
            continue
        d = 1 if always_long else (directions[k] if directions is not None else v['direction'])
        out[k] = size * d
    return out


def portfolio(per_market):
    """Plain average, month by month, of the markets that have a result that month."""
    keys = sorted(set().union(*[set(r) for r in per_market.values()]))
    out = {}
    for k in keys:
        vals = [r[k] for r in per_market.values() if k in r]
        out[k] = sum(vals) / len(vals)
    return out


def in_span(k, span):
    return ym_index(*span[0]) <= k <= ym_index(*span[1])


def stats(series, span):
    v = [series[k] for k in sorted(series) if in_span(k, span)]
    n = len(v)
    if n == 0:
        return {'n': 0, 'mean': None, 't': None, 'total': 0.0, 'yearly_vol': None}
    mean = sum(v) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in v) / (n - 1)) if n > 1 else float('nan')
    t = mean / (sd / math.sqrt(n)) if n > 1 and sd > 0 else float('nan')
    return {'n': n, 'mean': mean, 't': t, 'total': sum(v), 'yearly_vol': sd * math.sqrt(12) if n > 1 else None}


def by_year(series, span):
    out = {}
    for k, v in series.items():
        if in_span(k, span):
            out[k // 12] = out.get(k // 12, 0.0) + v
    return dict(sorted(out.items()))


def worst_drop(series, span):
    peak = cum = 0.0
    worst = 0.0
    for k in sorted(series):
        if not in_span(k, span):
            continue
        cum += series[k]
        peak = max(peak, cum)
        worst = min(worst, cum - peak)
    return worst


def shifted(directions, shift):
    """Each market keeps its own sequence of directions, shifted in time by `shift` months, wrapped around."""
    keys = sorted(directions)
    n = len(keys)
    vals = [directions[k] for k in keys]
    return {keys[i]: vals[(i - shift) % n] for i in range(n)}


def percentile_95(values):
    """The 95th percentile as the 950th of 1,000 sorted values (nearest rank)."""
    v = sorted(values)
    return v[math.ceil(0.95 * len(v)) - 1]


def evaluate(data, rates, rng_seed=LUCK_SEED, luck_runs=LUCK_RUNS):
    """Everything the reading needs. data: {market: months dict}."""
    meta = {m[0]: m for m in MARKETS}

    def run(sized, rates_, cost_x=1.0, markup_x=1.0, directions=None, always_long=False):
        per = {}
        for name, months in data.items():
            _, kind, base, quote, rt = meta[name]
            pos = positions_of(months, sized, (directions or {}).get(name), always_long)
            per[name] = position_results(months, pos, kind, base, quote, rt, rates_, cost_x, markup_x)
        return per

    sized = run(True, rates)
    plain = run(False, rates)
    long_sized = run(True, rates, always_long=True)
    doubled = run(True, rates, cost_x=2.0, markup_x=2.0)
    port = portfolio(sized)
    port_long = portfolio(long_sized)
    port_doubled = portfolio(doubled)

    rng = random.Random(rng_seed)
    luck = []
    for _ in range(luck_runs):
        dirs = {}
        for name, months in data.items():
            d = {k: v['direction'] for k, v in months.items()}
            dirs[name] = shifted(d, rng.randint(SHIFT_MIN, SHIFT_MAX))
        luck.append(stats(portfolio(run(True, rates, directions=dirs)), MAIN)['mean'])

    s_main = stats(port, MAIN)
    late_years = by_year(port, LATE)
    p95 = percentile_95(luck)
    lines = [
        {'line': 1, 'rule': '2010 to 2025: the average monthly result is above zero with t of 2 or more',
         'value': {'mean': s_main['mean'], 't': s_main['t']}, 'ok': s_main['mean'] > 0 and s_main['t'] >= 2},
        {'line': 2, 'rule': '2019 to 2025: the total is above zero, and at least 4 of the 7 years are',
         'value': {'total': stats(port, LATE)['total'], 'years_above': sum(1 for v in late_years.values() if v > 0)},
         'ok': stats(port, LATE)['total'] > 0 and sum(1 for v in late_years.values() if v > 0) >= 4},
        {'line': 3, 'rule': '2010 to 2025: it ends ahead of always long',
         'value': {'rule': s_main['total'], 'always_long': stats(port_long, MAIN)['total']},
         'ok': s_main['total'] > stats(port_long, MAIN)['total']},
        {'line': 4, 'rule': '2010 to 2025: it is above the 95th percentile of the luck runs',
         'value': {'mean': s_main['mean'], 'p95': p95, 'runs_below': sum(1 for x in luck if x < s_main['mean'])},
         'ok': s_main['mean'] > p95},
        {'line': 5, 'rule': '2010 to 2025: still above zero with the markup and the trading costs doubled',
         'value': {'total': stats(port_doubled, MAIN)['total']}, 'ok': stats(port_doubled, MAIN)['total'] > 0},
    ]
    passed = all(x['ok'] for x in lines)
    return {
        'sized': sized, 'plain': plain, 'long_sized': long_sized,
        'port': port, 'port_plain': portfolio(plain), 'port_long': port_long, 'port_doubled': port_doubled,
        'luck_means': luck, 'lines': lines, 'pass': passed,
        'reading': 'Worth a play account' if passed else 'Not there',
    }


# ---------------------------------------------------------------- self-test


def selftest():
    ok = True

    def check(name, got, want, tol=1e-12):
        nonlocal ok
        good = (abs(got - want) <= tol) if isinstance(want, float) else got == want
        print('%s  %s: got %r, want %r' % ('PASS' if good else 'FAIL', name, got, want))
        ok = ok and good

    # session dates: 16:59 New York stays, 17:00 moves to the next day (winter, UTC-5)
    t1659 = int(datetime(2024, 1, 10, 21, 59, tzinfo=timezone.utc).timestamp())
    t1700 = int(datetime(2024, 1, 10, 22, 0, tzinfo=timezone.utc).timestamp())
    check('16:59 New York is that day', session_date(t1659), date(2024, 1, 10))
    check('17:00 New York is the next day', session_date(t1700), date(2024, 1, 11))
    # summer (UTC-4): 16:59 New York is 20:59 UTC
    t_s = int(datetime(2024, 7, 10, 20, 59, tzinfo=timezone.utc).timestamp())
    check('summer 16:59 New York is that day', session_date(t_s), date(2024, 7, 10))
    days = daily_closes([(t1659 - 60, 1.0), (t1659, 2.0), (t1700, 3.0)])
    check('daily close is the last candle before 17:00', days, [(date(2024, 1, 10), 2.0), (date(2024, 1, 11), 3.0)])

    # a hand-made market: month-end prices rise for 14 months, then one fall
    d = []
    day0 = date(2010, 1, 1)
    price = 100.0
    for i in range(500):
        dd = day0 + timedelta(days=i)
        if dd.weekday() >= 5:
            continue
        price *= 1.001 if dd < date(2011, 3, 1) else 0.999
        d.append((dd, price))
    months = market_months(d)
    first = min(months)
    check('a market joins after 12 months of history', first, ym_index(2011, 2))
    check('rising for 12 months gives a long', months[ym_index(2011, 2)]['direction'], 1)
    # a constant daily change has (almost) no volatility: the size hits its cap of 3
    check('a calm market is capped at size 3', months[ym_index(2011, 2)]['size_sized'], 3.0)

    # costs: flip from +1 to -1 pays one round trip on the size (two halves)
    rates = {c: {k: 0.0 for k in range(ym_index(2000, 1), ym_index(2030, 1))} for c in ('USD', 'EUR', 'GBP', 'JPY')}
    k1, k2 = ym_index(2012, 1), ym_index(2012, 2)
    mm = {k1: {'change': 0.0}, k2: {'change': 0.0}}
    r = position_results(mm, {k1: 1.0, k2: -1.0}, 'pair', 'EUR', 'USD', 1.0, rates, markup_x=0.0)
    check('opening pays half a round trip', r[k1], -0.00005)
    check('a flip pays one round trip', r[k2], -0.0001)
    r = position_results(mm, {k1: 1.0, k2: 1.5}, 'pair', 'EUR', 'USD', 1.0, rates, markup_x=0.0)
    check('a size change pays half a round trip on the change', r[k2], -0.000025)
    # financing: EUR 4%, USD 1% -> long EUR/USD earns 3% a year, minus the 1% markup
    rates2 = {c: dict(rates[c]) for c in rates}
    for k in rates2['EUR']:
        rates2['EUR'][k] = 4.0
        rates2['USD'][k] = 1.0
    k5 = ym_index(2012, 5)
    mm2 = {k5: {'change': 0.0}}
    r = position_results(mm2, {k5: 1.0}, 'pair', 'EUR', 'USD', 0.0, rates2)
    check('pair long earns base minus quote, pays the markup', r[k5], (0.03 - 0.01) / 12)
    r = position_results(mm2, {k5: -2.0}, 'pair', 'EUR', 'USD', 0.0, rates2)
    check('pair short pays the carry on its size, and the markup', r[k5], (-2 * 0.03 - 2 * 0.01) / 12)
    r = position_results(mm2, {k5: 1.0}, 'gold', None, 'USD', 0.0, rates2)
    check('gold long pays the dollar rate', r[k5], (-0.01 - 0.01) / 12)
    r = position_results(mm2, {k5: -1.0}, 'index', None, 'USD', 0.0, rates2)
    check('index short earns the rate and pays the dividend', r[k5], (-(0.018 - 0.01) - 0.01) / 12)
    # the change: a long of size 2 on a +1% month makes 2%
    k9 = ym_index(2012, 9)
    r = position_results({k9: {'change': 0.01}}, {k9: 2.0}, 'pair', 'EUR', 'USD', 0.0, rates, markup_x=0.0)
    check('size times direction times change', r[k9], 0.02)
    # shift wraps around
    check('shift wraps', shifted({1: 1, 2: -1, 3: 1, 4: 1}, 1), {1: 1, 2: 1, 3: -1, 4: 1})
    check('95th percentile of 1..1000', percentile_95(list(range(1, 1001))), 950)
    check('portfolio averages the markets present', portfolio({'a': {1: 0.02, 2: 0.04}, 'b': {2: 0.0}}), {1: 0.02, 2: 0.02})
    s = stats({ym_index(2015, 1): 0.01, ym_index(2015, 2): 0.03}, ((2015, 1), (2015, 12)))
    check('t of two months', s['t'], 0.02 / (math.sqrt(0.0002) / math.sqrt(2)), 1e-9)
    print('selftest: %s' % ('all PASS' if ok else 'FAILED'))
    return ok


# ---------------------------------------------------------------- report


def pct(x, d=2):
    return '-' if x is None or (isinstance(x, float) and math.isnan(x)) else '%+.*f%%' % (d, 100 * x)


def ym_text(k):
    return '%04d-%02d' % (k // 12, k % 12 + 1)


def report(ev, ev_on, data, files, filled):
    L = []
    L.append('# Slow trend following on six markets: the one run')
    L.append('')
    L.append('**Reading: "%s"**' % ev['reading'])
    L.append('')
    L.append('Sized portfolio (10% yearly volatility target per market, at most 3), after costs and financing, monthly results summed (no compounding).')
    L.append('')
    L.append('| Line | Value | Holds |')
    L.append('| --- | --- | --- |')
    for x in ev['lines']:
        v = x['value']
        if x['line'] == 1:
            vt = 'average %s a month, t %.2f' % (pct(v['mean'], 3), v['t'])
        elif x['line'] == 2:
            vt = 'total %s, %d of 7 years above zero' % (pct(v['total']), v['years_above'])
        elif x['line'] == 3:
            vt = 'rule %s, always long %s' % (pct(v['total']), pct(v['always_long']))
        elif x['line'] == 4:
            vt = 'average %s a month; 95th percentile of luck %s; ahead of %d of 1,000' % (pct(v['mean'], 3), pct(v['p95'], 3), v['runs_below'])
        else:
            vt = 'total %s' % pct(v['total'])
        L.append('| %d. %s | %s | %s |' % (x['line'], x['rule'], vt, 'holds' if x['ok'] else 'no'))
    L.append('')
    L.append('## Periods')
    L.append('')
    L.append('| Portfolio | Period | Months | Average a month | t | Total | Yearly volatility | Worst drop |')
    L.append('| --- | --- | --- | --- | --- | --- | --- | --- |')
    spans = [('2006 to 2009 (the papers\' years)', ((2006, 1), (2009, 12))), ('2010 to 2025', MAIN), ('2019 to 2025', LATE), ('2026 to October (own line)', PART_2026)]
    for label, key in [('Sized', 'port'), ('Plain (size 1)', 'port_plain'), ('Always long, sized', 'port_long'), ('Sized, costs and markup doubled', 'port_doubled')]:
        for sl, sp in spans:
            s = stats(ev[key], sp)
            if not s['n']:
                continue
            L.append('| %s | %s | %d | %s | %s | %s | %s | %s |' % (label, sl, s['n'], pct(s['mean'], 3), '-' if s['t'] is None or math.isnan(s['t']) else '%.2f' % s['t'], pct(s['total']), pct(s['yearly_vol']), pct(worst_drop(ev[key], sp))))
    L.append('')
    so = stats(ev_on['port'], MAIN)
    L.append('Second look, description only (Amendment 2): with the overnight rates of all four currencies, the sized portfolio 2010 to 2025 averages %s a month (t %.2f), total %s. Lines with these rates: %s; reading "%s".' % (pct(so['mean'], 3), so['t'], pct(so['total']), ', '.join('%d %s' % (x['line'], 'holds' if x['ok'] else 'no') for x in ev_on['lines']), ev_on['reading']))
    L.append('')
    L.append('## By year (sized portfolio, after costs)')
    L.append('')
    yrs = by_year(ev['port'], ((2006, 1), (2026, 12)))
    L.append('| ' + ' | '.join(str(y) for y in yrs) + ' |')
    L.append('| ' + ' | '.join('---' for _ in yrs) + ' |')
    L.append('| ' + ' | '.join(pct(v, 1) for v in yrs.values()) + ' |')
    L.append('')
    L.append('## Each market alone (sized, after costs)')
    L.append('')
    L.append('| Market | First month | 2010 to 2025: average a month | t | Total | Always long total | 2019 to 2025 total | Long months / short months (2010 to 2025) |')
    L.append('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for name in data:
        s = stats(ev['sized'][name], MAIN)
        sl = stats(ev['long_sized'][name], MAIN)
        s2 = stats(ev['sized'][name], LATE)
        dirs = [v['direction'] for k, v in data[name].items() if in_span(k, MAIN)]
        L.append('| %s | %s | %s | %s | %s | %s | %s | %d / %d |' % (name, ym_text(min(data[name])), pct(s['mean'], 3), '-' if s['t'] is None else '%.2f' % s['t'], pct(s['total']), pct(sl['total']), pct(s2['total']), dirs.count(1), dirs.count(-1)))
    L.append('')
    L.append('## Data')
    L.append('')
    for f in files:
        L.append('- %s: %s to %s, %d trading days, %d position months; sha256 of the daily file %s' % (f['market'], f['first'], f['last'], f['days'], f['months'], f['sha256']))
    L.append('- Japan months filled from the OECD overnight call rate (Amendment 2): %d (%s to %s and the others listed in slow-trend.json).' % (len(filled), ym_text(min(filled)), ym_text(max(filled))))
    L.append('- Luck: %d runs, Python random.Random(%d), shifts %d to %d months, drawn market by market in the order %s.' % (LUCK_RUNS, LUCK_SEED, SHIFT_MIN, SHIFT_MAX, ', '.join(data)))
    L.append('')
    L.append('Play money only. No broker is connected. This is not financial advice.')
    return '\n'.join(L) + '\n'


def sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'selftest':
        sys.exit(0 if selftest() else 1)
    if cmd == 'daily':
        out = sys.argv[sys.argv.index('--out') + 1]
        paths = [p for p in sys.argv[2:sys.argv.index('--out')]]
        days = daily_closes(read_minutes(paths))
        with open(out, 'w') as f:
            f.write('date,close\n')
            for d, c in days:
                f.write('%s,%r\n' % (d.isoformat(), c))
        print('%s: %d days, %s to %s' % (out, len(days), days[0][0], days[-1][0]))
        return
    if cmd == 'run':
        a = lambda n: sys.argv[sys.argv.index('--' + n) + 1]
        ddir, rdir, odir = a('daily'), a('rates'), a('out')
        os.makedirs(odir, exist_ok=True)
        for f in ('slow-trend.json', 'slow-trend.md'):
            if os.path.exists(os.path.join(odir, f)):
                raise SystemExit('%s already exists: the study runs once' % f)
        if not selftest():
            raise SystemExit('selftest failed')
        data, files = {}, []
        for name, *_ in MARKETS:
            path = os.path.join(ddir, '%s_daily.csv' % name)
            with open(path) as f:
                rd = csv.reader(f)
                next(rd)
                days = [(date.fromisoformat(d), float(c)) for d, c in rd]
            months = market_months(days)
            data[name] = months
            files.append({'market': name, 'first': days[0][0].isoformat(), 'last': days[-1][0].isoformat(), 'days': len(days), 'months': len(months), 'sha256': sha256(path)})
        rates, filled = policy_rates(rdir)
        ev = evaluate(data, rates)
        ev_on = evaluate(data, overnight_rates(rdir))
        md = report(ev, ev_on, data, files, filled)
        out = {
            'reading': ev['reading'], 'pass': ev['pass'], 'lines': ev['lines'],
            'overnight': {'reading': ev_on['reading'], 'lines': ev_on['lines']},
            'files': files, 'japan_filled': [ym_text(k) for k in filled],
            'portfolio': {ym_text(k): v for k, v in ev['port'].items()},
            'portfolio_plain': {ym_text(k): v for k, v in ev['port_plain'].items()},
            'portfolio_always_long': {ym_text(k): v for k, v in ev['port_long'].items()},
            'luck_means': ev['luck_means'],
            'markets': {n: {ym_text(k): {**data[n][k], 'result': ev['sized'][n].get(k)} for k in data[n]} for n in data},
        }
        with open(os.path.join(odir, 'slow-trend.json'), 'w') as f:
            json.dump(out, f, indent=1)
        with open(os.path.join(odir, 'slow-trend.md'), 'w') as f:
            f.write(md)
        print('reading: "%s"; outputs in %s' % (ev['reading'], odir))
        return
    raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
