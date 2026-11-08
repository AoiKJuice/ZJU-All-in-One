import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NewsFeed, NewsItem } from '@shared/news'

// 校园资讯 · 来源 D（实验，默认关，仅 Windows 桌面）：读本机钉钉数据库里像通知的群消息。纯 TS，不调用钉钉接口。
// 库的位置、密钥派生与表结构是公开的逆向结论（dsh-zju-assistant〔GPL-3.0，只参考事实，代码自写〕、
// wechat-analysis-action core-dingtalk 的说明），2026-11-07 在用户本机 v3 数据上按文件头校验确认：
// - 目录：%APPDATA%\DingTalk\globalStorage\storage.db 为全局库；账号目录名是十六进制串加 _v3（旧版为 <uid>_v2），
//   主库在其中的 DBFiles\dingtalk.db。账号目录名不含 uid（v0.1 按路径里的数字认账号，一个也认不出，结果什么都没有）。
// - 全局库密钥：CPUID 0 号叶的 EAX（最大功能号，小整数，逐个试）与厂商串三个寄存器按小端读成 int32 的十进制拼起来，
//   取前 16 字节；用解密后的文件头「SQLite format 3\0」校验。
// - uid：全局库 GlobalStorage 表里全是数字的键，以及 last_login_user_uid 的值（其余值含登录令牌，不读）。
// - 账号库密钥：v3 = MD5(PBKDF2-HMAC-SHA1(uid + salt, "666DingT", 1000 轮, 32 字节)) 十六进制前 16 位，
//   salt 在账号目录的 user_config 文件里（Base64 的 JSON）；v2 = MD5(uid) 十六进制前 16 位。
// - 解密：AES-128-ECB 逐块；-wal 文件的帧头是明文、页数据加密，已提交的帧按页号合并进去，再用 node:sqlite 在内存里打开。
// - 消息在 tbmsg_000…tbmsg_127 分表与最近消息缓存 tblastmsg（cid、mid〔64 位〕、createdAt、contentType、content / extension JSON、
//   recallStatus、isDecrypt……），会话名在 tbconversation（type 1 单聊、2 群），清空记录的时刻在 msg_clear_info。
//   读全部会话（群聊、单聊、工作通知、系统账号）的全部消息，不替用户分哪条是通知；看哪些会话由用户在来源里勾选（settings.dingtalkHidden）。
// 解密后的库只在内存里，用完清零，不写盘、不缓存；消息原文不发给任何模型。scripts/test-dingtalk.mjs 用合成的库回归。

const HEADER = Buffer.from('SQLite format 3\0', 'latin1')
const md5hex = (s: string | Buffer): string => createHash('md5').update(s).digest('hex')

function decryptEcb(data: Buffer, key: Buffer): Buffer {
  const usable = data.length - (data.length % 16)
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(data.subarray(0, usable)), decipher.final()])
}

export const validKey = (head: Buffer, key: Buffer): boolean => key.length === 16 && head.length >= 16 && decryptEcb(head.subarray(0, 16), key).equals(HEADER)

function cpuVendor(): Promise<string> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Select-Object -First 1).Manufacturer'], { timeout: 10_000, windowsHide: true }, (error, stdout) =>
      resolve(error ? '' : stdout.trim())
    )
  })
}

const VENDORS = ['GenuineIntel', 'AuthenticAMD', 'HygonGenuine']

/** 全局库密钥的候选：本机厂商串（取不到时几家常见的）× EAX 0–64 × 两种寄存器次序 */
export function globalCandidates(vendor: string): Buffer[] {
  const vendors = [...new Set([vendor, ...VENDORS])].filter((v) => v.length === 12)
  const reg = (v: string, at: number): number => Buffer.from(v.slice(at, at + 4), 'latin1').readInt32LE(0)
  const out: Buffer[] = []
  for (const v of vendors) {
    for (let eax = 0; eax <= 64; eax++) {
      for (const order of [[0, 8, 4], [0, 4, 8]]) {
        const text = `${eax}${order.map((at) => reg(v, at)).join('')}`.slice(0, 16)
        if (text.length === 16) out.push(Buffer.from(text, 'latin1'))
      }
    }
  }
  return out
}

