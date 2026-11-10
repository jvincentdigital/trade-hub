import type { MetadataRoute } from 'next'

// Home-screen app (iPhone Add to Home Screen, Android install). Icons come from
// scripts/make-icons.mjs; src/proxy.ts lets this file and the icons load without the passcode.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Trade Hub',
    short_name: 'Trade Hub',
    description: 'Open trades, the strategy race and live markets. Play money only.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
