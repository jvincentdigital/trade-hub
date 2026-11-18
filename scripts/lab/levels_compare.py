"""Compare two lists of levels or of visits (docs/levels-study.md, "How the numbers are checked").

  python3 -I levels_compare.py <first.csv> <second.csv>

The kind of list is read from the header. Times and outcomes must be identical, prices
must agree to 1e-9. Prints MATCH or the differences, and exits 1 when the lists differ.
Standard library only.
"""
import csv
import sys

LEVELS = "kind,what,known_from,first_watched,low,high,atr,left_out".split(",")
VISITS = (
    "kind,twin,what,known_from,side,touch,near,far,atr,"
    "r010,r010_t,r025,r025_t,r050,r050_t,r100,r100_t,m15,m60,how_far,end,end_t,"
    "brk_t,b010,b010_t,b025,b025_t,b050,b050_t,b100,b100_t"
).split(",")
PRICES = {"low", "high", "atr", "near", "far", "how_far"}
ROUND = {"R00", "R50", "RTW"}
TOL = 1e-9


def key_of(header, row):
    if header == LEVELS:
        return (row["kind"], row["what"], row["known_from"])
    k = (row["kind"], row["twin"], row["what"], row["known_from"], row["side"], row["touch"])
    # Several round lines can be touched in one minute; their prices are whole pips, so the text is safe as a key.
    return k + (row["near"],) if row["kind"] in ROUND else k


def load(path):
    with open(path, newline="") as f:
        r = csv.DictReader(f)
        header = r.fieldnames
        if header not in (LEVELS, VISITS):
            sys.exit("%s: unknown header %r" % (path, header))
        rows = {}
        for row in r:
            k = key_of(header, row)
            if k in rows:
                sys.exit("%s: the same row twice: %r" % (path, k))
            rows[k] = row
    return header, rows


ha, a = load(sys.argv[1])
hb, b = load(sys.argv[2])
if ha != hb:
    sys.exit("the two files are not the same kind of list")
diffs = []
for k in sorted(set(a) | set(b)):
    if k not in a:
        diffs.append("only in the second list: %s" % (k,))
    elif k not in b:
        diffs.append("only in the first list:  %s" % (k,))
    else:
        for col in ha:
            x, y = a[k][col], b[k][col]
            if col in PRICES:
                if x == "" or y == "":
                    if x != y:
                        diffs.append("%s: %s is %r against %r" % (k, col, x, y))
                elif abs(float(x) - float(y)) > TOL:
                    diffs.append("%s: %s is %s against %s" % (k, col, x, y))
            elif x != y:
                diffs.append("%s: %s is %r against %r" % (k, col, x, y))

by_kind = {}
for row in a.values():
    name = row["kind"] if ha == LEVELS or row["twin"] == "level" else row["kind"] + " twins"
    by_kind[name] = by_kind.get(name, 0) + 1
print("first list: %d rows, second list: %d rows" % (len(a), len(b)))
print("first list by kind: " + ", ".join("%s %d" % kv for kv in sorted(by_kind.items())))
if diffs:
    print("DIFFERENT: %d differences" % len(diffs))
    for d in diffs[:200]:
        print("  " + d)
    sys.exit(1)
print("MATCH")