export const v3Key = (uid: string, salt: string): Buffer =>
  Buffer.from(md5hex(pbkdf2Sync(Buffer.from(uid + salt, 'utf8'), Buffer.from('666DingT', 'latin1'), 1000, 32, 'sha1')).slice(0, 16), 'latin1')

export const v2Key = (uid: string): Buffer => Buffer.from(md5hex(uid).slice(0, 16), 'latin1')

/** 解密并合并已提交的 WAL 帧，返回可 deserialize 的库（调用方用完清零） */
export async function decryptDatabase(path: string, key: Buffer): Promise<Buffer> {
  let db = decryptEcb(await readFile(path), key)
  const wal = await readFile(`${path}-wal`).catch(() => null)
  if (wal && wal.length >= 32) {
    const pageSize = wal.readUInt32BE(8)
    const salt1 = wal.readUInt32BE(16)
    const salt2 = wal.readUInt32BE(20)
    const frames: { page: number; offset: number; commit: boolean }[] = []
    for (let off = 32; pageSize > 0 && off + 24 + pageSize <= wal.length; off += 24 + pageSize) {
      // 盐与文件头不同的是上一轮检查点留下的旧帧
      if (wal.readUInt32BE(off + 8) !== salt1 || wal.readUInt32BE(off + 12) !== salt2) break
      frames.push({ page: wal.readUInt32BE(off), offset: off + 24, commit: wal.readUInt32BE(off + 4) !== 0 })
    }
    // 只合并到最后一个提交帧
    const last = frames.map((f) => f.commit).lastIndexOf(true)
    for (const f of frames.slice(0, last + 1)) {
      const at = (f.page - 1) * pageSize
      if (at + pageSize > db.length) db = Buffer.concat([db, Buffer.alloc(at + pageSize - db.length)])
      decryptEcb(wal.subarray(f.offset, f.offset + pageSize), key).copy(db, at)
    }
  }
  // 改成非 WAL 格式，内存里直接打开
  db[18] = 1
  db[19] = 1
  return db
}

export function open(buffer: Buffer): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.deserialize(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length))
  return db
}

async function openDecrypted(path: string, key: Buffer): Promise<DatabaseSync> {
  const plain = await decryptDatabase(path, key)
  try {
    return open(plain)
  } finally {
    plain.fill(0)
  }
}

const tablesOf = (db: DatabaseSync): string[] => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
const columnsOf = (db: DatabaseSync, table: string): Set<string> =>
  new Set((db.prepare(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all() as { name: string }[]).map((c) => c.name))

/** 全局库里登录过的账号 uid：全是数字的键与 last_login_user_uid 的值；别的值含登录令牌，不读 */
export function accountUids(db: DatabaseSync): string[] {
  if (!tablesOf(db).includes('GlobalStorage')) return []
  const cols = columnsOf(db, 'GlobalStorage')
  if (!cols.has('key')) return []
  const uids = (db.prepare("SELECT key FROM GlobalStorage WHERE key NOT GLOB '*[^0-9]*' AND length(key) BETWEEN 5 AND 24").all() as { key: unknown }[]).map((r) => String(r.key))
  if (cols.has('value')) {
    const last = db.prepare("SELECT value FROM GlobalStorage WHERE key = 'last_login_user_uid'").get() as { value: unknown } | undefined
    const value = typeof last?.value === 'string' ? last.value : last?.value instanceof Uint8Array ? Buffer.from(last.value).toString('utf8') : ''
    if (/^\d{5,24}$/.test(value)) uids.unshift(value)
  }
  return [...new Set(uids)]
}

async function saltOf(accountDir: string): Promise<string | null> {
  const raw = await readFile(join(accountDir, 'user_config'), 'latin1').catch(() => null)
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw.trim(), 'base64').toString('utf8')) as { salt?: unknown }
    return typeof parsed.salt === 'string' && parsed.salt.length <= 256 ? parsed.salt : null
  } catch {
    return null
  }
}

