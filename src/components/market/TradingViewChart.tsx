'use client'

// TradingView's free Advanced Chart widget: live candles on any timeframe, with
// their indicators and drawing tools, and no API key. It loads TradingView's own
// script into this box; their terms ask for the attribution link below.
import { useEffect, useRef } from 'react'

export function TradingViewChart({ symbol, height = 520 }: { symbol: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    // Build once per symbol: TradingView's script breaks if its tag is removed
    // before it loads (React runs this twice in dev), so there is no cleanup.
    const key = `${symbol}:${height}`
    if (!el || el.dataset.tv === key) return
    el.dataset.tv = key
    el.innerHTML =
      '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>'
    const s = document.createElement('script')
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    s.async = true
    s.textContent = JSON.stringify({
      width: '100%',
      height,
      symbol,
      interval: '60',
      timezone: 'America/Puerto_Rico',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      support_host: 'https://www.tradingview.com',
    })
    el.appendChild(s)
  }, [symbol, height])

  return (
    <div>
      <div ref={box} className="tradingview-widget-container" style={{ height, width: '100%' }} />
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        Chart by{' '}
        <a
          href={`https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/`}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--indigo)' }}
        >
          TradingView
        </a>
        . Change the timeframe and add indicators on the chart itself.
      </p>
    </div>
  )
}
