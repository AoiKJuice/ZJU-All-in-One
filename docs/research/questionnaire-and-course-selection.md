# 调研：问卷自动填写（抢票）与选课工具

2026-10-31。只做研究，未写代码、未调用任何写接口。

---

## 一、问卷自动填写（抢票）

### 目标

用户贴一个问卷地址，应用自动填好学号、姓名、班级、专业、校区、电话等信息，并在开放时提交。常见用途是活动报名、讲座和演出抢票。

### 主流平台

| 平台 | 浙大场景中的常见度 | 技术特点 | 主要障碍 |
|---|---|---|---|
| 问卷星 wjx.cn | 最高，社团、学院活动报名大多用它 | 普通多页表单。题目在 `.field` / `.topichtml`，填空是 `input` / `textarea`，选择题是自绘的 `.ui-radio` / `.ui-checkbox`。提交接口 `joinnew/processjq.ashx` 带加密参数（`jqsign`、`ktimes`、开始时间等） | 发起方可设定时开始和结束、配额（名额）、**每页最短作答时间**，以及智能验证（滑块）；部分问卷要求微信登录或限制填写次数 |
| 腾讯问卷 wj.qq.com | 中 | 单页应用，题目由前端渲染 | 常要求 QQ 或微信登录，可能弹腾讯防水墙验证码 |
| 金数据 jinshuju.net | 中 | 字段带 label，结构清晰 | 发起方可开验证码；是否支持链接预填未查到官方说明 |
| 飞书问卷 / 表单、问卷网 | 低 | 单页应用 | 多数要求登录 |

### 建议方案：内嵌页面填写，不直接调接口

直接调用各平台的提交接口很脆弱：问卷星的提交参数是加密的，各平台改版就会失效，而且容易被判为机器提交。更稳妥的做法是：

1. **在应用里开窗加载问卷页面**。用持久分区保存微信或 QQ 扫码后的登录态。
2. **注入一个通用填写脚本**，按题目标题匹配关键词：
   - 学号：「学号 / 工号 / 学工号」
   - 姓名
   - 班级：「班级 / 行政班」
   - 专业、学院 / 院系、年级
   - 校区：选择题，按选项文字匹配紫金港、玉泉、西溪、华家池、之江、海宁、舟山
   - 手机 / 电话 / 联系方式、邮箱、宿舍
   
   给 input 赋值后要派发 `input` / `change` 事件，React 和 Vue 页面才会认。选择题点击匹配到的选项元素。匹配不上的题目留空并高亮，让用户自己填。
3. **用户确认后提交**。也可以设定开放时刻自动提交：
   - 用平台响应头的 `Date` 校准本地时钟。
   - 到点刷新页面、填写，再提交。
   - 问卷设了最短作答时间时，要按设定的时长停留后再提交，否则会被拒。
4. **遇到验证码交给用户完成**，做法与 PTA 登录相同。不尝试绕过。

### 个人信息从哪来

- 教务课表接口 `kbcx/xskbcx_cxXsKb.html` 的响应里本来就有 `xh` 学号、`xm` 姓名、`xzb` 行政班、`xy` 学院、`zy` 专业，现有 `zdbk.loadSchedule()` 已经取到，只是没用上。
- 校区、手机号、邮箱、宿舍需要用户在设置里填一次，存在本机。手机号用 safeStorage 加密。

### 风险与边界

- 只替用户本人填写本人的信息、每份问卷提交一次，这和手动填写没有本质区别。**不做多账号、批量刷票和随机答题**，这些违反平台条款，问卷星帮助文档也明确把作答时间控制、配额当作质量控制手段。
- 定时自动提交仍可能被发起方的最短作答时间或智能验证挡住，界面要如实显示「需要验证 / 提交被拒」。
- MCP 只开放「打开并填写」，提交按现有规则必须先经应用内确认。

### 工作量估计

通用填写脚本、问卷星适配和设置页个人信息约 2–3 天。腾讯问卷、金数据各约 1 天。

---

## 二、选课工具

### 浙大选课的实际规则（2026 年）

