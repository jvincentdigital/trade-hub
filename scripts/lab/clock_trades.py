"""Three clock trades (docs/clock-trades-study.md; the plan was pushed before this script was run).

Offline, play money research. Python 3 standard library only.

  python3 -I clock_trades.py clock <file.csv.gz>              weekly-gap check of a file's clock (no returns)
  python3 -I clock_trades.py test1 <EURUSD file> <out dir>    EUR/USD local hours
  python3 -I clock_trades.py test2 <XAUUSD file> <out dir>    gold night and day
  python3 -I clock_trades.py test3 <SPXUSD file> <out dir>    the index's last half-hour

Files are gzip CSV with a header: time (UTC seconds, candle open), open, high, low, close, volume.
"""
import bisect
import csv
import gzip
import json
import math
import os
import random
import sys
from array import array
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
PERIODS = [("early (to 2012)", 0, 2012), ("middle (2013 to 2018)", 2013, 2018), ("recent (2019 to 2025)", 2019, 2025)]
RECENT = (2019, 2025)
LUCK_RUNS = 1000
SLACK = 300  # a trade uses the first candle stamped at or after its time, if within this many seconds


def load(path):
    times = array("q")
    opens = array("d")
    with gzip.open(path, "rt") as f:
        next(f)
        for line in f:
            a = line.split(",", 2)
            times.append(int(a[0]))
            opens.append(float(a[1]))
    return times, opens


def at(times, opens, d, hour, minute):
    """The price for a trade at this New York clock time on date d, or None."""
    t = int(datetime(d.year, d.month, d.day, hour, minute, tzinfo=NY).timestamp())
    i = bisect.bisect_left(times, t)
    if i < len(times) and times[i] - t <= SLACK:
        return opens[i]
    return None


def weekdays(first, last):
    d = first
    while d <= last:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


def span_of(times):
    a = datetime.fromtimestamp(times[0], timezone.utc).astimezone(NY).date()
    b = datetime.fromtimestamp(times[-1], timezone.utc).astimezone(NY).date()
    return a, min(b, date(2025, 12, 31))


def stats(xs):
    n = len(xs)
    if n < 2:
        return {"n": n, "mean": float("nan"), "t": float("nan"), "sum": sum(xs)}
    mean = sum(xs) / n
    var = sum((x - mean) ** 2 for x in xs) / (n - 1)
    se = math.sqrt(var / n)
    return {"n": n, "mean": mean, "t": mean / se if se > 0 else float("nan"), "sum": sum(xs)}


def show(s):
    return "%5d days, average %+.2f bp a day (t %+.2f), total %+.0f bp" % (s["n"], s["mean"], s["t"], s["sum"])


def bp(a, b):
    return 10000.0 * (b / a - 1.0)


