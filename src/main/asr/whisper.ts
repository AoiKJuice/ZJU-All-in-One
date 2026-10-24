import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, createWriteStream } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { performance } from 'node:perf_hooks'
import ffmpegPath from 'ffmpeg-static'
import type { TaskProgress, TranscriptSegment } from '@shared/types'
import { zjuSession } from '../auth/zjuam'
import { throttle } from './throttle'

const ENGINE_URL =
  'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip'
const MODEL_URL =
  'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
const MODEL_NAME = 'ggml-large-v3-turbo-q5_0.bin'
const REFERER = 'https://classroom.zju.edu.cn/'
const execFileAsync = promisify(execFile)

// 显卡占用上限（运行时间占空比）：其余时间让给界面渲染。实测 10 分钟音频平均占用 64% → 49%，耗时约 1.5 倍
const GPU_DUTY = 0.6
// large-v3-turbo q5_0 在显卡上的显存峰值实测约 1.1GB（束搜索与贪心解码相差无几）
const GPU_MIB = 1200

const PROMPT = '以下是普通话的课堂录音，请使用简体中文并加上标点符号。'

type Report = (progress: Omit<TaskProgress, 'key'>) => void
type DownloadProgress = Pick<TaskProgress, 'bytes' | 'speed' | 'eta' | 'ratio'>

interface WhisperOutput {
  transcription: {
    offsets: {
      from: number
      to: number
    }
    text: string
  }[]
}

interface ProcessResult {
  code: number | null
  stderr: string
}

const tasks = new Map<string, Promise<TranscriptSegment[]>>()
const engineReports = new Set<Report>()
const modelReports = new Set<Report>()
const childPids = new Set<number>()

let engineTask: Promise<string> | undefined
let modelTask: Promise<string> | undefined

function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu, '').toLowerCase()
}

const watermarkKeywords = [
  '点赞',
  '订阅',
  '转发',
  '打赏',
  '明镜',
  '点点栏目',
  '字幕由',
  '字幕组',
  'Amara',
  'YoYo',
  '优优独播',
  '独播剧场',
  '感谢观看',
  '谢谢观看',
  '感谢收看',
  '中文字幕',
  '字幕志愿者'
].map(normalizeText)

const strongWatermarkKeywords = [
  '明镜',
  '点点栏目',
  'Amara',
  'YoYo',
  '独播剧场',
  '字幕志愿者'
].map(normalizeText)

const normalizedPrompt = normalizeText(PROMPT)
const promptPatterns = Array.from(
  { length: normalizedPrompt.length - 7 },
  (_, index) => normalizedPrompt.slice(index, index + 8)
)

export function cleanSegments(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  const filtered = segments.filter(segment => {
    const text = normalizeText(segment.text)
    if (strongWatermarkKeywords.some(keyword => text.includes(keyword))) {
      return false
    }
    if (promptPatterns.some(pattern => text.includes(pattern))) return false

    let hits = 0
    for (const keyword of watermarkKeywords) {
      if (text.includes(keyword) && ++hits >= 2) return false
    }
    return true
  })

  let start = 0
  let end = filtered.length
  while (start < end && normalizeText(filtered[start].text).length === 0) {
    start++
  }
  while (end > start && normalizeText(filtered[end - 1].text).length === 0) {
    end--
  }
  return filtered.slice(start, end)
}

export function activeChildPids(): number[] {
  return [...childPids]
}

function rootPath(): string {
  return join(app.getPath('userData'), 'whisper')
}

function transcriptPath(cacheKey: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(cacheKey)) {
    throw new Error('无效的转写缓存键')
  }
  return join(app.getPath('userData'), 'transcripts', `${cacheKey}.json`)
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function estimateEta(started: number, ratio?: number): number | undefined {
  if (ratio === undefined || ratio <= 0) return undefined
  return (performance.now() - started) / 1000 * (1 - ratio) / ratio
}

