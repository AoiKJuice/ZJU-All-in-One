# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ZJU All in One：聚合浙江大学学业信息（课表、考试、作业、智云课堂回放）并提供课堂工具（PPT 提取、课堂转写）的桌面应用。核心诉求：**只登录一次统一身份认证**；**主页一屏给出所有必要信息**，板块越少越好。

技术栈：Electron + electron-vite（Vite 8 / rolldown）+ React 19 + TypeScript 7 + Tailwind CSS v4 + motion + zustand。包管理用 npm。

## 常用命令

```bash
npm run dev                  # 开发模式
ZJU_DEMO=1 npm run dev       # 演示数据模式：不登录即可调前端（数据通道全部换成 services/demo.ts）
ZJU_PROFILE=test npm run dev # 另开一套数据目录（zju-all-in-one-test），可与已安装版并行，不撞单实例锁
npm run dist                 # 打包 Windows 安装包 + 便携版到 release/（先设 ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/）
ZJU_DEMO=1 ZJU_DEMO_VIDEO=<本地 mp4> npm run dev # 演示模式下用本地视频调播放器
ZJU_DEBUG=1 npm run dev      # 主进程打印每个 zjuFetch 请求的最终落点、状态码与响应开头，用于对照真实接口
npx electron scripts/test-forms.mjs # 问卷填写回归：标题匹配词表 + 本地模拟的问卷星 / 腾讯问卷 / 金数据页（scripts/forms-fixtures，内容虚构）
npm run build                # 构建到 out/
npm run typecheck            # node（main/preload/shared）、web（renderer）、mobile（src/mobile）三套 tsconfig
npm run mobile:dev -- --mode demo  # 浏览器里调手机界面（演示数据；内置浏览器 preview 名 mobile-demo，切到手机尺寸）
npm run mobile:build         # 安卓网页资源到 out/mobile 并 cap sync 到 android/
```

安卓 APK：`npm run mobile:build` 后在 `android/` 执行 `gradlew assembleRelease`（JAVA_HOME 用 JDK 21；本机 SDK 在 `C:/Android/Sdk`，写在被忽略的 `android/local.properties`；Gradle 下载走代理时设 `GRADLE_OPTS=-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 …`）。发布签名的密钥库与口令在仓库外 `~/.zju-android/keystore.properties`（可用 `ZJU_ANDROID_SIGNING` 指定），丢了就无法覆盖升级已装的版本；缺省时出未签名包。版本号由 `android/app/build.gradle` 读 package.json（0.10.1 → versionCode 1001）。图标与启动图标由 `npx electron scripts/make-android-icons.cjs` 从 `build/icon.svg` 生成。

没有测试与 lint 配置。Electron 二进制在国内网络下需镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（重装依赖或执行 `node node_modules/electron/install.js` 时设置）。

## 分工

2026-11 起不再与 ChatGPT Astra 分工（`scripts/astra*.mjs` 留作历史），内核与前端都由 Claude 写；量大、无需创造力的部分（批量转换、提取、样板代码等）可交给 DeepSeek Flash（见用户全局说明，密钥取自 `DEEPSEEK_API_KEY`，结果抽查后再用）。

**不要把账号数据发给任何外部模型**：学号/用户 id、课程与活动 id、手机号、接口原始响应体都不能进 prompt。只给字段名与结构，值一律省略。

## 架构

三层进程，`src/shared/` 为共享类型：
- **`src/main/`**：所有网络请求在主进程发出（无 CORS，共享 cookie）。
- **`src/preload/`**：将 IPC 通道 1:1 暴露为 `window.zju[channel]`。
- **`src/renderer/`**：React UI，只通过 `window.zju` 取数。

### IPC 契约

`src/shared/ipc.ts` 的 `ZjuApi` 是唯一事实来源。新增通道：加到 `ZjuApi` 和 `ZJU_CHANNELS` → 在 `src/main/ipc.ts` 的 `handlers` 实现（类型强制覆盖每个通道）→ preload 自动转发。preload 透传参数（`window.zju[channel](...args)`），handler 签名为 `(win, ...args)`。长任务进度由主进程 `webContents.send('task:progress', …)` 推送，渲染端在 `store.ts` 全局订阅一次存入 `tasks`。

### 认证与 SSO

- `auth/zjuam.ts` 只负责 CAS：弹出真实 `BrowserWindow` 让用户在 `zjuam.zju.edu.cn` 登录，cookie 存于持久分区 `persist:zju`，以 `iPlanetDirectoryPro` cookie 判定已登录。它**不得 import services**（避免循环依赖）。
- 账号密码登录在 `auth/password.ts`（流程照 Celechron：登录页取 execution → `/cas/v2/getPubKey` → 无填充 RSA → 表单提交；失败提示在登录页 `#errormsg`，页面始终带隐藏的验证码区，不能据 captcha 字样判断）。凭据用 `safeStorage` 加密存 userData/credentials.bin；只有密码被拒才清掉，网络错误不清。`zjuFetch` 被 SSO 弹回 `/cas/login` 时调用 `onCasExpired` 注册的回调（ipc.ts 接上 `relogin`）重登并重试一次，http.ts 不直接 import password.ts。各 service 的 `ensureLogin` 用 `http.ensureCas()`（cookie 不在时先重登）而不是只查 cookie。**重登时不要先删旧 cookie**（并发请求会误判未登录，曾导致"老掉登录"），以提交前后 cookie 值变化判定成功；`auth:state` 遇到未登录只在没有保存账号时才清 cookie。重登成功或密码被拒时主进程发 `app:auth` 让界面重取登录态；未登录时界面在窗口获得焦点、网络恢复与每分钟重试。日志里 `cas-expired` / `auth-relogin` / `auth-state` 记录掉线与重登结果（不含账号）。网页登录（`auth:login` 不带参数）保留作验证码兜底。**调试时不要替用户输入账号密码**，真实登录只能由用户验证。
- 登录态组合在 `ipc.ts`：`auth:state` = 有 CAS cookie 时调 `zdbk.fetchProfile()` 取姓名学号（失败时 `user: null` 但仍算已登录）；`account` 为学号（教务取不到时用保存的登录账号），刊头登录后显示它；`auth:logout` 清 cookie 后调用各 service 的 `reset()`。
- 每个 service 自己维护一次性的 `ensureLogin()` 与 `reset()`，请求一律走 `src/main/http.ts` 的 `zjuFetch`。**不要用 `session.fetch`**：Electron 45 下它跟随跳转后 `response.url` 恒为空串，`redirect: 'manual'` 则直接抛错；`zjuFetch` 基于 `net.request` 的 `redirect` 事件记录最终 URL。重定向后不在目标站点即视为未登录，抛 `Error('未登录')`。渲染进程把这类错误显示为"登录后显示"。

### 数据源（未以登录态实测，字段处有"推测"注释）

