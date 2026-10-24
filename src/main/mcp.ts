import { app, BrowserWindow, dialog } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { basename, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { REFRESH_EVENT } from '@shared/ipc'
import { PERIOD_TIMES } from '@shared/periods'
import type { McpState, McpToolGroup } from '@shared/types'
import { call } from './ipc'

// 本地 MCP 服务：让本机的 Agent（Claude Code 等）调用课表、作业、回放等信息与工具。
// 只监听 127.0.0.1，请求需带 Authorization: Bearer <token>；无状态模式，每个请求新建一个 McpServer。
// 工具复用 ipc.ts 的通道实现（call），与界面共用登录会话；提交作业另需在应用内弹窗确认。

const PORT = 17321

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
    tools: { query: true, refresh: true, transcribe: true, submit: false }
  }
  if (!existsSync(configPath())) return defaults
  const saved = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<Config>
  return { ...defaults, ...saved, tools: { ...defaults.tools, ...saved.tools } }
}

let config: Config | undefined
let server: Server | undefined
let error: string | null = null

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
      description: '学在浙大的作业与待办，含截止时间与是否已提交',
      annotations: read
    }, async () => json((await call('data:assignments')).data))

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

    mcp.registerTool('get_transcript', {
      description: '某次课已转写的文字稿（本地 Whisper 结果）；尚未转写时返回 null',
      inputSchema: { sub_id: z.string() },
      annotations: read
    }, async ({ sub_id }) => json(await call('replay:transcript', sub_id)))
  }

  if (tools.refresh) {
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
      description: '用本地 Whisper 转写某次课的回放（长课需数分钟，进度显示在应用内），返回文字稿；已转写过则直接返回缓存',
      inputSchema: { course_id: z.string(), sub_id: z.string() },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true }
    }, async ({ course_id, sub_id }) => json(await call('replay:transcribe', course_id, sub_id)))
  }

  if (tools.submit) {
    mcp.registerTool('submit_assignment', {
      description: '向学在浙大提交作业（附件为本机文件路径）。提交不可撤回，应用会弹窗请用户确认；用户取消则返回未提交',
      inputSchema: {
        activity_id: z.string().describe('作业 id'),
        file_paths: z.array(z.string()).describe('要上传的本机文件绝对路径'),
        comment: z.string().optional().describe('提交说明')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    }, async ({ activity_id, file_paths, comment = '' }) => {
      const detail = await call('homework:detail', activity_id)
      const files = await Promise.all(file_paths.map(async (path) => ({ path, name: basename(path), size: (await stat(path)).size })))
      const win = BrowserWindow.getAllWindows()[0]
      win?.show()
      const options = {
        type: 'question' as const,
        title: '提交作业',
        message: `本地 Agent 请求提交作业：${detail.courseName} ${detail.title}`,
        detail: [...files.map((f) => f.name), comment && `说明：${comment}`].filter(Boolean).join('\n'),
        buttons: ['提交', '取消'],
        defaultId: 1,
        cancelId: 1
      }
      const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
      if (response !== 0) return json({ submitted: false, reason: '用户取消' })
      await call('homework:submit', activity_id, comment, files)
      return json({ submitted: true })
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
