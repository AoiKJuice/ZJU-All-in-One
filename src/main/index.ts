import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { initMcp } from './mcp'
import { initializeDiagnostics } from './diagnostics'

// 打包后应用名取 productName（"ZJU All in One"），数据目录会随之改变；固定到开发时的目录，登录态与 Whisper 模型共用
// ZJU_PROFILE=xxx 可另开一套数据目录（与已安装版并行调试，不撞单实例锁）
const profile = process.env['ZJU_PROFILE']
app.setPath('userData', join(app.getPath('appData'), profile ? `zju-all-in-one-${profile}` : 'zju-all-in-one'))

// Windows 回放用软件解码，规避 D3D11 解码路径。界面保留 GPU 合成（全软件渲染太卡）；
// 与 Whisper CUDA 的争用由 asr/throttle.ts 限制 Whisper 的显卡占空比解决。
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-accelerated-video-decode')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hidden',
    // 与刊头同高；符号取墨色中间调，昼夜两种纸色上都看得清
    titleBarOverlay: { color: '#00000000', symbolColor: '#8c8274', height: 56 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1714' : '#f3eee4',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow = win
  win.on('closed', () => { mainWindow = null })

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  initializeDiagnostics()
  app.on('second-instance', showMainWindow)

  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.cmc.zju.edu.cn/*', '*://*.zju.edu.cn/*'] },
      (details, callback) => {
        const headers = details.requestHeaders
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'referer') delete headers[key]
        }
        headers['Referer'] = 'https://classroom.zju.edu.cn/'
        callback({ requestHeaders: headers })
      }
    )

    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['*://*.cmc.zju.edu.cn/*', '*://*.zju.edu.cn/*'] },
      (details, callback) => {
        const headers = { ...details.responseHeaders }
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'access-control-allow-origin') delete headers[key]
        }
        headers['Access-Control-Allow-Origin'] = ['*']
        callback({ responseHeaders: headers })
      }
    )

    registerIpc()
    initMcp()
    createWindow()
    app.on('activate', showMainWindow)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
