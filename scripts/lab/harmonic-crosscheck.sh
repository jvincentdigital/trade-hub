#!/usr/bin/env bash
# Harmonic study: cross-check the two pattern finders (docs/harmonic-study.md,
# "How the numbers are checked", Amendment 3 point 3). For each case it runs the
# engine (scripts/lab/harmonic-patterns.ts) and the second finder
# (scripts/lab/harmonic_finder2.py) on the development copy, compares the two
# lists with scripts/lab/harmonic_compare.py and prints one line per case.
# Exits 1 if any case differs. Development copies only (they end 2018-12-31).
#
#   scripts/lab/harmonic-crosscheck.sh [out_dir]
set -u
cd "$(dirname "$0")/../.."
DATA="${HARMONIC_DEV:-$HOME/.local/share/trade-hub/harmonic-dev}"
OUT="${1:-${TMPDIR:-/tmp}/harmonic-cross}"
mkdir -p "$OUT"

# market chart k year: the two required cases, then three that widen the net
CASES=(
  "GBPUSD 15 2 2015"
  "GBPUSD 15 3 2015"
  "XAUUSD 30 2 2012"
  "USDJPY 15 3 2016"
  "EURGBP 30 3 2011"
)

fail=0
for c in "${CASES[@]}"; do
  read -r m ch k y <<<"$c"
  file="$DATA/${m}_1m.csv.gz"
  eng="$OUT/engine_${m}_${ch}_k${k}_${y}.csv"
  fin="$OUT/finder2_${m}_${ch}_k${k}_${y}.csv"
  cmp="$OUT/compare_${m}_${ch}_k${k}_${y}.txt"
  if ! ./node_modules/.bin/tsx scripts/lab/harmonic-patterns.ts "$file" "$m" "$ch" "$k" "$y" "$eng" >/dev/null; then
    echo "$m ${ch}m k=$k $y: ERROR (engine)"
    fail=1
    continue
  fi
  if ! python3 -I scripts/lab/harmonic_finder2.py "$file" "$m" "$ch" "$k" "$y" "$fin" >/dev/null; then
    echo "$m ${ch}m k=$k $y: ERROR (second finder)"
    fail=1
    continue
  fi
  python3 -I scripts/lab/harmonic_compare.py "$eng" "$fin" >"$cmp"
  rc=$?
  counts=$(sed -n '1p;2p' "$cmp" | paste -sd ';' -)
  if [ $rc -eq 0 ]; then
    echo "$m ${ch}m k=$k $y: MATCH ($counts)"
  else
    echo "$m ${ch}m k=$k $y: $(grep -m1 '^DIFFERENT' "$cmp") ($counts) see $cmp"
    fail=1
  fi
done
exit $fail
