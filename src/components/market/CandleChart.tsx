'use client'
import { useEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { OHLCCandle, PatternHit } from '@/lib/types/market'

interface CandleChartProps {
  candles: OHLCCandle[]
  patterns?: PatternHit[]
  height?: number
}

export function CandleChart({ candles, patterns = [], height = 400 }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a3a3a3',
      },
      grid: {
        vertLines: { color: '#1f1f1f' },
        horzLines: { color: '#1f1f1f' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2a2a' },
      timeScale: { borderColor: '#2a2a2a', timeVisible: true },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
    }
  }, [height])

  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return
    seriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )
    chartRef.current?.timeScale().fitContent()
  }, [candles])

  useEffect(() => {
    if (!markersRef.current) return
    // A busy chart (dozens of hits) hides the candles: keep only strong bullish or
    // bearish hits there, and drop the names when there are still many. The full
    // list stays under the chart.
    const shown =
      patterns.length > 20
        ? patterns.filter((p) => p.type !== 'neutral' && p.confidence >= 0.8)
        : patterns
    const named = shown.length <= 15
    const markers: SeriesMarker<Time>[] = shown.map((p) => ({
      time: p.time as UTCTimestamp,
      position: p.type === 'bearish' ? 'aboveBar' : 'belowBar',
      color: p.type === 'bullish' ? '#22c55e' : p.type === 'bearish' ? '#ef4444' : '#f59e0b',
      shape: p.type === 'bullish' ? 'arrowUp' : p.type === 'bearish' ? 'arrowDown' : 'circle',
      text: named ? p.name : undefined,
    }))
    markersRef.current.setMarkers(markers)
  }, [patterns])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}
