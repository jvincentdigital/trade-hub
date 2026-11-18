"""Development copy of a 1-minute file: every row stamped before 2019-01-01 00:00 UTC and nothing after.

  python3 -I harmonic_dev_copy.py <full file.csv.gz> <copy.csv.gz>

docs/harmonic-study.md, "Order of work" and Amendment 3 point 15: the code is written and
tested on these copies, so the checking years cannot leak into it. Reads the time column
only. Prints the row counts and the copy's last stamp. Standard library only.
"""
import gzip
import sys
import time

END = 1546300800  # 2019-01-01 00:00:00 UTC

src, dest = sys.argv[1], sys.argv[2]
kept = dropped = 0
last = None
with gzip.open(src, "rt") as f, gzip.GzipFile(dest, "wb", mtime=0) as g:
    g.write(next(f).encode("ascii"))
    for line in f:
        t = int(line.split(",", 1)[0])
        if t < END:
            g.write(line.encode("ascii"))
            kept += 1
            last = t
        else:
            dropped += 1
print(
    "%s: %d rows kept, %d rows from 2019 on left out, last stamp %s UTC"
    % (dest, kept, dropped, time.strftime("%Y-%m-%d %H:%M", time.gmtime(last)))
)