async function download(
  url: string,
  filePath: string,
  progress: (detail: DownloadProgress) => void,
  headers: Record<string, string> = {}
): Promise<void> {
  const response = await zjuSession().fetch(url, { headers })
  if (!response.ok || !response.body) throw new Error('文件下载失败')

  const total = Number(response.headers.get('content-length'))
  const started = performance.now()
  const samples = [{ time: started, bytes: 0 }]
  let received = 0
  let lastReport = started
  const partPath = `${filePath}.part`

  const notify = (finished = false): void => {
    const now = performance.now()
    while (samples.length > 1 && samples[1].time <= now - 2000) {
      samples.shift()
    }
    const first = samples[0]
    const elapsed = (now - first.time) / 1000
    const speed = elapsed > 0 ? (received - first.bytes) / elapsed : 0
    progress({
      bytes: { done: received, total },
      speed,
      ratio: finished ? 1 : total > 0 ? clamp(received / total) : undefined,
      eta: finished ? 0 : total > 0 && speed > 0
        ? Math.max(0, total - received) / speed
        : undefined
    })
    lastReport = now
  }

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      const now = performance.now()
      samples.push({ time: now, bytes: received })
      while (samples.length > 1 && samples[1].time <= now - 2000) {
        samples.shift()
      }
      if (now - lastReport >= 250) notify()
      callback(null, chunk)
    }
  })

  async function* chunks(): AsyncGenerator<Uint8Array> {
    const reader = response.body!.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        yield value
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
  }

  notify()
  try {
    await pipeline(
      Readable.from(chunks()),
      meter,
      createWriteStream(partPath)
    )
    await rename(partPath, filePath)
    notify(true)
  } finally {
    await rm(partPath, { force: true })
  }
}

function run(
  executable: string,
  args: string[],
  onStderr: (line: string) => void = () => {},
  onStdout: (line: string) => void = () => {},
  track = false,
  /** 显卡占用上限（占空比），见 throttle.ts */
  duty = 1
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''

    if (track && child.pid !== undefined) {
      childPids.add(child.pid)
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch (error) {
        console.warn('降低子进程优先级失败', error)
      }
    }

    const release = child.pid !== undefined ? throttle(child.pid, duty) : () => {}
    const forget = (): void => {
      release()
      if (child.pid !== undefined) childPids.delete(child.pid)
    }

    const readLines = (
      stream: Readable,
      onLine: (line: string) => void,
      capture = false
    ): (() => void) => {
      let pending = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        if (capture) stderr = (stderr + chunk).slice(-6000)
        const lines = (pending + chunk).split(/[\r\n]/)
        pending = lines.pop()!
        for (const line of lines) {
          if (line) onLine(line)
        }
      })
      return () => {
        if (pending) onLine(pending)
      }
    }

    const flushStderr = readLines(child.stderr, onStderr, true)
    const flushStdout = readLines(child.stdout, onStdout)

    child.on('error', error => {
      forget()
      reject(new Error(`进程启动失败：${error.message}`))
    })
    child.on('close', code => {
      forget()
      flushStderr()
      flushStdout()
      resolve({ code, stderr })
    })
  })
}

async function findCli(directory: string): Promise<string | undefined> {
  if (!existsSync(directory)) return undefined

  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === 'whisper-cli.exe') {
      return path
    }
    if (entry.isDirectory()) {
      const found = await findCli(path)
      if (found) return found
    }
  }
  return undefined
}

function emit(
  reports: Set<Report>,
  stage: 'engine' | 'model',
  detail: DownloadProgress = {},
  message?: string
): void {
  for (const report of reports) report({ stage, ...detail, message })
}

async function installEngine(): Promise<string> {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('当前引擎仅支持 Windows x64')
  }

  const root = rootPath()
  const directory = join(root, 'engine')
  const existing = await findCli(directory)
  if (existing) return existing

  await mkdir(root, { recursive: true })
  const archive = join(root, 'engine-b5454.zip')
  if (!existsSync(archive)) {
    await download(ENGINE_URL, archive, detail => {
      emit(engineReports, 'engine', detail, '下载 Whisper 引擎')
    })
  }

  const staging = await mkdtemp(join(root, 'engine-install-'))
  try {
    emit(engineReports, 'engine', {}, '解压 Whisper 引擎')
    // 使用系统 bsdtar，避免 GNU tar 将盘符识别为远程主机。
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    const result = await run(tar, ['-xf', archive, '-C', staging])
    if (result.code !== 0) {
      throw new Error(`引擎解压失败：${result.stderr.trim()}`)
    }
    if (!await findCli(staging)) throw new Error('未找到 Whisper 引擎')

    await rm(directory, { recursive: true, force: true })
    await rename(staging, directory)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  await rm(archive, { force: true })
  return (await findCli(directory))!
}

