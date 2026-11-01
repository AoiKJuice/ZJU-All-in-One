import { app, crashReporter } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

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

  watchMainThread()
  // 显卡信息：卡死多与显卡进程有关，记下实际用的适配器与叠加平面支持
  void app.getGPUInfo('basic').then((info) => {
    const gpu = info as { gpuDevice?: { active?: boolean; deviceString?: string; driverVersion?: string }[] }
    const active = gpu.gpuDevice?.find(d => d.active) ?? gpu.gpuDevice?.[0]
    logDiagnostic('gpu-info', { device: active?.deviceString, driver: active?.driverVersion, adapters: gpu.gpuDevice?.length })
  }, () => {})

  try {
    crashReporter.start({ uploadToServer: false })
    logDiagnostic('crash-reporter-started')
  } catch {
    logDiagnostic('crash-reporter-start-failed')
  }
}

/**
 * 主线程看门狗：在独立线程里看主线程的心跳。主线程（也是窗口的 UI 线程）被原生调用卡住时，
 * 上面的事件循环监测在卡住期间写不了日志、进程被 Windows 结束就什么也留不下；看门狗线程照常运行，
 * 卡住超过 3 秒就记一条，恢复时再记一条，用于判断 AppHang 时主线程是否被拖住
 */
function watchMainThread(): void {
  if (!logPath) return
  const beat = new Int32Array(new SharedArrayBuffer(4))
  const start = Date.now()
  setInterval(() => Atomics.store(beat, 0, Date.now() - start), 250).unref()
  const code = `
    const { workerData } = require('node:worker_threads')
    const { appendFileSync } = require('node:fs')
    const { beat, start, logPath, pid } = workerData
    let stalled = 0
    const log = (event, details) => {
      try { appendFileSync(logPath, JSON.stringify({ time: new Date().toISOString(), pid, event, details }) + '\\n') } catch {}
    }
    setInterval(() => {
      const lag = Date.now() - start - Atomics.load(beat, 0)
      if (lag > 3000 && !stalled) { stalled = lag; log('main-thread-stall', { ms: lag }) }
      else if (lag > 15000 && stalled < 15000) { stalled = lag; log('main-thread-stall', { ms: lag }) }
      else if (lag < 1000 && stalled) { log('main-thread-recovered', {}); stalled = 0 }
    }, 1000)
  `
  try {
    const worker = new Worker(code, { eval: true, workerData: { beat, start, logPath, pid: process.pid } })
    worker.unref()
  } catch {
    logDiagnostic('watchdog-failed')
  }
}
