"""Compare two pattern lists (docs/harmonic-study.md, "How the numbers are checked", Amendment 3 point 3).

  python3 -I harmonic_compare.py <engine.csv> <finder2.csv>

Both files have this header and one row per pattern:
chart,k,pattern,dir,x_time,x,a_time,a,b_time,b,c_time,c,confirm_time,d,stop,outcome,outcome_time

Times and outcomes must be identical, prices must agree to 1e-9. Prints MATCH or
every difference, and exits 1 when the lists differ. Standard library only.
"""
import csv
import sys

HEADER = "chart,k,pattern,dir,x_time,x,a_time,a,b_time,b,c_time,c,confirm_time,d,stop,outcome,outcome_time".split(",")
EXACT = ["x_time", "a_time", "b_time", "c_time", "outcome", "outcome_time"]
PRICES = ["x", "a", "b", "c", "d", "stop"]
OUTCOMES = {"skipped", "completed", "cancelled_c", "cancelled_time", "cancelled_swing", "waiting"}
TOL = 1e-9


def load(path):
    rows = {}
    with open(path, newline="") as f:
        r = csv.DictReader(f)
        if r.fieldnames != HEADER:
            sys.exit("%s: wrong header %r" % (path, r.fieldnames))
        for row in r:
            if row["outcome"] not in OUTCOMES:
                sys.exit("%s: unknown outcome %r" % (path, row["outcome"]))
            key = (row["chart"], row["k"], row["confirm_time"], row["pattern"], row["dir"])
            if key in rows:
                sys.exit("%s: the same pattern twice: %r" % (path, key))
            rows[key] = row
    return rows


a, b = load(sys.argv[1]), load(sys.argv[2])
diffs = []
for key in sorted(set(a) | set(b)):
    if key not in a:
        diffs.append("only in the second list: %s" % (key,))
    elif key not in b:
        diffs.append("only in the first list:  %s" % (key,))
    else:
        for col in EXACT:
            if a[key][col] != b[key][col]:
                diffs.append("%s: %s is %r against %r" % (key, col, a[key][col], b[key][col]))
        for col in PRICES:
            if abs(float(a[key][col]) - float(b[key][col])) > TOL:
                diffs.append("%s: %s is %s against %s" % (key, col, a[key][col], b[key][col]))

by_outcome = {}
for row in a.values():
    by_outcome[row["outcome"]] = by_outcome.get(row["outcome"], 0) + 1
print("first list: %d patterns, second list: %d patterns" % (len(a), len(b)))
print("first list by outcome: " + ", ".join("%s %d" % kv for kv in sorted(by_outcome.items())))
if diffs:
    print("DIFFERENT: %d differences" % len(diffs))
    for d in diffs[:200]:
        print("  " + d)
    sys.exit(1)
print("MATCH")
