import { app, BrowserWindow } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { basename, extname, isAbsolute, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { CONFIRM_EVENT, OPEN_EVENT, REFRESH_EVENT } from '@shared/ipc'
import { PERIOD_TIMES } from '@shared/periods'
import type { ConfirmRequest, McpState, McpToolGroup, OpenRequest } from '@shared/types'
import { call } from './ipc'
import { downloadToFile } from './download'
import { exportSlidesPdf, writeTranscript } from './export'
import { getTodoState, setIgnored } from './todos'

// 本地 MCP 服务：让本机的 Agent（Claude Code 等）调用课表、作业、回放等信息与工具。
// 只监听 127.0.0.1，请求需带 Authorization: Bearer <token>；无状态模式，每个请求新建一个 McpServer。
// 工具复用 ipc.ts 的通道实现（call），与界面共用登录会话；提交 / 撤回作业须用户在应用内确认（askUser）。

// ZJU_MCP_PORT 可换端口：开发版与已安装版同时开着 MCP 时避免抢端口
const PORT = Number(process.env['ZJU_MCP_PORT']) || 17321

interface Config {
  enabled: boolean
  token: string
  tools: Record<McpToolGroup, boolean>
}

const configPath = (): string => join(app.getPath('userData'), 'mcp.json')

function loadConfig(): Config {
  const defaults: Config = {
    enabled: false,
    token: randomBytes(24).toString('base64url'),
    // 提交作业不可撤回，默认关
    tools: { query: true, download: true, app: true, transcribe: true, submit: false }
  }
  if (!existsSync(configPath())) return defaults
  const saved = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<Config>
  // 只取现有分组的键，旧版本存下的分组名丢弃
  const tools = Object.fromEntries(Object.entries(defaults.tools).map(([k, v]) => [k, saved.tools?.[k as McpToolGroup] ?? v]))
  return { ...defaults, ...saved, tools: tools as Config['tools'] }
}

let config: Config | undefined
let server: Server | undefined
let error: string | null = null

/** 下载与导出的默认目录 */
const outputDir = (): string => join(app.getPath('downloads'), 'ZJU All in One')

/** dir 下不与已有文件重名的路径：重名时加 (1)、(2)… */
async function freePath(dir: string | undefined, name: string): Promise<string> {
  const folder = dir ?? outputDir()
  if (!isAbsolute(folder)) throw new Error('save_dir 须为绝对路径')
  await mkdir(folder, { recursive: true })
  const clean = name.replace(/[\\/:*?"<>|]/g, '_')
  const ext = extname(clean)
  const stem = basename(clean, ext)
  let path = join(folder, clean)
  for (let i = 1; existsSync(path); i++) path = join(folder, `${stem} (${i})${ext}`)
  return path
}

const isZju = (url: string): boolean => {
  const host = new URL(url).hostname
  return host === 'zju.edu.cn' || host.endsWith('.zju.edu.cn')
}

const focusWindow = (): BrowserWindow | undefined => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win?.isMinimized()) win.restore()
  win?.show()
  return win
}

// 等待用户在应用内确认的请求；10 分钟无答复按取消处理
const CONFIRM_TIMEOUT = 10 * 60_000
const confirms = new Map<string, (approve: boolean) => void>()

function askUser(request: Omit<ConfirmRequest, 'id'>): Promise<boolean> {
  const win = focusWindow()
  if (!win) return Promise.resolve(false)
  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => answerConfirm(id, false), CONFIRM_TIMEOUT)
    confirms.set(id, (approve) => {
      clearTimeout(timer)
      confirms.delete(id)
      resolve(approve)
    })
    win.webContents.send(CONFIRM_EVENT, { id, ...request } satisfies ConfirmRequest)
  })
}

export function answerConfirm(id: string, approve: boolean): void {
  confirms.get(id)?.(approve)
}

const json = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
})

