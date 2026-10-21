import { app, crashReporter } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logPath: string | undefined
let initialized = false

export function logDiagnostic(
  event: string,
  details: Record<string, unknown> = {}
): void {
  if (!logPath) return

  try {
    // 低频同步写入，让退出与未捕获异常记录在进程结束前保存。
    appendFileSync(logPath, JSON.stringify({
      time: new Date().toISOString(),
      pid: process.pid,
      event,
      details
    }) + '\n', 'utf8')
  } catch {
    console.error('诊断日志写入失败')
  }
}

export function initializeDiagnostics(): void {
  if (initialized) return
  initialized = true

  try {
    const directory = join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })
    logPath = join(directory, 'app.log')
  } catch {
    console.error('诊断日志目录创建失败')
  }

  logDiagnostic('app-start', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch
  })

  app.on('before-quit', () => logDiagnostic('before-quit'))
  app.on('quit', (_event, exitCode) => logDiagnostic('quit', { exitCode }))
  app.on('render-process-gone', (_event, contents, details) => {
    logDiagnostic('render-process-gone', {
      webContentsId: contents.id,
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  app.on('child-process-gone', (_event, details) => {
    logDiagnostic('child-process-gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  app.on('browser-window-created', (_event, window) => {
    const windowId = window.id
    window.on('unresponsive', () => logDiagnostic('window-unresponsive', { windowId }))
    window.on('responsive', () => logDiagnostic('window-responsive', { windowId }))
    window.on('closed', () => logDiagnostic('window-closed', { windowId }))
  })
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    // 省略可能含请求参数的异常正文，保留调用位置。
    logDiagnostic('uncaught-exception', {
      name: error.name,
      origin,
      stack: error.stack?.split('\n').filter(line => line.trimStart().startsWith('at ')).join('\n')
    })
  })

  // 主进程事件循环卡顿监测：每 500ms 计时一次，超出 1s 记一条，用于区分主进程阻塞与渲染/GPU 卡死
  let tick = performance.now()
  setInterval(() => {
    const now = performance.now()
    const lag = now - tick - 500
    if (lag > 1000) logDiagnostic('main-event-loop-lag', { ms: Math.round(lag) })
    tick = now
  }, 500).unref()

  try {
    crashReporter.start({ uploadToServer: false })
    logDiagnostic('crash-reporter-started')
  } catch {
    logDiagnostic('crash-reporter-start-failed')
  }
}
