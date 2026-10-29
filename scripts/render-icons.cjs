// Renders every icon from build/icon.svg (the source of truth) using Electron's own Chromium.
//   npx electron scripts/render-icons.cjs
// Outputs:
//   build/icon.png                  1024 px app icon (electron-builder turns it into .icns / .ico)
//   build/trayTemplate(@2x).png     macOS menu-bar template (black glyph, transparent)
//   src/renderer/src/assets/logo.svg  header logo (cropped to the rounded square, no shadow)
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(ROOT, 'build/icon.svg'), 'utf8')
// Menu-bar template: the same artwork in solid black on transparent — no background, no glow —
// with strokes thickened so the ζ and the signal arcs survive 16 px.
const traySvg = svg
  .replace('viewBox="0 0 1024 1024"', 'viewBox="170 120 760 760"')
  .replace(/<rect [^>]*\/>/g, '')
  .replace(/<path [^>]*filter="url\(#glow\)"[^>]*\/>/g, '')
  .replace(/url\(#g\w*\)/g, '#000')
  .replace(/ opacity="[\d.]+"/g, '')
  .replace(/stroke-width="(\d+)"/g, (_, w) => `stroke-width="${Math.round(w * 1.45)}"`)

const headerSvg = svg
  .replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"')
  .replace(' filter="url(#sh)"', '')

async function render(win, markup, size) {
  const html = `<html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px">${markup.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  return nativeImage.createFromBuffer(img.toPNG()).resize({ width: size, height: size, quality: 'best' }).toPNG()
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  fs.writeFileSync(path.join(ROOT, 'build/icon.png'), await render(win, svg, 1024))
  // render the tray glyph large, then downscale for clean anti-aliasing
  const big = nativeImage.createFromBuffer(await render(win, traySvg, 512))
  fs.writeFileSync(path.join(ROOT, 'build/trayTemplate.png'), big.resize({ width: 16, height: 16, quality: 'best' }).toPNG())
  fs.writeFileSync(path.join(ROOT, 'build/trayTemplate@2x.png'), big.resize({ width: 32, height: 32, quality: 'best' }).toPNG())
  fs.mkdirSync(path.join(ROOT, 'src/renderer/src/assets'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'src/renderer/src/assets/logo.svg'), headerSvg)
  console.log('icons rendered from build/icon.svg')
  app.quit()
})