function buildServer(tools: Config['tools']): McpServer {
  const mcp = new McpServer({ name: 'zju-all-in-one', version: app.getVersion() })
  const read = { readOnlyHint: true, openWorldHint: true }

  if (tools.query) {
    mcp.registerTool('get_status', {
      description: '统一身份认证登录状态与学号、姓名',
      annotations: read
    }, async () => json(await call('auth:state')))

    mcp.registerTool('get_schedule', {
      description: '本学期课表：每门课的星期（1 = 周一）、节次与起止时刻、周次、地点、教师',
      annotations: read
    }, async () => json((await call('data:schedule')).data.map((c) => ({
      ...c,
      startTime: PERIOD_TIMES[c.startPeriod - 1]?.[0],
      endTime: PERIOD_TIMES[c.endPeriod - 1]?.[1]
    }))))

    mcp.registerTool('get_calendar', {
      description: '当前学年学期校历：各半学期起止日期、放假与调休',
      annotations: read
    }, async () => json(await call('data:calendar')))

    mcp.registerTool('get_exams', {
      description: '本学期考试安排（含期中）',
      annotations: read
    }, async () => json((await call('data:exams')).data))

    mcp.registerTool('get_assignments', {
      description: '待办：学在浙大的作业与活动，以及（设置里开启并登录后）PTA 未截止的题目集（type 为 pta，progress 为已通过 / 总题数）；含截止时间与是否已完成。ignored 为 true 的是用户在应用里忽略的条目（主页不显示、不提醒）',
      annotations: read
    }, async () => {
      const ignored = new Set(getTodoState().ignored)
      return json((await call('data:assignments')).data.map((a) => ({ ...a, ignored: ignored.has(a.id) })))
    })

    mcp.registerTool('get_assignment_detail', {
      description: '某项作业的说明、附件与已有提交',
      inputSchema: { activity_id: z.string().describe('作业 id（get_assignments 返回的 id）') },
      annotations: read
    }, async ({ activity_id }) => json(await call('homework:detail', activity_id)))

    mcp.registerTool('get_lectures', {
      description: '智云课堂课次（直播 / 回放）。不给日期时返回近期回放，正在直播的排最前',
      inputSchema: {
        from: z.string().optional().describe('起始日期 YYYY-MM-DD（含）'),
        to: z.string().optional().describe('结束日期 YYYY-MM-DD（含）')
      },
      annotations: read
    }, async ({ from, to }) => json(from && to ? await call('data:lectures', from, to) : (await call('data:replays')).data))

    mcp.registerTool('get_slides', {
      description: '某次课的课件页图片地址，time 为相对开课的秒数',
      inputSchema: { course_id: z.string(), sub_id: z.string() },
      annotations: read
    }, async ({ course_id, sub_id }) => json(await call('replay:slides', course_id, sub_id)))

    mcp.registerTool('get_playback', {
      description: '某次课的播放地址：回放为已签名的 mp4 直链（可交给 download_file 下载），直播中为 hls 流',
      inputSchema: { course_id: z.string(), sub_id: z.string() },
      annotations: read
    }, async ({ course_id, sub_id }) => json(await call('replay:playback', course_id, sub_id)))

    mcp.registerTool('get_transcript', {
      description: '某次课的文字稿。source 缺省为 local：本地 Whisper 结果，尚未转写时 segments 为 null；给 course_id 时同时检查 stale：智云课后会重新生成回放、换掉视频，stale 为 true 表示文字稿对应的是旧视频，应以 force 重新转写。source 为 platform：智云平台自带的转写，无需本地转写、直播中也有，还没生成时为空数组',
      inputSchema: {
        sub_id: z.string(),
        course_id: z.string().optional(),
        source: z.enum(['local', 'platform']).optional()
      },
      annotations: read
    }, async ({ sub_id, course_id, source }) => {
      if (source === 'platform') return json({ segments: await call('replay:platformTranscript', sub_id) })
      const segments = await call('replay:transcript', sub_id)
      const stale = segments && course_id ? await call('replay:transcriptStale', course_id, sub_id) : undefined
      return json({ stale, segments })
    })
  }

  if (tools.download) {
    mcp.registerTool('download_file', {
      description: '用登录会话把浙大站点上的文件下载到本机：作业附件与已交文件（get_assignment_detail 的 attachments / submissions[].files）、作业说明里的文件链接、课件图片（get_slides）、回放视频（get_playback）。返回本机路径',
      inputSchema: {
        url: z.string().describe('文件地址，须为 *.zju.edu.cn'),
        file_name: z.string().optional().describe('保存的文件名，建议传附件名；缺省取地址末段'),
        save_dir: z.string().optional().describe('保存目录（绝对路径），缺省为"下载/ZJU All in One"')
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
    }, async ({ url, file_name, save_dir }) => {
      if (!isZju(url)) throw new Error('只能下载浙大站点（*.zju.edu.cn）上的文件')
      const path = await freePath(save_dir, file_name ?? (decodeURIComponent(basename(new URL(url).pathname)) || 'download'))
      await downloadToFile(url, path)
      return json({ path, size: (await stat(path)).size })
    })

    mcp.registerTool('export_slides_pdf', {
      description: '把某次课的全部课件页导出为一个 PDF，返回本机路径',
      inputSchema: {
        course_id: z.string(),
        sub_id: z.string(),
        title: z.string().optional().describe('文件名（不含扩展名），缺省为"课件-<sub_id>"'),
        save_dir: z.string().optional().describe('保存目录（绝对路径），缺省为"下载/ZJU All in One"')
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
    }, async ({ course_id, sub_id, title, save_dir }) => {
      const name = title ?? `课件-${sub_id}`
      const path = await freePath(save_dir, `${name}.pdf`)
      await exportSlidesPdf(await call('replay:slides', course_id, sub_id), name, path)
      return json({ path })
    })

    mcp.registerTool('export_transcript', {
      description: '把某次课的文字稿导出为 txt / srt / md 文件，返回本机路径。source 缺省为 local（本地转写，需先 transcribe_lecture），platform 为智云平台自带的转写',
      inputSchema: {
        sub_id: z.string(),
        format: z.enum(['txt', 'srt', 'md']),
        source: z.enum(['local', 'platform']).optional(),
        title: z.string().optional().describe('文件名（不含扩展名），缺省为"文字稿-<sub_id>"'),
        save_dir: z.string().optional().describe('保存目录（绝对路径），缺省为"下载/ZJU All in One"')
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false }
    }, async ({ sub_id, format, source, title, save_dir }) => {
      const segments = source === 'platform' ? await call('replay:platformTranscript', sub_id) : await call('replay:transcript', sub_id)
      if (!segments?.length) throw new Error(source === 'platform' ? '智云暂无文字稿' : '尚未转写，先调用 transcribe_lecture')
      const name = title ?? `文字稿-${sub_id}`
      const path = await freePath(save_dir, `${name}.${format}`)
      await writeTranscript(segments, format, name, path)
      return json({ path })
    })
  }

  if (tools.app) {
    mcp.registerTool('open_in_app', {
      description: '在应用窗口里打开内容给用户看：主页 / 课表 / 工具 / 设置、某节课的回放或直播页、某项作业的详情侧页，或登录面板（未登录时让用户自己输入账号密码）',
      inputSchema: {
        target: z.enum(['home', 'schedule', 'tools', 'settings', 'login', 'lecture', 'assignment']),
        course_id: z.string().optional().describe('target 为 lecture 时必填'),
        sub_id: z.string().optional().describe('target 为 lecture 时必填'),
        activity_id: z.string().optional().describe('target 为 assignment 时必填')
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ target, course_id, sub_id, activity_id }) => {
      let request: OpenRequest
      if (target === 'login') request = { login: true }
      else if (target === 'assignment') {
        const assignment = (await call('data:assignments')).data.find((a) => a.id === activity_id)
        if (!assignment) throw new Error('未找到该作业')
        request = { assignment }
      } else if (target === 'lecture') {
        // 先找近期回放，再找本学期全部课次
        const match = (l: { id: string; courseId: string }): boolean => l.id === sub_id && l.courseId === course_id
        const term = await call('data:calendar')
        const today = new Date().toISOString().slice(0, 10)
        const replay = (await call('data:replays')).data.find(match)
          ?? (await call('data:lectures', term.halves[0]?.start ?? today, today)).find(match)
        if (!replay) throw new Error('未找到该课次')
        request = { replay }
      } else request = { page: target }
      focusWindow()?.webContents.send(OPEN_EVENT, request)
      return json({ opened: target })
    })

    mcp.registerTool('ignore_assignment', {
      description: '忽略或恢复一项待办：忽略后主页不显示、截止前不提醒',
      inputSchema: {
        activity_id: z.string().describe('待办 id（get_assignments 返回的 id）'),
        ignored: z.boolean().describe('true 忽略，false 恢复')
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ activity_id, ignored }) => {
      const state = await setIgnored(activity_id, ignored)
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(REFRESH_EVENT)
      return json(state)
    })

    mcp.registerTool('refresh', {
      description: '重新检查登录状态（登录过期时用保存的账号自动重登），并让应用界面重新拉取所有数据',
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true }
    }, async () => {
      const state = await call('auth:state')
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(REFRESH_EVENT)
      return json(state)
    })
  }

  if (tools.transcribe) {
    mcp.registerTool('transcribe_lecture', {
      description: '用本地 Whisper 转写某次课的回放（长课需数分钟，进度显示在应用内），返回文字稿；已转写过则直接返回缓存，force 为 true 时忽略缓存重新转写（视频被替换后用）',
      inputSchema: { course_id: z.string(), sub_id: z.string(), force: z.boolean().optional() },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true }
    }, async ({ course_id, sub_id, force }) => json(await call('replay:transcribe', course_id, sub_id, force)))
  }

  if (tools.submit) {
    mcp.registerTool('submit_assignment', {
      description: '向学在浙大提交作业（附件为本机文件路径）。应用内会请用户确认（可预览文件）；用户取消则返回未提交。已有草稿（如撤回过）时覆盖草稿',
      inputSchema: {
        activity_id: z.string().describe('作业 id'),
        file_paths: z.array(z.string()).describe('要上传的本机文件绝对路径'),
        comment: z.string().optional().describe('提交说明')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    }, async ({ activity_id, file_paths, comment = '' }) => {
      const detail = await call('homework:detail', activity_id)
      const files = await Promise.all(file_paths.map(async (path) => ({ path, name: basename(path), size: (await stat(path)).size })))
      if (!(await askUser({ action: 'submit', courseName: detail.courseName, title: detail.title, files, comment }))) {
        return json({ submitted: false, reason: '用户取消' })
      }
      await call('homework:submit', activity_id, comment, files)
      return json({ submitted: true })
    })

    mcp.registerTool('retract_submission', {
      description: '撤回某项作业的一次提交（get_assignment_detail 中 canRetract 为 true 的那次；评分前且作业允许时可用）。撤回后该提交变为草稿，可再提交。应用内会请用户确认',
      inputSchema: {
        activity_id: z.string().describe('作业 id'),
        submission_id: z.string().describe('要撤回的提交 id（submissions[].id）')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    }, async ({ activity_id, submission_id }) => {
      const detail = await call('homework:detail', activity_id)
      const submission = detail.submissions.find((x) => x.id === submission_id)
      if (!submission) throw new Error('未找到该提交')
      if (!submission.canRetract) throw new Error('这次提交不能撤回（已评分或作业不允许撤回）')
      if (!(await askUser({ action: 'retract', courseName: detail.courseName, title: detail.title, files: submission.files, comment: submission.comment }))) {
        return json({ retracted: false, reason: '用户取消' })
      }
      await call('homework:retract', submission_id)
      return json({ retracted: true })
    })
  }

  return mcp
}

function start(): void {
  error = null
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${config!.token}`) {
      res.writeHead(401).end()
      return
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    const mcp = buildServer(config!.tools)
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  })
  http.on('error', (e: NodeJS.ErrnoException) => {
    error = e.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用` : e.message
    server = undefined
  })
  http.listen(PORT, '127.0.0.1')
  server = http
}

function stop(): void {
  server?.close()
  server = undefined
}

export function getMcpState(): McpState {
  config ??= loadConfig()
  return {
    enabled: config.enabled,
    url: server ? `http://127.0.0.1:${PORT}/mcp` : null,
    token: config.token,
    tools: config.tools,
    error
  }
}

export async function setMcp(patch: { enabled?: boolean; tools?: Partial<Record<McpToolGroup, boolean>> }): Promise<McpState> {
  config ??= loadConfig()
  const wasEnabled = config.enabled
  config = { ...config, enabled: patch.enabled ?? config.enabled, tools: { ...config.tools, ...patch.tools } }
  await writeFile(configPath(), JSON.stringify(config, null, 2))
  if (config.enabled !== wasEnabled) {
    if (config.enabled) {
      start()
      // listen 的失败经 error 事件异步报告，稍等再回状态
      await new Promise((r) => setTimeout(r, 100))
    } else stop()
  }
  return getMcpState()
}

/** 应用启动时按保存的开关启动 */
export function initMcp(): void {
  config = loadConfig()
  if (config.enabled) start()
}
