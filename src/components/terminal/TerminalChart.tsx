'use client'
import { useEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { PR_OFFSET_SEC, type Level, type Trip } from '@/lib/race/terminal'
import type { OHLCCandle } from '@/lib/types/market'

// The Terminal's big chart (lightweight-charts, like CandleChart): candles,
// open trades as price lines with labels at the right (entry solid, stop red
// dashed, targets green), closed trades as an arrow at the entry and a dot at
// the exit joined by a dotted line. Times on the axis are Puerto Rico time.
// Colours are the tokens in globals.css (the chart cannot read CSS variables).
const C = {
  text: '#a1a1aa',
  grid: '#1e1e1e',
  border: '#2a2a2a',
  green: '#22c55e',
  red: '#ef4444',
  entry: '#a1a1aa',
  accent: '#6366f1',
}
const DIM = '59' // about 35% opacity, for the lines of trades not picked

/** Intraday candles move to Puerto Rico time; daily ones keep their date. */
const timeAt = (sec: number, daily: boolean) => (daily ? sec : sec - PR_OFFSET_SEC) as UTCTimestamp

export function TerminalChart(props: {
  candles: OHLCCandle[]
  levels: Level[]
  trips: Trip[]
  /** Fits the view again when it changes (market or candle size), not on every refresh. */
  viewKey: string
  /** Price decimals for the axis. */
  decimals: number
  daily: boolean
}) {
  const { candles, levels, trips, viewKey, decimals, daily } = props
  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const fitted = useRef('')

  useEffect(() => {
    if (!box.current) return
    const c = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: C.text,
        attributionLogo: false,
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, timeVisible: true, rightOffset: 4 },
    })
    const s = c.addSeries(CandlestickSeries, {
      upColor: C.green,
      downColor: C.red,
      borderUpColor: C.green,
      borderDownColor: C.red,
      wickUpColor: C.green,
      wickDownColor: C.red,
    })
    chart.current = c
    series.current = s
    markers.current = createSeriesMarkers(s, [])
    return () => {
      c.remove()
      chart.current = null
      series.current = null
      markers.current = null
      fitted.current = ''
    }
  }, [])

  useEffect(() => {
    series.current?.applyOptions({
      priceFormat: { type: 'price', precision: decimals, minMove: 10 ** -decimals },
    })
  }, [decimals])

  useEffect(() => {
    const s = series.current
    if (!s) return
    s.setData(candles.map((c) => ({ ...c, time: timeAt(c.time, daily) })))
    if (candles.length && fitted.current !== viewKey) {
      fitted.current = viewKey
      // About the last 120 candles, like a fresh MT4 chart, not all 720.
      const to = candles.length + 4
      chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, to - 124), to })
    }
  }, [candles, viewKey, daily])

  // Open trades: one price line per level.
  useEffect(() => {
    const s = series.current
    if (!s) return
    const anyPicked = levels.some((l) => l.picked)
    // Keep the picked trade's stop and targets in view, even when far from the candles.
    const keep = levels.filter((l) => l.picked).map((l) => l.price)
    s.applyOptions({
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const r = base()
        if (!r?.priceRange || !keep.length) return r
        const { minValue, maxValue } = r.priceRange
        return {
          ...r,
          priceRange: {
            minValue: Math.min(minValue, ...keep),
            maxValue: Math.max(maxValue, ...keep),
          },
        }
      },
    })
    // Many trades in one market would stack their names; then only the picked one is named.
    const named = new Set(levels.map((l) => l.key)).size <= 2
    const lines: IPriceLine[] = levels.map((l) => {
      const base =
        l.kind === 'stop' ? C.red : l.kind === 'target' ? C.green : l.picked ? C.accent : C.entry
      return s.createPriceLine({
        price: l.price,
        color: anyPicked && !l.picked ? base + DIM : base,
        lineWidth: l.picked ? 2 : 1,
        lineStyle: l.kind === 'stop' ? LineStyle.LargeDashed : LineStyle.Solid,
        axisLabelVisible: !anyPicked || l.picked,
        title: named || l.picked ? l.title : '',
      })
    })
    return () => lines.forEach((p) => s.removePriceLine(p))
  }, [levels])

  // Closed trades: arrow at the entry, dot at the exit, a dotted line between.
  useEffect(() => {
    const c = chart.current
    if (!c || !markers.current) return
    const marks: SeriesMarker<Time>[] = trips.flatMap((t) => {
      const color = t.won ? C.green : C.red
      const buy = t.side === 'long'
      return [
        {
          time: timeAt(t.entryTime, daily),
          position: buy ? 'belowBar' : 'aboveBar',
          shape: buy ? 'arrowUp' : 'arrowDown',
          color,
        } as const,
        {
          time: timeAt(t.exitTime, daily),
          position: 'inBar',
          shape: 'circle',
          color,
          size: 0.6,
        } as const,
      ]
    })
    markers.current.setMarkers(marks.sort((a, b) => (a.time as number) - (b.time as number)))
    const joins = trips
      .filter((t) => t.exitTime > t.entryTime)
      .map((t) => {
        const line = c.addSeries(LineSeries, {
          color: (t.won ? C.green : C.red) + 'b3',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        })
        line.setData([
          { time: timeAt(t.entryTime, daily), value: t.entry },
          { time: timeAt(t.exitTime, daily), value: t.exit },
        ])
        return line
      })
    return () => joins.forEach((l) => c.removeSeries(l))
  }, [trips, daily])

  return <div ref={box} style={{ position: 'absolute', inset: 0 }} />
}
