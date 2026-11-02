import type { BrowserWindow } from 'electron'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { FormsApi, FormSession } from '@shared/forms'
import type { McpToolGroup } from '@shared/types'
import { fetchProfile } from '../services/zdbk'
import { loadCredentials } from '../auth/password'
import { answerForm, applyProfile, closeForm, EMPTY_PROFILE, focusForm, listForms, loadProfile, openForm, saveProfile, setAppWindow } from './index'

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
    void applyProfile()
    return saved
  },
  'forms:open': (_win, url, options) => openForm(url, options),
  // 界面全局每秒取一次（应用内弹窗靠它），顺便记下主窗口，问卷开放时提到前面
  'forms:sessions': async (win) => {
    setAppWindow(win)
    return listForms()
  },
  'forms:answer': (_win, id, answers) => answerForm(id, answers),
  'forms:focus': (_win, id) => focusForm(id),
  'forms:close': (_win, id) => closeForm(id)
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

/** 给 Agent 的记录：只有题目与状态，不带所填的值 */
const brief = (s: FormSession) => ({
  id: s.id,
  url: s.url,
  title: s.title,
  status: s.status,
  open_at: s.at,
  submitted_at: s.submittedAt,
  asking: s.questions.map((q) => ({ title: q.title, required: q.required, filled: q.filled })),
  answered: s.backup.map((b) => b.title),
  message: s.message
})

export function registerFormTools(mcp: McpServer, tools: Record<McpToolGroup, boolean>): void {
  if (tools.query) {
    mcp.registerTool('get_forms', {
      description: '在应用里订阅过的问卷：进行中的（waiting 等待开放 / filling 填写中 / asking 等用户在应用弹窗里补填或确认 / submitting 已点提交 / verify 需要验证码 / login 需要扫码登录 / closed / error）与已提交的（submitted，带答过的题目标题）。asking 时列出要问的题。不含所填的值',
      annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => json((await listForms()).map(brief)))
  }

  if (tools.app) {
    mcp.registerTool('fill_form', {
      description: '在应用里订阅一份问卷（问卷星、腾讯问卷、金数据等）：后台打开，开放后按用户保存的个人信息填写学号、姓名、性别、班级、专业、学院、年级、校区、手机、邮箱、QQ、微信、宿舍，然后在应用里弹窗列出全部题目，由用户补填、确认后才提交；Agent 不能直接提交。给 open_at 时到点（按问卷站时钟）刷新再填，页面写着开放时间时也会自动等到那时。之后用 get_forms 查看',
      inputSchema: {
        url: z.string().describe('问卷地址'),
        open_at: z.string().optional().describe('开放时刻，ISO 8601（带时区），缺省为立即')
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
    }, async ({ url, open_at }) => {
      const session = await openForm(url, { autoSubmit: false, optional: true, ...(open_at ? { at: open_at } : {}) })
      if (session.status === 'waiting') return json(brief(session))
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500))
        const now = (await listForms()).find((s) => s.id === session.id)
        if (now && now.status !== 'filling') return json(brief(now))
      }
      return json(brief((await listForms()).find((s) => s.id === session.id) ?? session))
    })
  }
}
