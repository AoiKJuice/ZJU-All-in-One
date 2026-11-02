// 对真实问卷只读试填：npx electron scripts/probe-form.mjs <问卷地址>
// 用临时分区（不带登录态）打开页面，按虚构资料注入 src/main/forms/page.js，打印认出的题目、字段与各题容器结构；
// 不点提交、不翻页，窗口关掉即丢弃。用于对照真实页面结构补规则，结构再照着写成 forms-fixtures 里的模拟页
import { app, BrowserWindow } from 'electron'
import { formMatcher, formPage } from '../src/main/forms/page.js'

const PROFILE = {
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
const script = (op) => `(${formPage.toString()})(${JSON.stringify(PROFILE)}, ${JSON.stringify(op)}, ${formMatcher.toString()})`

// 每个可见控件：类型、name、所在题目框的类名，以及是否有值
function controls() {
  return [...document.querySelectorAll('input, select, textarea, [role=combobox], [contenteditable=true]')]
    .filter((el) => el.getClientRects().length && el.type !== 'hidden')
    .map((el) => {
      const chain = []
      for (let n = el.parentElement, i = 0; n && n !== document.body && i < 6; n = n.parentElement, i++) chain.push(n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : ''))
      return { tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role'), name: el.name, filled: el.type === 'checkbox' || el.type === 'radio' ? el.checked : !!el.value, chain: chain.join(' < ') }
    })
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const url = process.argv.at(-1)
  if (!/^https?:\/\//.test(url)) {
    console.log('用法：npx electron scripts/probe-form.mjs <问卷地址>')
    app.exit(1)
    return
  }
  const win = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { partition: 'probe-forms', sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  await win.loadURL(url).catch((e) => console.log('加载：' + e.message))
  await new Promise((r) => setTimeout(r, 3000))
  await win.webContents.executeJavaScript(script('install'))
  await new Promise((r) => setTimeout(r, 2500))
  const state = await win.webContents.executeJavaScript(script('state'))
  const { filled, missed, questions, submitReady, nextPage, captcha, notOpen, title } = state
  console.log(JSON.stringify({ title, questions, submitReady, nextPage, captcha, notOpen, filled, missed }, null, 1))
  console.log(JSON.stringify(await win.webContents.executeJavaScript(`(${controls.toString()})()`), null, 1))
  win.destroy()
  app.exit(0)
})
