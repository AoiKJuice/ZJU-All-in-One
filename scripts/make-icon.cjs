// 由 build/icon.svg（钟鹰）渲染应用图标 build/icon.png（1024×1024，透明底）。用法：npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const svg = fs.readFileSync(path.join(__dirname, '../build/icon.svg'), 'utf8')
const html = `<html><head><style>
html, body { margin: 0; width: 1024px; height: 1024px; background: transparent; overflow: hidden; }
svg { display: block; width: 1024px; height: 1024px; }
</style></head><body>${svg}</body></html>`
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '../build/icon.png'), image.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
