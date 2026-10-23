// 生成应用图标 build/icon.png（1024×1024）：纸色底、书宋"浙"、朱色小点。用法：npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const font = path.join(__dirname, '../src/renderer/public/type/FZShuSong-Z01S.woff2').split(path.sep).join('/')
const html = `<html><head><style>
@font-face { font-family: S; src: url('file:///${font}') format('woff2'); }
html, body { margin: 0; width: 1024px; height: 1024px; background: transparent; }
.tile { position: absolute; inset: 64px; border-radius: 200px; background: #f3eee4; overflow: hidden; }
.ch { position: absolute; inset: 0; display: grid; place-items: center; font: 520px/1 S, serif; color: #26221d; padding-bottom: 90px; }
.dot { position: absolute; left: 50%; bottom: 112px; width: 52px; height: 52px; margin-left: -26px; border-radius: 50%; background: #a94f35; }
</style></head><body><div class="tile"><div class="ch">浙</div><div class="dot"></div></div></body></html>`
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, '../build/icon.png'), image.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
