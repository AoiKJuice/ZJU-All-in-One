// 对真实问卷只读试看：npx electron scripts/probe-form.mjs <问卷地址> [--fill]
// 用临时分区（不带登录态）打开页面，注入 src/main/forms/page.js 列出认出的题（题型、选项数、必填、认出的字段）、
// 没认进题里的控件与各控件外层结构。默认按空资料注入，不往页面里写任何值；--fill 才按虚构资料试填。
// 不点提交、不翻页，窗口关掉即丢弃。用于对照真实页面结构补规则，结构再照着写成 forms-fixtures 里的模拟页
import { app, BrowserWindow } from 'electron'
import { formMatcher, formPage } from '../src/main/forms/page.js'

const FICTIONAL = {
  studentId: '3220109999',
  name: '林知远',
  gender: '男',
  className: '计科2203',
  major: '计算机科学与技术',
  college: '计算机科学与技术学院',
  grade: '2022',
  campus: '紫金港',
  phone: '13800001234',
  email: 'linzy@example.com',
  qq: '123456789',
  wechat: 'lzy_demo',
  dorm: '碧峰5舍312'
}
const fill = process.argv.includes('--fill')
const PROFILE = fill ? FICTIONAL : Object.fromEntries(Object.keys(FICTIONAL).map((k) => [k, '']))
const script = (op) => `(${formPage.toString()})(${JSON.stringify(PROFILE)}, ${JSON.stringify(op)}, ${formMatcher.toString()}, null)`

// 每个可见控件（含自绘单选 / 多选 / 下拉、可编辑区）：类型与往上几层的类名，标出是否落在认出的题里
function controls() {
  const sel = 'input, select, textarea, [role=radio], [role=checkbox], [role=combobox], [role=listbox], [contenteditable=true], [contenteditable=""]'
  return [...document.querySelectorAll(sel)]
    .filter((el) => el.getClientRects().length && el.type !== 'hidden')
    .slice(0, 40)
    .map((el) => {
      const chain = []
      for (let n = el.parentElement, i = 0; n && n !== document.body && i < 6; n = n.parentElement, i++) chain.push(n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : ''))
      return { tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || (el.isContentEditable ? 'editable' : ''), chain: chain.join(' < ') }
    })
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const url = process.argv.find((a) => /^https?:\/\//.test(a))
  if (!url) {
    console.log('用法：npx electron scripts/probe-form.mjs <问卷地址> [--fill]')
    app.exit(1)
    return
  }
  const win = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { partition: 'probe-forms', sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  win.webContents.on('will-prevent-unload', (e) => e.preventDefault())
  await win.loadURL(url).catch((e) => console.log('加载：' + e.message))
  await new Promise((r) => setTimeout(r, 5000))
  // 被弹到登录页（统一身份认证、扫码）：不是问卷，不往里填
  const landed = win.webContents.getURL()
  // 与 src/main/forms/index.ts 的 isLogin 相同：主机像登录服务，或路径里有 login / signin / oauth / sso 一段（腾讯问卷的登录页与问卷同主机）
  const lu = new URL(landed)
  if (landed.split('#')[0] !== url.split('#')[0] && (/ptlogin|graph\.qq\.com|open\.weixin\.qq\.com|passport\.|accounts\.(feishu|larksuite)|zjuam\./i.test(lu.hostname) || /(^|\/)(r\/)?(login|signin|sign_in|oauth2?|sso|cas\/login)(\.html?|\/|$)/i.test(lu.pathname))) {
    console.log('需要登录：' + new URL(landed).hostname)
    win.destroy()
    app.exit(0)
    return
  }
  await win.webContents.executeJavaScript(script('install'))
  await new Promise((r) => setTimeout(r, 2500))
  const state = await win.webContents.executeJavaScript(script('state'))
  const questions = await win.webContents.executeJavaScript(script('describe'))
  const { title, submitReady, nextPage, captcha, needLogin, notOpen, ended, opensAt, done } = state
  console.log(JSON.stringify({ url: landed, title, questions: state.questions, submitReady, nextPage, captcha, needLogin, notOpen, ended, opensAt, done }))
  for (const q of questions) console.log(`  ${q.required ? '*' : ' '} ${q.kind.padEnd(8)} ${q.field ?? '-'}  ${q.title}${q.options.length ? '  [' + q.options.slice(0, 6).join(' / ') + (q.options.length > 6 ? ' …' : '') + ']' : ''}`)
  if (!questions.length) console.log('  页面文字：' + (await win.webContents.executeJavaScript(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)`)))
  console.log(JSON.stringify(await win.webContents.executeJavaScript(`(${controls.toString()})()`), null, 1))
  win.destroy()
  app.exit(0)
})
