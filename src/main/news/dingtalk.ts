import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NewsFeed, NewsItem } from '@shared/news'

// 校园资讯 · 来源 D（实验，默认关，仅 Windows 桌面）：读本机钉钉数据库里像通知的群消息。纯 TS，不调用钉钉接口。
// 数据结构与密钥派生的思路参考 dsh-zju-assistant（GPL-3.0，只参考思路，代码自写）：
// - 全局库：密钥由 CPU 厂商字符串拼出，这里枚举几种拼法，用解密后的文件头「SQLite format 3\0」校验；
// - 账号库（目录名为 uid）：V3 = MD5(PBKDF2(uid + 全局库 user_config 里的 salt, 盐「666DingT」)) 十六进制前 16 位，
//   V2 = MD5(uid) 十六进制前 16 位；PBKDF2 的轮数与摘要也逐个尝试、按文件头校验；
// - 解密：AES-128-ECB 逐块（与页无关），再把 -wal 文件里已提交的帧按页号合并进去，改成非 WAL 格式后用 node:sqlite 在内存里打开；
// - 查 tbconversation（会话名）与 tblastmsg、tbmsg*（消息），只保留像通知的消息。
// 本文件只用 Node 模块（不 import electron），scripts/test-dingtalk.mjs 用合成的库回归。
// 解密后的库只在内存里，不写盘、不缓存；消息原文不发给任何模型。未在真实钉钉数据上验证。

const HEADER = Buffer.from('SQLite format 3\0', 'latin1')
const PBKDF2_SALT = '666DingT'

const md5hex = (s: string | Buffer): string => createHash('md5').update(s).digest('hex')

function decryptEcb(data: Buffer, key: Buffer): Buffer {
  const usable = data.length - (data.length % 16)
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(data.subarray(0, usable)), decipher.final()])
}

export const validKey = (head: Buffer, key: Buffer): boolean => key.length === 16 && decryptEcb(head.subarray(0, 16), key).equals(HEADER)

function cpuVendor(): Promise<string> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Select-Object -First 1).Manufacturer'], { timeout: 10_000, windowsHide: true }, (error, stdout) =>
      resolve(error ? '' : stdout.trim())
    )
  })
}

/** 全局库密钥的候选：厂商字符串（GenuineIntel / AuthenticAMD）的几种拼法 */
function globalCandidates(vendor: string): Buffer[] {
  const seeds = [vendor, `${vendor}${vendor}`, `DingTalk${vendor}`, `${vendor}DingTalk`, vendor.toLowerCase()]
  const out: Buffer[] = []
  for (const s of seeds.filter(Boolean)) {
    out.push(Buffer.from(s.padEnd(16, '\0').slice(0, 16), 'latin1'))
    out.push(Buffer.from(md5hex(s).slice(0, 16), 'latin1'))
    out.push(createHash('md5').update(s).digest())
  }
  return out
}

/** 账号库密钥的候选（V3 先、V2 后） */
export function accountCandidates(uid: string, salts: string[]): Buffer[] {
  const out: Buffer[] = []
  for (const salt of salts) {
    for (const password of [uid + salt, salt + uid, uid]) {
      for (const iterations of [1000, 10_000, 4096, 1]) {
        for (const digest of ['sha1', 'sha256']) {
          for (const len of [32, 16]) {
            const derived = pbkdf2Sync(password, PBKDF2_SALT, iterations, len, digest)
            out.push(Buffer.from(md5hex(derived).slice(0, 16), 'latin1'))
            out.push(Buffer.from(md5hex(derived.toString('hex')).slice(0, 16), 'latin1'))
          }
        }
      }
    }
  }
  out.push(Buffer.from(md5hex(uid).slice(0, 16), 'latin1'))
  return out
}

/** 解密并合并已提交的 WAL 帧，返回可 deserialize 的库 */
export async function decryptDatabase(path: string, key: Buffer): Promise<Buffer> {
  const db = decryptEcb(await readFile(path), key)
  const walPath = `${path}-wal`
  if (existsSync(walPath)) {
    const wal = await readFile(walPath)
    if (wal.length >= 32) {
      const pageSize = wal.readUInt32BE(8)
      const salt1 = wal.readUInt32BE(16)
      const salt2 = wal.readUInt32BE(20)
      const frames: { page: number; data: Buffer; commit: boolean }[] = []
      for (let off = 32; off + 24 + pageSize <= wal.length; off += 24 + pageSize) {
        if (wal.readUInt32BE(off + 8) !== salt1 || wal.readUInt32BE(off + 12) !== salt2) break
        frames.push({ page: wal.readUInt32BE(off), data: decryptEcb(wal.subarray(off + 24, off + 24 + pageSize), key), commit: wal.readUInt32BE(off + 4) !== 0 })
      }
      // 只合并到最后一个提交帧
      const last = frames.map((f) => f.commit).lastIndexOf(true)
      let merged = db
      for (const f of frames.slice(0, last + 1)) {
        const at = (f.page - 1) * pageSize
        if (at + pageSize > merged.length) merged = Buffer.concat([merged, Buffer.alloc(at + pageSize - merged.length)])
        f.data.copy(merged, at)
      }
      merged[18] = 1
      merged[19] = 1
      return merged
    }
  }
  db[18] = 1
  db[19] = 1
  return db
}

export function open(buffer: Buffer): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.deserialize(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length))
  return db
}

const columns = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all() as { name: string }[]).map((c) => c.name)
const pick = (cols: string[], names: string[]): string | undefined => names.find((n) => cols.includes(n)) ?? cols.find((c) => names.some((n) => c.toLowerCase().includes(n.toLowerCase())))