// ---- 消息正文 ----
// 2026-11-07 照用户本机真实数据逐类核对过结构（content 与 extension 都是 JSON，正文多在 attachments[0].extension 里，又一层 JSON）：
// - 1 文字：content.text；@所有人存成「@10」（atOpenIds {"10":"所有人"}）；入群提示也是 1，extension 里带 merge。
// - 2 图片：没有文字。
// - 102 链接：attachments[0].extension 的 title / text，地址在 attachments[0].url。智云课堂「5分钟后开始上课」提醒也是这种。
// - 500 / 501 文件：只有 f_name（课件、作业附件），不算通知。
// - 1200–1202 / 1400 Markdown：extension.markdown 与 title。引用回复也是 1200：markdown =「> 被引用的原文 + ------ + 回复」，
//   title 与第二个附件的 replyContent 都是回复本身——不能三处都取，否则同一句出现三遍。
// - 1600 DING：dingContent。
// - 2900 / 2950 / 300 卡片：interactiveCardLastMessage 或多语言 LastMessageI18n（取 zh_CN），消息 extension 里有 biz_custom_desc；
//   群公告是 widgetName = notice 的卡片，本机只有「[群公告]」几个字，正文不在库里。
// - 3100 富文本：extension.desc 是完整纯文字，payload 是同样内容的富文本——只取 desc。
// 都对不上时才按显示字段兜底取，并去掉被别的片段包含的重复片段。

const SHOWN = ['text', 'markdown', 'title', 'summary', 'desc', 'description', 'dingContent', 'biz_custom_title', 'biz_custom_desc', 'interactiveCardLastMessage', 'b_tl', 'h_tl', 'fileName', 'f_name']
const LOCALIZED = ['LastMessageI18n', 'i18n_summary', 'i18n_title']
const NESTED = ['items', 'contents', 'data', 'value', 'textRuns', 'b_form', 'payloadV2', 'payload', 'attachments', 'extension']

function asObject(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const s = value.trim()
  if (!s.startsWith('{') && !s.startsWith('[')) return value
  try {
    return JSON.parse(s)
  } catch {
    return value
  }
}

const bytesToText = (v: unknown): unknown => (v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : v)
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => {
  const x = asObject(bytesToText(v))
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {}
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const localized = (v: unknown): string => {
  const o = obj(v)
  return str(o.zh_CN) || str(o.zh_TW) || str(o.en_US)
}

function collect(value: unknown, out: string[], depth = 0): void {
  if (depth > 12 || value === null || value === undefined) return
  const v = asObject(value)
  if (typeof v === 'string') {
    if (v.trim()) out.push(v.trim())
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) collect(x, out, depth + 1)
    return
  }
  if (typeof v !== 'object') return
  const o = v as Obj
  for (const key of SHOWN) {
    const x = asObject(o[key])
    if (typeof x === 'string') {
      if (x.trim()) out.push(x.trim())
    } else if (x && typeof x === 'object') collect(x, out, depth + 1)
  }
  for (const key of LOCALIZED) {
    const text = localized(o[key])
    if (text) out.push(text.trim())
  }
  for (const key of NESTED) if (!(key === 'payload' && o.payloadV2)) collect(o[key], out, depth + 1)
}

const squash = (s: string): string => s.replace(/[\s\p{P}\p{S}]/gu, '')

/** 兜底：显示字段都取出来，去掉被别的片段整段包含的（摘要与全文、标题与正文） */
function fallbackText(content: unknown, extension: unknown): string {
  const parts: string[] = []
  collect(bytesToText(content), parts)
  if (!parts.length) collect(bytesToText(extension), parts)
  const unique = [...new Set(parts.filter(Boolean))]
  return unique.filter((p, i) => !unique.some((q, j) => j !== i && q.length > p.length && squash(q).includes(squash(p).replace(/…$/, '')))).join('\n')
}

