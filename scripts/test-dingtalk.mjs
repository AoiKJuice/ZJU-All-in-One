// 钉钉本机库解密流程的回归（不碰真实数据）：合成一个带 WAL 的 SQLite 库，按 V2 规则（MD5(uid) 前 16 位）AES-128-ECB 加密，
// 再用 src/main/news/dingtalk.ts 的候选密钥、解密、WAL 合并与查询读回来。用法：ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-dingtalk.mjs（要 Electron 自带 Node 的 node:sqlite deserialize）
import { createCipheriv, createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { accountCandidates, validKey, decryptDatabase, open, noticesFrom } from '../src/main/news/dingtalk.ts'

const dir = mkdtempSync(join(tmpdir(), 'dt-'))
try {
  const plain = join(dir, 'plain.db')
  const db = new DatabaseSync(plain)
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE tbconversation(cid TEXT, title TEXT); CREATE TABLE tblastmsg(cid TEXT, content TEXT, createdAt INTEGER);")
  db.exec("INSERT INTO tbconversation VALUES ('c1', '2024级测试群')")
  db.prepare('INSERT INTO tblastmsg VALUES (?, ?, ?)').run('c1', '【通知】请各位同学于周五 18:00 前在问卷里填写实习意向，地点：东三教学楼。逾期不再补录。', 1762400000000)
  db.prepare('INSERT INTO tblastmsg VALUES (?, ?, ?)').run('c1', '收到', 1762400001000)
  // 拷贝时 WAL 还未合并：主库 + -wal
  copyFileSync(plain, join(dir, 'snap.db'))
  copyFileSync(plain + '-wal', join(dir, 'snap.db-wal'))
  db.close()

  const uid = '123456789'
  const key = Buffer.from(createHash('md5').update(uid).digest('hex').slice(0, 16), 'latin1')
  const enc = (buf) => {
    const c = createCipheriv('aes-128-ecb', key, null)
    c.setAutoPadding(false)
    return Buffer.concat([c.update(buf), c.final()])
  }
  const main = readFileSync(join(dir, 'snap.db'))
  writeFileSync(join(dir, 'dingtalk.db'), enc(main))
  // WAL：文件头与帧头保持明文，页数据加密
  const wal = Buffer.from(readFileSync(join(dir, 'snap.db-wal')))
  const pageSize = wal.readUInt32BE(8)
  for (let off = 32; off + 24 + pageSize <= wal.length; off += 24 + pageSize) enc(wal.subarray(off + 24, off + 24 + pageSize)).copy(wal, off + 24)
  writeFileSync(join(dir, 'dingtalk.db-wal'), wal)

  const head = readFileSync(join(dir, 'dingtalk.db')).subarray(0, 16)
  const found = accountCandidates(uid, ['']).find((k) => validKey(head, k))
  if (!found) throw new Error('候选密钥里没有正确的')
  const restored = open(await decryptDatabase(join(dir, 'dingtalk.db'), found))
  const items = noticesFrom(restored, uid)
  restored.close()
  if (items.length !== 1 || items[0].from !== '2024级测试群') throw new Error('读回的通知不对：' + JSON.stringify(items))
  console.log('通过：', items[0].from, items[0].title)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
