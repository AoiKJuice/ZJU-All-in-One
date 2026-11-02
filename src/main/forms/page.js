// 注入问卷页面（主世界）运行的填写脚本。经 Function.toString 注入，两个函数都必须自包含、不引用外部变量；
// 写成 .js 是为了 scripts/test-forms.mjs 不经构建就能直接加载回归（类型见 page.d.ts）。
// 只操作页面：给输入框赋值后派发 input / change 事件，选择题点匹配的选项，自绘下拉先展开再点选项；不调平台接口。

/** 题目标题 → 字段；明确问的不是本人（家长电话、意向校区……）返回 false，认不出返回 null。标题先去掉题号、星号与括号里的说明再匹配，括号里出现「家长」「紧急」这类词时整题不认 */
export function formMatcher() {
  const RULES = [
    ['majorClass', /专业.{0,2}班级|班级.{0,2}专业/],
    ['collegeMajor', /(学院|院系).{0,2}专业/],
    ['studentId', /学号|学生证号|学籍号|学工号|student\s*(id|no|number)/],
    ['name', /姓名|名字|怎么称呼|如何称呼|^称呼$|^name$|your name|full name|真实姓名/],
    ['gender', /性别|gender|^sex$|^男\s*\/\s*女$/],
    ['phone', /手机|电话|联系方式|phone|mobile|^tel/],
    ['email', /邮箱|e-?mail|电子邮件|邮件地址/],
    ['qq', /(^|[^a-z])qq(号|号码|账号)?([^a-z群]|$)/],
    ['wechat', /微信|wechat|weixin|^vx/],
    ['className', /班级|行政班|^class$|^class\s*(no|name)/],
    ['major', /专业|^major$/],
    ['college', /学院|院系|所在院|院别|系别|^college$|^school$|faculty/],
    ['grade', /年级|入学年份|入学年|入学时间|届别|^grade$|^year$/],
    ['campus', /校区|campus/],
    ['dorm', /宿舍|寝室|住宿|dorm/]
  ]
  // 问的不是本人，或不是这几项（意向校区、辅修专业、身份证号、后四位……）
  const NOT = /家长|父亲|母亲|父母|监护人|紧急|辅导员|班主任|导师|老师|教师|指导|队友|队员|队长|成员|组员|推荐人|介绍人|同伴|室友|舍友|朋友|好友|他人|代填|宿管|楼长|意向|希望|想去|期望|志愿|辅修|第二专业|双学位|转专业|毕业|出生|生日|身份证|证件|护照|银行|卡号|车牌|准考|考号|后\s*[四4六6]\s*位|前\s*[四4六6]\s*位|群|人数|是否|渠道|途径|备注|理由|原因|为什么|建议|意见|评价|昵称|拼音|英文名|签名|用户名|队名|团队|作品|项目|单位|公司|家庭|籍贯|生源|民族|政治面貌|职务|学位|研究方向|楼栋长|楼长|门牌|组长|负责人|班长|团支书|支书|书记|目标|转入|转出/
  const STRONG = /组长|负责人|班长|团支书|家长|父亲|母亲|父母|监护人|紧急|辅导员|班主任|导师|老师|教师|队友|队员|推荐人|介绍人|室友|舍友|朋友|代填/
  return (raw) => {
    const full = String(raw || '').toLowerCase()
    if (STRONG.test(full)) return false
    const text = full
      .replace(/[（(【[][^）)】\]]*[）)】\]]/g, ' ')
      .replace(/[*＊]/g, ' ')
      .replace(/^\s*(第?\s*\d+\s*[题.、．:：)）]?|q\d+[.:：]?)\s*/, '')
      .replace(/请(填写|输入|选择)|您的|你的|本人|是[？?]?$|[？?：:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) return null
    if (NOT.test(text)) return false
    for (const [field, re] of RULES) if (re.test(text)) return field
    return null
  }
}

/**
 * op：install 安装（重复调用只更新资料并重跑）/ refill 忘掉已填记录按资料重填 / state 取状态 / submit 点提交。
 * 返回页面状态，见 page.d.ts 的 PageState
 */