/** 钉钉表情（[钉子] [比心] [送花花]…）与「[图片]」一类的占位；Markdown 链接的 [文字](地址) 不动 */
const EMOJI = /\[[一-龥]{1,5}\](?!\()/g
const tidy = (s: string): string =>
  s
    .replace(/@10(?!\d)/g, '@所有人')
    .replace(EMOJI, '')
    .replace(/[ \t　]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

// 系统提示：入群合并消息带 merge / memberUid，直播状态带 liveState；其余（移出、改群名、设管理员、搜索入群）是没有 realmOrgid 的系统消息，
// 人发的文字消息都带 realmFlag / realmOrgid。句式只在这类消息上认，免得「请还没进群的同学尽快加入群聊」这类真通知被去掉
const SYSTEM_TEXT =
  /^系统已将.+移出群聊$|通过\S{0,8}加入该群$|^\S{1,24}?(加入|退出|离开)了?(该)?群(聊)?$|^\S{1,40}?修改(了)?群名称?为[:：]|已将.+(添加|设置)为群管理员$|成为新群主$|撤回了一条消息$|^\S{1,24}?开启了(全员禁言|群直播)/
const systemTip = (text: string, ext: Obj): boolean =>
  Boolean(ext.merge || ext.memberUid || ext.mergeTemplateType || ext.liveState !== undefined) || (!('realmOrgid' in ext) && !('realmFlag' in ext) && SYSTEM_TEXT.test(text))

interface Parsed {
  body: string
  /** 列表标题；不给时取正文第一句 */
  title?: string
}

/** 引用回复：被引用的原文改成引用块（作者行改成加粗的名字），回复放前面 */
function reply(markdown: string, answerHint: string): Parsed | null {
  const lines = markdown.split('\n')
  let at = -1
  for (let i = lines.length - 1; i >= 0; i--) if (/^\s*-{3,}\s*$/.test(lines[i]!)) {
    at = i
    break
  }
  if (at < 0 && !answerHint) return null
  const quoted = (at < 0 ? markdown : lines.slice(0, at).join('\n')).trim()
  const answer = (answerHint || lines.slice(at + 1).join('\n')).replace(/^\s*#{1,6}\s*/, '').trim()
  const quote = quoted
    .split('\n')
    .map((l) => l.replace(/^\s*>\s?/, ''))
    .map((l) => l.replace(/^\s*#{1,6}\s*(.+)$/, '**$1**'))
    .map((l) => `> ${l}`)
    .join('\n')
  return { body: `${answer}\n\n${quote}`, title: undefined }
}

export function parseMessage(contentType: number, rawContent: unknown, rawExtension: unknown): Parsed | null {
  const content = obj(rawContent)
  const ext = obj(rawExtension)
  const atts = (Array.isArray(asObject(content.attachments)) ? (asObject(content.attachments) as unknown[]) : []).map((a) => ({ ext: obj(obj(a).extension), url: str(obj(a).url) }))
  const first = atts[0] ?? { ext: {}, url: '' }
  switch (contentType) {
    case 1: {
      const text = str(content.text)
      if (!text || systemTip(text, ext)) return null
      return { body: text }
    }
    // 图片：地址要钉钉登录态才能取，只记下发过一张图
    case 2:
      return { body: '', title: '图片' }
    case 102: {
      const title = str(first.ext.title).trim()
      const text = str(first.ext.text).trim()
      if (!title && !text) return null
      const head = first.url && /^https?:/i.test(first.url) ? `[${title || first.url}](${first.url})` : title
      return { body: [head, text].filter(Boolean).join('\n\n'), title: title || text }
    }
    case 500:
    case 501: {
      const name = str(first.ext.f_name) || str(ext.sp_fName)
      return name ? { body: `文件：${name}`, title: name } : null
    }
    case 1600: {
      const text = str(first.ext.dingContent)
      return text ? { body: text } : null
    }
    case 1200:
    case 1201:
    case 1202:
    case 1400: {
      const markdown = str(first.ext.markdown) || str(first.ext.text)
      if (!markdown) break
      // 引用回复：消息 extension 带被引用消息的 id；回复本身在第二个附件的 replyContent（或本附件的 title）
      if (ext.sourceMessageId) {
        const answerHint = str(atts.find((a) => a.ext.replyContent)?.ext.replyContent) || str(first.ext.title)
        const asReply = reply(markdown, answerHint.trim())
        if (asReply) return asReply
      }
      const title = str(first.ext.title).trim()
      return { body: markdown, title: title.length > 4 ? title : undefined }
    }
    case 3100: {
      const desc = str(first.ext.desc)
      if (desc) return { body: desc }
      break
    }
    case 300:
    case 2900:
    case 2950: {
      // 会话列表里的那一行：「[群公告]」「[投票]」「[钉钉文档] ADS分组」或整句（直播回放、访客邀约）
      const last = (localized(first.ext.LastMessageI18n) || str(first.ext.interactiveCardLastMessage) || localized(ext.LastMessageI18n) || str(ext.interactiveCardLastMessage)).trim()
      const tag = /^\[([^\]]{1,8})\]\s*([\s\S]*)$/.exec(last)
      const kind = tag?.[1] ?? (first.ext.widgetName === 'notice' ? '群公告' : '')
      // 正文：群公告的全文、文档名、回放标题都在消息 extension 的 biz_custom_desc；投票只有题目（biz_custom_title）
      // 文档的 desc 带「[分享] 」前缀
      const text = (str(ext.biz_custom_desc) || tag?.[2] || (tag ? '' : last) || str(ext.biz_custom_title) || str(first.ext.title)).trim().replace(/^\[[^\]]{1,8}\]\s*/, '')
      if (!text && !kind) return null
      const link = str(ext.biz_custom_action_url)
      const body = kind === '钉钉文档' && /^https:\/\//.test(link) ? `[${text || kind}](${link})` : text
      return { body, title: kind ? (text ? `${kind}：${titleOf(text)}` : kind) : undefined }
    }
  }
  const text = fallbackText(rawContent, rawExtension)
  return text ? { body: text } : null
}

/** 一行 Markdown 去掉标记，作列表标题 */
export function plainLine(line: string): string {
  return tidy(line)
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s*|>\s?|[-*+]\s+|\d+[.)、]\s*)/, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** 「各位同学好：」「请各位同学查收以下通知：」这类开场白不当标题 */
const GREETING = /^((各位|亲爱的|全体)?(同学|老师|大家|同学们|老师们)(们)?(好|你好|们好|下午好|上午好|晚上好)?|\S{1,8}(同学|老师)[，,\s]*(你好|您好))[，,：:！!～~。\s]*$/
const LEAD_IN = /(查收|如下|以下|请查看|请注意|通知如下)[^。]{0,12}[：:]$/

/** 标题：第一句有内容的话，跳过引用、分隔线、开场白与只有几个字的行，去掉 @、网址，长了在句读处截断 */
export function titleOf(body: string): string {
  let fallback = ''
  const rows = body.split('\n')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (/^\s*>/.test(row) || /^\s*-{3,}\s*$/.test(row)) continue
    const p = plainLine(row)
      .replace(/^(@所有人|@\S+?\(\S+?\))\s*/g, '')
      .replace(/\s*(@所有人|@\S+?\(\S+?\))\s*$/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[：:，,\s]+$/, '')
      .trim()
    if (!p) continue
    fallback ||= p
    const more = rows.slice(i + 1).some((r) => plainLine(r))
    if (more && (GREETING.test(p) || LEAD_IN.test(plainLine(row)) || p.length < 6)) continue
    // 「【20261106学工通知汇总】」这类每天一样的抬头：接上下一句，免得一列标题都一样
    if (more && /^【[^】]+】$/.test(p)) {
      const next = titleOf(rows.slice(i + 1).join('\n'))
      return cut(next ? `${p}${next}` : p)
    }
    return cut(p)
  }
  return cut(fallback || plainLine(body))
}

function cut(p: string): string {
  if (p.length <= 48) return p
  const at = p.slice(0, 48).search(/[。！？；!?;](?=[^。！？；!?;]*$)/)
  return at >= 12 ? p.slice(0, at) : `${p.slice(0, 46)}…`
}

/** 一个账号最多返回的条数（新的在前） */
const MAX_ITEMS = 2000

/** 只看近 60 天 */
const RECENT_MS = 60 * 86_400_000

/** 同一条消息的几版里谁更新：lastModify、version、contentVersion、撤回状态依次比 */
const newer = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** 各环节去掉了多少条（只有计数，不含内容）：排查漏读用 */
export type DingStats = Record<string, number>
export let lastStats: DingStats = {}
const bump = (stats: DingStats, key: string): void => {
  stats[key] = (stats[key] ?? 0) + 1
}

/**
 * 一个账号近 60 天的全部消息（群聊、单聊、工作通知），不替用户分哪条是通知——在界面「来源」里按会话勾选保留。
 * 去掉的只有：系统提示（入群、改群名、直播开始结束）、撤回的、清空过记录之前的、本地还没解开的
 */
export function messagesFrom(db: DatabaseSync, account: string, uid: string, now = Date.now(), stats: DingStats = {}): NewsItem[] {
  const tables = tablesOf(db)
  // @<uid> 换成名字用：群昵称（cid + uid）与通讯录昵称
  const groupNicks = new Map<string, string>()
  if (tables.includes('tbuser_group_nick') && ['cid', 'uid', 'groupNick'].every((c) => columnsOf(db, 'tbuser_group_nick').has(c)))
    for (const r of db.prepare('SELECT cid, CAST(uid AS TEXT) AS uid, groupNick FROM tbuser_group_nick').all() as Record<string, unknown>[])
      if (typeof r.groupNick === 'string' && r.groupNick) groupNicks.set(`${r.cid}/${r.uid}`, r.groupNick)
  const profileCols = tables.includes('tbuser_profile_v2') ? columnsOf(db, 'tbuser_profile_v2') : new Set<string>()
  const nickOf = profileCols.has('uid') && profileCols.has('nick') ? db.prepare(`SELECT nick${profileCols.has('alias') ? ', alias' : ''} FROM tbuser_profile_v2 WHERE uid = ?`) : null
  const nameOf = (cid: string, uid: string): string | null => {
    const g = groupNicks.get(`${cid}/${uid}`)
    if (g) return g
    const r = nickOf?.get(uid) as { nick?: unknown; alias?: unknown } | undefined
    const n = (typeof r?.alias === 'string' && r.alias) || (typeof r?.nick === 'string' && r.nick)
    return n || null
  }
  const mentions = (text: string, cid: string): string => text.replace(/@(\d{6,})(?!\d)/g, (_, id: string) => `@${nameOf(cid, id) ?? ''}`).replace(/@(?=\s|$)/g, '')

  // 会话名：群名、单聊对方的备注或昵称（单聊会话常没有标题，cid 是「uid:uid」）
  const chats = new Map<string, string>()
  if (tables.includes('tbconversation')) {
    const cols = columnsOf(db, 'tbconversation')
    const names = ['alias', 'title', 'originTitle'].filter((c) => cols.has(c))
    if (cols.has('cid')) {
      const sql = `SELECT cid${cols.has('type') ? ', type' : ''}${names.map((c) => `, "${c}"`).join('')} FROM tbconversation`
      for (const r of db.prepare(sql).all() as Record<string, unknown>[]) {
        const cid = String(r.cid)
        bump(stats, `conv-type-${r.type}`)
        let name = String(names.map((c) => r[c]).find((v) => typeof v === 'string' && v.trim()) ?? '').trim()
        // 单聊、系统账号（钉钉云盘、直播助手）的标题常是对方的 uid
        if (!name || /^\d+$/.test(name)) {
          const other = /^\d+$/.test(name) ? name : cid.split(':').find((id) => /^\d+$/.test(id) && id !== uid)
          name = (other && nameOf(cid, other)) || name
        }
        chats.set(cid, name || '钉钉')
      }
    }
  }

  // 清空过聊天记录的会话：清空时刻之前的不算
  const cleared = new Map<string, number>()
  if (tables.includes('msg_clear_info')) {
    const cols = columnsOf(db, 'msg_clear_info')
    if (cols.has('cid') && cols.has('clear_timestamp'))
      for (const r of db.prepare('SELECT cid, clear_timestamp FROM msg_clear_info').all() as Record<string, unknown>[]) cleared.set(String(r.cid), Number(r.clear_timestamp))
  }

  // 历史分表与最近消息缓存合在一起，同一条消息（cid + 服务端 mid，没有时本地 id）取最后改过的一版，免得旧缓存把撤回的又带回来
  const sources = [...tables.filter((t) => /^tbmsg_\d+$/.test(t)), ...tables.filter((t) => t === 'tblastmsg')]
  const best = new Map<string, { row: Record<string, unknown>; rank: number[] }>()
  for (const table of sources) {
    const cols = columnsOf(db, table)
    if (!cols.has('cid') || !cols.has('createdAt') || !(cols.has('content') || cols.has('extension'))) continue
    // mid 是 64 位整数，按 JS 数字读会丢精度、把不同消息并成一条
    const plain = ['cid', 'createdAt', 'content', 'extension', 'type', 'contentType', 'recallStatus', 'shieldStatus', 'isDecrypt', 'lastModify', 'version', 'contentVersion'].filter((c) => cols.has(c)).map((c) => `"${c}"`)
    const ids = ['mid', 'localId', 'senderId'].filter((c) => cols.has(c)).map((c) => `CAST("${c}" AS TEXT) AS "${c}"`)
    const rows = db.prepare(`SELECT ${[...plain, ...ids].join(', ')} FROM "${table}" WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT 800`).all(now - RECENT_MS) as Record<string, unknown>[]
    for (const row of rows) {
      const mid = typeof row.mid === 'string' && row.mid !== '0' && row.mid !== '' ? `m${row.mid}` : row.localId ? `l${row.localId}` : `${table}:${row.createdAt}`
      const key = `${row.cid}/${mid}`
      const rank = [Number(row.lastModify ?? 0), Number(row.version ?? 0), Number(row.contentVersion ?? 0), Number(row.recallStatus ?? 0)]
      const seen = best.get(key)
      bump(stats, 'rows-read')
      if (!seen || newer(rank, seen.rank)) best.set(key, { row, rank })
    }
  }

  const out: NewsItem[] = []
  for (const [key, { row }] of best) {
    const cid = String(row.cid)
    const chat = chats.get(cid) ?? '钉钉'
    const ct = Number(row.contentType ?? 1)
    bump(stats, 'messages')
    const t = Number(row.createdAt)
    if (cleared.has(cid) && t <= cleared.get(cid)!) {
      bump(stats, 'drop-cleared')
      continue
    }
    if (Number(row.type) === 3) {
      bump(stats, 'drop-system')
      continue
    }
    if (Number(row.recallStatus) || Number(row.shieldStatus)) {
      bump(stats, 'drop-recalled')
      continue
    }
    // 本地还没解开的正文读不了；但文件消息常标着没解开、文件名照样是明文 JSON，能读的照收
    if ('isDecrypt' in row && Number(row.isDecrypt) !== 1 && !Object.keys(obj(row.content)).length) {
      bump(stats, `drop-undecrypted-ct${ct}`)
      continue
    }
    const parsed = parseMessage(ct, row.content, row.extension)
    const body = parsed ? mentions(tidy(parsed.body), cid) : ''
    if (!parsed || (!body && !parsed.title)) {
      bump(stats, `drop-empty-ct${ct}`)
      continue
    }
    const title = parsed.title ? plainLine(parsed.title) : titleOf(body)
    // 发送人：自己写「我」；单聊里对方发的、工作通知一类认不出的不写
    const senderId = typeof row.senderId === 'string' ? row.senderId : ''
    const sender = senderId === uid ? '我' : senderId ? nameOf(cid, senderId) : null
    bump(stats, `kept-ct${ct}`)
    out.push({
      id: `dingtalk:${account}:${key}`,
      kind: 'dingtalk',
      title: cut(title || titleOf(body)),
      text: body.slice(0, 4000),
      time: Number.isFinite(t) && t > 0 ? new Date(t < 1e12 ? t * 1000 : t).toISOString() : null,
      from: sender && sender !== chat ? `${chat} · ${sender}` : chat,
      sourceId: cid
    })
  }
  return out.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? '')).slice(0, MAX_ITEMS)
}