async function installModel(): Promise<string> {
  const directory = join(rootPath(), 'models')
  const model = join(directory, MODEL_NAME)
  if (existsSync(model)) return model

  await mkdir(directory, { recursive: true })
  await download(MODEL_URL, model, detail => {
    emit(modelReports, 'model', detail, '下载 Whisper 模型')
  })
  return model
}

async function ensureEngine(report: Report): Promise<string> {
  report({ stage: 'engine', message: '准备 Whisper 引擎' })
  engineReports.add(report)
  try {
    engineTask ??= installEngine().finally(() => {
      engineTask = undefined
    })
    const cli = await engineTask
    report({ stage: 'engine', ratio: 1 })
    return cli
  } finally {
    engineReports.delete(report)
  }
}

async function ensureModel(report: Report): Promise<string> {
  report({ stage: 'model', message: '准备 Whisper 模型' })
  modelReports.add(report)
  try {
    modelTask ??= installModel().finally(() => {
      modelTask = undefined
    })
    const model = await modelTask
    report({ stage: 'model', ratio: 1 })
    return model
  } finally {
    modelReports.delete(report)
  }
}

function seconds(value: string): number {
  const [hours, minutes, seconds] = value.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

async function extractAudio(
  media: string,
  wav: string,
  report: Report
): Promise<number> {
  if (!ffmpegPath) throw new Error('未找到 ffmpeg')

  const executable = ffmpegPath.replace(
    /app\.asar([\\/])/,
    'app.asar.unpacked$1'
  )
  const started = performance.now()
  let lastReport = started
  let duration = 0
  let audioDuration = 0
  report({ stage: 'audio', ratio: 0, message: '抽取课堂音频' })

  const result = await run(executable, [
    '-y',
    '-i', media,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    wav
  ], line => {
    const total = line.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/)
    if (total) duration = seconds(total[1])

    const current = line.match(/time=\s*(\d+:\d+:\d+(?:\.\d+)?)/)
    if (!current) return

    audioDuration = seconds(current[1])
    const now = performance.now()
    if (duration > 0 && now - lastReport >= 250) {
      const ratio = clamp(audioDuration / duration)
      report({
        stage: 'audio',
        ratio,
        eta: estimateEta(started, ratio),
        message: '抽取课堂音频'
      })
      lastReport = now
    }
  }, undefined, true)

  if (result.code !== 0) {
    throw new Error(`音频抽取失败：${result.stderr.trim()}`)
  }
  report({ stage: 'audio', ratio: 1, eta: 0 })
  return audioDuration > 0 ? audioDuration : duration
}

/**
 * 按本机显存决定用不用显卡：显存预算 = 总显存的 30%，且给其他程序至少留 1GB 空闲；
 * 预算放得下模型就上显卡（限占空比），放不下或没有 NVIDIA 显卡就用 CPU。
 */
async function gpuPlan(): Promise<{ args: string[]; duty: number }> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=memory.total,memory.used', '--format=csv,noheader,nounits'], { windowsHide: true })
    const [total, used] = stdout.trim().split(/\r?\n/)[0].split(',').map(Number)
    const budget = Math.min(total * 0.3, total - used - 1024)
    if (budget >= GPU_MIB) return { args: [], duty: GPU_DUTY }
  } catch {
    // 没有 nvidia-smi：非 NVIDIA 显卡
  }
  return { args: ['-ng'], duty: 1 }
}