| | 常规选课（第一至第三轮） | 低学分定点选课（低定） | 补选申请 |
|---|---|---|---|
| 入口 | 选课管理 → 自主选课 | 同左 | 选课管理 → 补退选申请 |
| 分配 | 阶段截止后统一筛选，相当于摇号；**先后无意义** | 有余量的班先到先得，结束后统一确认 | 院系审核，优先群体，其余随机 |
| 资格 | 无 | 已选、待定、补选申请学分合计 ≤ 22 才能参加，选到超过 22 分为止（服务器校验） | 无学分门槛 |

低定期间退课释放名额的规则（第三轮通知）：

| 退课时间 | 名额释放时间 |
|---|---|
| 每日 18:00 前退课 | 当日 18:00–24:00 随机释放 |
| 第一天、第二天 18:00 后退课 | 次日 18:00–24:00 释放 |
| 第三天 18:00 后退课 | 不再释放给低定，留给补选 |

所以「订阅课程、有余量就自动选」只在低定阶段有意义，有效时间窗基本是每天 18:00–24:00。常规轮次是统一筛选，抢先提交没有用；工具在常规轮次能做的是更好地展示课程、帮助排志愿。

### 接口（正方教务的浙大定制版）

主要依据开源项目 campus-agent 的 `core/zju/lib/zdbk/README.md` 与 `references/zdbk-selection.md`，作者在 2026-09 以登录态实测，并读过当期前端脚本 `zzxkghb.js`、`xsbtx.js`。注意它没有许可证，只能参考接口事实，不能复制代码。

功能 URL 都带 `?gnmkdm=<模块码>&su=<学号>`。列表接口是 jqGrid 分页表单（`queryModel.showCount` / `currentPage`）。会话失效返回非标准状态码 901 或 922。

| 用途 | 接口（前缀 `jwglxt/`） | 说明 |
|---|---|---|
| 选课首页 / 上下文 | GET `xsxk/zzxkghb_cxZzxkGhbIndex.html`（N253530） | 隐藏域给学年学期、年级 `nj`、专业 `zydm`、志愿数 `xkzys` |
| 已选志愿 | POST `xsxk/zzxkghb_cxZzxkGhbChoosed.html` | `sxbj` 1 已选上 / 其他 待筛选；`xkzy` 志愿次序、`xkzyfz` 志愿组 |
| 已选学分 | POST `xsxk/zzxkghb_cxZzxkYxxf.html` | `xf9` 总学分、`xf91` 长学期、`xf92` 短学期（低定资格判断用） |
| 按类别列课程 | POST `xsxk/zzxkghb_cxZzxkGhbKcList.html` | 课程行没有学分字段，学分在 `kcxx` 的第二段 |
| 搜索课程 | POST `xsxk/zzxkghb_cxZzxkGhbDdkcList.html` | |
| 教学班 | POST `xsxk/zzxkghb_cxZzxkGhbJxbList.html` | `jsxm` 教师、`sksj` 时间、`skdd` 地点（多值用 `<br>` 分隔），`rs` 余量、`yxrs` 待定人数 |
| **选课（写）** | POST `xsxk/zzxkghb_xkBcZyZzxkGhb.html` | `xn, xq, nj, xkkh, tabname, xkzys`；`tabname` 必须取教学班接口返回的实际值（如 `xkrw2006view`、`tykjxrwb`） |
| 退课（写） | POST `xsxk/zzxkghb_tuikBcZzxkGhb.html` | `xkkh` |
| 志愿排序（写） | POST `xsxk/zzxkghb_xkBcZypxZzxkGhb.html` | `xkkhs`、`zypxs`，每组提交完整的新顺序 |
| 补退选 | `xsbtx/*`（N253540） | 课程搜索、待申请班级（容量 `rl`、已选 `yxrs`、申请数 `bxrs`）、提交 / 删除申请 |
| 培养方案 | POST `pyfagl/pyfaxxcx_cxPyfaxscxIndex.html`（N153020） | 按入学年、学院、专业取方案，含最低毕业学分、核心课 `zyhxkc`；PDF 在 `pyfagl/pyfayl_cxPyfaylPdf.html?id=<jxjhh>` |
| 毕业审核 | POST `bysh/byshck_cxByshzsIndex.html`（N6025） | 培养方案要求的每门课及修读状态（zjuTimeTable 用它列「毕业要求课程」） |

其他学校的正方系统接口名不同（标准版是 `zzxkyzb_cxZzxkYzbPartDisplay`、`zzxkyzbjk_xkBcZyZzxkYzb` 等）。它们的展示思路可以参考：zhengfang-course-selector 是第三方选课前端，zfxk-helper 实现了志愿排序和自动任务。接口本身不能照搬。

