// 钉钉本机库读取的回归（不碰真实数据，内容全是编的）：在临时目录里合成一份 v3 结构的钉钉数据目录——
// globalStorage/storage.db（GlobalStorage 表放 uid，用全局库密钥加密）、<hex>_v3/user_config（Base64 JSON 的 salt）、
// <hex>_v3/DBFiles/dingtalk.db（会话、tbmsg 分表、tblastmsg、msg_clear_info、通讯录昵称与群昵称，带未合并的 WAL，用 v3 密钥加密）——
// 再把 APPDATA 指过去，用 src/main/news/dingtalk.ts 的 fetchDingtalk 读回。消息结构照用户本机真实库逐类核对过（见文件头注释），覆盖：
// 编辑过的文字取最新版、@所有人（@10）与 @uid 换成名字、发送人（群昵称 / 通讯录昵称 / 我）、群公告卡片正文、投票题目、
// 钉钉文档链接、引用回复、富文本、链接、标着没解开但文件名可读的文件、图片、只在 tblastmsg 里的、64 位 mid、
// 单聊（无标题时按对方昵称）与系统账号（标题是 uid）；应去掉的：撤回、清空记录之前、系统提示（入群合并、移出群聊、type 3），
// 而人发的「请还没进群的同学尽快加入群聊」要留着。不分哪条是通知：短消息、单聊都返回。
// 用法：ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-dingtalk.mjs（要 Electron 自带 Node 的 node:sqlite deserialize）
import { createCipheriv } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fetchDingtalk, globalCandidates, v3Key } from '../src/main/news/dingtalk.ts'

const enc = (buf, key) => {
  const c = createCipheriv('aes-128-ecb', key, null)
  c.setAutoPadding(false)
  return Buffer.concat([c.update(buf), c.final()])
}

/** 建一个 WAL 模式的库，拷出「主库 + 未合并的 -wal」，按钉钉的方式加密写到 target */
function encryptedSnapshot(work, target, key, build) {
  const plain = join(work, `plain-${Math.random().toString(36).slice(2)}.db`)
  const db = new DatabaseSync(plain)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;')
  build(db)
  copyFileSync(plain, plain + '.snap')
  copyFileSync(plain + '-wal', plain + '.snap-wal')
  db.close()
  writeFileSync(target, enc(readFileSync(plain + '.snap'), key))
  // WAL：文件头与帧头保持明文，页数据加密
  const wal = Buffer.from(readFileSync(plain + '.snap-wal'))
  const pageSize = wal.readUInt32BE(8)
  for (let off = 32; off + 24 + pageSize <= wal.length; off += 24 + pageSize) enc(wal.subarray(off + 24, off + 24 + pageSize), key).copy(wal, off + 24)
  writeFileSync(target + '-wal', wal)
}

const fail = (message, value) => {
  throw new Error(`${message}${value === undefined ? '' : '：\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 1))}`)
}