async function head(path: string): Promise<Buffer | null> {
  const buf = await readFile(path).catch(() => null)
  return buf ? Buffer.from(buf.subarray(0, 16)) : null
}

/** 依次打开本机每个钉钉账号的主库（只在内存里），交给 visit；出错的记进 failed。读通知与排查都走这里 */
export async function eachAccount(visit: (db: DatabaseSync, account: string, uid: string) => void, failed: NewsFeed['failed']): Promise<number> {
  if (process.platform !== 'win32') throw new Error('只支持 Windows')
  const root = join(process.env['APPDATA'] ?? '', 'DingTalk')
  if (!existsSync(root)) throw new Error('没有找到钉钉数据目录')

  // 全局库 → 登录过的 uid
  const globalPath = join(root, 'globalStorage', 'storage.db')
  const globalHead = await head(globalPath)
  if (!globalHead) throw new Error('没有找到钉钉全局库')
  const globalKey = globalCandidates(await cpuVendor()).find((k) => validKey(globalHead, k))
  if (!globalKey) throw new Error('钉钉全局库的密钥对不上（这一版钉钉可能还不兼容）')
  const globalDb = await openDecrypted(globalPath, globalKey)
  let uids: string[]
  try {
    uids = accountUids(globalDb)
  } finally {
    globalDb.close()
  }
  if (!uids.length) throw new Error('没有找到登录过的钉钉账号')

  const dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && /_v[23]$/.test(d.name)).map((d) => d.name)
  const opened = new Set<string>()
  // v3 先于 v2：升级过的账号两份都在，只读新的
  for (const name of dirs.sort((a, b) => b.slice(-1).localeCompare(a.slice(-1)))) {
    const dir = join(root, name)
    const file = join(dir, 'DBFiles', 'dingtalk.db')
    const h = await head(file)
    if (!h) continue
    let uid: string | undefined
    let key: Buffer | undefined
    if (name.endsWith('_v3')) {
      const salt = await saltOf(dir)
      if (salt === null) continue
      for (const u of uids) {
        const k = v3Key(u, salt)
        if (validKey(h, k)) {
          uid = u
          key = k
          break
        }
      }
    } else {
      const u = name.slice(0, -3)
      if (/^\d{5,24}$/.test(u) && validKey(h, v2Key(u))) {
        uid = u
        key = v2Key(u)
      }
    }
    if (!uid || !key) {
      failed.push({ from: '钉钉', message: '账号库的密钥对不上' })
      continue
    }
    if (opened.has(uid)) continue
    opened.add(uid)
    try {
      if ((await stat(file)).size > 1_500_000_000) throw new Error('库太大')
      const db = await openDecrypted(file, key)
      try {
        visit(db, name, uid)
      } finally {
        db.close()
      }
    } catch (error) {
      failed.push({ from: '钉钉', message: error instanceof Error ? error.message : String(error) })
    }
  }
  return opened.size
}

export async function fetchDingtalk(): Promise<NewsFeed> {
  const feed: NewsFeed = { items: [], failed: [], hidden: 0, fetchedAt: Date.now() }
  const opened = await eachAccount((db, account, uid) => {
    const stats: DingStats = {}
    feed.items.push(...messagesFrom(db, account, uid, Date.now(), stats))
    lastStats = stats
  }, feed.failed)
  if (!opened && !feed.failed.length) feed.failed.push({ from: '钉钉', message: '没有找到账号库' })
  feed.items.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
  return feed
}
