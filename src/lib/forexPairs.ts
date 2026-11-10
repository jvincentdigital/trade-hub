// The 8 forex pairs. A plain module (not the 'use client' hooks file) so
// server code like /api/race can read the instrument list too.
export const FOREX_PAIRS = [
  { symbol: 'EUR/USD', base: 'EUR', quote: 'USD', invert: true },
  { symbol: 'GBP/USD', base: 'GBP', quote: 'USD', invert: true },
  { symbol: 'USD/JPY', base: 'USD', quote: 'JPY', invert: false },
  { symbol: 'USD/CHF', base: 'USD', quote: 'CHF', invert: false },
  { symbol: 'AUD/USD', base: 'AUD', quote: 'USD', invert: true },
  { symbol: 'USD/CAD', base: 'USD', quote: 'CAD', invert: false },
  { symbol: 'NZD/USD', base: 'NZD', quote: 'USD', invert: true },
  { symbol: 'EUR/GBP', base: 'EUR', quote: 'GBP', invert: false },
]
