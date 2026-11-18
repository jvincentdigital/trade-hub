// Levels study: fast questions about runs of 1-minute candles ("the first
// minute from here whose high is at or above x", "the lowest low over these
// minutes"). Blocks of 16 minutes hold their high and low in a segment tree, so
// a question costs a few dozen steps however far it looks. Exact: the tree only
// skips blocks that cannot hold the answer, and the answer is read from the
// minutes themselves. Pure.

const SHIFT = 4
const B = 1 << SHIFT

export class MinuteIndex {
  readonly n: number
  private readonly size: number
  private readonly mx: Float64Array
  private readonly mn: Float64Array

  constructor(
    private readonly high: Float64Array,
    private readonly low: Float64Array,
    n = high.length,
  ) {
    this.n = n
    const blocks = Math.max(1, Math.ceil(n / B))
    let size = 1
    while (size < blocks) size <<= 1
    this.size = size
    this.mx = new Float64Array(2 * size).fill(-Infinity)
    this.mn = new Float64Array(2 * size).fill(Infinity)
    for (let i = 0; i < n; i++) {
      const leaf = size + (i >> SHIFT)
      if (high[i] > this.mx[leaf]) this.mx[leaf] = high[i]
      if (low[i] < this.mn[leaf]) this.mn[leaf] = low[i]
    }
    for (let i = size - 1; i >= 1; i--) {
      this.mx[i] = Math.max(this.mx[2 * i], this.mx[2 * i + 1])
      this.mn[i] = Math.min(this.mn[2 * i], this.mn[2 * i + 1])
    }
  }

  /** First block in [l, r) whose highest high is >= x, or -1. */
  private blockMax(node: number, nl: number, nr: number, l: number, r: number, x: number): number {
    if (nr <= l || nl >= r || this.mx[node] < x) return -1
    if (nr - nl === 1) return nl
    const mid = (nl + nr) >> 1
    const a = this.blockMax(2 * node, nl, mid, l, r, x)
    return a >= 0 ? a : this.blockMax(2 * node + 1, mid, nr, l, r, x)
  }

  /** First block in [l, r) whose lowest low is <= x, or -1. */
  private blockMin(node: number, nl: number, nr: number, l: number, r: number, x: number): number {
    if (nr <= l || nl >= r || this.mn[node] > x) return -1
    if (nr - nl === 1) return nl
    const mid = (nl + nr) >> 1
    const a = this.blockMin(2 * node, nl, mid, l, r, x)
    return a >= 0 ? a : this.blockMin(2 * node + 1, mid, nr, l, r, x)
  }

  /** First minute in [from, to) whose high is >= x, or -1. */
  firstHigh(from: number, to: number, x: number): number {
    if (to > this.n) to = this.n
    if (from < 0) from = 0
    if (from >= to) return -1
    const h = this.high
    const bf = from >> SHIFT
    const bt = (to - 1) >> SHIFT
    const e0 = bf === bt ? to : (bf + 1) << SHIFT
    for (let m = from; m < e0; m++) if (h[m] >= x) return m
    if (bf === bt) return -1
    if (bt > bf + 1) {
      const b = this.blockMax(1, 0, this.size, bf + 1, bt, x)
      if (b >= 0) {
        for (let m = b << SHIFT; ; m++) if (h[m] >= x) return m
      }
    }
    for (let m = bt << SHIFT; m < to; m++) if (h[m] >= x) return m
    return -1
  }

  /** First minute in [from, to) whose low is <= x, or -1. */
  firstLow(from: number, to: number, x: number): number {
    if (to > this.n) to = this.n
    if (from < 0) from = 0
    if (from >= to) return -1
    const l = this.low
    const bf = from >> SHIFT
    const bt = (to - 1) >> SHIFT
    const e0 = bf === bt ? to : (bf + 1) << SHIFT
    for (let m = from; m < e0; m++) if (l[m] <= x) return m
    if (bf === bt) return -1
    if (bt > bf + 1) {
      const b = this.blockMin(1, 0, this.size, bf + 1, bt, x)
      if (b >= 0) {
        for (let m = b << SHIFT; ; m++) if (l[m] <= x) return m
      }
    }
    for (let m = bt << SHIFT; m < to; m++) if (l[m] <= x) return m
    return -1
  }

  /** First minute in [from, to) whose high is >= up or whose low is <= dn, or -1. */
  firstEither(from: number, to: number, up: number, dn: number): number {
    const a = up === Infinity ? -1 : this.firstHigh(from, to, up)
    if (dn === -Infinity) return a
    const b = this.firstLow(from, a >= 0 ? a : to, dn)
    return b >= 0 ? b : a
  }

  /** Highest high over [from, to) (-Infinity when empty). */
  maxHigh(from: number, to: number): number {
    if (to > this.n) to = this.n
    let best = -Infinity
    if (from >= to) return best
    const h = this.high
    const bf = from >> SHIFT
    const bt = (to - 1) >> SHIFT
    if (bf === bt) {
      for (let m = from; m < to; m++) if (h[m] > best) best = h[m]
      return best
    }
    for (let m = from; m < (bf + 1) << SHIFT; m++) if (h[m] > best) best = h[m]
    for (let m = bt << SHIFT; m < to; m++) if (h[m] > best) best = h[m]
    let l = this.size + bf + 1
    let r = this.size + bt
    while (l < r) {
      if (l & 1) best = Math.max(best, this.mx[l++])
      if (r & 1) best = Math.max(best, this.mx[--r])
      l >>= 1
      r >>= 1
    }
    return best
  }

  /** Lowest low over [from, to) (Infinity when empty). */
  minLow(from: number, to: number): number {
    if (to > this.n) to = this.n
    let best = Infinity
    if (from >= to) return best
    const lo = this.low
    const bf = from >> SHIFT
    const bt = (to - 1) >> SHIFT
    if (bf === bt) {
      for (let m = from; m < to; m++) if (lo[m] < best) best = lo[m]
      return best
    }
    for (let m = from; m < (bf + 1) << SHIFT; m++) if (lo[m] < best) best = lo[m]
    for (let m = bt << SHIFT; m < to; m++) if (lo[m] < best) best = lo[m]
    let l = this.size + bf + 1
    let r = this.size + bt
    while (l < r) {
      if (l & 1) best = Math.min(best, this.mn[l++])
      if (r & 1) best = Math.min(best, this.mn[--r])
      l >>= 1
      r >>= 1
    }
    return best
  }
}