const work = mkdtempSync(join(tmpdir(), 'dt-'))
try {
  const root = join(work, 'appdata', 'DingTalk')
  const me = '123456789'
  const salt = '099cb0c5da9bc3cd22cb34f79e06e561'
  const now = Date.now()

  mkdirSync(join(root, 'globalStorage'), { recursive: true })
  encryptedSnapshot(work, join(root, 'globalStorage', 'storage.db'), globalCandidates('GenuineIntel')[7], (db) => {
    db.exec('CREATE TABLE GlobalStorage(key TEXT PRIMARY KEY, value BLOB)')
    db.prepare('INSERT INTO GlobalStorage VALUES (?, ?)').run('last_login_user_uid', me)
    db.prepare('INSERT INTO GlobalStorage VALUES (?, ?)').run('DTLastUserData', 'token-should-not-be-read')
  })

  const account = join(root, '8f15e590bba2164a3186_v3')
  mkdirSync(join(account, 'DBFiles'), { recursive: true })
  writeFileSync(join(account, 'user_config'), Buffer.from(JSON.stringify({ salt })).toString('base64'))
  encryptedSnapshot(work, join(account, 'DBFiles', 'dingtalk.db'), v3Key(me, salt), (db) => {
    db.exec('CREATE TABLE tbconversation(cid TEXT, type INTEGER, title TEXT, alias TEXT)')
    db.exec(
      'CREATE TABLE tbmsg_000(cid TEXT, mid INTEGER, senderId INTEGER, type INTEGER, createdAt INTEGER, lastModify INTEGER, contentType INTEGER, content TEXT, extension TEXT, recallStatus INTEGER, shieldStatus INTEGER, isDecrypt INTEGER)'
    )
    db.exec('CREATE TABLE tbmsg_001 AS SELECT * FROM tbmsg_000 WHERE 0')
    db.exec('CREATE TABLE tblastmsg AS SELECT * FROM tbmsg_000 WHERE 0')
    db.exec('CREATE TABLE msg_clear_info(cid TEXT, clear_timestamp INTEGER)')
    db.exec('CREATE TABLE tbuser_profile_v2(uid INTEGER, nick TEXT, alias TEXT)')
    db.exec('CREATE TABLE tbuser_group_nick(primaryKey TEXT, cid TEXT, uid INTEGER, groupNick TEXT)')

    const chat = db.prepare('INSERT INTO tbconversation VALUES (?, ?, ?, ?)')
    chat.run('g1', 2, '2024级测试群', '')
    chat.run('g2', 2, '实验室群', '')
    chat.run('g3', 2, '已清空的群', '')
    chat.run(`${me}:555`, 1, '', '')
    chat.run('21000', 1, '21000', '')
    chat.run('w1', 1, '工作通知:浙江大学', '')
    db.prepare('INSERT INTO msg_clear_info VALUES (?, ?)').run('g3', now - 1000)
    const profile = db.prepare('INSERT INTO tbuser_profile_v2 VALUES (?, ?, ?)')
    profile.run(100200002, '李同学', '')
    profile.run(555, '某同学', '')
    profile.run(21000, '钉钉云盘', '')
    db.prepare('INSERT INTO tbuser_group_nick VALUES (?, ?, ?, ?)').run('g1-100100001', 'g1', 100100001, '王老师')
    db.prepare('INSERT INTO tbuser_group_nick VALUES (?, ?, ?, ?)').run('g2-100100001', 'g2', 100100001, '王老师')

    const typed = { realmFlag: 1, realmOrgid: 0 }
    const put = (table, cid, mid, sender, minutesAgo, contentType, content, { ext = typed, recall = 0, modified, type = 1, decrypted = 1 } = {}) =>
      db
        .prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(cid, mid, sender, type, now - minutesAgo * 60_000, modified ?? now - minutesAgo * 60_000, contentType, JSON.stringify(content), JSON.stringify(ext), recall, decrypted)
    const att = (extension, url) => ({ attachments: [{ extension: JSON.stringify(extension), ...(url ? { url } : {}) }] })

    // g1：文字（编辑过）、短消息、撤回、@、系统提示、人发的「加入群聊」、图片、64 位 mid
    const notice = '【通知】请各位同学于周五 18:00 前在问卷里填写实习意向，地点：东三教学楼。'
    put('tbmsg_000', 'g1', 1, 100100001, 60, 1, { text: notice })
    put('tbmsg_001', 'g1', 1, 100100001, 60, 1, { text: notice + '（已更新）' }, { modified: now - 1000 })
    put('tbmsg_000', 'g1', 2, 100200002, 58, 1, { text: '收到' })
    put('tbmsg_001', 'g1', 4, 100100001, 55, 1, { text: '已撤回的消息' }, { recall: 1 })
    put('tbmsg_000', 'g1', 9, 100100001, 54, 1, { text: '@10 明天交作业，@100200002 记得带实验报告' })
    put('tbmsg_000', 'g1', 10, 100100001, 53, 1, { text: '甲邀请乙加入群聊' }, { ext: { merge: 1 } })
    put('tbmsg_000', 'g1', 11, 0, 52, 1, { text: '系统已将丙移出群聊' }, { ext: { openConversationId: 'x' } })
    put('tbmsg_000', 'g1', 12, 100100001, 51, 1, { text: '请还没进群的同学尽快加入群聊' })
    put('tbmsg_000', 'g1', 13, 0, 50, 1, { text: '系统消息' }, { type: 3 })
    put('tbmsg_000', 'g1', 14, Number(me), 49, 2, { mediaId: '@x', url: 'https://down.example.com/a.jpg' })
    db.prepare('INSERT INTO tbmsg_000 VALUES (?, CAST(? AS INTEGER), 100100001, 1, ?, ?, 1, ?, ?, 0, 0, 1)').run('g1', '1234567890123456789', now - 30 * 60_000, now - 30 * 60_000, JSON.stringify({ text: '开题报告周三前交' }), JSON.stringify(typed))
    db.prepare('INSERT INTO tbmsg_001 VALUES (?, CAST(? AS INTEGER), 100100001, 1, ?, ?, 1, ?, ?, 0, 0, 1)').run('g1', '1234567890123456790', now - 29 * 60_000, now - 29 * 60_000, JSON.stringify({ text: '中期检查表周五前交' }), JSON.stringify(typed))

    // g2：群公告、投票、钉钉文档、引用回复、富文本、链接、文件（标着没解开）、只在 tblastmsg 里的
    put('tbmsg_000', 'g2', 20, 100100001, 48, 2900, att({ widgetName: 'notice', LastMessageI18n: JSON.stringify({ zh_CN: '[群公告]' }) }), {
      ext: { biz_custom_title: '群公告', biz_custom_desc: '本周组会改到周四下午，请带好实验记录。' }
    })
    put('tbmsg_000', 'g2', 21, 100100001, 47, 2950, att({ widgetName: 'vote.schema', interactiveCardLastMessage: '[投票]' }), {
      ext: { biz_custom_title: '组会时间投票', interactiveCardLastMessage: '[投票]' }
    })
    put('tbmsg_000', 'g2', 22, 100200002, 46, 2950, att({ LastMessageI18n: JSON.stringify({ zh_CN: '[钉钉文档] 分组表' }) }), {
      ext: { biz_custom_desc: '[分享] 分组表', biz_custom_action_url: 'https://alidocs.dingtalk.com/i/nodes/demo' }
    })
    put('tbmsg_001', 'g2', 23, 100200002, 45, 1200, {
      attachments: [
        { extension: JSON.stringify({ markdown: '> 王老师：\n> 周四交报告\n---------------\n可以延期吗', title: '可以延期吗' }) },
        { extension: JSON.stringify({ replyContent: '可以延期吗' }) }
      ]
    }, { ext: { ...typed, sourceMessageId: 99 } })
    put('tbmsg_001', 'g2', 24, 100100001, 44, 3100, att({ desc: '实验室本周五停电，请提前保存数据。' }))
    put('tbmsg_001', 'g2', 25, 100100001, 43, 102, att({ title: '安全培训', text: '请在周日前完成' }, 'https://example.com/a'))
    put('tbmsg_001', 'g2', 26, 100100001, 42, 501, att({ f_name: '报告模板.docx' }), { decrypted: 0 })
    put('tblastmsg', 'g2', 27, 100100001, 40, 1, { text: '@10 明早八点实验室集合' })

    put('tbmsg_000', 'g3', 30, 100100001, 20, 1, { text: '清空前的消息' })
    put('tbmsg_000', `${me}:555`, 31, 555, 15, 1, { text: '明天一起去图书馆吗' })
    put('tbmsg_000', `${me}:555`, 32, Number(me), 14, 1, { text: '好' })
    put('tbmsg_000', '21000', 33, 21000, 13, 1, { text: '王老师在"实验室群"上传了1个文件' })
    put('tbmsg_000', 'w1', 34, 0, 12, 1200, att({ markdown: '### 关于期中教学检查的通知\n请各位同学按时参加。', title: '关于期中教学检查的通知' }))
  })

  process.env.APPDATA = join(work, 'appdata')
  const feed = await fetchDingtalk()
  if (feed.failed.length) fail('读取失败', feed.failed)

  const got = feed.items.map((i) => `${i.from}｜${i.title}`).sort()
  const want = [
    '2024级测试群 · 王老师｜【通知】请各位同学于周五 18:00 前在问卷里填写实习意向，地点：东三教学楼。（已更新）',
    '2024级测试群 · 李同学｜收到',
    '2024级测试群 · 王老师｜明天交作业，@李同学 记得带实验报告',
    '2024级测试群 · 王老师｜请还没进群的同学尽快加入群聊',
    '2024级测试群 · 我｜图片',
    '2024级测试群 · 王老师｜开题报告周三前交',
    '2024级测试群 · 王老师｜中期检查表周五前交',
    '实验室群 · 王老师｜群公告：本周组会改到周四下午，请带好实验记录。',
    '实验室群 · 王老师｜投票：组会时间投票',
    '实验室群 · 李同学｜钉钉文档：分组表',
    '实验室群 · 李同学｜可以延期吗',
    '实验室群 · 王老师｜实验室本周五停电，请提前保存数据。',
    '实验室群 · 王老师｜安全培训',
    '实验室群 · 王老师｜报告模板.docx',
    '实验室群 · 王老师｜明早八点实验室集合',
    '某同学｜明天一起去图书馆吗',
    '某同学 · 我｜好',
    '钉钉云盘｜王老师在"实验室群"上传了1个文件',
    '工作通知:浙江大学｜关于期中教学检查的通知'
  ].sort()
  if (JSON.stringify(got) !== JSON.stringify(want)) fail('读回的消息不对', got.join('\n'))

  const text = (title) => feed.items.find((i) => i.title === title)?.text
  const expect = (title, body) => {
    if (text(title) !== body) fail(`「${title}」的正文不对`, text(title))
  }
  expect('明天交作业，@李同学 记得带实验报告', '@所有人 明天交作业，@李同学 记得带实验报告')
  expect('群公告：本周组会改到周四下午，请带好实验记录。', '本周组会改到周四下午，请带好实验记录。')
  expect('钉钉文档：分组表', '[分组表](https://alidocs.dingtalk.com/i/nodes/demo)')
  expect('可以延期吗', '可以延期吗\n\n> 王老师：\n> 周四交报告')
  expect('安全培训', '[安全培训](https://example.com/a)\n\n请在周日前完成')
  expect('报告模板.docx', '文件：报告模板.docx')
  expect('图片', '')
  expect('关于期中教学检查的通知', '### 关于期中教学检查的通知\n请各位同学按时参加。')
  if (new Set(feed.items.map((i) => i.sourceId)).size !== 6 - 1) fail('会话应有 5 个（清空的不算）', [...new Set(feed.items.map((i) => i.sourceId))])
  if (feed.hidden !== 0) fail('不再替用户隐藏，hidden 应为 0', feed.hidden)
  if (feed.items.some((i) => 'notice' in i)) fail('不再分是不是通知')
  console.log('通过：', feed.items.length, '条，', new Set(feed.items.map((i) => i.sourceId)).size, '个会话')
} finally {
  rmSync(work, { recursive: true, force: true })
}
