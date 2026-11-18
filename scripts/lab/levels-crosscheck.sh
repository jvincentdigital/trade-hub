#!/usr/bin/env bash
# Levels study: cross-check the two level and visit finders (docs/levels-study.md,
# "How the numbers are checked", last point). For each case it runs the engine
# (scripts/lab/levels-list.ts) and the second finder (scripts/lab/levels_finder2.py)
# on the development copy, compares levels.csv and visits.csv with
# scripts/lab/levels_compare.py and prints one line per case and list.
# Exits 1 if anything differs. Development copies only (they end 2018-12-31).
#
#   scripts/lab/levels-crosscheck.sh [out_dir]
set -u
cd "$(dirname "$0")/../.."
DATA="${HARMONIC_DEV:-$HOME/.local/share/trade-hub/harmonic-dev}"
OUT="${1:-${TMPDIR:-/tmp}/levels-cross}"
mkdir -p "$OUT"

# market year: the four cases the plan names
CASES=(
  "EURUSD 2005"
  "EURUSD 2012"
  "USDJPY 2012"
  "XAUUSD 2013"
)

fail=0
for c in "${CASES[@]}"; do
  read -r m y <<<"$c"
  file="$DATA/${m}_1m.csv.gz"
  eng="$OUT/engine-$m-$y"
  fin="$OUT/finder2-$m-$y"
  if ! ./node_modules/.bin/tsx scripts/lab/levels-list.ts "$file" "$m" "$y" "$eng" >"$OUT/engine-$m-$y.log" 2>&1; then
    echo "$m $y: ERROR (engine) see $OUT/engine-$m-$y.log"
    fail=1
    continue
  fi
  if ! python3 -I scripts/lab/levels_finder2.py "$file" "$m" "$y" "$fin" >"$OUT/finder2-$m-$y.log" 2>&1; then
    echo "$m $y: ERROR (second finder) see $OUT/finder2-$m-$y.log"
    fail=1
    continue
  fi
  for list in levels visits; do
    cmp="$OUT/compare-$m-$y-$list.txt"
    python3 -I scripts/lab/levels_compare.py "$eng/$list.csv" "$fin/$list.csv" >"$cmp"
    rc=$?
    counts=$(sed -n '1p;2p' "$cmp" | paste -sd ';' -)
    if [ $rc -eq 0 ]; then
      echo "$m $y $list: MATCH ($counts)"
    else
      echo "$m $y $list: $(grep -m1 '^DIFFERENT' "$cmp") ($counts) see $cmp"
      fail=1
    fi
  done
done
exit $fail
