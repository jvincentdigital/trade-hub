// The 9 forex pairs (GBP/JPY added 2026-11-10 for the London open). A plain module (not the 'use client' hooks file) so
// server code like /api/race can read the instrument list too.
export const FOREX_PAIRS = [
  { symbol: 'EUR/USD', base: 'EUR', quote: 'USD' },
  { symbol: 'GBP/USD', base: 'GBP', quote: 'USD' },
  { symbol: 'USD/JPY', base: 'USD', quote: 'JPY' },
  { symbol: 'USD/CHF', base: 'USD', quote: 'CHF' },
  { symbol: 'AUD/USD', base: 'AUD', quote: 'USD' },
  { symbol: 'USD/CAD', base: 'USD', quote: 'CAD' },
  { symbol: 'NZD/USD', base: 'NZD', quote: 'USD' },
  { symbol: 'EUR/GBP', base: 'EUR', quote: 'GBP' },
  { symbol: 'GBP/JPY', base: 'GBP', quote: 'JPY' },
]
