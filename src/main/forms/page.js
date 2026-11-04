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
 * op：install 安装（重复调用只更新资料与答案并重跑）/ state 取状态 / describe 列出当前页全部题目 / answer 按题目键填入用户在应用里给的答案 / submit 点提交（多页问卷点下一页）。
 * arg：install、answer 时为答案表（题目键 → 文字，多选为选项文字数组）。返回见 page.d.ts
 */
export function formPage(profile, op, makeMatcher, arg) {
  const w = window
  let s = w.__zjuForms
  if (!s) {
    if (op !== 'install') return null
    s = w.__zjuForms = { profile, answers: {}, done: new WeakMap(), seen: new Map(), filled: [], missed: [], lacking: [], placed: [], touched: [], drifts: 0, alerts: [], running: false, again: false, submittedAt: 0, changedAt: Date.now(), ranQuestions: -1, pagePrefilled: new WeakSet() }
    s.match = makeMatcher()
    // 用户亲手改过的控件（真实的输入、点击）不再按资料改回去；我们自己派发的事件 isTrusted 为 false
    for (const type of ['input', 'change', 'click']) {
      document.addEventListener(type, (e) => e.isTrusted && e.target instanceof Element && s.touched.length < 200 && s.touched.push(e.target), true)
    }
    // 窗口在后台不显示，页面的 alert / confirm 弹不出来还会卡住：alert（作答时间太短、提交被拒等）记下交给应用显示，
    // confirm（「确定提交吗」）视为同意——提交前用户已在应用里确认过，或选了自动提交
    w.alert = (message) => void s.alerts.push(String(message))
    w.confirm = (message) => {
      s.alerts.push(String(message))
      return true
    }
    let timer = 0
    new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void run(), 350)
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
  }
  if (op === 'install') {
    s.profile = profile
    if (arg) s.answers = { ...s.answers, ...arg }
  }
  if (op === 'answer') s.answers = { ...s.answers, ...arg }

  // 金数据新版（jsjform.com）类名带构建哈希，题目块只有 j-field-field_N 稳定
  // 飞书多维表格表单的题目卡片 .base-form-container_card_item（标题、题号与必填星号在卡片里，.bitable-form-item 只包输入区）；Arco / iView / Naive / Semi / Vant 的表单项
  const BOX = '[topic], .field.ui-field-contain, section.question, .question, [data-question-id], .ant-form-item, .form-field, [data-field-id], [class*="j-field-field_"], .el-form-item, .t-form__item, .arco-form-item, .ivu-form-item, .n-form-item, .semi-form-field, .van-field, .base-form-container_card_item, .form-group, .form-item'
  const TITLE = '.topichtml, .field-label, .question-main-title, .question-title, .ant-form-item-label, .el-form-item__label, .t-form__label, .form-label, .control-label, legend, label, h1, h2, h3, h4, h5, [class*="title"], [class*="label"]'
  const TEXT = 'input:not([type]), input[type=text], input[type=tel], input[type=email], input[type=number], input[type=search], input[type=url], input[type=date], input[type=time], input[type=datetime-local], input[type=month], textarea, [contenteditable="true"], [contenteditable=""]'
  // 上传题里的输入框（飞书附件、文件名）不算填空
  const UPLOAD = '[class*="upload" i], [class*="attach" i]'
  // 真是上传区才算：里面有文件框或带 upload 类名（飞书附件题的标题外层类名也带 Attachment，那不是上传区）
  const inUpload = (el) => {
    for (let u = el.closest(UPLOAD); u; u = u.parentElement && u.parentElement.closest(UPLOAD)) if (u.matches('[class*="upload" i]') || u.querySelector('input[type=file]')) return true
    return false
  }
  // 量表 / 评分的格子：问卷星量表与矩阵（a.rate-off，选中变 rate-on，文字在 title 里）、各组件库的星级
  const RATE = '.rate-off, .rate-on, .ant-rate-star, .el-rate__item, .t-rate__item, .arco-rate-character, .ivu-rate-star, .n-rate__item, .semi-rating-star, .van-rate__item'
  const OPTION = `.ui-radio, .ui-checkbox, [role=radio], [role=checkbox], .ant-radio-wrapper, .ant-checkbox-wrapper, .ant-radio-button-wrapper, .t-radio, .t-checkbox, .t-radio-button, .el-radio, .el-checkbox, .el-radio-button, .el-checkbox-button, .arco-radio, .arco-checkbox, .arco-radio-button, .ivu-radio-wrapper, .ivu-checkbox-wrapper, .n-radio, .n-radio-button, .n-checkbox, .semi-radio, .semi-checkbox, .van-radio, .van-checkbox, ${RATE}, label`
  const OPTION_CLASS = OPTION.replace(/, label$/, '')
  const MULTI = '.ui-checkbox, [role=checkbox], .ant-checkbox-wrapper, .t-checkbox, .el-checkbox, .el-checkbox-button, .arco-checkbox, .ivu-checkbox-wrapper, .n-checkbox, .semi-checkbox, .van-checkbox'
  // 日期 / 时间选择器的输入框：照填空题填，应用里给日期框
  const PICKER = '.ant-picker, .el-date-editor, .t-date-picker, .t-time-picker, .arco-picker, .ivu-date-picker, .n-date-picker, .semi-datepicker'
  const DROPDOWN = '.ant-select, .el-select, .t-select, .arco-select, .ivu-select, .n-select, .semi-select, [role=combobox], [aria-haspopup="listbox"]'
  const DROP_ITEM = '.ant-select-item-option, .el-select-dropdown__item, .t-select-option, .arco-select-option, .ivu-select-item, .n-base-select-option, .semi-select-option, [role=option]'
  const DROP_VALUE = '.ant-select-selection-item, .el-select__selected-item, .t-select__single, .arco-select-view-value, .ivu-select-selected-value, .n-base-selection-label, .semi-select-selection-text'
  const CAPTCHA = 'iframe[src*="captcha" i], #tcaptcha_transform, #tCaptchaDyMainWrap, [id*="captcha" i], [class*="captcha" i], #nc_1_wrapper, .geetest_panel, .geetest_holder, .yidun_popup, #SM_POP, .sm-pop'
  const SUBMIT = '#ctlNext, #submit_button, #submitbtn, .submitbtn, .btn-submit, button[type=submit], input[type=submit]'
  const SUBMIT_WORDS = /^(提\s*交|提交问卷|提交答卷|提交表单|确认提交|确定提交|立即提交|立即报名|提交报名|报\s*名|交\s*卷|submit|send)$/i
  const NEXT = '#divNext, .next-page, .btn-next'
  const NEXT_WORDS = /^(下一页|下一步|next)$/i

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim()
  const norm = (t) => clean(t).toLowerCase().replace(/[\s,，.。:：;；、*＊()（）[\]【】\-_/]/g, '')
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const editable = (el) => el.matches('[contenteditable="true"], [contenteditable=""]')
  const KNOWN_SELECT = '.ant-select, .el-select, .t-select, .arco-select, .ivu-select, .n-select, .semi-select, .ant-cascader-picker, .el-cascader'
  // 问卷星的日期题是只读输入框（点开日历选），verify 写着「日期」，值照样能写进去
  const wjxDate = (el) => el.readOnly && /日期|时间/.test(el.getAttribute('verify') || '')
  // 可编辑区（飞书多维表格表单、腾讯文档的富文本框）嵌套时只认最外层；下拉组件里的搜索框不算填空
  const isText = (el) =>
    el.matches(TEXT) &&
    !inUpload(el) &&
    !el.closest(KNOWN_SELECT) &&
    (editable(el) ? !el.parentElement.closest('[contenteditable="true"], [contenteditable=""]') : (!el.readOnly || wjxDate(el)) && !el.disabled)
  const textValue = (el) => (editable(el) ? el.innerText.replace(/\n+$/, '') : el.value)
  // 带联想的输入框（问卷网的邮箱框）外层也是 role=combobox，按输入框算，不当下拉
  const autocomplete = (el) => el.matches('[role=combobox], [aria-haspopup="listbox"]') && !el.matches(KNOWN_SELECT) && [...el.querySelectorAll(TEXT)].some(isText)
  const dropOf = (box) => [...box.querySelectorAll(DROPDOWN)].find((el) => !autocomplete(el)) || null
  // 上传题的文件框算控件（题目要列出来，在网页里传），上传组件里的其他输入框不算
  const controls = (root) =>
    [...root.querySelectorAll(`${TEXT}, select, input[type=radio], input[type=checkbox], input[type=file], [role=radio], [role=checkbox], ${RATE}, ${DROPDOWN}`)].filter(
      (el) => (el.matches('input[type=file]') || !inUpload(el)) && !autocomplete(el) && !(editable(el) && el.parentElement.closest('[contenteditable="true"], [contenteditable=""]'))
    )

  const titleOf = (box) => {
    for (const el of box.querySelectorAll(TITLE)) {
      if (el.querySelector('input, select, textarea') || el.closest(OPTION_CLASS) || inUpload(el) || el.closest('.ui-controlgroup, .ant-radio-group, .question-options')) continue
      const t = clean(el.textContent)
      // 只有题号（飞书把「3」单独放一个元素）的不算，接着找
      if (t && display(t)) return t.slice(0, 80)
    }
    const copy = box.cloneNode(true)
    // 上传区的「粘贴或拖拽至这里上传」不是标题
    ;[...copy.querySelectorAll(UPLOAD)].filter(inUpload).forEach((n) => n.remove())
    copy.querySelectorAll(`input, select, textarea, [contenteditable="true"], [contenteditable=""], ${OPTION}, ${DROPDOWN}`).forEach((n) => n.remove())
    return clean(copy.textContent).slice(0, 80)
  }
  const display = (t) =>
    clean(t.replace(/^\s*(第?\s*\d+\s*[题.、．:：)）]?|Q\d+[.:：]?)\s*/i, '').replace(/[*＊]/g, '').replace(/必填|选填/g, '').replace(/[，,、;；]\s*([）)])/g, '$1').replace(/[（(]\s*[）)]/g, ''))
  const required = (box, title) =>
    !!box.querySelector('.req, .required, .is-required, .ant-form-item-required, .question-required, .t-form__label--required, .arco-form-item-label-required-symbol, .ivu-form-item-required, [class*="_required"], [class*="requiredSign"], [class*="required-mark" i], [aria-required="true"], [required]') ||
    box.getAttribute('req') === '1' ||
    // 星号写在题号旁（飞书「*3」，题号可能在题目块里，也可能是紧挨着的前一个元素）
    /^[\s\d.、]*[*＊]/.test(box.textContent) ||
    (!!box.previousElementSibling && /^[\s\d.、]*[*＊][\s\d.、]*$/.test(box.previousElementSibling.textContent)) ||
    /[*＊]|必填/.test(title)

  // 题目块里没有标题（form.zju.edu.cn：标题在外层 comBoxName，Ant 的 form-item 只包输入框）时往上提到只含这一题的外层
  const lift = (box) => {
    let node = box
    const count = controls(box).length
    while (!titleOf(node) && node.parentElement && node.parentElement !== document.body && controls(node.parentElement).length === count && node.parentElement.textContent.length < 600) node = node.parentElement
    return node
  }
  // 题目容器：已知的题目块取最内层；不在任何题目块里的控件往上找到只含这一题的祖先
  const boxes = () => {
    const known = [...document.querySelectorAll(BOX)].filter(visible)
    const inner = known.filter((b) => !known.some((o) => o !== b && b.contains(o)) && controls(b).length > 0).map(lift)
    const list = [...new Set(inner)]
    for (const el of controls(document.body)) {
      if (!visible(el) && !el.matches('input[type=radio], input[type=checkbox]')) continue
      if (list.some((b) => b.contains(el))) continue
      let node = el
      // 同一题的控件：同名的原生框，或同一个 radiogroup / 评分组里的自绘选项
      const group = el.closest('[role=radiogroup], [role=group], .ant-rate, .el-rate, .t-rate, .arco-rate, .ivu-rate, .n-rate, .semi-rating, .van-rate')
      const mine = (c) => c === el || (!!el.name && c.name === el.name) || (!!group && group.contains(c))
      while (node.parentElement && node.parentElement !== document.body && controls(node.parentElement).every(mine) && node.parentElement.textContent.length < 600) node = node.parentElement
      node = lift(node)
      if (visible(node) && !list.includes(node)) list.push(node)
    }
    return list
  }
  // 每题的键：标题规范化，同名的按出现顺序加序号；页面重渲染、刷新后不变，应用里填的答案按它对回去
  const keyed = () => {
    const count = {}
    return boxes().map((box) => {
      const title = titleOf(box)
      const base = norm(display(title)) || 'q'
      count[base] = (count[base] || 0) + 1
      return { box, title, key: count[base] > 1 ? `${base}#${count[base]}` : base }
    })
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
      const sc = score(optText(el) || el.value, targets)
      if (sc > top || (sc === top && sc > 0 && optText(el).length < optText(hit).length)) {
        hit = el
        top = sc
      }
    }
    return hit
  }
  // 应用里选的答案就是页面上的选项文字，按规范化后完全相同来找
  const exact = (items, label) => items.find((el) => norm(optText(el) || el.value) === norm(label)) || null

  const setText = (el, value) => {
    // 可编辑区：聚焦、全选后按输入法插入，编辑器（飞书、腾讯文档）才会更新自己的状态；不认时直接改文字
    if (editable(el)) {
      el.focus()
      document.execCommand('selectAll', false)
      document.execCommand('insertText', false, value)
      if (textValue(el) !== value) {
        el.textContent = value
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
      }
      el.blur()
      return
    }
    // 日期选择器（Ant / Element……）输入后要回车或失焦才认；React 的 onBlur 听的是 focusout
    const picker = !!el.closest(PICKER)
    if (picker) for (const type of ['focus', 'focusin']) el.dispatchEvent(new FocusEvent(type, { bubbles: type === 'focusin' }))
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true }))
    if (picker) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    for (const type of ['keyup', 'blur']) el.dispatchEvent(new Event(type, { bubbles: true }))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  }
  // 应用里日期时间框给的是「2026-11-05T20:00」，选择器与问卷星要空格
  const fit = (el, value) => (el.closest(PICKER) || wjxDate(el) ? value.replace(/^(\d{4}-\d{2}-\d{2})T/, '$1 ') : value)
  const inputOf = (opt) => {
    if (opt.matches('input')) return opt
    const inner = opt.querySelector('input[type=radio], input[type=checkbox]')
    if (inner) return inner
    const target = opt.htmlFor && document.getElementById(opt.htmlFor)
    return target && target.matches('input[type=radio], input[type=checkbox]') ? target : null
  }
  const checked = (opt) => {
    const input = inputOf(opt)
    if (input) return input.checked
    const role = opt.matches('[role=radio], [role=checkbox]') ? opt : opt.querySelector('[role=radio], [role=checkbox]')
    if (role && role.hasAttribute('aria-checked')) return role.getAttribute('aria-checked') === 'true'
    return (
      /(^|[\s_-])(checked|is-checked|active|selected|rate-on)(\s|$)/.test(typeof opt.className === 'string' ? opt.className : '') ||
      !!opt.querySelector('.is-checked, .checked, .rate-on, [class*="-checked"]:not([class*="unchecked"])')
    )
  }
  // 选项文字：自己的文字，否则 aria-label / title（问卷星量表、矩阵的格子只在 title 里写「很满意」），
  // 再否则表格首行同一列的文字（矩阵题的格子里只有一个圆圈），最后是第几颗星 / 分值
  const optText = (el) => {
    const own = clean(el.textContent)
    if (own) return own
    const tagged = el.matches('[title], [aria-label]') ? el : el.querySelector('[title], [aria-label]')
    const tip = tagged ? clean(tagged.getAttribute('aria-label') || tagged.getAttribute('title')) : ''
    if (tip) return tip
    const cell = el.closest('td, th')
    const table = cell && cell.closest('table')
    const head = table && table.rows[0]
    if (head && head !== cell.parentElement && head.cells[cell.cellIndex]) {
      const t = clean(head.cells[cell.cellIndex].textContent)
      if (t) return t
    }
    const pos = el.matches('[aria-posinset]') ? el : el.querySelector('[aria-posinset]')
    if (pos) return pos.getAttribute('aria-posinset')
    const scored = el.matches('[val], [dval]') ? el : el.querySelector('[val], [dval]')
    return scored ? clean(scored.getAttribute('val') || scored.getAttribute('dval')) : ''
  }
  // 点选项：真实的框点外层（label 会转给框）；自绘的点最里面的那个（问卷星量表的 a、星级的 role=radio），事件冒泡给外层也收得到
  // 只包着圆圈的格子（矩阵）点了不转给单选框，没选上就直接点框
  const press = (opt) => {
    const input = inputOf(opt)
    const inner = input ? null : opt.querySelector('.rate-off, .rate-on, [role=radio], [role=checkbox]')
    ;(inner || opt).click()
    if (input && input.type === 'radio' && !input.checked && !opt.matches('label')) input.click()
  }
  // 选项：已知的选项类名，或包着单选 / 多选框（或用 for 指向它）的 label；题目标题的 label 不算
  const CHOICE = `${OPTION_CLASS}, input[type=radio], input[type=checkbox]`
  const unit = (el, box) => {
    let node = el
    for (let i = 0; i < 3 && !clean(node.textContent); i++) {
      const up = node.parentElement
      if (!up || up === box || up.querySelectorAll(CHOICE).length > (node.matches(CHOICE) ? 1 : node.querySelectorAll(CHOICE).length)) break
      node = up
    }
    return node
  }
  const optionsOf = (box) => {
    // 没有外层类名、也没被 label 包着的原生框（矩阵格子里只有一个圆圈）也算，往上提到它所在的格子
    const units = [...new Set([...box.querySelectorAll(`${OPTION}, input[type=radio], input[type=checkbox]`)].map((el) => unit(el, box)))].filter(
      (el) => optText(el) && !inUpload(el) && (!el.matches('label') || el.matches(OPTION_CLASS) || !!inputOf(el)) && el.querySelectorAll(CHOICE).length <= 1
    )
    return units.filter((u) => !units.some((o) => o !== u && u.contains(o)))
  }
  const isMulti = (opts) => opts.some((o) => o.matches(MULTI) || !!o.querySelector('[role=checkbox], input[type=checkbox]') || (inputOf(o) && inputOf(o).type === 'checkbox'))
  // 矩阵题：几行共用同一组选项（问卷星矩阵量表 / 矩阵单选、腾讯问卷矩阵）。原生框按 name 分行，自绘的按所在表格行 / radiogroup 分；
  // 每行选项个数与文字都一样才算，免得把排成表格的普通选择题拆开
  const rowsOf = (box, options) => {
    if (options.length < 4) return null
    const rows = new Map()
    for (const o of options) {
      const input = inputOf(o)
      const row = input && input.name ? input.name : o.closest('tr, [role=radiogroup]')
      if (!row || (typeof row !== 'string' && (row === box || !box.contains(row)))) return null
      if (!rows.has(row)) rows.set(row, [])
      rows.get(row).push(o)
    }
    const list = [...rows.values()]
    const labels = list[0].map(optText).join('|')
    if (list.length < 2 || list.some((cells) => cells.length < 2 || cells.map(optText).join('|') !== labels)) return null
    return list.map((cells) => ({ cells, label: rowLabel(box, cells) }))
  }
  // 矩阵每行的说明：行里不含选项的那一格（首列），否则紧挨着的上一行（问卷星手机版把行标题单独放一行）
  const rowLabel = (box, cells) => {
    let row = cells[0]
    while (row.parentElement && row.parentElement !== box && !cells.every((c) => row.contains(c))) row = row.parentElement
    const named = row.getAttribute('aria-label')
    if (named) return clean(named)
    const own = [...row.children].find((c) => !c.matches(CHOICE) && !c.querySelector(CHOICE) && clean(c.textContent))
    if (own) return clean(own.textContent)
    const prev = row.previousElementSibling
    return prev && !prev.querySelector(CHOICE) ? clean(prev.textContent) : ''
  }
  // 按选项文字选：多选逐项勾 / 取消；单选点要的那项（星级会把它前面的也点亮，按最后一个亮的算现值）
  const chooseIn = (box, opts, list, multi) => {
    const want = new Set(list.map(norm))
    if (multi) {
      for (const o of opts) tick(box, o, want.has(norm(optText(o))))
      return
    }
    const target = opts.find((o) => want.has(norm(optText(o))))
    if (!target) return
    const last = opts.filter(checked).pop()
    if (last !== target && (inputOf(target) || !s.done.has(target) || last)) press(target)
    s.done.set(target, true)
    if (inputOf(target)) s.placed.push([box, target, null])
  }
  const valueIn = (opts, multi) => {
    const on = opts.filter(checked).map(optText)
    return multi ? on : on.pop() || ''
  }
  // 「其他：____」这类选项里的输入框不算填空题
  const textsOf = (box) => [...box.querySelectorAll(TEXT)].filter((el) => visible(el) && isText(el) && !el.closest(OPTION))
  // 多项填空每个空的说明：自带的提示，否则往上几层找紧挨着的、不含输入框的前一个元素（问卷星矩阵填空的说明在同一行前一格 td 里）
  const blankLabel = (el) => {
    const own = el.getAttribute('aria-label') || el.placeholder
    if (own) return clean(own)
    for (let node = el, i = 0; node && i < 4; node = node.parentElement, i++) {
      const prev = node.previousElementSibling
      if (prev && !prev.querySelector('input, textarea, select') && clean(prev.textContent)) return clean(prev.textContent)
    }
    return ''
  }
  // 矩阵题每行都选了才算填了
  const filledBox = (box) => {
    const rows = rowsOf(box, optionsOf(box))
    return rows ? rows.every((row) => row.cells.some(checked)) : anyFilled(box)
  }
  const anyFilled = (box) =>
    [...box.querySelectorAll(TEXT)].some((el) => textValue(el).trim()) ||
    [...box.querySelectorAll('select')].some((el) => el.selectedIndex > 0 || (el.value && !/^-?\d$/.test(el.value) && el.value !== '')) ||
    [...box.querySelectorAll('input[type=radio], input[type=checkbox]')].some((el) => el.checked) ||
    [...box.querySelectorAll(OPTION)].some(checked) ||
    !!box.querySelector('.ant-select-selection-item, .el-select__selected-item')

  const touched = (box) => s.touched.some((t) => box.contains(t))
  // 文本框的值与我们填的不同就重填：页面水合、到点刷新后受控输入框会被页面清空（金数据新版实测），只看「填过」会误报已填。
  // 页面自己带出来的值（form.zju.edu.cn 按登录账号填好学工号、姓名）不按资料改；用户在应用里给的答案（force）照填
  const putText = (box, el, given, force = false) => {
    const value = fit(el, given)
    if (!force && !s.done.has(el) && textValue(el).trim()) s.pagePrefilled.add(el)
    if (!force && s.pagePrefilled.has(el)) return
    if (force) s.pagePrefilled.delete(el)
    if (!touched(box) && norm(textValue(el)) !== norm(value)) setText(el, value)
    s.placed.push([box, el, value])
  }
  const choose = (select, option) => {
    if (select.value === option.value) return
    select.value = option.value
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    if (w.jQuery) w.jQuery(select).trigger('change')
  }
  // 点选项：有真实单选 / 多选框时按它的 checked 判断，被页面清掉可以再点；只靠类名的自绘选项只点一次，免得多选被来回切换
  const tick = (box, option, on) => {
    const input = inputOf(option)
    if (checked(option) !== on && (input || !s.done.has(option))) {
      press(option)
      if (input && input.checked !== on && !option.matches('label')) input.click()
    }
    s.done.set(option, true)
    if (input && on) s.placed.push([box, option, null])
  }
  // 自绘下拉：按下展开，等选项层出来；返回可见的选项
  const openDrop = async (drop) => {
    const trigger = drop.querySelector('.ant-select-selector, .el-select__wrapper, .el-input, .t-input') || drop
    for (const type of ['mousedown', 'mouseup', 'click']) trigger.dispatchEvent(new MouseEvent(type, { bubbles: true }))
    for (let i = 0; i < 10; i++) {
      await sleep(80)
      const items = [...document.querySelectorAll(DROP_ITEM)].filter(visible)
      if (items.length) return items
    }
    return []
  }
  const closeDrop = () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }
  const dropTo = async (drop, find) => {
    const option = find(await openDrop(drop))
    if (!option) {
      closeDrop()
      return false
    }
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    option.click()
    return true
  }

  // 按资料填一题：返回 true 已填 / false 有字段但没对上 / null 不认识
  const fillBox = async (box, title) => {
    const mine = !touched(box)
    const texts = textsOf(box)
    // 多项填空：一题里几个空，各按自己旁边的文字认
    if (texts.length > 1) {
      let any = null
      for (const el of texts) {
        const label = blankLabel(el)
        const field = s.match(label)
        const value = field ? valueOf(field) : ''
        if (field && !value) s.lacking.push(field)
        if (!value) continue
        putText(box, el, value)
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
    // 认出了题，资料里却没有这一项：记下来，开放后在应用里问用户
    if (!value) {
      s.lacking.push(field)
      return false
    }
    const record = () => {
      s.filled.push({ title: display(title), field })
      return true
    }
    if (texts.length === 1) {
      putText(box, texts[0], value)
      s.done.set(texts[0], field)
      return record()
    }
    const targets = wants(field, value)
    const select = [...box.querySelectorAll('select')].find((el) => !el.disabled)
    if (select) {
      if (s.done.has(select) && !mine) return record()
      const option = pick([...select.options].filter((o) => o.index > 0 || o.value), targets)
      if (!option) return false
      choose(select, option)
      s.done.set(select, field)
      s.placed.push([box, select, option.value])
      return record()
    }
    const options = optionsOf(box)
    if (rowsOf(box, options)) return null
    if (options.length) {
      const option = pick(options, targets)
      if (!option) return false
      if (mine) tick(box, option, true)
      return record()
    }
    const drop = dropOf(box)
    if (drop) {
      if (s.done.has(drop) && (!mine || filledBox(box))) return record()
      if (!(await dropTo(drop, (items) => pick(items, targets)))) return false
      s.done.set(drop, field)
      return record()
    }
    return false
  }

  // 按应用里给的答案填一题（题目键 → 文字，多选为选项文字数组；多项填空的各空为「键/序号」）。返回是否填了
  const answerBox = async (box, key) => {
    const texts = textsOf(box)
    const options = optionsOf(box)
    const select = [...box.querySelectorAll('select')].find((el) => !el.disabled)
    const rows = !select && rowsOf(box, options)
    if (rows) {
      // 矩阵题各行的答案是「键/行序号」
      const multi = isMulti(options)
      let any = false
      rows.forEach(({ cells }, i) => {
        const v = s.answers[`${key}/${i}`]
        if (v === undefined) return
        chooseIn(box, cells, (Array.isArray(v) ? v : [v]).filter(Boolean), multi)
        any = true
      })
      return any
    }
    if (!select && !options.length && texts.length > 1) {
      let any = false
      texts.forEach((el, i) => {
        const v = s.answers[`${key}/${i}`]
        if (typeof v !== 'string') return
        putText(box, el, v, true)
        any = true
      })
      return any
    }
    if (!(key in s.answers)) return false
    const v = s.answers[key]
    const list = (Array.isArray(v) ? v : [v]).filter(Boolean)
    if (select) {
      const option = list.length ? exact([...select.options], list[0]) : null
      if (option) {
        choose(select, option)
        s.placed.push([box, select, option.value])
      }
      return !!option
    }
    if (options.length) {
      chooseIn(box, options, list, isMulti(options))
      return list.length > 0
    }
    const drop = dropOf(box)
    if (drop) {
      if (!list.length) return false
      const current = box.querySelector(DROP_VALUE)
      if (current && norm(current.textContent) === norm(list[0])) return true
      return dropTo(drop, (items) => exact(items, list[0]))
    }
    if (texts.length === 1 && typeof v === 'string') {
      putText(box, texts[0], v, true)
      return !!v
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
      const before = JSON.stringify([s.filled, s.missed, s.lacking])
      const list = keyed()
      s.ranQuestions = list.length
      s.filled = []
      s.missed = []
      s.lacking = []
      s.placed = []
      s.blocked = false
      for (const { box, title, key } of list) {
        // 一题出错不能连累后面的题；应用里答过的题按答案填，不再按资料填
        const lacked = s.lacking.length
        const answered = await answerBox(box, key).catch(() => false)
        const result = answered || (await fillBox(box, title).catch(() => null))
        const missed = result !== true && required(box, title) && !filledBox(box)
        // 认出了题、只是资料里没有：列在「缺资料」里，不算没认出，但同样拦住自动提交
        if (missed && s.lacking.length > lacked) s.blocked = true
        else if (missed) s.missed.push(display(title) || '未命名的题')
      }
      // 多页问卷翻页后前一页的题被隐藏，填过的仍记在 seen 里
      for (const f of s.filled) s.seen.set(`${f.field}|${f.title}`, f)
      s.lacking = [...new Set(s.lacking)]
      if (JSON.stringify([s.filled, s.missed, s.lacking]) !== before) s.changedAt = Date.now()
    } finally {
      s.running = false
      if (s.again) {
        s.again = false
        setTimeout(() => void run(), 0)
      }
    }
  }

  // 应用里用的输入框类型：原生类型；日期选择器、问卷星 verify 写着的格式（日期、手机、邮件、数字）
  const inputType = (el) => {
    if (/^(date|time|datetime-local|month|tel|email|number)$/.test(el.type)) return el.type
    const verify = el.getAttribute('verify') || ''
    const hint = verify + ' ' + (el.placeholder || '')
    if (el.closest(PICKER) || wjxDate(el)) return /时间|time/i.test(hint) ? (/日期|date/i.test(hint) ? 'datetime-local' : 'time') : /月份|month/i.test(hint) && !/日期/.test(hint) ? 'month' : 'date'
    if (/手机/.test(verify)) return 'tel'
    if (/邮件|邮箱/.test(verify)) return 'email'
    if (/数字|整数|小数/.test(verify)) return 'number'
    return undefined
  }
  // 列出当前页全部题目：题型、选项、现在的值、是否必填、认出的字段。自绘下拉要展开一次才读得到选项
  const describe = async () => {
    const list = []
    for (const { box, title, key } of keyed()) {
      const matched = s.match(title)
      const base = { title: display(title) || '未命名的题', required: required(box, title), field: matched || null }
      const texts = textsOf(box)
      const options = optionsOf(box)
      const select = [...box.querySelectorAll('select')].find((el) => !el.disabled)
      const drop = dropOf(box)
      const file = box.querySelector('input[type=file]')
      const rows = !select && rowsOf(box, options)
      if (file && !texts.length && !options.length && !select && !drop) {
        // 上传题：应用里传不了，弹窗里给「在网页中填写」
        list.push({ ...base, key, kind: 'other', options: [], value: file.files && file.files.length ? '已上传' : '' })
      } else if (select) {
        const opts = [...select.options].filter((o) => o.index > 0 || o.value)
        const current = select.options[select.selectedIndex]
        list.push({ ...base, key, kind: 'radio', options: opts.map((o) => clean(o.text)), value: current && opts.includes(current) ? clean(current.text) : '' })
      } else if (rows) {
        const multi = isMulti(options)
        rows.forEach(({ cells, label }, i) => {
          list.push({ ...base, key: `${key}/${i}`, title: `${base.title} ${label ? display(label) : i + 1}`, kind: multi ? 'checkbox' : 'radio', options: cells.map(optText), value: valueIn(cells, multi), field: null })
        })
      } else if (options.length) {
        const multi = isMulti(options)
        list.push({ ...base, key, kind: multi ? 'checkbox' : 'radio', options: options.map(optText), value: valueIn(options, multi) })
      } else if (drop) {
        const labels = [...new Set((await openDrop(drop)).map((el) => clean(el.textContent)).filter(Boolean))]
        closeDrop()
        const current = box.querySelector(DROP_VALUE)
        list.push({ ...base, key, kind: labels.length ? 'radio' : 'other', options: labels, value: current ? clean(current.textContent) : '' })
      } else if (texts.length > 1) {
        texts.forEach((el, i) => {
          const label = blankLabel(el)
          list.push({ ...base, key: `${key}/${i}`, title: `${base.title} ${label ? display(label) : i + 1}`, kind: 'text', input: inputType(el), options: [], value: textValue(el), field: s.match(label) || null })
        })
      } else if (texts.length === 1) {
        list.push({ ...base, key, kind: texts[0].tagName === 'TEXTAREA' || (editable(texts[0]) && texts[0].offsetHeight > 60) ? 'textarea' : 'text', input: inputType(texts[0]), options: [], value: textValue(texts[0]) })
      } else {
        list.push({ ...base, key, kind: 'other', options: [], value: filledBox(box) ? '已填' : '' })
      }
    }
    return list.map((q) => ({ ...q, filled: Array.isArray(q.value) ? q.value.length > 0 : !!q.value.trim() }))
  }

  const button = (sel, words) =>
    [...document.querySelectorAll(sel)].find(visible) ||
    [...document.querySelectorAll('button, a, [role=button], div[class*="btn"], span[class*="btn"]')].find((b) => visible(b) && words.test(clean(b.textContent)))

  const state = () => {
    const text = clean(document.body ? document.body.innerText : '').slice(0, 3000)
    const list = keyed()
    const questions = list.length
    // 兜底：题目数和上次填写时不一样（倒计时到点换出题目、整页被替换，监听没赶上），
    // 或填过的值被页面清掉（水合重置受控输入框，改 value 不触发 DOM 变化），再填一遍；值始终放不进去的（页面拒收）最多重试 20 次
    const drifted = s.drifts < 20 && s.placed.some(([box, el, value]) => el.isConnected && !touched(box) && (value === null ? !checked(el) : norm(el.matches('select') ? el.value : textValue(el)) !== norm(value)))
    if (op === 'state' && !s.running && (questions !== s.ranQuestions || drifted)) {
      if (drifted) s.drifts++
      void run()
    }
    // 页面写着的开放时刻（「开放时间为 2026-11-02 19:28」），立即订阅的也能显示倒计时
    // 问卷星写在后面：「此问卷将于2026-11-02 21:10（北京时间）开放」
    // 年份可省（「11月5日 20:00 开始」），时刻可写成「20点00分」
    const date = /(?:(\d{4})[-/年.])?(\d{1,2})[-/月.](\d{1,2})[日号]?\s*(?:周.|星期.)?\s*(\d{1,2})[:：时点](\d{2})(?:[:：分](\d{2}))?/
    const when = new RegExp('(?:开放|开始|开启|开抢)[^0-9]{0,12}' + date.source).exec(text) || new RegExp(date.source + '[^0-9]{0,16}(?:开放|开始|开启|开抢)').exec(text)
    const opens = () => {
      const now = new Date()
      const at = new Date(when[1] ? +when[1] : now.getFullYear(), +when[2] - 1, +when[3], +when[4], +when[5], +(when[6] || 0))
      // 没写年份、算出来早已过去半年的是明年
      if (!when[1] && now - at > 180 * 864e5) at.setFullYear(at.getFullYear() + 1)
      return at.toISOString()
    }
    return {
      title: clean(document.title).replace(/\s*[-_|｜—]\s*(金数据|问卷星|腾讯问卷|问卷网|jinshuju|wjx)\s*$/i, ''),
      page: list.map((q) => q.key).join('|'),
      filled: [...s.seen.values()],
      missed: s.missed,
      lacking: s.lacking,
      blocked: s.missed.length > 0 || !!s.blocked,
      questions,
      submitReady: !!button(SUBMIT, SUBMIT_WORDS),
      nextPage: !!button(NEXT, NEXT_WORDS),
      captcha: [...document.querySelectorAll(CAPTCHA)].some((el) => visible(el) && el.getBoundingClientRect().height > 30),
      // 要先登录才能填：页面这么写，且没有题或文字框全是禁用的（腾讯文档收集表没登录时只给只读预览）
      needLogin:
        /(登录|登陆)后(才能|方可|即可|再)?(填写|作答|提交|参与|报名)|请先(登录|登陆)/.test(text) &&
        (questions === 0 || (() => {
          const boxes = list.flatMap(({ box }) => [...box.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=file]), textarea')])
          return boxes.length > 0 && boxes.every((el) => el.disabled)
        })()),
      done: (questions === 0 || s.submittedAt > 0) && /提交成功|填写成功|报名成功|感谢您?的?(参与|填写|作答|支持|提交|配合)|答卷已(经)?提交|已提交|提交完成|提交完毕|已收到|已记录|您已完成|thank you|response (has been )?recorded/i.test(text),
      notOpen: questions === 0 && /尚未开始|还未开始|未开始|尚未开放|暂未开放|未开放|尚未开启|暂未开启|未开启|即将开始|暂停收集|暂停回收|暂停填写|已暂停|未到.{0,6}时间|尚未发布|未发布|[未不]在.{0,6}时间范围|将于.{0,30}(开放|开始|开启)|距离?开始还有|not (yet )?(started|open)/i.test(text),
      // 停止收集、已截止、已经填过：不会再开放，不用等
      ended: questions === 0 ? (/已?停止(收集|回收|填写|报名)|已停止|已结束|已截止|截止收集|结束收集|已关闭|已过期|不再接受|名额已满|已满员|人数已满|报名已满|已报满|已达上限|已达到上限|已抢完|已经?填写过|已提交过|已参与过|不能重复|只能填写一次|每人限填/.exec(text) || [null])[0] : null,
      opensAt: questions === 0 && when ? opens() : null,
      // 点过提交后页面标出的校验错误（必填没填、格式不对）
      invalid: s.submittedAt > 0 && [...document.querySelectorAll('.errorMessage, .question-error, .ant-form-item-has-error, .ant-form-item-explain-error, .el-form-item__error, .is-error, .t-is-error, .t-form__item--error, .arco-form-item-status-error, .ivu-form-item-error, .n-form-item-feedback--error, .semi-form-field-error-message, .van-field__error-message, [class*="error-message" i], [class*="errorMsg"], [aria-invalid="true"]')].some(visible),
      alerts: s.alerts.slice(-3),
      // 值被清掉、还没重填好时不算填稳，免得自动提交交出空表
      stableFor: drifted ? 0 : Date.now() - s.changedAt,
      running: s.running,
      submittedAt: s.submittedAt
    }
  }

  if (op === 'submit') {
    // 多页问卷没到最后一页时点下一页
    const target = button(SUBMIT, SUBMIT_WORDS)
    const next = button(NEXT, NEXT_WORDS)
    if (next && !target) next.click()
    else if (target) {
      s.submittedAt = Date.now()
      target.click()
    }
    return state()
  }
  if (op === 'describe') return describe()
  if (op === 'install' || op === 'answer') return run().then(state)
  return state()
}
