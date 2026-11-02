import type { BrowserWindow } from 'electron'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { FormsApi, FormSession } from '@shared/forms'
import type { McpToolGroup } from '@shared/types'
import { fetchProfile } from '../services/zdbk'
import { loadCredentials } from '../auth/password'
import { closeForm, EMPTY_PROFILE, focusForm, listForms, loadProfile, openForm, refillForm, refillLacking, saveProfile } from './index'

// 问卷填写的 IPC 通道与 MCP 工具，ipc.ts / mcp.ts 各并入一行

type FormsHandlers = { [K in keyof FormsApi]: (win: BrowserWindow | null, ...args: Parameters<FormsApi[K]>) => ReturnType<FormsApi[K]> }

export const formsHandlers: FormsHandlers = {
  'forms:profile': async () => {
    const saved = await loadProfile()
    if (saved?.studentId && saved.name) return saved
    // 学号、姓名还空着时预填：教务（选课期间常取不到）退回保存的统一身份认证账号；本科学号 3YY……的 YY 是入学年份
    const user = await fetchProfile().then((r) => r.data, () => null)
    const account = (await loadCredentials().catch(() => null))?.username ?? ''
    const base = saved ?? EMPTY_PROFILE
    const studentId = base.studentId || user?.studentId || (/^\d{8,12}$/.test(account) ? account : '')
    const year = /^3(\d{2})\d{7}$/.exec(studentId)?.[1]
    return { ...base, studentId, name: base.name || user?.name || '', grade: base.grade || (year ? `20${year}` : '') }
  },
  'forms:saveProfile': async (_win, profile) => {
    const saved = await saveProfile(profile)
    void refillLacking()
    return saved
  },
  'forms:open': (_win, url, options) => openForm(url, options),
  'forms:sessions': async () => listForms(),
  'forms:focus': async (_win, id) => focusForm(id),
  'forms:refill': (_win, id) => refillForm(id),
  'forms:close': async (_win, id) => closeForm(id)
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

/** 给 Agent 的记录：只留题目与字段，不带所填的值 */
const brief = (s: FormSession) => ({ id: s.id, url: s.url, title: s.title, status: s.status, open_at: s.at, filled: s.filled, missed: s.missed, lacking: s.lacking, message: s.message })

export function registerFormTools(mcp: McpServer, tools: Record<McpToolGroup, boolean>): void {
  if (tools.query) {
    mcp.registerTool('get_forms', {
      description: '本次运行里在应用中打开过的问卷与填写结果：状态（waiting 等待开放 / filling 填写中 / filled 已填好待用户提交 / attention 有必填题没认出 / verify 需要验证码 / login 需要登录 / submitted 已提交 / closed 窗口已关 / error 打不开）、已填的题与对应字段、没认出的必填题、认出了题但用户资料里没填的字段（lacking，需用户在应用里补资料）',
      annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => json(listForms().map(brief)))
  }

  if (tools.app) {
    mcp.registerTool('fill_form', {
      description: '在应用里开窗打开一份问卷（问卷星、腾讯问卷、金数据等），按用户在应用里保存的个人信息填写学号、姓名、性别、班级、专业、学院、年级、校区、手机、邮箱、QQ、微信、宿舍。只填写不提交，由用户在窗口里检查后自己提交；认不出的必填题会在页面上标出。给 open_at 时窗口先打开，到点（按问卷站时钟）刷新再填。返回打开后几秒内的填写结果，之后可用 get_forms 查看',
      inputSchema: {
        url: z.string().describe('问卷地址'),
        open_at: z.string().optional().describe('开放时刻，ISO 8601（带时区），缺省为立即')
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
    }, async ({ url, open_at }) => {
      const session = await openForm(url, { autoSubmit: false, ...(open_at ? { at: open_at } : {}) })
      if (session.status === 'waiting') return json(brief(session))
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500))
        const now = listForms().find((s) => s.id === session.id)
        if (now && now.status !== 'filling') return json(brief(now))
      }
      return json(brief(listForms().find((s) => s.id === session.id) ?? session))
    })
  }
}