async function recognize(
  cli: string,
  model: string,
  wav: string,
  output: string,
  duration: number,
  report: Report
): Promise<TranscriptSegment[]> {
  const started = performance.now()
  let progressRatio: number | undefined
  let lastEnd = 0
  let lastReport = started
  let partial: TranscriptSegment[] = []
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const ratio = (): number | undefined => {
    return progressRatio ?? (duration > 0 ? clamp(lastEnd / duration) : undefined)
  }

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!pending) return

    const currentRatio = ratio()
    const segments = partial
    partial = []
    pending = false
    lastReport = performance.now()
    report({
      stage: 'transcribe',
      ratio: currentRatio,
      eta: estimateEta(started, currentRatio),
      ...(segments.length > 0 ? { partial: segments } : {})
    })
  }

  const schedule = (): void => {
    pending = true
    if (timer !== undefined) return
    timer = setTimeout(
      flush,
      Math.max(0, Math.ceil(250 - (performance.now() - lastReport)))
    )
  }

  const onStderr = (line: string): void => {
    const progress = line.match(/progress\s*=\s*(\d+(?:\.\d+)?)%/)
    if (!progress) return

    progressRatio = clamp(Number(progress[1]) / 100)
    schedule()
  }

  const onStdout = (line: string): void => {
    const match = line.match(
      /^\s*\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$/
    )
    if (!match) return

    const segment = {
      start: seconds(match[1]),
      end: seconds(match[2]),
      text: match[3].trim()
    }
    lastEnd = segment.end
    partial.push(...cleanSegments([segment]))
    schedule()
  }

  report({ stage: 'transcribe', ratio: 0, message: '本地 Whisper 转写' })
  const plan = await gpuPlan()
  const result = await run(cli, [
    ...plan.args,
    '-m', model,
    '-f', wav,
    '-l', 'zh',
    '-oj',
    '-of', output,
    '-pp',
    '--prompt', PROMPT
  ], onStderr, onStdout, true, plan.duty).finally(flush)

  if (result.code !== 0) {
    throw new Error(`Whisper 转写失败：${result.stderr.trim()}`)
  }

  const json = JSON.parse(
    await readFile(`${output}.json`, 'utf8')
  ) as WhisperOutput

  const segments = cleanSegments(json.transcription.map(segment => ({
    start: segment.offsets.from / 1000,
    end: segment.offsets.to / 1000,
    text: segment.text.trim()
  })))
  report({ stage: 'transcribe', ratio: 1, eta: 0 })
  return segments
}

export async function readTranscript(
  cacheKey: string
): Promise<TranscriptSegment[] | null> {
  const path = transcriptPath(cacheKey)
  if (!existsSync(path)) return null
  return cleanSegments(
    JSON.parse(await readFile(path, 'utf8')) as TranscriptSegment[]
  )
}

async function execute(
  mediaUrl: string,
  cacheKey: string,
  report: Report
): Promise<TranscriptSegment[]> {
  const cached = await readTranscript(cacheKey)
  if (cached) return cached

  const cli = await ensureEngine(report)
  const model = await ensureModel(report)
  const temporary = await mkdtemp(join(rootPath(), 'task-'))

  try {
    const media = join(temporary, 'media')
    const wav = join(temporary, 'audio.wav')
    const output = join(temporary, 'transcript')

    await download(mediaUrl, media, detail => {
      report({ stage: 'audio', ...detail, message: '下载回放媒体' })
    }, { Referer: REFERER })

    const duration = await extractAudio(media, wav, report)
    await rm(media)

    const segments = await recognize(cli, model, wav, output, duration, report)
    const directory = join(app.getPath('userData'), 'transcripts')
    const target = transcriptPath(cacheKey)
    await mkdir(directory, { recursive: true })
    await writeFile(`${target}.part`, JSON.stringify(segments), 'utf8')
    await rename(`${target}.part`, target)
    return segments
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export function transcribe(
  mediaUrl: string,
  cacheKey: string,
  report: Report
): Promise<TranscriptSegment[]> {
  const existing = tasks.get(cacheKey)
  if (existing) return existing

  const task = execute(mediaUrl, cacheKey, report).finally(() => {
    tasks.delete(cacheKey)
  })
  tasks.set(cacheKey, task)
  return task
}
