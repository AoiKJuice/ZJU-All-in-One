// 问卷填写脚本回归：npx electron scripts/test-forms.mjs [文件名片段]
// 先用 forms-fixtures/titles.json（各字段的标题说法与容易误认的反例）核对标题匹配；
// 逐个加载 scripts/forms-fixtures 里的模拟问卷（问卷星 / 腾讯问卷 / 金数据结构，内容虚构），注入 src/main/forms/page.js 填写，
// 按题目块的 data-expect 核对：字段键 = 应填成该项，none = 不该动，missed = 认不出的必填题应被标出；
// 没有 missed 时模拟自动提交，页面校验通过会置 window.__submitted；有 missed 时不应提交。问卷星多页样例翻页后再核对第二页
import { app, BrowserWindow } from 'electron'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { formMatcher, formPage } from '../src/main/forms/page.js'

const root = dirname(fileURLToPath(import.meta.url))
const dir = join(root, 'forms-fixtures')
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

// 在页面里核对每个题目块
function check(profile) {
  const norm = (t) => (t || '').toLowerCase().replace(/[\s,，.。:：;；、*()（）\-_/级校区]/g, '')
  const problems = []
  const value = (box) => {
    const texts = [...box.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]), textarea')].map((e) => e.value).filter(Boolean)
    const chosen = [...box.querySelectorAll('input[type=radio], input[type=checkbox]')].filter((e) => e.checked).map((e) => e.closest('label, .ui-radio, .ui-checkbox')?.textContent || e.value)
    const select = [...box.querySelectorAll('select')].filter((s) => s.selectedIndex > 0).map((s) => s.options[s.selectedIndex].text)
    const custom = [...box.querySelectorAll('.ant-select-selection-item')].map((e) => e.textContent)
    return [...texts, ...chosen, ...select, ...custom].join(' ')
  }
  for (const box of document.querySelectorAll('[data-expect]')) {
    if (!box.getClientRects().length) continue
    const expect = box.getAttribute('data-expect')
    const got = value(box)
    const title = (box.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)
    if (expect === 'none') {
      if (got) problems.push(`不该填：${title} → ${got}`)
    } else if (expect === 'missed') {
      if (!box.dataset.zjuMissed) problems.push(`没标出：${title}`)
    } else {
      const want = expect === 'majorClass' ? [profile.major + profile.className, profile.className] : expect === 'grade' ? [profile.grade, profile.grade.slice(2)] : expect === 'gender' ? [profile.gender] : [profile[expect]]
      if (!got || !want.some((w) => norm(got).includes(norm(w)) || norm(w).includes(norm(got)))) problems.push(`${expect}：${title} → ${got || '（空）'}`)
    }
  }
  return problems
}

async function settle(win) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150))
    const state = await win.webContents.executeJavaScript(script('state'))
    if (state && state.questions > 0 && !state.running && state.stableFor > 700) return state
  }
  return win.webContents.executeJavaScript(script('state'))
}

// 逐个关窗时别让 Electron 以为窗口都关了而退出
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  let failed = 0
  const match = formMatcher()
  const titles = JSON.parse(readFileSync(join(dir, 'titles.json'), 'utf8'))
  const wrong = [
    ...Object.entries(titles.positive).flatMap(([field, list]) => list.filter((t) => match(t) !== field).map((t) => `${t} → ${match(t)}（应为 ${field}）`)),
    ...titles.negative.filter((n) => match(n.title)).map((n) => `${n.title} → ${match(n.title)}（不该认）`)
  ]
  console.log(`${wrong.length ? '✗' : '✓'} 标题匹配`)
  for (const w of wrong) console.log('    ' + w)
  if (wrong.length) failed++
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.html') && f.includes(process.argv.at(-1).endsWith('.mjs') ? '' : process.argv.at(-1)))) {
    const win = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
    await win.loadURL(pathToFileURL(join(dir, file)).href).catch((e) => console.log(`  加载失败 ${file}：${e.message}`))
    await new Promise((r) => setTimeout(r, 1000))
    await win.webContents.executeJavaScript(script('install'))
    let state = await settle(win)
    const problems = await win.webContents.executeJavaScript(`(${check.toString()})(${JSON.stringify(PROFILE)})`)
    if (state.nextPage) {
      await win.webContents.executeJavaScript(`document.querySelector('#divNext').click()`)
      await new Promise((r) => setTimeout(r, 300))
      state = await settle(win)
      problems.push(...(await win.webContents.executeJavaScript(`(${check.toString()})(${JSON.stringify(PROFILE)})`)).map((p) => `第二页 ${p}`))
    }
    const expectMissed = await win.webContents.executeJavaScript(`!!document.querySelector('[data-expect=missed]')`)
    if (!state.missed.length) {
      await win.webContents.executeJavaScript(script('submit'))
      await new Promise((r) => setTimeout(r, 400))
      const submitted = await win.webContents.executeJavaScript('window.__submitted === true')
      if (!submitted) problems.push('自动提交未通过页面校验')
      const after = await win.webContents.executeJavaScript(script('state'))
      if (submitted && !after.done) problems.push('提交后没认出成功页')
    }
    if (expectMissed && !state.missed.length) problems.push('有认不出的必填题却会提交')
    console.log(`${problems.length ? '✗' : '✓'} ${file}  填 ${state.filled.length}  未认出 ${state.missed.length}${state.missed.length ? '（' + state.missed.join('、') + '）' : ''}`)
    for (const p of problems) console.log('    ' + p)
    if (problems.length) failed++
    win.destroy()
    await new Promise((r) => setTimeout(r, 300))
  }
  console.log(failed ? `${failed} 个失败` : '全部通过')
  app.exit(failed ? 1 : 0)
})
