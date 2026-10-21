import { app } from 'electron'
import { execFile } from 'node:child_process'
import { cpus, freemem, totalmem } from 'node:os'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { SystemStats } from '@shared/types'
import { activeChildPids } from './asr/whisper'

const execFileAsync = promisify(execFile)

function cpuTimes(): { idle: number; total: number } {
  let idle = 0
  let total = 0

  for (const cpu of cpus()) {
    idle += cpu.times.idle
    total += Object.values(cpu.times).reduce((sum, time) => sum + time, 0)
  }
  return { idle, total }
}

async function cpuUsage(): Promise<number> {
  const before = cpuTimes()
  await setTimeout(200)
  const after = cpuTimes()
  const total = after.total - before.total
  if (total <= 0) throw new Error('CPU 采样失败')

  return Math.max(0, Math.min(1, 1 - (after.idle - before.idle) / total))
}

async function childMemory(pid: number): Promise<number> {
  const { stdout } = await execFileAsync('tasklist', [
    '/FI', `PID eq ${pid}`,
    '/FO', 'CSV',
    '/NH'
  ], { windowsHide: true })

  const row = stdout.trim().split(/\r?\n/).find(line => line.startsWith('"'))
  // 查询期间子进程可能已经退出，tasklist 此时返回无匹配提示。
  if (!row && !activeChildPids().includes(pid)) return 0
  if (!row) throw new Error('子进程内存读取失败')

  const fields = row.slice(1, -1).split('","')
  const memory = Number(fields[4].replace(/[,\s]/g, '').replace(/K$/i, ''))
  if (!Number.isFinite(memory)) throw new Error('子进程内存格式错误')
  return memory * 1024
}

async function appMemory(): Promise<number> {
  const metrics = app.getAppMetrics()
  const electronMemory = metrics.reduce(
    (sum, metric) => sum + metric.memory.workingSetSize * 1024,
    0
  )
  if (process.platform !== 'win32') return electronMemory

  const electronPids = new Set(metrics.map(metric => metric.pid))
  const pids = activeChildPids().filter(pid => !electronPids.has(pid))
  const children = await Promise.all(pids.map(childMemory))
  return electronMemory + children.reduce((sum, bytes) => sum + bytes, 0)
}

async function gpuStats(): Promise<SystemStats['gpu']> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total',
      '--format=csv,noheader,nounits'
    ], { windowsHide: true })

    const [name, utilization, used, total] = stdout.trim().split(/\r?\n/)[0]
      .split(',').map(value => value.trim())
    const util = Number(utilization)
    const memUsed = Number(used)
    const memTotal = Number(total)

    if (!name || ![util, memUsed, memTotal].every(Number.isFinite)) {
      throw new Error('GPU 统计格式错误')
    }

    return {
      name,
      util: util / 100,
      memUsed: memUsed * 1024 * 1024,
      memTotal: memTotal * 1024 * 1024
    }
  } catch {
    return undefined
  }
}

export async function getSystemStats(): Promise<SystemStats> {
  const [cpu, memoryUsed, gpu] = await Promise.all([
    cpuUsage(),
    appMemory(),
    gpuStats()
  ])
  const total = totalmem()

  return {
    cpu,
    memory: { used: total - freemem(), total },
    appMemory: memoryUsed,
    ...(gpu ? { gpu } : {})
  }
}
