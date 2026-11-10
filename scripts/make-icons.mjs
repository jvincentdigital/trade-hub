// Draws the home-screen icons from one SVG (three rising candles, indigo on
// near-black) and saves the PNGs + favicon.ico. Uses the installed Google
// Chrome through Playwright, so nothing new to install.
// Run: node scripts/make-icons.mjs   (then commit the files it writes)
import { writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BG = '#0a0a0a' // --bg-primary
const FG = '#6366f1' // --indigo

// 100 x 100 grid. Glyph box is x 23..77, y 18..80, centred on (50, 49).
// `scale` shrinks it for the maskable icon so it stays inside the 80% safe circle.
// `round` gives the favicon rounded corners; phone icons stay square (the phone rounds them).
const svg = (scale, round = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${round}" fill="${BG}"/>
  <g fill="${FG}" transform="translate(50 50) scale(${scale}) translate(-50 -49)">
    <rect x="28" y="52" width="4" height="28" rx="2"/>
    <rect x="23" y="58" width="14" height="16" rx="2.5"/>
    <rect x="48" y="36" width="4" height="32" rx="2"/>
    <rect x="43" y="42" width="14" height="18" rx="2.5"/>
    <rect x="68" y="18" width="4" height="36" rx="2"/>
    <rect x="63" y="24" width="14" height="22" rx="2.5"/>
  </g>
</svg>`

const outputs = [
  { file: 'public/icon-192.png', size: 192, scale: 1 },
  { file: 'public/icon-512.png', size: 512, scale: 1 },
  { file: 'public/icon-maskable-512.png', size: 512, scale: 0.78 },
  { file: 'src/app/apple-icon.png', size: 180, scale: 1 },
]
const favSizes = [16, 32, 48]

const browser = await chromium.launch({ channel: 'chrome' })

// round > 0 leaves the corners transparent, so Chrome saves RGBA, which the .ico
// decoder in Next requires (it rejects RGB PNGs inside an .ico).
// A fresh page per size: reusing one page after a resize can capture a stale frame.
async function render(size, scale, round = 0) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  })
  await page.setContent(
    `<html><body style="margin:0">${svg(scale, round).replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`,
  )
  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: round > 0,
  })
  await page.close()
  return png
}

for (const { file, size, scale } of outputs) {
  writeFileSync(file, await render(size, scale))
  console.log('wrote', file)
}

// favicon.ico = a small header + directory, then each PNG as is (allowed since Vista).
const pngs = []
for (const s of favSizes) pngs.push(await render(s, 1, 18))
await browser.close()
const head = Buffer.alloc(6 + 16 * pngs.length)
head.writeUInt16LE(0, 0)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(pngs.length, 4)
let offset = head.length
pngs.forEach((png, i) => {
  const e = 6 + 16 * i
  head.writeUInt8(favSizes[i], e)
  head.writeUInt8(favSizes[i], e + 1)
  head.writeUInt16LE(1, e + 4) // planes
  head.writeUInt16LE(32, e + 6) // bits per pixel
  head.writeUInt32LE(png.length, e + 8)
  head.writeUInt32LE(offset, e + 12)
  offset += png.length
})
writeFileSync('src/app/favicon.ico', Buffer.concat([head, ...pngs]))
console.log('wrote src/app/favicon.ico')
