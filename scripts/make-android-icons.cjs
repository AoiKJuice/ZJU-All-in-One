// 由 build/icon.svg（钟鹰）生成安卓图标到 android/app/src/main/res。用法：npx electron scripts/make-android-icons.cjs
// 传统图标即整枚钟鹰；自适应图标的前景把钟鹰缩进 108dp 画布的安全区，背景为纸色（values/ic_launcher_background.xml）；
// 启动图标 drawable/splash_icon.png 由 drawable/splash.xml 叠在纸色底上居中
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

// 截图按 CSS 像素一比一，不受系统显示缩放影响
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.on('window-all-closed', () => {})

const svg = fs.readFileSync(path.join(__dirname, '../build/icon.svg'), 'utf8')
const res = path.join(__dirname, '../android/app/src/main/res')
const SIZE = 1024

// [文件, 边长, 钟鹰占画布比例]
const targets = [['drawable/splash_icon.png', 288, 1]]
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [name, k] of Object.entries(densities)) {
  targets.push([`mipmap-${name}/ic_launcher.png`, 48 * k, 1])
  targets.push([`mipmap-${name}/ic_launcher_round.png`, 48 * k, 1])
  targets.push([`mipmap-${name}/ic_launcher_foreground.png`, 108 * k, 0.64])
}

const page = (ratio) => `<html><head><style>
html, body { margin: 0; width: ${SIZE}px; height: ${SIZE}px; overflow: hidden; background: transparent; display: grid; place-items: center; }
svg { display: block; width: ${Math.round(SIZE * ratio)}px; height: ${Math.round(SIZE * ratio)}px; }
</style></head><body>${svg}</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  for (const [file, size, ratio] of targets) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(ratio)))
    await new Promise((r) => setTimeout(r, 200))
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(res, file), image.resize({ width: size, height: size, quality: 'best' }).toPNG())
  }
  app.quit()
})