/** 像通知的消息：够长，且有通知类的字眼 */
const NOTICE = /通知|公告|请(各位|大家|同学)|报名|截止|提交|填写|会议|讲座|时间[:：]|地点[:：]|@所有人|务必|注意/

export function noticesFrom(db: DatabaseSync, account: string): NewsItem[] {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
  const titles = new Map<string, string>()
  if (tables.includes('tbconversation')) {
    const cols = columns(db, 'tbconversation')
    const id = pick(cols, ['cid', 'conversationId', 'id'])
    const title = pick(cols, ['title', 'name'])
    if (id && title) for (const r of db.prepare(`SELECT "${id}" AS id, "${title}" AS title FROM tbconversation`).all() as { id: unknown; title: unknown }[]) titles.set(String(r.id), String(r.title ?? ''))
  }
  const out: NewsItem[] = []
  for (const table of tables.filter((t) => t === 'tblastmsg' || /^tbmsg/i.test(t))) {
    const cols = columns(db, table)
    const cid = pick(cols, ['cid', 'conversationId'])
    const content = pick(cols, ['content', 'text', 'msgContent', 'message'])
    const time = pick(cols, ['createdAt', 'created_at', 'createTime', 'time', 'modifyTime'])
    if (!content) continue
    const rows = db.prepare(`SELECT ${cid ? `"${cid}" AS cid,` : ''} "${content}" AS content ${time ? `, "${time}" AS time` : ''} FROM "${table}" ${time ? `ORDER BY "${time}" DESC` : ''} LIMIT 300`).all() as { cid?: unknown; content: unknown; time?: unknown }[]
    for (const [i, r] of rows.entries()) {
      let text = typeof r.content === 'string' ? r.content : ''
      // 有的消息内容是 JSON（{"text": "..."}）
      if (text.startsWith('{')) {
        try {
          const j = JSON.parse(text) as Record<string, unknown>
          text = String(j.text ?? j.content ?? j.title ?? '')
        } catch {
          /* 原样用 */
        }
      }
      if (text.length < 30 || !NOTICE.test(text)) continue
      const t = Number(r.time)
      const group = titles.get(String(r.cid)) ?? '钉钉群'
      out.push({
        id: `dingtalk:${account}:${table}:${r.cid ?? ''}:${r.time ?? i}`,
        kind: 'dingtalk',
        title: text.split('\n')[0].slice(0, 60),
        text: text.slice(0, 2000),
        time: Number.isFinite(t) && t > 0 ? new Date(t < 1e12 ? t * 1000 : t).toISOString() : null,
        from: group
      })
    }
  }
  return out
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0 || !existsSync(dir)) return
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) await walk(p, depth - 1, out)
    else if (/\.db$/i.test(entry.name)) out.push(p)
  }
}

async function head(path: string): Promise<Buffer> {
  const buf = await readFile(path)
  return buf.subarray(0, 16)
}

export async function fetchDingtalk(): Promise<NewsFeed> {
  if (process.platform !== 'win32') throw new Error('只支持 Windows')
  const root = join(process.env['APPDATA'] ?? '', 'DingTalk')
  if (!existsSync(root)) throw new Error('没有找到钉钉数据目录')
  const files: string[] = []
  await walk(root, 4, files)
  if (!files.length) throw new Error('没有找到钉钉数据库')

  // 账号库：路径里带纯数字 uid（如 …\123456_v2\DBFiles\dingtalk.db）
  const uidOf = (p: string): string | null => /[\\/](\d{5,})(?:_v\d)?[\\/]/.exec(p)?.[1] ?? null
  const globals = files.filter((f) => !uidOf(f))
  const accounts = files.filter((f) => uidOf(f))

  // 全局库里的 salt（user_config）
  const salts = new Set<string>([''])
  const vendor = await cpuVendor()
  for (const g of globals) {
    const h = await head(g).catch(() => null)
    if (!h) continue
    const key = h.equals(HEADER) ? null : globalCandidates(vendor).find((k) => validKey(h, k))
    if (key === undefined) continue
    try {
      const db = open(key ? await decryptDatabase(g, key) : await readFile(g))
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
      if (tables.includes('user_config')) {
        for (const row of db.prepare('SELECT * FROM user_config').all() as Record<string, unknown>[]) {
          const values = Object.values(row).map((v) => String(v ?? ''))
          if (values.some((v) => /salt/i.test(v)) || Object.keys(row).some((k) => /salt/i.test(k))) {
            for (const v of values) if (v && !/salt/i.test(v) && v.length <= 64) salts.add(v)
          }
        }
      }
      db.close()
    } catch {
      /* 不是可读的库 */
    }
  }

  const feed: NewsFeed = { items: [], failed: [], hidden: 0, fetchedAt: Date.now() }
  for (const file of accounts) {
    const uid = uidOf(file)!
    try {
      if ((await stat(file)).size > 1_500_000_000) throw new Error('库太大')
      const h = await head(file)
      const key = h.equals(HEADER) ? null : accountCandidates(uid, [...salts]).find((k) => validKey(h, k))
      if (key === undefined) throw new Error('没有匹配的密钥')
      const db = open(key ? await decryptDatabase(file, key) : await readFile(file))
      try {
        feed.items.push(...noticesFrom(db, uid))
      } finally {
        db.close()
      }
    } catch (error) {
      feed.failed.push({ from: '钉钉', message: error instanceof Error ? error.message : String(error) })
    }
  }
  feed.items.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
  return feed
}