def report(name, days, legs_gross, cost, luck_gross, out_dir, extra=None):
    """days: list of dates; legs_gross: per day a list of gross leg results (bp) for the legs that traded.

    luck_gross: per luck run, a list of per-day lists of gross leg results.
    """
    lines = []
    results = {"name": name, "cost": cost}

    def net(day_legs, k=1.0):
        return sum(g - k * cost for g in day_legs)

    series = [(d, legs) for d, legs in zip(days, legs_gross) if legs]
    lines.append("%s: %d trading days from %s to %s; cost %.1f bp a leg" % (name, len(series), series[0][0], series[-1][0], cost))

    def block(label, k):
        out = {}
        lines.append("  %s:" % label)
        whole = stats([net(l, k) for _, l in series])
        lines.append("    whole period          %s" % show(whole))
        out["whole"] = whole
        for pname, y0, y1 in PERIODS:
            xs = [net(l, k) for d, l in series if y0 <= d.year <= y1]
            if xs:
                out[pname] = stats(xs)
                lines.append("    %-22s%s" % (pname, show(out[pname])))
        years = {}
        for d, l in series:
            years[d.year] = years.get(d.year, 0.0) + net(l, k)
        out["years"] = years
        lines.append("    by year (bp): " + ", ".join("%d %+.0f" % (y, years[y]) for y in sorted(years)))
        return out

    gross = block("before costs", 0.0)
    after = block("after costs", 1.0)
    double = block("at double cost", 2.0)
    results.update({"gross": gross, "net": after, "double": double})

    # What luck looks like: the same measure for each luck run, whole period.
    luck_net = sorted(stats([net(l) for l in run if l])["mean"] for run in luck_gross)
    luck_g = sorted(stats([net(l, 0.0) for l in run if l])["mean"] for run in luck_gross)
    p95 = luck_net[int(0.95 * len(luck_net)) - 1]
    p95g = luck_g[int(0.95 * len(luck_g)) - 1]
    beat = sum(1 for x in luck_net if after["whole"]["mean"] > x)
    lines.append(
        "  luck runs (%d): after costs the 95th percentile is %+.2f bp a day (median %+.2f); the rule is ahead of %d of them"
        % (len(luck_net), p95, luck_net[len(luck_net) // 2], beat)
    )
    results["luck"] = {"p95_net": p95, "p95_gross": p95g, "median_net": luck_net[len(luck_net) // 2], "ahead_of": beat}

    recent = after[PERIODS[2][0]]
    up_years = sum(1 for y in range(RECENT[0], RECENT[1] + 1) if after["years"].get(y, 0.0) > 0)
    checks = [
        ("1. recent period above zero with t of 2 or more", recent["mean"] > 0 and recent["t"] >= 2),
        ("2. whole period t of 3 or more", after["whole"]["t"] >= 3),
        ("3. whole period above the 95th percentile of luck", after["whole"]["mean"] > p95),
        ("4. at least 5 of the 7 years 2019 to 2025 above zero (%d were)" % up_years, up_years >= 5),
        ("5. at double cost the recent period is still above zero", double[PERIODS[2][0]]["mean"] > 0),
    ]
    for label, ok in checks:
        lines.append("  %s: %s" % (label, "yes" if ok else "no"))
    g_recent = gross[PERIODS[2][0]]
    real = g_recent["mean"] > 0 and g_recent["t"] >= 2 and gross["whole"]["t"] >= 3 and gross["whole"]["mean"] > p95g
    reading = "WORTH A PLAY ACCOUNT (pending the second implementation and the reviewers)" if all(ok for _, ok in checks) else ("REAL BUT TOO SMALL TO TRADE" if real else "NOT THERE")
    lines.append("  The reading fixed in the plan: %s" % reading)
    results["checks"] = [[label, ok] for label, ok in checks]
    results["reading"] = reading
    if extra:
        lines += extra
    text = "\n".join(lines) + "\n"
    os.makedirs(out_dir, exist_ok=True)
    key = name.split(" ")[0]
    open(os.path.join(out_dir, key + ".txt"), "w").write(text)
    json.dump(results, open(os.path.join(out_dir, key + ".json"), "w"), indent=1, default=str)
    with open(os.path.join(out_dir, key + "-days.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "legs_gross_bp"])
        for d, l in series:
            w.writerow([d.isoformat(), " ".join("%.4f" % g for g in l)])
    sys.stdout.write(text)


def marks_grid(times, opens, days, start_min, n_marks, day_shift):
    """Prices at 5-minute marks from start_min (minutes after midnight of d + day_shift days) for every day."""
    grid = []
    for d in days:
        base = d + timedelta(days=day_shift)
        row = []
        for k in range(n_marks):
            m = start_min + 5 * k
            dd = base + timedelta(days=m // 1440)
            row.append(at(times, opens, dd, (m % 1440) // 60, m % 60))
        grid.append(row)
    return grid


def random_clocks(grid, leg_marks, runs, seed):
    """For each run: every leg at a random start mark with a random direction; per day the gross results of its legs."""
    rng = random.Random(seed)
    n_marks = len(grid[0])
    out = []
    for _ in range(runs):
        legs = [(rng.randrange(0, n_marks - m), m, rng.choice((1, -1))) for m in leg_marks]
        run = []
        for row in grid:
            day = []
            for start, m, sign in legs:
                a, b = row[start], row[start + m]
                if a is not None and b is not None:
                    day.append(sign * bp(a, b))
            run.append(day)
        out.append(run)
    return out


def test1(path, out_dir):
    times, opens = load(path)
    first, last = span_of(times)
    days, legs = [], []
    alone = {"short 03:00 to 11:00": [], "long 11:00 to 16:00": []}
    for d in weekdays(first, last):
        p3, p11, p16 = at(times, opens, d, 3, 0), at(times, opens, d, 11, 0), at(times, opens, d, 16, 0)
        day = []
        if p3 is not None and p11 is not None:
            day.append(-bp(p3, p11))
            alone["short 03:00 to 11:00"].append((d, -bp(p3, p11)))
        if p11 is not None and p16 is not None:
            day.append(bp(p11, p16))
            alone["long 11:00 to 16:00"].append((d, bp(p11, p16)))
        days.append(d)
        legs.append(day)
    # Luck: an 8-hour and a 5-hour leg anywhere inside 00:00 to 17:00.
    grid = marks_grid(times, opens, days, 0, 17 * 12 + 1, 0)
    luck = random_clocks(grid, [8 * 12, 5 * 12], LUCK_RUNS, 1)
    report("test1 EUR/USD local hours, both legs", days, legs, 1.0, luck, out_dir, each_alone(alone, 1.0))


def each_alone(alone, cost):
    lines = ["  each leg alone, after costs:"]
    for label, xs in alone.items():
        lines.append("    %-24s whole %s" % (label, show(stats([g - cost for _, g in xs]))))
        recent = [g - cost for d, g in xs if RECENT[0] <= d.year <= RECENT[1]]
        lines.append("    %-24s recent %s" % ("", show(stats(recent))))
        lines.append("    %-24s before costs, whole %s" % ("", show(stats([g for _, g in xs]))))
    return lines


def test2(path, out_dir):
    times, opens = load(path)
    first, last = span_of(times)
    days, legs = [], []
    alone = {"long 18:05 to 08:20": [], "short 08:20 to 13:30": []}
    for d in weekdays(first, last):
        prev = d - timedelta(days=1)
        p_eve, p_open, p_close = at(times, opens, prev, 18, 5), at(times, opens, d, 8, 20), at(times, opens, d, 13, 30)
        day = []
        if p_eve is not None and p_open is not None:
            day.append(bp(p_eve, p_open))
            alone["long 18:05 to 08:20"].append((d, bp(p_eve, p_open)))
        if p_open is not None and p_close is not None:
            day.append(-bp(p_open, p_close))
            alone["short 08:20 to 13:30"].append((d, -bp(p_open, p_close)))
        days.append(d)
        legs.append(day)
    # Luck: a 14 h 15 min and a 5 h 10 min leg anywhere from 18:05 the evening before to 17:00.
    grid = marks_grid(times, opens, days, 18 * 60 + 5, (22 * 60 + 55) // 5 + 1, -1)
    luck = random_clocks(grid, [855 // 5, 310 // 5], LUCK_RUNS, 1)
    report("test2 gold night and day, both legs", days, legs, 2.0, luck, out_dir, each_alone(alone, 2.0))


def test3(path, out_dir):
    times, opens = load(path)
    first, last = span_of(times)
    days, legs, raw = [], [], []
    prev16 = None
    for d in weekdays(first, last):
        p1530, p16 = at(times, opens, d, 15, 30), at(times, opens, d, 16, 0)
        if p1530 is not None and p16 is not None and prev16 is not None and p1530 != prev16:
            sign = 1 if p1530 > prev16 else -1
            days.append(d)
            legs.append([sign * bp(p1530, p16)])
            raw.append((sign, bp(p1530, p16)))
        if p16 is not None:
            prev16 = p16
    rng = random.Random(1)
    signs = [s for s, _ in raw]
    luck = []
    for _ in range(LUCK_RUNS):
        rng.shuffle(signs)
        luck.append([[s * r] for s, (_, r) in zip(signs, raw)])
    extra = [
        "  always long 15:30 to 16:00, after costs:  %s" % show(stats([r - 1.5 for _, r in raw])),
        "  always short 15:30 to 16:00, after costs: %s" % show(stats([-r - 1.5 for _, r in raw])),
        "  days the signal said long: %d of %d" % (sum(1 for s, _ in raw if s > 0), len(raw)),
    ]
    report("test3 index last half-hour", days, legs, 1.5, luck, out_dir, extra)


def clock(path):
    """Weekly gap: last candle before and first candle after each weekend, in New York time. No returns."""
    times, _ = load(path)
    per = {}
    for i in range(1, len(times)):
        if times[i] - times[i - 1] < 40 * 3600:
            continue
        a = datetime.fromtimestamp(times[i - 1], timezone.utc).astimezone(NY)
        b = datetime.fromtimestamp(times[i], timezone.utc).astimezone(NY)
        if a.weekday() != 4:
            continue
        ok = (16 * 60 <= a.hour * 60 + a.minute < 17 * 60) and b.weekday() == 6 and (17 * 60 <= b.hour * 60 + b.minute <= 18 * 60 + 30)
        y = per.setdefault(a.year, {"n": 0, "ok": 0, "last": {}, "first": {}})
        y["n"] += 1
        y["ok"] += 1 if ok else 0
        y["last"][a.strftime("%a %H:%M")] = y["last"].get(a.strftime("%a %H:%M"), 0) + 1
        y["first"][b.strftime("%a %H:%M")] = y["first"].get(b.strftime("%a %H:%M"), 0) + 1
    bad = 0
    for y in sorted(per):
        p = per[y]
        top = lambda dct: ", ".join("%s x%d" % kv for kv in sorted(dct.items(), key=lambda kv: -kv[1])[:3])
        share = p["ok"] / p["n"]
        bad += 1 if share < 0.9 else 0
        print("%d: %2d weekends, %2d fit (%.0f%%) | last before: %s | first after: %s" % (y, p["n"], p["ok"], 100 * share, top(p["last"]), top(p["first"])))
    print("CLOCK CHECK: %s" % ("PASS" if bad == 0 else "FAIL in %d years" % bad))


def weeks_of(times):
    """Index ranges [i0, i1) of the stretches between weekend gaps (more than 40 hours without a candle)."""
    out = []
    i0 = 0
    for i in range(1, len(times)):
        if times[i] - times[i - 1] >= 40 * 3600:
            out.append((i0, i))
            i0 = i
    out.append((i0, len(times)))
    return out


def impossible(first, last, reopen_hour):
    """Amendment 1: a week is 'late' if it has a candle after Friday 17:00 New York, 'early' if it starts before the Sunday reopen."""
    f = datetime.fromtimestamp(first, timezone.utc).astimezone(NY)
    l = datetime.fromtimestamp(last, timezone.utc).astimezone(NY)
    late = (l.weekday() == 4 and (l.hour, l.minute) > (17, 0)) or l.weekday() == 5
    early = f.weekday() == 5 or (f.weekday() == 6 and f.hour * 60 + f.minute < reopen_hour * 60 - 5)
    return late, early


def clock2(path, reopen_hour):
    """Amendment 1 check: no week may have a candle while the market is shut. No returns."""
    times, _ = load(path)
    per = {}
    for i0, i1 in weeks_of(times):
        late, early = impossible(times[i0], times[i1 - 1], reopen_hour)
        y = datetime.fromtimestamp(times[i0], timezone.utc).astimezone(NY).year
        p = per.setdefault(y, [0, 0, 0])
        p[0] += 1
        p[1] += 1 if late else 0
        p[2] += 1 if early else 0
    bad = sum(p[1] + p[2] for p in per.values())
    print(" ".join("%d:%d/%d" % (y, per[y][1] + per[y][2], per[y][0]) for y in sorted(per)))
    print("CLOCK CHECK (weeks with a candle in the shut market / weeks): %s" % ("PASS" if bad == 0 else "FAIL, %d weeks" % bad))


def fix(path, out, reopen_hour):
    """Amendment 1 repair: move a whole week by one hour when it has candles in the shut market. Uses stamps only."""
    times, _ = load(path)
    shift_at = {}
    drop_at = {}
    count = {}
    unresolved = 0
    for i0, i1 in weeks_of(times):
        late, early = impossible(times[i0], times[i1 - 1], reopen_hour)
        shift = -3600 if late and not early else 3600 if early and not late else 0
        settled = not (late and early)
        if shift:
            still_late, still_early = impossible(times[i0] + shift, times[i1 - 1] + shift, reopen_hour)
            if still_late or still_early:
                settled = False
                shift = 0
        if not settled:
            # A week that one hour cannot explain is left out of the file altogether.
            unresolved += 1
            drop_at[i0] = i1
        if shift:
            y = datetime.fromtimestamp(times[i0], timezone.utc).astimezone(NY).year
            c = count.setdefault(y, [0, 0])
            c[0 if shift < 0 else 1] += 1
            shift_at[i0] = (i1, shift)
    with gzip.open(path, "rt") as f, gzip.open(out, "wt") as g:
        g.write(next(f))
        shift = 0
        until = -1
        drop_until = -1
        for i, line in enumerate(f):
            if i in drop_at:
                drop_until = drop_at[i]
            if i < drop_until:
                continue
            if i in shift_at:
                until, shift = shift_at[i]
            elif i == until:
                shift = 0
            if shift:
                t, rest = line.split(",", 1)
                line = "%d,%s" % (int(t) + shift, rest)
            g.write(line)
    print("weeks moved an hour earlier / later, by year: " + ", ".join("%d %d/%d" % (y, count[y][0], count[y][1]) for y in sorted(count)))
    print("weeks that one hour could not explain, left out of the file: %d" % unresolved)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "clock":
        clock(sys.argv[2])
    elif cmd == "clock2":
        clock2(sys.argv[2], int(sys.argv[3]))
    elif cmd == "fix":
        fix(sys.argv[2], sys.argv[3], int(sys.argv[4]))
    elif cmd == "test1":
        test1(sys.argv[2], sys.argv[3])
    elif cmd == "test2":
        test2(sys.argv[2], sys.argv[3])
    elif cmd == "test3":
        test3(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit("usage: clock_trades.py clock|test1|test2|test3 ...")