export function formPage(profile, op, makeMatcher) {
  const w = window
  let s = w.__zjuForms
  if (!s) {
    if (op !== 'install') return null
    s = w.__zjuForms = { profile, done: new WeakMap(), seen: new Map(), filled: [], missed: [], alerts: [], running: false, again: false, submittedAt: 0, changedAt: Date.now() }
    s.match = makeMatcher()
    // 页面的 alert（作答时间太短、提交被拒等）记下来交给工具页显示；原对话框推迟弹出，不卡住注入脚本
    const alert = w.alert
    w.alert = function (message) {
      s.alerts.push(String(message))
      setTimeout(() => alert.call(w, message))
    }
    let timer = 0
    new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void run(), 350)
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
  }
  if (op === 'install') s.profile = profile
  if (op === 'refill') {
    s.profile = profile || s.profile
    s.done = new WeakMap()
    s.seen = new Map()
  }

  const BOX = '[topic], .field.ui-field-contain, section.question, .question, [data-question-id], .ant-form-item, .form-field, [data-field-id], .el-form-item, .t-form__item, .form-group, .form-item'
  const TITLE = '.topichtml, .field-label, .question-main-title, .question-title, .ant-form-item-label, .el-form-item__label, .t-form__label, .form-label, .control-label, legend, label, h1, h2, h3, h4, h5, [class*="title"], [class*="label"]'
  const TEXT = 'input:not([type]), input[type=text], input[type=tel], input[type=email], input[type=number], input[type=search], input[type=url], textarea'
  const OPTION = '.ui-radio, .ui-checkbox, [role=radio], [role=checkbox], .ant-radio-wrapper, .ant-checkbox-wrapper, .t-radio, .t-checkbox, .el-radio, .el-checkbox, label'
  const DROPDOWN = '.ant-select, .el-select, .t-select, [role=combobox]'
  const DROP_ITEM = '.ant-select-item-option, .el-select-dropdown__item, .t-select-option, [role=option]'
  const CAPTCHA = 'iframe[src*="captcha" i], #tcaptcha_transform, #tCaptchaDyMainWrap, [id*="captcha" i], [class*="captcha" i], #nc_1_wrapper, .geetest_panel, .geetest_holder, .yidun_popup, #SM_POP, .sm-pop'
  const SUBMIT = '#ctlNext, #submit_button, #submitbtn, .submitbtn, .btn-submit, button[type=submit], input[type=submit]'
  const NEXT = '#divNext, .next-page, .btn-next'

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim()
  const norm = (t) => clean(t).toLowerCase().replace(/[\s,，.。:：;；、*＊()（）[\]【】\-_/]/g, '')
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const isText = (el) => el.matches(TEXT) && !el.readOnly && !el.disabled
  const controls = (root) => [...root.querySelectorAll(`${TEXT}, select, input[type=radio], input[type=checkbox], ${DROPDOWN}`)]

  const titleOf = (box) => {
    for (const el of box.querySelectorAll(TITLE)) {
      if (el.querySelector('input, select, textarea') || el.closest(OPTION.replace(/, label$/, '')) || el.closest('.ui-controlgroup, .ant-radio-group, .question-options')) continue
      const t = clean(el.textContent)
      if (t) return t.slice(0, 80)
    }
    const copy = box.cloneNode(true)
    copy.querySelectorAll(`input, select, textarea, ${OPTION}, ${DROPDOWN}`).forEach((n) => n.remove())
    return clean(copy.textContent).slice(0, 80)
  }
  const display = (t) => clean(t.replace(/^\s*(第?\s*\d+\s*[题.、．:：)）]?|Q\d+[.:：]?)\s*/i, '').replace(/[*＊]/g, '').replace(/必填|选填/g, '').replace(/[（(]\s*[）)]/g, ''))
  const required = (box, title) =>
    !!box.querySelector('.req, .required, .is-required, .ant-form-item-required, .question-required, .t-form__label--required, [aria-required="true"], [required]') ||
    box.getAttribute('req') === '1' ||
    /[*＊]|必填/.test(title)

  // 题目容器：已知的题目块取最内层；不在任何题目块里的控件往上找到只含这一题的祖先
  const boxes = () => {
    const known = [...document.querySelectorAll(BOX)].filter(visible)
    const inner = known.filter((b) => !known.some((o) => o !== b && b.contains(o)) && controls(b).length > 0)
    const list = [...inner]
    for (const el of controls(document.body)) {
      if (!visible(el) && !el.matches('input[type=radio], input[type=checkbox]')) continue
      if (list.some((b) => b.contains(el))) continue
      let node = el
      while (node.parentElement && node.parentElement !== document.body && controls(node.parentElement).every((c) => c.name && c.name === el.name) && node.parentElement.textContent.length < 400) node = node.parentElement
      if (node !== el && visible(node)) list.push(node)
    }
    return list
  }

  const valueOf = (field) => {
    const p = s.profile
    if (field === 'majorClass') return p.className && p.major && !p.className.includes(p.major) ? p.major + p.className : p.className || p.major
    if (field === 'collegeMajor') return p.college && p.major ? p.college + p.major : ''
    return p[field] || ''
  }
  // 选择题的候选说法：性别补「男生 / 男性」，年级补「22级」「大二」，校区去掉「校区」二字
  const wants = (field, value) => {
    const list = [value]
    if (field === 'gender') list.push(/男/.test(value) ? '男生' : '女生', /男/.test(value) ? '男性' : '女性', /男/.test(value) ? 'male' : 'female')
    if (field === 'grade') {
      const year = parseInt(value.replace(/\D/g, ''), 10)
      if (year > 1990) {
        const now = new Date()
        const level = (now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1) - year + 1
        list.push(`${year}级`, `${String(year).slice(2)}级`, `${year}`)
        if (level >= 1 && level <= 5) list.push(`大${'一二三四五'[level - 1]}`)
      }
    }
    if (field === 'campus' || field === 'college') list.push(value.replace(/校区|学院$/g, ''))
    return list.map(norm).filter(Boolean)
  }
  const score = (text, targets) => {
    const t = norm(text)
    if (!t) return 0
    let best = 0
    for (const v of targets) {
      if (t === v) best = Math.max(best, 3)
      else if (t.includes(v) && !(v === '男' && t.includes('女')) && !(v === '女' && t.includes('男'))) best = Math.max(best, 2)
      else if (t.length >= 2 && v.includes(t)) best = Math.max(best, 1)
    }
    return best
  }
  const pick = (items, targets) => {
    let hit = null
    let top = 0
    for (const el of items) {
      const sc = score(el.textContent || el.getAttribute('title') || el.value, targets)
      if (sc > top || (sc === top && sc > 0 && clean(el.textContent).length < clean(hit.textContent).length)) {
        hit = el
        top = sc
      }
    }
    return hit
  }

  const setText = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    for (const type of ['input', 'change', 'keyup', 'blur']) el.dispatchEvent(new Event(type, { bubbles: true }))
  }
  const checked = (opt) => {
    const input = opt.matches('input') ? opt : opt.querySelector('input[type=radio], input[type=checkbox]')
    return (input && input.checked) || /(^|[\s-])(checked|is-checked|active|selected)(\s|$)/.test(opt.className) || opt.getAttribute('aria-checked') === 'true'
  }
  const filledBox = (box) =>
    [...box.querySelectorAll(TEXT)].some((el) => el.value.trim()) ||
    [...box.querySelectorAll('select')].some((el) => el.selectedIndex > 0 || (el.value && !/^-?\d$/.test(el.value) && el.value !== '')) ||
    [...box.querySelectorAll('input[type=radio], input[type=checkbox]')].some((el) => el.checked) ||
    [...box.querySelectorAll(OPTION)].some(checked) ||
    !!box.querySelector('.ant-select-selection-item, .el-select__selected-item')

  // 填一题：返回 true 已填 / false 有字段但没对上 / null 不认识
  const fillBox = async (box, title) => {
    const texts = [...box.querySelectorAll(TEXT)].filter((el) => visible(el) && isText(el))
    // 多项填空：一题里几个空，各按自己旁边的文字认
    if (texts.length > 1) {
      let any = null
      for (const el of texts) {
        const label = clean(el.getAttribute('aria-label') || el.placeholder || (el.previousElementSibling && el.previousElementSibling.textContent) || (el.parentElement && el.parentElement.previousElementSibling && el.parentElement.previousElementSibling.textContent) || '')
        const field = s.match(label)
        const value = field ? valueOf(field) : ''
        if (!value) continue
        if (!s.done.has(el)) setText(el, value)
        s.done.set(el, field)
        s.filled.push({ title: display(label), field })
        any = true
      }
      return any
    }
    let field = s.match(title)
    // 标题认不出时再看输入框的提示文字；标题明确不是本人（如紧急联系人姓名）时不看
    if (field === null && texts.length === 1) field = s.match(texts[0].getAttribute('aria-label') || texts[0].placeholder || '')
    if (!field) return null
    const value = valueOf(field)
    if (!value) return false
    const record = () => {
      s.filled.push({ title: display(title), field })
      return true
    }
    if (texts.length === 1) {
      const el = texts[0]
      if (!s.done.has(el)) setText(el, value)
      s.done.set(el, field)
      return record()
    }
    const targets = wants(field, value)
    const select = [...box.querySelectorAll('select')].find((el) => !el.disabled)
    if (select) {
      if (s.done.has(select)) return record()
      const option = pick([...select.options].filter((o) => o.index > 0 || o.value), targets)
      if (!option) return false
      select.value = option.value
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      if (w.jQuery) w.jQuery(select).trigger('change')
      s.done.set(select, field)
      return record()
    }
    // 选项：已知的选项类名，或包着单选 / 多选框（或用 for 指向它）的 label；题目标题的 label 不算
    const options = [...box.querySelectorAll(OPTION)].filter(
      (el) =>
        clean(el.textContent) &&
        !el.querySelector(OPTION.replace(/, label$/, '')) &&
        (!el.matches('label') || el.matches(OPTION.replace(/, label$/, '')) || !!el.querySelector('input[type=radio], input[type=checkbox]') || !!(el.htmlFor && document.getElementById(el.htmlFor) && document.getElementById(el.htmlFor).matches('input[type=radio], input[type=checkbox]')))
    )
    if (options.length) {
      const option = pick(options, targets)
      if (!option) return false
      if (!s.done.has(option) && !checked(option)) {
        const input = option.matches('label') ? null : option.querySelector('input')
        option.click()
        if (input && !input.checked && !checked(option)) input.click()
      }
      s.done.set(option, field)
      return record()
    }
    // 自绘下拉：按下展开，等选项层出来再点
    const drop = box.querySelector(DROPDOWN)
    if (drop) {
      if (s.done.has(drop)) return record()
      const trigger = drop.querySelector('.ant-select-selector, .el-select__wrapper, .el-input, .t-input') || drop
      for (const type of ['mousedown', 'mouseup', 'click']) trigger.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      let option = null
      for (let i = 0; i < 10 && !option; i++) {
        await sleep(80)
        option = pick([...document.querySelectorAll(DROP_ITEM)].filter(visible), targets)
      }
      if (!option) {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        return false
      }
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      option.click()
      s.done.set(drop, field)
      return record()
    }
    return false
  }

  const run = async () => {
    if (s.running) {
      s.again = true
      return
    }
    s.running = true
    try {
      const before = JSON.stringify([s.filled, s.missed])
      s.filled = []
      s.missed = []
      for (const box of boxes()) {
        const title = titleOf(box)
        const result = await fillBox(box, title)
        const missed = result !== true && required(box, title) && !filledBox(box)
        if (missed) s.missed.push(display(title) || '未命名的题')
        if (missed && !box.dataset.zjuMissed) {
          box.dataset.zjuMissed = '1'
          box.style.outline = '2px solid #c4372b'
          box.style.outlineOffset = '4px'
          box.style.borderRadius = '8px'
        } else if (!missed && box.dataset.zjuMissed) {
          delete box.dataset.zjuMissed
          box.style.outline = ''
        }
      }
      // 多页问卷翻页后前一页的题被隐藏，填过的仍记在 seen 里
      for (const f of s.filled) s.seen.set(`${f.field}|${f.title}`, f)
      if (JSON.stringify([s.filled, s.missed]) !== before) s.changedAt = Date.now()
    } finally {
      s.running = false
      if (s.again) {
        s.again = false
        setTimeout(() => void run(), 0)
      }
    }
  }

  const button = (sel, words) =>
    [...document.querySelectorAll(sel)].find(visible) ||
    [...document.querySelectorAll('button, a, [role=button], div[class*="btn"], span[class*="btn"]')].find((b) => visible(b) && words.test(clean(b.textContent)))

  const state = () => {
    const text = clean(document.body ? document.body.innerText : '').slice(0, 3000)
    const questions = boxes().length
    return {
      title: clean(document.title),
      filled: [...s.seen.values()],
      missed: s.missed,
      questions,
      submitReady: !!button(SUBMIT, /^(提\s*交|提交问卷|提交答卷|确认提交|submit)$/i),
      nextPage: !!button(NEXT, /^(下一页|下一步|next)$/i),
      captcha: [...document.querySelectorAll(CAPTCHA)].some((el) => visible(el) && el.getBoundingClientRect().height > 30),
      done: (questions === 0 || s.submittedAt > 0) && /提交成功|感谢您?的?(参与|填写|作答|支持|提交)|答卷已(经)?提交|已提交|提交完成|报名成功|已收到|您已完成/.test(text),
      notOpen: questions === 0 && /尚未开始|还未开始|未开始|尚未开放|暂未开放|未开放|即将开始|暂停收集|已暂停|not (yet )?(started|open)/i.test(text),
      // 点过提交后页面标出的校验错误（必填没填、格式不对）
      invalid: s.submittedAt > 0 && [...document.querySelectorAll('.errorMessage, .question-error, .ant-form-item-has-error, .ant-form-item-explain-error, .el-form-item__error, .is-error, [aria-invalid="true"]')].some(visible),
      alerts: s.alerts.slice(-3),
      stableFor: Date.now() - s.changedAt,
      running: s.running,
      submittedAt: s.submittedAt
    }
  }

  if (op === 'submit') {
    const target = button(SUBMIT, /^(提\s*交|提交问卷|提交答卷|确认提交|submit)$/i)
    if (target) {
      s.submittedAt = Date.now()
      target.click()
    }
    return state()
  }
  if (op === 'install' || op === 'refill') return run().then(state)
  return state()
}