优先参考已实测的开源实现，而非臆测：教务/学在浙大见 [Celechron](https://github.com/Celechron/Celechron)（`lib/http/zjuServices/`、`lib/model/`），学在浙大/智云课堂见 [zju-learning-assistant](https://github.com/PeiPei233/zju-learning-assistant)（`src-tauri/src/zju_assist.rs`）。新增数据源时先找这类现成轮子，对照其源码实现。

- `services/eta.ts` ETA（`eta.zju.edu.cn/zftal-xgxt-web`，正方学工"三全育人学生信息平台"）：**课表主来源**（教务常出错 / 选课排课期间为空）。照 Elychron（Celechron 分支）`lib/http/zjuServices/eta.dart`：CAS service 必须是站点自己的 `http://eta.zju.edu.cn/zftal-xgxt-web/teacher/xtgl/index/check.zf`，带票据跳回时升到 https（`zjuFetch` 的 `upgradeHttp`）；课表 `student/xtgl/index/getTableKcb.zf?xnxq=2026-2027-1` → `data.kbList` 按星期分组，条目给 `xqj`/`ksj`/`ks`/`xxq`/`dsz`（all/single/double）与 `ke[0].kcmc/rkjs/jsmc`，只有当前学年学期，不给教学周范围（按 1–8 周）。`ipc.ts` 的 `fetchSchedule` 先 ETA，失败或为空退回教务（日志 `schedule-source`）。
- `services/zdbk.ts` 本科教务：SSO 入口 `/jwglxt/xtgl/login_ssologin.html` → zjuam。课表 `kbcx/xskbcx_cxXsKb.html?gnmkdm=N253508`，表单 `xnm=2025-2026`、`xqm=1|秋` 等；考试 `xskscx/kscx_cxXsgrksIndex.html`（含期中 `qz*` 字段）。端点参考开源项目 Celechron。
- `services/courses.ts` 学在浙大（TronClass）：经 `identity.zju.edu.cn`（Keycloak，broker 到 zjuam）SSO，待办来自 `/api/todos`。
- `services/classroom.ts` 智云课堂：以下从其前端 bundle 逆向得到，可信度较高——token 在 `.zju.edu.cn` 的 `_token` cookie（PHP 序列化，正则提取），请求头 `Authorization: Bearer <token>`；无 token 时访问 `https://tgmedia.cmc.zju.edu.cn?forward=…&tenant_code=112` 走 CAS 换取。课程月历 `courseapi/v2/course-live/get-my-course-month`，课件 `pptnote/v1/schedule/search-ppt`，平台自带 AI 转写 `courseapi/v3/web-socket/search-trans-result`，回放页 `/livingpage?course_id&sub_id&tenant_code=112`。平台转写在 `yjapi.cmc.zju.edu.cn` 的同名路径（`sub_id&format=json`，`list[0].all_content[]` 的 `BeginSec/EndSec/Text`，大写开头，照 zju-learning-assistant），即 `getPlatformTranscript`。

### PTA（pintia.cn）

`services/pta.ts`：浙大程序设计课的作业平台，账号与统一身份认证无关，设置里开关（默认关，存 userData/pta.json）并单独登录，用独立分区 `persist:pta`（退出统一身份认证不影响它）。接口逆向自 PTA 网页端与开源的 vscode-pintia：登录 `POST passport.pintia.cn/api/users/sessions` `{phone: "+86…" | email, password, rememberMe}`，成功写 `PTASession` cookie；网页端先不带验证码提交，服务端回 `GATEWAY_WRONG_CAPTCHA` 才弹腾讯滑块（CaptchaAppId `194593025`，`turing.captcha.qcloud.com/TCaptcha.js`）。应用内登录遇到时由 `solveCaptcha` 开一个小窗加载 `pintia.cn/robots.txt`（验证码校验来源域名，任一 pintia.cn 页面即可），注入 TCaptcha 让用户完成，再带 `ticket` / `randStr` 重提；后台自动重登遇到验证码直接失败、保留凭据，不突然弹窗。网页登录（弹窗加载 `pintia.cn/auth/login`）仍保留。界面显示的 PTA 账号脱敏（手机号留前三后四、邮箱留首字与域名）。当前用户 `passport.pintia.cn/api/u/current`；未截止题目集 `GET pintia.cn/api/problem-sets?filter={"endAtAfter":<now>}`；完成情况 `exam-problem-status`（`PROBLEM_ACCEPTED` 计通过）。**只读，不 POST `/exams`**（那会替用户开考）。凭据 safeStorage 加密存 pta-credentials.bin，401 时自动重登。`data:assignments` 合并学在浙大与 PTA（PTA 出错只记日志），PTA 条目 `type: 'pta'`、带 `progress`，作业侧页对它只显示进度与"在 PTA 打开"。

### 选课与查老师（工具页「选课」）

代码都在独立文件里：类型与通道 `shared/xk.ts`（`ZjuApi` 继承 `XkApi`，`ZJU_CHANNELS` 并入 `XK_CHANNELS`）、通道实现 `services/xkApi.ts`（桌面与安卓共用）、桌面接线 `main/xkIpc.ts`（补 win 参数、接订阅、演示模式换 `services/demoXk.ts`）、MCP `main/mcpXk.ts`、界面 `components/course/`。
- `services/xk.ts` 教务"自主选课"（浙大定制的正方 zzxkghb 系列，模块 N253530），复用教务会话（`zdbk.post` / `zdbk.page` / `zdbk.studentId`，功能 URL 带 `su=<学号>`）。接口事实参考 campus-agent（`core/zju/lib/zdbk`，2026-09 登录态实测，无许可证只参考事实），调研见 tools 分支 `docs/research/questionnaire-and-course-selection.md`：首页 `cxZzxkGhbIndex` 隐藏域取 xn / xq / nj / zydm / xkzys（志愿数，逐学期会变，有时只有 1）/ ylxs，类别页签取 `categroyClick(this,'dl','lx')` 的实参；类别课程 `cxZzxkGhbKcList`（学分在 `kcxx` 第二段）；搜课 `cxZzxkGhbDdkcList`（`cxtjList[0]` 条件）；教学班 `cxZzxkGhbJxbList`（搜索页签 xk_9 要带原搜索条件；`rs` = 余量/容量，`yxrs` 待定；`sksj` 由 `parseSlots` 解析"周一第3,4,5节{单周}"）；已选 `cxZzxkGhbChoosed`（`sxbj` 1 已选上，`xkzy` 志愿次序，`xkzyfz` 志愿组）；学分 `cxZzxkYxxf`；写：选 `xkBcZyZzxkGhb`（tabname 取教学班返回值）、退 `tuikBcZzxkGhb`、排序 `xkBcZypxZzxkGhb`（一组的完整新顺序）。**写请求不重发**，结果以回查已选为准。**以上都未以登录态实测，写接口只能由用户在选课窗口期自己验证，调试时一律不调用。**培养方案里还没修的必修课取自毕业自审（`data:graduation`），不另调接口。
- 选课规则：常规轮次截止后统一筛选（先后无意义，待定多于余量即要竞争）；低学分定点选课（已选 ≤ 22 学分）有余量先到先得，退课名额在 18:00–24:00 随机释放。
- 订阅与自动选课（`main/xkwatch.ts`，userData/xk-watch.json，只在桌面端）：18:00–24:00 每 20–40 秒、其余 5 分钟逐个查余量；有余量弹通知（点开打开选课工具，`OpenRequest` 的 `{ tool }`）；`auto` 须用户在应用内二次确认授权（MCP 发起的走 `askUser`），选上即停，总学分 > 22 停掉全部自动，被拒或结果不明关掉自动只通知。
- 查老师（`services/chalaoshi.ts`）：站点无搜索接口，缓存 `/static/json/search.json` 的精简索引（7 天，`writeConfig` 存 chalaoshi-index.json，安卓存 localStorage），本地按姓名找人，同名按学院再按热度；详情 `/teacher/{id}/`、评论 `api.chalaoshi.de/comments/{id}?sort=rate|time` 解析 HTML。请求经 `zjuFetch`（跟随系统代理；国内被墙，不通时只显示教师名）。只读，不遍历。
- MCP：查询组 `get_course_selection_context` / `search_courses` / `list_category_courses` / `get_course_sections`（课程参数原样传回搜索结果项）/ `get_selected_courses` / `get_teacher_rating` / `get_teacher_comments`；界面组订阅三件；提交组 `select_course_section` / `reorder_course_preferences` / `drop_course_section` / `auto_select_section`，均先 `askUser`（`ConfirmRequest.action` 加了 select / drop / reorder / autoselect）。

### 问卷填写（工具页，仅桌面端）

活动报名、讲座抢票类问卷：粘贴地址，应用开窗打开并按本人信息填写。代码全在独立文件里（与其他工具分支少冲突）：类型与通道 `src/shared/forms.ts`（`ZjuApi extends FormsApi`、`ZJU_CHANNELS` 展开 `FORMS_CHANNELS`），主进程 `src/main/forms/`（`index.ts` 窗口与记录、`page.js` 注入脚本、`handlers.ts` 通道与 MCP，`ipc.ts` / `mcp.ts` 各并入一行），界面 `components/FormFill.tsx` + `forms.css`，安卓桥 `src/mobile/forms.ts` 全部返回不支持、`tools/index.ts` 以 `desktop: true` 隐藏入口。
- 个人信息（学号、姓名、性别、学院、专业、班级、年级、校区、手机、邮箱、QQ、微信、宿舍）`secure.ts` 加密存 userData/form-profile.bin；没存过时用教务姓名学号预填，本科学号 `3YY…` 推出年级。打开、重新填写前先存一次。
- 窗口用独立分区 `persist:forms`（扫码登录的微信 / QQ 下次还在），同站与登录弹窗留在应用里，其他外链交给系统浏览器。**不调平台提交接口**，只操作页面。
- `page.js` 经 `Function.toString` 注入主世界，两个函数必须自包含（写成 .js 是为了回归脚本不经构建直接加载，类型在 `page.d.ts`）。`formMatcher` 先去题号、星号、括号说明再按词表认字段（专业班级、学院专业是组合题）；`NOT` / `STRONG` 排除问的不是本人或不是这几项的题（家长、紧急联系人、队友、负责人、意向校区、辅修、身份证、后四位、群号……），明确排除的题不再看输入框提示文字。题目容器取已知题目块（问卷星 `[topic]` / `.field`、腾讯 `section.question`、金数据 / Ant `.ant-form-item` 等）的最内层，不在其中的控件往上找。文本框用原生 setter 赋值并派发 input / change / keyup / blur；原生下拉按选项文字选并补 jQuery change（select2）；单选点选项（已选中的不再点，免得多选被取消）；自绘下拉（Ant / Element / TDesign）先按下展开再点选项。选项文字按性别「男生 / 男性」、年级「2022级 / 22级 / 大N」、校区去掉「校区」容错。MutationObserver 去抖重跑，补上单页应用晚渲染、多页问卷翻页后出现的题；填过的控件记在 WeakMap 里，用户改过的不会被覆盖回去（「重新填写」才清掉）。认不出且没填的必填题在页面上描红并列进记录。
- 状态（`FormStatus`）：等待开放 / 填写中 / 已填好 / 待补填（有必填题没认出、什么都没认出、或提交被页面校验拦下）/ 需验证（出现验证码）/ 需登录 / 已提交（成功页，或我们点过提交后题目消失）/ 已关闭 / 打不开。主进程每 0.8 秒读一次页面状态，页面 `alert`（作答时间太短等）记下显示在记录里，原对话框推迟弹出。
- 自动提交只试一次：第一次填稳（1.2 秒没变化）时有没认出的必填题就放弃；多页问卷只在只剩「提交」、没有「下一页」时才交；验证码、扫码、最短作答时间一律交给用户在窗口里完成，不绕过。不做多账号、批量提交。
- 定时：窗口先打开（可提前登录），HEAD 请求取问卷站 `Date` 头校准（往返中点 + 半秒），开放前 20 秒再校准一次，到点刷新再填；页面仍显示未开始 / 暂停时每 0.8 秒重刷，最多 15 次。界面倒计时按校准后的时钟走。
- 记录只在本次运行里保留（最多 12 条，先丢已关的），工具页开着时每秒取一次；点开一条看已填字段（标签，悬停看原题）、未认出的题，操作为 前往窗口 / 重新填写 / 关闭窗口（已关的为移除）。
- MCP：`fill_form`（界面组，只填不交，可带 `open_at`，返回几秒内的结果）与 `get_forms`（查询组）；返回的记录只含题目与字段，不带所填的值。
- 回归：`npx electron scripts/test-forms.mjs [文件名片段]`，模拟页的题目块带 `data-expect`（字段键 / `none` 不该填 / `missed` 应标出），无 missed 时模拟自动提交并核对页面校验通过与成功页识别。新增平台结构时先加模拟页。**不要向真实问卷提交测试**。

### 待办忽略与截止提醒

`src/main/todos.ts`：userData/todos.json 存忽略的待办 id、提醒开关与已提醒记录（`<id>@<截止时间>`，截止时间变了会再提醒）。主页截止条目是 `div[role=button]`（尾注格里要放按钮）：悬停时剩余时间与「忽略」在同一格里同时交叉淡变（`.swap` 叠放，两者各 0.3 秒同时进行、过程中有重叠；不加延迟，不能先消失再出现，也不能即时切换，用户要求），3 天内的截止时刻显示为「周六 20:53」、悬停换成日期；右键菜单与作业侧页也有忽略；忽略后弹「撤销」轻提示防误触；区块标题旁「已忽略」切换显示被忽略项（淡显，可恢复）。设置「待办 / 截止前 3 小时提醒」开启后，主进程每 30 分钟经 `call('data:assignments')` 取待办，未完成且未忽略的在截止前 3 小时弹 Windows 通知（已进入 3 小时内的立即弹），点通知经 `app:open` 打开作业侧页。`initTodos` 设置 AppUserModelId 为 electron-builder 的 appId。MCP：`get_assignments` 带 `ignored`，`ignore_assignment` 在界面组。

### 本地 MCP 服务

`src/main/mcp.ts`：供本机 Agent（Claude Code 等）调用的 MCP 服务，Streamable HTTP 无状态模式，只监听 `127.0.0.1:17321/mcp`，请求须带 `Authorization: Bearer <token>`（token 随机生成，与开关一起存 userData/mcp.json）。默认关闭，设置页开关；工具按组开关：查询（状态、课表含起止时刻、校历、考试、作业、作业详情、课次、课件、播放地址、文字稿）/ 下载（`download_file` 仅限 *.zju.edu.cn，用登录会话下附件、已交文件、课件图、回放视频；`export_slides_pdf`、`export_transcript`；默认存到"下载/ZJU All in One"，重名加序号，不弹保存框）/ 界面（`open_in_app` 经 `app:open` 事件打开页面、课次、作业侧页或登录面板；`refresh` 经 `app:refresh` 让界面重拉）/ 转写 / 提交与撤回（默认关）。**应用新增能力时同步补对应的 MCP 工具**（用户要求覆盖到位）。开发版与已安装版同时开 MCP 会抢端口，开发时设 `ZJU_MCP_PORT=17399`。工具一律经 `ipc.ts` 导出的 `call()` 复用通道实现，共用登录会话，演示模式也生效。**提交与撤回必须先经用户在应用内确认**：`askUser` 经 `app:confirm` 事件把请求推给界面（`components/AgentConfirm.tsx`，排队、文件可点开预览），用户答复经 `mcp:answer` 回到主进程，10 分钟无答复按取消。不用系统原生对话框（用户要求本软件风格）。测试只能在演示模式里点开发版窗口内的按钮，不要用模拟按键操作用户桌面。节次作息在 `src/shared/periods.ts`，主进程与界面共用。

### 回放、转写、作业提交

- 回放页（`pages/Replay.tsx`）：`<video>` 直接播放 `replay:playback` 返回的签名地址（`vod.cmc.zju.edu.cn`，签名见 `classroom.getPlaybackUrl`，部分账号 `phone` 为空按空串签）；默认 session 对 `*.cmc.zju.edu.cn` 补 Referer。课件图是 http 地址，靠 CSP 的 `upgrade-insecure-requests` 升级为 https。
- 转写：`src/main/asr/whisper.ts`，首次使用下载 whisper.cpp CUDA 12.4 构建（b5454，约 684MB）与 `ggml-large-v3-turbo-q5_0`（hf-mirror，约 574MB）到 userData/whisper；ffmpeg 来自 `ffmpeg-static`（安装时设 `FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static`）。`gpuPlan` 按显存决定用不用显卡：预算 = 总显存 30%（且至少给别的程序留 1GB 空闲），放得下模型（实测峰值约 1.1GB，束搜索与贪心相差无几）就上显卡，否则 `-ng` 走 CPU。上显卡时由 `asr/throttle.ts` 限制显卡占用：常驻 PowerShell 用 NtSuspendProcess / NtResumeProcess 按 200ms 周期、60% 占空比挂起与恢复 whisper-cli（实测 10 分钟音频平均占用 64% → 49%，耗时约 1.5 倍）；它的 stdin 关闭时会先恢复再退出。抽音频用 `aresample=async=1:first_pts=0` 按时间戳重采样（智云录像的 AAC 解码出的采样比时间轴多，实测约 3 秒 / 50 分钟，不对齐时文字稿越往后越晚于画面）。调用带 `-mc 64` 与 VAD（`--vad -vm ggml-silero-v5.1.2.bin`，随模型从 hf-mirror 下载，约 0.9MB；只送有人说话的片段，课末近一小时的静音不再编句子，也快很多；实测时间戳仍是原时间轴，但紧跟长静音的那一句起点会被算在静音开头，`fixVadStart` 按字数挪回）。缓存存原始结果，`cleanSegments`（去水印、`dropRepeats` 去复读：连着三遍以上只留一句、4 字以上 60 秒内重复的丢掉、全稿 8 次以上只留第一次）在读取时做，规则改了旧稿不必重转。meta 记 `pipeline: 2`，更早的稿子（含无 meta 的）视为过期，回放页提示重新转写。转写开始时清掉崩溃残留的 `task-*` 临时目录。结果缓存在 userData/transcripts，旁边的 `<subId>.json.meta.json` 记下转写所用视频的路径。**智云会在课后重新生成回放并替换同一课次的视频**（实测：课后先给出较短的版本，次日 0 点左右换成完整的 1080p 文件，路径里多一层生成日期 `…/<录制日>/<生成日>/<hash>_1920_1080.mp4`），所以 `isTranscriptStale` 比对来源路径（旧缓存无记录时看文字稿是否覆盖不到视频时长的 85%），回放页文字稿栏的「重新转写」在过期时以主题色提示，`replay:transcribe` 的 `force` 忽略缓存重转，失败时保留原文字稿。文字稿栏有 本地 / 智云 两个来源（`replay:platformTranscript`，直播中随课件每 30 秒重取）：没有本地稿时默认显示智云的；导出与 MCP 的 `get_transcript` / `export_transcript` 都带 `source`。
- 导出：`src/main/export.ts`，课件用隐藏窗口 `printToPDF`，文字稿 txt/srt/md。
- 播放器（`components/Player.tsx`）为自绘控制条：回放有播放/进度/倍速，直播（hls）不允许暂停与拖动、被暂停会立即恢复；铺满窗口与全屏按钮相邻，全屏作用于整个播放器容器（字幕、控制条一起进全屏）。
- 课件区（`components/SlideViewer.tsx`）：缩略图 / 大图切换，大图可翻页、默认跟随当前讲解页（直播取最新一页，回放取 `created_sec` ≤ 播放时间的最后一页）；点击课件不影响播放；大图模式的翻页区固定两行（第一行翻页，第二行 从此页播放 / 回到当前 / 全窗口 / 下载，不随宽度在一行两行间跳，用户要求），右键菜单保留；触屏上大图可直接双指缩放、双击放大、单指左右滑动翻页（`components/ZoomStage.tsx`）。文字稿栏工具行：来源一行，字幕 / 重新转写 / 下载固定在第二行；还没有本地稿时「转写」是空状态里的主按钮，不单独占工具行（用户不要孤零零的按钮）；导出只留一个「下载」按钮，点开再选 TXT / SRT / MD（`components/FormatMenu.tsx`）。**不要把功能只藏在右键或小字里**（用户要求按钮要显眼）。
- 回放页布局：左列视频（`.player-wrap` 用容器查询取 min(列宽, 可用高 × 16/9)），右侧栏在 课件 / 文字稿 / 选集 间切换，三个面板始终挂载只隐藏（字幕依赖文字稿 DOM）。播放器控制条的「课件」按钮把视频位置切成当前讲解页（`useCurrentSlide`，声音照常），再点「画面」切回；不在视频下方另放课件区（用户明确不要）。右键视频切换铺满。
- **主进程请求校内 `http://` 地址会挂起不返回**（智云课件图 `pptimgurl` 就是 http）：渲染端靠 CSP `upgrade-insecure-requests` 才正常；主进程下载 / 导出前用 `download.ts` 的 `upgrade()` 升成 https。
- **下载一律在应用内完成**：`file:download`（保存框 + `main/download.ts` 用登录会话流式写盘，cmc 域补 Referer）与 `file:reveal`；不要用 `<a target=_blank>` 指向文件（会被 `setWindowOpenHandler` 交给浏览器）。作业说明里的文件链接也被拦截走应用内下载。
- 作业提交（`courses.submitHomework`）流程逆向自学在浙大前端：`POST /api/uploads` → `PUT upload_url` → `POST /api/course/activities/{id}/submissions`；已有草稿时与网页一致改用 `PUT` 并带 `submission_id` 覆盖草稿。**调试时不要替用户点真实提交**；界面上需两次点击确认。
- 撤回（`courses.retractSubmission`）逆向自学在浙大前端 homework 页（公开课程页 `courses.zju.edu.cn/course/<id>` 会加载完整前端代码，懒加载块在 runtime 的映射表里）：`PUT /api/submissions/{id}/retract`，错误码 40001 为撤回失败。可撤回条件与网页一致：`can_retract && !is_redo && !submit_by_instructor && activity.data.allow_retract`。撤回后该提交变成草稿（`submission_list` 里 `is_draft: true`），详情把草稿单列为 `draft`，不算已提交。
- 本机文件预览（`file:preview` / `components/FilePreview.tsx`）：图片、PDF、常见文本在应用内显示（blob 地址，CSP 放行 `img-src blob:` 与 `frame-src blob:`，PDF 依赖 `webPreferences.plugins: true` 的内置查看器），其余或超过 50MB 交给 `file:open`（系统默认程序）。
- 直播：`sub_status` 1 直播中 / 2 未开始 / 3 回放生成中 / 5 无回放 / 6 回放；直播流为 `search-live-course-list` 的 `sub_content.output.m3u8` + `clientUUID`，渲染端用 hls.js 播放（CSP 需 `connect-src`，主进程对 cmc 域补 CORS 头）。
- 主页今日 / 明日课程与课表一样经 `hooks/useCalendar` + `sessionsOn` 按日期判断半学期、教学周、单双周与放假调休（只按星期筛会把不上的单双周课也列出来）。
- 课程作业 `courses.fetchCourseHomework`（课程详情里状态：已交 / 进行中（未交且未截止）/ 未交（已截止））：`POST /api/my-courses` 取进行中的课程（按规范化课名匹配课表），`GET /api/courses/{id}/homework-activities` 分页取作业（照 zju-learning-assistant；提交状态字段为推测）。MCP `get_course_homework`。
- 课表按周翻页依赖 Celechron 公开校历 `calendar.celechron.top/<学年-学期>.json`；`exchange` 键前 8 位为放假日、后 8 位为调休上课日（上课日按放假日课表排）。

### 安卓端（Capacitor）

`android/` 为 Capacitor 8 工程，`capacitor.config.ts` 指定网页资源 `out/mobile`。思路：渲染端原样复用，主进程的 services 搬进 WebView 运行。
- `vite.mobile.config.ts`（vite 根 `src/mobile`；替身路径须 `normalizePath` 成正斜杠，否则 Windows 下同一文件被打包两份——曾导致提交作业报「文件已失效」、自动重登回调注册错实例）用插件把 `src/main` 下依赖 Electron / Node 的底层模块换成 `src/mobile` 里接口相同的实现：`http.ts`、`auth/zjuam.ts`、`secure.ts`、`diagnostics.ts`、`services/ptaTransport.ts`，以及 `node:crypto`（md5、randomUUID）/ `node:fs/promises`（只读刚选的文件）/ `node:path` 的替身。**services 不能直接 import electron 或 node 模块**，需要时照此拆出可替换的一层（凭据与配置读写已收进 `src/main/secure.ts`，PTA 的网络与窗口在 `ptaTransport.ts`）。
- `src/mobile/bridge.ts` 是安卓端的 `window.zju`：通道与 `ipc.ts` 相同，另有 `platform: 'android'` 与 `immersive`（播放器全屏：横屏并隐藏系统栏）。本地转写、导出、MCP、网页登录不提供；渲染端以 `lib/platform.ts` 的 `MOBILE` 隐藏入口。`--mode demo` 构建换成演示数据（校历为编出来的秋学期第 8 周）。
- 原生插件 `ZjuNativePlugin.java`：超过 256KB 的响应（如智云整节课的文字稿）不经桥传字符串，写进缓存文件、网页按 `convertFileSrc` 地址读取后 `release`；请求不自动跟随跳转（`native.ts` 的 `nativeFetch` 逐跳处理、记落点、`upgradeHttp`），cookie 读写系统 CookieManager（与 WebView 共用，`<video>` / `<img>` 带登录态），桌面 UA；凭据 Android Keystore AES-GCM 加密存 SharedPreferences；下载经 MediaStore 写到"下载/ZJU All in One"，`file:reveal` / `file:open` 用其他应用打开。
- 页面源设为 `https://classroom.zju.edu.cn`（`server.hostname`，本地提供、不访问该站）：智云回放与课件图校验 Referer，直接加载时据此通过。允许明文（校历是 http）。
- 截止提醒用 `@capacitor/local-notifications` 预约系统闹钟（`src/mobile/todos.ts`），应用不在前台也会到点弹出，每次取到待办重排；点通知打开作业侧页。
- 返回键（`src/mobile/main.tsx`）：先收起全屏播放 / 课件大图 / 文件预览（派发 Esc），再关登录面板、作业侧页、按历史返回，到头退到后台。系统栏图标随应用深浅色。
- 手机布局全在 `styles.css` 末尾 `html[data-platform='android']` 一节：导航为底部半透明悬浮胶囊标签栏，回放页收起刊头与标签栏；主页四块竖排整页滚动，考试排在回放前，每块先只显示前几条（`Home.tsx` 的 `LIMIT`），「展开 / 收起」看全部，高度经 `AutoHeight` 平滑过渡，免得一块很长把下面挤走；课表这周周末没课只画五天、左侧只写节次、左右滑动翻周、格子浅底；回放页视频通栏在上、侧栏在下；侧页与登录面板占满宽度；触屏没有悬停，待办「忽略」只在作业侧页。安全区取 Capacitor 注入的 `--safe-area-inset-*`。桌面样式不要写成影响安卓的无前缀规则，反之亦然。
- Tailwind 在安卓构建里靠 `styles.css` 的 `@source '..'` 扫描渲染端源码。`electron-builder.yml` 排除 `out/mobile`。
- **未在真机上验证**登录、各数据源与下载；改动后至少在演示模式下按手机尺寸看一遍。

### 渲染进程与设计语言

风格沿用 AoiKJuice 主站（`C:\Project\AoiKJuice\frontend\aoi-next`）："Stay Quiet"、去卡片化、高效率。
- 纸与墨配色 + 朱色（`--shu`）为唯一强调色；纸纹是预渲染 PNG（`public/grain-light|dark.png`，2 倍尺寸，`background-size: 180px`；原 SVG feTurbulence 每次背景重画都重算滤镜，切页时背景轻微闪烁）；EB Garamond + 思源宋体（用户指定，Noto Serif SC，只打包 Medium 500 一档以略加字重；`@fontsource/noto-serif-sc` 按 unicode-range 分片，在渲染端 `main.tsx` 引入，两端共用），数字字体不变（其余字体文件在 `src/renderer/public/type/`）；颗粒纸纹；空心描边大字（`OutlineWord`）作页面水印；进入动画为"上浮 + 去模糊"（`Reveal`，0.7 秒，按 `i` 错落 0.045 秒；用户嫌原来的 1.1 秒慢）；大块面板（主页区块、设置面板、课表、回放两栏、衬底徽标）用 `Reveal flat` 只上浮淡入不模糊，整页退场只淡出——大面积 / 全窗 filter 动画在用户的 NVIDIA 显卡上让卡片闪烁（逐帧录屏录不到，那是显示层的闪烁）。
- **界面不放解释性、冗余文字**：不写副标题、计数、来源注记、功能描述；空状态只写"无"。
- **不留孤零零的按钮**：作业侧页的「原页面」放在标题旁（忽略 / 原页面 / 关闭），回放页的「原页面」是元信息标签里的一枚。
- **并列信息不用点号也不用竖线分隔**（用户觉得竖线「蠢蠢的」）：`Joined`（components/Type.tsx）段间留白，侧页 / 课程详情 / 回放页顶部的元信息显示为浅底小标签。
- **选中态不用下划线**：选中文字转主题色，背后主题色浅底的圆角滑块，同组切换时滑块移动过去（`components/Type.tsx` 的 `Choice`，`layoutId` 按 group；可多选的开关组 `multi` 只淡入淡出）；刊头 / 底部导航同理。开关类文字按钮 `.act[data-on]` 为静态的主题色浅底胶囊。主操作用 `.btn.btn-solid`（实心主题色胶囊），次操作 `.btn`。
- **分行**：正文 `text-wrap: pretty`（不让最后几个字单独落到下一行），标题 `balance`；`Joined` 每段包成整体换行的 `.part`，字段不会从中间断开；选项、按钮、状态标签不换行，手机设置页的选项按等宽列排。设置页选中滑块为圆角矩形（`.opt`），其余选项为胶囊形。
- **字重分层**（思源宋体可变字重 `@fontsource-variable/noto-serif-sc`）：页面 / 区块 / 侧页标题 600，条目标题、导航、按钮 500，正文与副文字 400。
- **分层靠底色，不靠细线**（用户要求：区域之间只隔一根线、背景一模一样时看不出层次，线太多显得杂乱）：区块放进 `.pane` / `.panel`——比纸面略浅的 `--surface`、圆角 `--r-lg`、柔和投影 `--shadow`；条目 `.rows/.row`（时间 · 正文 · 尾注）之间不画线，可点的条目悬停浅底 `--surface-2`；课表只在午间、晚间两处画浅线，课程格子为圆角浅底块。浮层（轻提示为胶囊形、登录面板、菜单、确认框、侧页）一律圆角、`--shadow-pop`、无描边；输入框为浅底圆角。**不要再出现尖角矩形或通栏分隔线**。区块标题用 `SectionHead`；空/错/未登录状态统一用 `Quiet` 一行小字。样式类集中在 `styles.css`，颜色只用 CSS 变量（`--paper/--surface/--surface-2/--ink/--ink-2/--ink-3/--rule/--tint/--shu/--emblem`）。
- **风格**（设置「风格」→ `html[data-style]`）：经典（`paper`，默认，即本节所述的纸与墨）/ Material / 液态玻璃（ColorOS 试做过，效果不理想已删）。后两套各是 `src/renderer/src/themes/*.css` 一个自包含文件（在 `styles.css` 顶部 @import，以后可改为从 GitHub 按需下载、只收 CSS），规则一律以 `html[data-style='x']` 开头：变量块写成 `html[data-style='x'][data-theme]`（否则比不过后面的 `html[data-theme='light']`），深色 `[data-theme='dark']`；主要覆盖 `--paper/--surface/--surface-2/--ink*/--shadow*/--r-*/--grain`，再少量组件规则。**字体不随风格变**，各风格都用设置里的字体（用户要求），主题不打包字体；共用的几条（收窄字距、不画描边水印）在 `styles.css` 末尾。Material 的手机导航栏用比卡片深一档的 `--m3-nav`（与卡片同色时看不出来）。液态玻璃照 Apple 的用法分两层：内容层是渐变壁纸（写进 `--grain`）上的半透明面板，**不做实时模糊**（壁纸是平滑渐变，模糊看不出区别，十几块大面积 backdrop-filter 会让切换风格卡顿）；导航与控件层（标签栏、刊头导航与右侧按钮、翻周、轻提示、右键菜单）才是玻璃——`components/LiquidGlass.tsx` 按元素尺寸与圆角用 canvas 算凸圆弧边缘的折射位移图与沿边高光图，生成 SVG 滤镜（轻模糊 → 红绿蓝分别位移形成色散 → 叠高光），写到元素的 `--lg-filter`，CSS 里 `backdrop-filter: var(--lg-filter, blur(8px)) saturate()`（仅 Chromium）。刊头在液态玻璃下不能铺模糊底（会成为导航玻璃的 backdrop root，取不到后面的内容），滚动后只加渐隐（画在 `::before` 上以透明度淡入淡出，渐变本身不能过渡，直接切换很突兀）。侧页等临时浮层轻度毛玻璃；课程格子、条目不加模糊（AppHang 教训）。
- 主题色在播放器黑底控件上用提亮版本 `--shu-bright`（随 data-accent 定义）。
- 动效速度（设置「动效」：关闭 / 快 / 标准 / 慢，系数 0 / 0.6 / 1 / 1.6）：motion 的时长、延迟一律写成 `dur(x)`（`lib/motion.ts`），CSS 过渡写成 `calc(xs * var(--speed, 1))`。新增动画照此写。
- 刊头登录后右上角不显示任何账号信息（未登录时才有「登录」），退出在设置页；设置页的学号经 `format.maskAccount` 脱敏。
- 设置（`lib/settings.ts` + 设置页）写到 `html` 的 `data-style` / `data-theme` / `data-font`（song 书宋、hei 黑体、kai 文楷）/ `data-accent`（blue 求是蓝 #003F88、red 求是红即浙大 VI 的"创新红" #B01F24、shu 朱砂），存 localStorage。`--shu` 是"当前主题色"的变量名，不一定是朱色。 字号四档（小 / 标准 / 大 / 特大）写成 `--scale`，乘在根字号上，不提供自定义数值。
- 数字统一用 Source Serif 4 的等高数字（`AJ Digits` 只接管数字与常见符号的 unicode-range），不用 EB Garamond 的旧式数字。
- `Reveal` 动画结束会清掉 filter/transform：带 filter 的祖先会让 `position: fixed` 的后代（如铺满的播放器）只相对它定位。
- **工具页**（`pages/Tools.tsx` + `tools/`）：入口网格，每个工具一张卡片＝悬停时会动的细线徽标（`tools/icons.tsx`，墨色主体 + 一处主题色，动效写在 styles.css「工具页」一节）+ 名称，不写说明；点开后整页是该工具，标题左侧返回。路由用 store 的 `tool`（记入浏览历史，返回键 / 侧键回到入口）。新工具：`ToolId` 加 id、`tools/index.ts` 注册（只在桌面端可用的标 `desktop: true`，安卓端不显示）、画一个带悬停动效的徽标，View 不写页面标题；工具自己的样式放独立 css 随组件引入。
- **毕业自审**（`components/Graduation.tsx`，`services/graduation.ts` 教务自审树 + `services/sztz.ts` 第二课堂）：总览（毕业总学分 + 二三四课堂、美育、劳育数字块）与「待完成」清单（最深一层没达标的模块写还差几学分、几门在修 / 未修，加上未达标的课堂与美育劳育）在上，培养方案顶层模块按名称归入 通识类 / 专业类 / 实践类 / 认定类（美育、劳育、心理健康等）/ 其他 分组显示，卡片高度固定：有要求门数的按门数画进度，否则按学分；卡片底部只写在修 / 未修几门，不写差几学分；同名模块（选必修各一）靠右上的选必修小标签区分；「待完成」每行只写一项（差几门 / 差几学分 / 几门未完成 / 未达标）；点模块或数字块在自己的侧页（`.local-sheet`，Esc / 安卓返回键收起）看明细：模块的课（未完成 / 全部）、第二课堂记录（已完成 / 审核中 / 未通过，`getSqjl` 记录按项目分类的 `sfdekt` / `sfdskt` 分二 / 三课堂，其余推测为四课堂）。不要再做超长卡片。
- **选课**（`components/course/`，样式 `course.css` 随组件引入）：一屏两栏。左栏找课：搜索 + 「有余量」开关，类别页签（教务给的本专业 / 通识 / 体育…，加「培养方案」列还没修的必修课，点了搜这门课并展开），课程行就地展开成教学班卡片（教师 + 查老师评分、时间小标签含单双周与半学期、地点与考试、余量大数字 / 容量条 / 待定（多于余量时主题色）、冲突标签），主按钮写清会落在第几志愿（「加入志愿」/「加为第 2 志愿」/「志愿已满」），满员的才出「订阅余量」。右栏我的志愿：上方课表（每组领头的志愿——已选上或第一志愿——为课名配色的实底块，后面的志愿为同色虚线框；只上半学期的课占半格；悬停教学班时主题色虚框预览，撞上别组领头志愿的格子为斜纹；悬停志愿组时别的淡下去），下方按志愿组列出（普通课＝同一门课的 1/2/3 志愿；通识按上课时间分组，标题写「通识 周二 11–12 节」），次序圆点领头实心，↑↓ 调序、× 移出，剩下的空位是虚线圆点 + 加号，点了去找课；桌面端另有「订阅」页签（余量、二次确认授权「自动选」）。冲突（`xkLogic.ts`）分三级：撞已选上的、撞别组第一志愿的（主题色）、只撞别组备选的（淡色「的备选冲突」）；同组互为备选不算，学期段与单双周参与判断。加入 / 移出一次点击并给撤销，退选已选上的课要二次确认。手机端顶部 找课 / 志愿 切换，整页滚动，订阅不显示。
- 导航为主页、课表、工具、设置（安卓端见上文；设置是刊头里的独立标签，右上角只留未登录时的登录与深浅色切换，后者用细线日 / 月图标而非单字「昼 / 夜」）；设置页分 外观 / 账号（统一身份认证、PTA）/ 本地 Agent 三组，不加说明小字；回放页从主页回放条目进入，作业详情与提交在右侧侧页（`AssignmentSheet`）。主页为一屏布局（`.page-fit` + `.panes`），各区块内部滚动；根字号随视口缩放（`html { font-size: clamp(...) }`），小窗口时整体缩小而不是整页下滑。路由是 zustand `store.ts` 的 `page` 状态，`go`/`openReplay` 记入 `past`/`future`，鼠标侧键（button 3/4）返回 / 前进，作业侧页开着时返回先关侧页；主页滚到顶后继续上滚约三格触发刷新（`usePullRefresh`，刊头下一道细线示意）；登录状态变化时 `epoch` 自增，`useZju` 据此自动重拉。
- **数据缓存**（`lib/cache.ts`）：`useZju` 与课表页的校历、各周课次先显示缓存，只有过期（5 分钟）或 `epoch` 变化（登录变化、下拉刷新）才在后台静默重取，切页面不重新加载；`useZju` 的结果同时存 localStorage，冷启动先显示上次数据；确认未登录时整体清空。
- 课表页（`pages/Schedule.tsx`）：标题写作「秋七周」（半学期 + 汉字周数，`format.cnNumber`），日期只在星期下面；左侧节次 + 开始时刻；上午 1–5、下午 6–10、晚上 11–13 节各是一块卡片（`.period-block`，块间空一行，不用分隔线）；空间够时七天都画，手机或窄窗口（≤760px）里周六、周日只有这一周确实有课（含调休）才加那一列；「今天」一列在最右时右侧两角跟块一起圆（`data-last`）；课程按课名配色（`lib/courseColor.ts`，课名排序后依次取 `--course-0…7`，同名同色，无左侧衬线），有录播的右上角带播放标志、直播中带「直播」；点课程打开课程详情上拉面板（`components/CourseSheet.tsx`，store 的 `course`：智云入口、这门课每周的上课时间地点与周次、`data:courseHomework` 的全部作业含已交；把手下拉或点遮罩关闭，返回键先关它）。一屏布局，网格行高 `minmax(2.2rem, 1fr)` 占满可用高度；滚轮翻周（累计 60px 翻一周、冷却 380ms），鼠标中键回本周；翻周按钮是底部居中的半透明悬浮胶囊 `.week-float`，长度固定（用户要求不要变长变短）：中间一格在本周写灰色「本周」（不可点），离开本周时交叉淡变成主题色「回到本周」；翻周时网格不动（用户要求）：标题周数（含春夏秋冬）与日期用 `components/Roll.tsx` 按位做密码锁式上下滚动，只滚变了的那一位；课程格子按 星期 + 节次 + 课名 + 教室 认，两周都有的原地不动，出现 / 消失的淡入淡出（`AnimatePresence`），往后翻向上滚、往前翻向下滚，回本周按来向决定方向；预取前后一周课次。教务会把连上的课拆成几条，`lib/calendar.mergeSessions` 把同一天、同名、同教室、节次相接且只隔普通课间（≤10 分钟，不跨大课间 / 午休 / 晚饭）的合成一节，主页今日课程同样合并。
- 节次作息表在 `lib/periods.ts`。
- **徽标「钟鹰」**：无外环、无底色，右半边是几何化的求是鹰（倒三角、四层羽、朝右的鹰头，照校标特征抽象，不照搬原图），左半边两根主题色指针；鹰身不用黑色，用 `--emblem`（昼间黛蓝 #2A3B57、夜间浅灰蓝）。几何在 `components/Logo.tsx`。界面上不放在刊头，而是 `App.tsx` 里的衬底 `.page-emblem`：放大压在左下角、越出左下两边、低不透明度，回放页不放；它挂在页面外层，在有衬底的页面之间切换不重播，出现时用与 `Reveal` 相同的"上浮 + 去模糊"；设置页「徽标」可隐藏（`settings.emblem`）。软件图标 `build/icon.svg` 用同一组几何（透明底、黛蓝鹰、求是蓝 #1F5FBF 指针，viewBox 裁到图形本身），改动后 `npx electron scripts/make-icon.cjs` 与 `scripts/make-android-icons.cjs` 重新生成（安卓自适应图标须有底板，背景层用纸色）。求是鹰图形浙大已申请商标，用户知情后选定此方案。
- 页面滚动区 `main.app-scroller` 设 `scrollbar-gutter: stable`：长页与一屏页切换时新旧页重叠会让滚动条一闪，整页宽度跳动重排（用户感到「组件尺寸变来变去、卡一下」）。设置页的 PTA / MCP 状态先显示内存缓存。
- 窗口无边框（`titleBarOverlay` 高 56px，与刊头同高；`--mast-h` 取 `env(titlebar-area-height, 56px)`，不能写成 rem——根字号随窗口缩放，小窗口时导航会比窗口按钮偏高），刊头右侧为系统按钮留出 140px；可拖动区域加 `.drag`。

### 窗口卡死（AppHang）教训

2026-10 排查结论：主进程事件循环从未阻塞（`diagnostics.ts` 有 >1s 卡顿监测，日志在 userData/logs/app.log；Windows 事件日志里是 `Application Hang`/AppHangB1，而非崩溃）。卡死总伴随 GPU 重负载（视频解码、Whisper CUDA ~80%）叠加昂贵的合成：全窗 `mix-blend-mode` 覆盖层、上千行逐行 `filter: blur` 动画、每条新结果整表重渲染。因此：
- 2026-11-01 晚上两次「只是看回放」就卡死，看门狗都记到 `main-thread-stall` 后不再恢复（主线程卡在原生调用里）；实测播放 1080p 回放时占用很低（渲染进程、显卡进程各约 8% 单核，显卡 4–7%），不是资源问题。已关掉系统媒体控制（`disable-features=HardwareMediaKeyHandling,MediaSessionService`，Electron 里有卡主线程的已知问题，应用用不到媒体键），效果待用户验证；`disable-features` 只能写一次。用户说的「动效结束时背景轻微闪烁」在用户自己的录屏里录不到（只有整屏均匀 1 级的编码起伏），应是显示器层面的（160Hz 4K 小米显示器，可变刷新率 / 局部调光）。
- 2026-11-01 又一次 AppHang（转写早已结束、启动约一分钟，无主线程卡顿、无渲染进程无响应记录）。本机为 RTX 5060 Ti + AMD 核显 + 三块虚拟显示适配器，Chromium 用 NVIDIA、启用 DirectComposition 与叠加平面（MPO）。已加 `disable-direct-composition-video-overlays`（视频不走 MPO），并在 `diagnostics.ts` 加独立线程的主线程看门狗（卡住超 3 秒记 `main-thread-stall`、恢复记 `main-thread-recovered`）与启动时的 `gpu-info`，下次卡死据此判断。
- 开发版窗口被别的窗口完全挡住时 Chromium 视为隐藏、动画帧暂停（页面切换停在退场）：脚本化测试时给 electron 加 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`。内置浏览器面板在后台时同理。
- 不要加全窗 blend/filter 覆盖层；纸纹画在 `body` 背景上（`--grain`）。
- 长列表与流式结果用普通元素，不做逐行 filter 动画；主进程推送需节流（转写 partial 每 250ms 合并一次）。
- 2026-10-23 再次在 Whisper 识别约一分半后 AppHang：CUDA 占满显卡时 Chromium GPU 进程被饿住，它挂在主窗口下的子窗口把主窗口拖成未响应。曾试过整个界面关闭硬件加速（`disableHardwareAcceleration`），转写不再卡死但界面明显卡顿，用户否决；现保留 GPU 合成、只关硬件视频解码，改为限制 Whisper 的显卡占空比（见上文转写）。Whisper/ffmpeg 子进程以低于正常优先级运行。
- **Claude 桌面版是 MSIX 包**：从会话里启动的 shell 及其子进程（含 `npm run dev`、手动启动的安装版）读写 `%APPDATA%` 会被重定向到 `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming`，看到的 userData（日志、cookie、Whisper 临时目录）不是用户真实使用的那份；用户自己启动的应用写在真实 `%APPDATA%`。要读真实日志，用 `Invoke-CimMethod Win32_Process Create` 起一个包外进程把文件复制到工作区外，读完即删。
- 排查时：转写临时目录 userData/whisper/task-* 里剩下的文件能看出卡在哪一步（有 audio.wav 无 transcript.json = 识别阶段）。
- 隐藏/最小化窗口时动画帧暂停，`AnimatePresence mode="wait"` 的页面切换会停在退场阶段，脚本化测试前先 `Page.bringToFront`。

### 构建细节

`package.json` 为 `"type": "module"`，但沙箱 preload 必须是 CommonJS，故 `electron.vite.config.ts` 将其输出为 `out/preload/index.cjs`，`src/main/index.ts` 按此路径加载，改一处需同步另一处。路径别名 `@shared/*`、`@renderer/*` 需同时在 vite 配置与对应 tsconfig 中维护。
