import { app } from 'electron'
import { spawn } from 'node:child_process'
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
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ffmpegPath from 'ffmpeg-static'
import type { TaskProgress, TranscriptSegment } from '@shared/types'
import { zjuSession } from '../auth/zjuam'

const ENGINE_URL =
  'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip'
const MODEL_URL =
  'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
const MODEL_NAME = 'ggml-large-v3-turbo-q5_0.bin'
const REFERER = 'https://classroom.zju.edu.cn/'

type Report = (progress: Omit<TaskProgress, 'key'>) => void

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

let engineTask: Promise<string> | undefined
let modelTask: Promise<string> | undefined

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

async function download(
  url: string,
  filePath: string,
  progress: (ratio?: number) => void,
  headers: Record<string, string> = {}
): Promise<void> {
  const response = await zjuSession().fetch(url, { headers })
  if (!response.ok || !response.body) throw new Error('文件下载失败')

  const total = Number(response.headers.get('content-length'))
  let received = 0
  const partPath = `${filePath}.part`
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      progress(total > 0 ? clamp(received / total) : undefined)
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

  try {
    await pipeline(
      Readable.from(chunks()),
      meter,
      createWriteStream(partPath)
    )
    await rename(partPath, filePath)
  } finally {
    await rm(partPath, { force: true })
  }
}

function run(
  executable: string,
  args: string[],
  onLine: (line: string) => void = () => {}
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let pending = ''
    let stderr = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-6000)
      const lines = (pending + chunk).split(/[\r\n]/)
      pending = lines.pop()!
      for (const line of lines) onLine(line)
    })
    child.on('error', error => {
      reject(new Error(`进程启动失败：${error.message}`))
    })
    child.on('close', code => {
      if (pending) onLine(pending)
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
  ratio?: number,
  message?: string
): void {
  for (const report of reports) report({ stage, ratio, message })
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
    await download(ENGINE_URL, archive, ratio => {
      emit(engineReports, 'engine', ratio, '下载 Whisper 引擎')
    })
  }

  const staging = await mkdtemp(join(root, 'engine-install-'))
  try {
    emit(engineReports, 'engine', undefined, '解压 Whisper 引擎')
    const result = await run('tar', ['-xf', archive, '-C', staging])
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
  await download(MODEL_URL, model, ratio => {
    emit(modelReports, 'model', ratio, '下载 Whisper 模型')
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
): Promise<void> {
  if (!ffmpegPath) throw new Error('未找到 ffmpeg')

  const executable = ffmpegPath.replace(
    /app\.asar([\\/])/,
    'app.asar.unpacked$1'
  )
  let duration = 0
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
    if (current && duration > 0) {
      report({
        stage: 'audio',
        ratio: clamp(seconds(current[1]) / duration),
        message: '抽取课堂音频'
      })
    }
  })

  if (result.code !== 0) {
    throw new Error(`音频抽取失败：${result.stderr.trim()}`)
  }
  report({ stage: 'audio', ratio: 1 })
}

async function recognize(
  cli: string,
  model: string,
  wav: string,
  output: string,
  report: Report
): Promise<TranscriptSegment[]> {
  const args = [
    '-m', model,
    '-f', wav,
    '-l', 'zh',
    '-oj',
    '-of', output,
    '-pp',
    '--prompt', '以下是普通话的课堂录音，请使用简体中文并加上标点符号。'
  ]
  const onLine = (line: string): void => {
    const progress = line.match(/progress\s*=\s*(\d+(?:\.\d+)?)%/)
    if (progress) {
      report({
        stage: 'transcribe',
        ratio: clamp(Number(progress[1]) / 100)
      })
    }
  }

  report({ stage: 'transcribe', ratio: 0, message: '本地 Whisper 转写' })
  let result = await run(cli, args, onLine)

  if (result.code !== 0) {
    report({
      stage: 'transcribe',
      ratio: 0,
      message: 'GPU 转写失败，改用 CPU'
    })
    result = await run(cli, [...args, '-ng'], onLine)
  }
  if (result.code !== 0) {
    throw new Error(`Whisper 转写失败：${result.stderr.trim()}`)
  }

  const json = JSON.parse(
    await readFile(`${output}.json`, 'utf8')
  ) as WhisperOutput

  const segments = json.transcription.map(segment => ({
    start: segment.offsets.from / 1000,
    end: segment.offsets.to / 1000,
    text: segment.text.trim()
  }))
  report({ stage: 'transcribe', ratio: 1 })
  return segments
}

export async function readTranscript(
  cacheKey: string
): Promise<TranscriptSegment[] | null> {
  const path = transcriptPath(cacheKey)
  if (!existsSync(path)) return null
  return JSON.parse(await readFile(path, 'utf8')) as TranscriptSegment[]
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

    report({ stage: 'audio', message: '下载回放媒体' })
    await download(mediaUrl, media, ratio => {
      report({ stage: 'audio', ratio, message: '下载回放媒体' })
    }, { Referer: REFERER })

    await extractAudio(media, wav, report)
    await rm(media)

    const segments = await recognize(cli, model, wav, output, report)
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