### 建议的功能形态

1. **课程浏览**（选课页或课表页的一个视图）：
   - 按类别和关键词搜课。
   - 教学班按教师、时间、地点、余量、待定人数列出。
   - 时间与当前课表冲突的标出来。
   - 待定人数多于余量的提示竞争程度，这对常规轮次最有用。
2. **本专业必修**：用毕业审核接口列出培养方案要求的课程和修读状态（已修 / 在修 / 未修），未修的必修课点一下就能看本学期开了哪些班。比单看培养方案 PDF 直观。
3. **订阅与低定自动选课**：
   - 用户订阅某门课的一个或几个班，并按顺序给出备选。
   - 低定期间，主进程在 18:00–24:00 每 20–40 秒（带随机抖动）查一次余量，其余时间降到每 5 分钟一次；有余量就弹 Windows 通知，或按用户事先授权直接提交。
   - 选上一门立刻重查学分，超过 22 分就停止全部订阅。
   - 写请求不自动重发：超时或结果不明时先查「已选志愿」。
   - 同一账号的写操作串行执行。
4. **MCP 工具**：`search_courses`、`get_sections`、`get_selected`、`get_program_requirements` 归查询组；`subscribe_course` 归界面组；`select_section`、`drop_section` 归提交组，**必须先经应用内确认**，与现有的作业提交一致。

### 风险

- **学校规定**：本次没有查到明令禁止脚本选课的条文，但抢课脚本历来处在灰色地带。campus-agent 的作者明确不实现「到点反复提交」。建议默认只通知、手动一键选，自动提交作为每门课单独授权的选项，并限制频率（不低于 20 秒），避免给教务系统加压。
- **会话互踢**：同一账号在别处登录时，教务会返回 922 把本会话顶掉。长时间轮询要能自动重登，并照顾到用户同时在网页上操作的情况。
- **规则逐学期变化**：低定门槛、释放时间、志愿数（当期首页 `xkzys=1`，并非一直是三志愿）都要实时读取，不能写死。
- **未实测**：上表的写接口都只有前端源码作为证据，campus-agent 也注明退课和排序尚未真实提交验证。要实现，得在下一个选课窗口用真实账号逐个验证，这只能由用户本人操作。

### 工作量估计

课程浏览、本专业必修和查询类 MCP 约 3–4 天，只读，随时可以开发。订阅和低定自动选课约 2 天，但只能在选课窗口期内实测。

---

## 来源

- [Anchorite-no/campus-agent](https://github.com/Anchorite-no/campus-agent)：`core/zju/lib/zdbk/README.md`、`core/zju/references/zdbk-selection.md`（无许可证，只参考事实）
- [Zhangyc0/ZJU-Course-Selection](https://github.com/Zhangyc0/ZJU-Course-Selection)：2021 年的浙大低定抢课脚本，用的是同一个 `zzxkghb_xkBcZyZzxkGhb` 接口
- [ZJU-R/zjuTimeTable](https://github.com/ZJU-R/zjuTimeTable)：毕业审核接口用法
- [shaxiu/ZF_API](https://github.com/shaxiu/ZF_API)、[CodeBoy2006/zfxk-helper](https://github.com/CodeBoy2006/zfxk-helper)、[TimFang4162/zhengfang-course-selector](https://github.com/TimFang4162/zhengfang-course-selector)、[ceilf6/Auto_courseGrabber](https://github.com/ceilf6/Auto_courseGrabber)：其他学校的正方选课实现
- [低学分定点选课通知](https://zdbk.zju.edu.cn/jwglxt/xtgl/xwck_ckLoginNews.html?xwbh=3DC84179347072CDE0632AB3CA0A6CC1)、[选课规则（新生指引）](https://zjuers.com/welcome/course_sys/rules/)
- 问卷星帮助中心：[答题时间控制](https://www.wjx.cn/help/help.aspx?helpid=185)、[配额规则](https://www.wjx.cn/help/help.aspx?helpid=184)
- [ZainCheung/wenjuanxin](https://github.com/ZainCheung/wenjuanxin)、[Zemelee/wjx](https://github.com/Zemelee/wjx)：问卷星页面结构的参考（这些项目用于刷问卷，不采用其做法）
