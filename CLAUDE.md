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
npm run build                # 构建到 out/
npm run typecheck            # node（main/preload/shared）与 web（renderer）两套 tsconfig
```

没有测试与 lint 配置。Electron 二进制在国内网络下需镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（重装依赖或执行 `node node_modules/electron/install.js` 时设置）。

## 分工：与 Astra 协作

用户要求本项目由 Claude 与 ChatGPT Astra（`gpt-6-astra`，OpenAI 兼容接口）协作完成：
- **Claude**：构想、前端（`src/renderer/**`、样式、交互）、跨模块集成与延伸功能。
- **Astra**：内核（`src/main/services/**`、`src/main/auth/**` 的抓取、SSO、解析）编写与审查。**不让它碰前端，不让它写过度防御性代码**（层层 try/catch、逐字段校验、content-type 检查等），这些约束已写在 `scripts/astra-system.md`。

**不要把账号数据发给 Astra**：学号/用户 id、课程与活动 id、手机号、接口原始响应体都不能进 prompt（曾被权限系统拦截）。只给字段名与结构，值一律省略。

流程：把任务说明 + 相关文件内容写进一个 prompt 文件 → `node scripts/astra.mjs <prompt.md> <out.md>`（需环境变量 `ASTRA_API_KEY`；多个独立任务可各开一个进程并行）→ 审查回复 → `node scripts/astra-apply.mjs . <out.md>` 写入文件 → typecheck。给 Astra 的 prompt 必须附上 `src/shared/types.ts`，否则它会自拟字段名。逆向得到的真实接口事实（见下文）应一并提供给它，避免臆测端点。

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

优先参考已实测的开源实现，而非臆测：教务/学在浙大见 [Celechron](https://github.com/Celechron/Celechron)（`lib/http/zjuServices/`、`lib/model/`），学在浙大/智云课堂见 [zju-learning-assistant](https://github.com/PeiPei233/zju-learning-assistant)（`src-tauri/src/zju_assist.rs`）。新增数据源时先找这类现成轮子，把相关源码片段交给 Astra 对照实现。

- `services/zdbk.ts` 本科教务：SSO 入口 `/jwglxt/xtgl/login_ssologin.html` → zjuam。课表 `kbcx/xskbcx_cxXsKb.html?gnmkdm=N253508`，表单 `xnm=2025-2026`、`xqm=1|秋` 等；考试 `xskscx/kscx_cxXsgrksIndex.html`（含期中 `qz*` 字段）。端点参考开源项目 Celechron。
- `services/courses.ts` 学在浙大（TronClass）：经 `identity.zju.edu.cn`（Keycloak，broker 到 zjuam）SSO，待办来自 `/api/todos`。
- `services/classroom.ts` 智云课堂：以下从其前端 bundle 逆向得到，可信度较高——token 在 `.zju.edu.cn` 的 `_token` cookie（PHP 序列化，正则提取），请求头 `Authorization: Bearer <token>`；无 token 时访问 `https://tgmedia.cmc.zju.edu.cn?forward=…&tenant_code=112` 走 CAS 换取。课程月历 `courseapi/v2/course-live/get-my-course-month`，课件 `pptnote/v1/schedule/search-ppt`，平台自带 AI 转写 `courseapi/v3/web-socket/search-trans-result`，回放页 `/livingpage?course_id&sub_id&tenant_code=112`。`listSlides`/`getTranscript` 已实现但尚未接 IPC，是两个课堂工具的内核。

### 本地 MCP 服务

`src/main/mcp.ts`：供本机 Agent（Claude Code 等）调用的 MCP 服务，Streamable HTTP 无状态模式，只监听 `127.0.0.1:17321/mcp`，请求须带 `Authorization: Bearer <token>`（token 随机生成，与开关一起存 userData/mcp.json）。默认关闭，设置页开关；工具按组开关：查询（状态、课表含起止时刻、校历、考试、作业、作业详情、课次、课件、播放地址、文字稿）/ 下载（`download_file` 仅限 *.zju.edu.cn，用登录会话下附件、已交文件、课件图、回放视频；`export_slides_pdf`、`export_transcript`；默认存到"下载/ZJU All in One"，重名加序号，不弹保存框）/ 界面（`open_in_app` 经 `app:open` 事件打开页面、课次、作业侧页或登录面板；`refresh` 经 `app:refresh` 让界面重拉）/ 转写 / 提交与撤回（默认关）。**应用新增能力时同步补对应的 MCP 工具**（用户要求覆盖到位）。开发版与已安装版同时开 MCP 会抢端口，开发时设 `ZJU_MCP_PORT=17399`。工具一律经 `ipc.ts` 导出的 `call()` 复用通道实现，共用登录会话，演示模式也生效。**提交与撤回必须先经用户在应用内确认**：`askUser` 经 `app:confirm` 事件把请求推给界面（`components/AgentConfirm.tsx`，排队、文件可点开预览），用户答复经 `mcp:answer` 回到主进程，10 分钟无答复按取消。不用系统原生对话框（用户要求本软件风格）。测试只能在演示模式里点开发版窗口内的按钮，不要用模拟按键操作用户桌面。节次作息在 `src/shared/periods.ts`，主进程与界面共用。

### 回放、转写、作业提交

- 回放页（`pages/Replay.tsx`）：`<video>` 直接播放 `replay:playback` 返回的签名地址（`vod.cmc.zju.edu.cn`，签名见 `classroom.getPlaybackUrl`，部分账号 `phone` 为空按空串签）；默认 session 对 `*.cmc.zju.edu.cn` 补 Referer。课件图是 http 地址，靠 CSP 的 `upgrade-insecure-requests` 升级为 https。
- 转写：`src/main/asr/whisper.ts`，首次使用下载 whisper.cpp CUDA 12.4 构建（b5454，约 684MB）与 `ggml-large-v3-turbo-q5_0`（hf-mirror，约 574MB）到 userData/whisper；ffmpeg 来自 `ffmpeg-static`（安装时设 `FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static`）。`gpuPlan` 按显存决定用不用显卡：预算 = 总显存 30%（且至少给别的程序留 1GB 空闲），放得下模型（实测峰值约 1.1GB，束搜索与贪心相差无几）就上显卡，否则 `-ng` 走 CPU。上显卡时由 `asr/throttle.ts` 限制显卡占用：常驻 PowerShell 用 NtSuspendProcess / NtResumeProcess 按 200ms 周期、60% 占空比挂起与恢复 whisper-cli（实测 10 分钟音频平均占用 64% → 49%，耗时约 1.5 倍）；它的 stdin 关闭时会先恢复再退出。结果缓存在 userData/transcripts。**不使用智云自带转写**（用户认为效果差）。
- 导出：`src/main/export.ts`，课件用隐藏窗口 `printToPDF`，文字稿 txt/srt/md。
- 播放器（`components/Player.tsx`）为自绘控制条：回放有播放/进度/倍速，直播（hls）不允许暂停与拖动、被暂停会立即恢复；铺满窗口与全屏按钮相邻，全屏作用于整个播放器容器（字幕、控制条一起进全屏）。
- 课件区（`components/SlideViewer.tsx`）：缩略图 / 大图切换，大图可翻页、默认跟随当前讲解页（直播取最新一页，回放取 `created_sec` ≤ 播放时间的最后一页）；点击课件不影响播放，右键菜单"全窗口查看 / 下载"。
- 回放页布局：左列视频（`.player-wrap` 用容器查询取 min(列宽, 可用高 × 16/9)），右侧栏在 课件 / 文字稿 / 选集 间切换，三个面板始终挂载只隐藏（字幕依赖文字稿 DOM）。播放器控制条的「课件」按钮把视频位置切成当前讲解页（`useCurrentSlide`，声音照常），再点「画面」切回；不在视频下方另放课件区（用户明确不要）。右键视频切换铺满。
- **主进程请求校内 `http://` 地址会挂起不返回**（智云课件图 `pptimgurl` 就是 http）：渲染端靠 CSP `upgrade-insecure-requests` 才正常；主进程下载 / 导出前用 `download.ts` 的 `upgrade()` 升成 https。
- **下载一律在应用内完成**：`file:download`（保存框 + `main/download.ts` 用登录会话流式写盘，cmc 域补 Referer）与 `file:reveal`；不要用 `<a target=_blank>` 指向文件（会被 `setWindowOpenHandler` 交给浏览器）。作业说明里的文件链接也被拦截走应用内下载。
- 作业提交（`courses.submitHomework`）流程逆向自学在浙大前端：`POST /api/uploads` → `PUT upload_url` → `POST /api/course/activities/{id}/submissions`；已有草稿时与网页一致改用 `PUT` 并带 `submission_id` 覆盖草稿。**调试时不要替用户点真实提交**；界面上需两次点击确认。
- 撤回（`courses.retractSubmission`）逆向自学在浙大前端 homework 页（公开课程页 `courses.zju.edu.cn/course/<id>` 会加载完整前端代码，懒加载块在 runtime 的映射表里）：`PUT /api/submissions/{id}/retract`，错误码 40001 为撤回失败。可撤回条件与网页一致：`can_retract && !is_redo && !submit_by_instructor && activity.data.allow_retract`。撤回后该提交变成草稿（`submission_list` 里 `is_draft: true`），详情把草稿单列为 `draft`，不算已提交。
- 本机文件预览（`file:preview` / `components/FilePreview.tsx`）：图片、PDF、常见文本在应用内显示（blob 地址，CSP 放行 `img-src blob:` 与 `frame-src blob:`，PDF 依赖 `webPreferences.plugins: true` 的内置查看器），其余或超过 50MB 交给 `file:open`（系统默认程序）。
- 直播：`sub_status` 1 直播中 / 2 未开始 / 3 回放生成中 / 5 无回放 / 6 回放；直播流为 `search-live-course-list` 的 `sub_content.output.m3u8` + `clientUUID`，渲染端用 hls.js 播放（CSP 需 `connect-src`，主进程对 cmc 域补 CORS 头）。
- 课表按周翻页依赖 Celechron 公开校历 `calendar.celechron.top/<学年-学期>.json`；`exchange` 键前 8 位为放假日、后 8 位为调休上课日（上课日按放假日课表排）。

### 渲染进程与设计语言

风格沿用 AoiKJuice 主站（`C:\Project\AoiKJuice\frontend\aoi-next`）："Stay Quiet"、去卡片化、高效率。
- 纸与墨配色 + 朱色（`--shu`）为唯一强调色；EB Garamond + 方正书宋（字体文件在 `src/renderer/public/type/`）；颗粒纸纹；空心描边大字（`OutlineWord`）作页面水印；进入动画为"上浮 + 去模糊"（`Reveal`，按 `i` 错落）。
- **界面不放解释性、冗余文字**：不写副标题、计数、来源注记、功能描述；空状态只写"无"。
- **不用点号（·）作分隔**，用 `Sep`（细竖线）/ `Joined`（components/Type.tsx）；选中态用主题色下划线（刊头导航的滑动点除外）。
- **不要用卡片**：信息用 `.rows/.row`（时间 · 正文 · 尾注，细线分隔）呈现，区块标题用 `SectionHead`；空/错/未登录状态统一用 `Quiet` 一行小字。样式类集中在 `styles.css`，颜色只用 CSS 变量（`--paper/--ink/--ink-2/--ink-3/--rule/--tint/--shu`）。
- 主题色在播放器黑底控件上用提亮版本 `--shu-bright`（随 data-accent 定义）。
- 设置（`lib/settings.ts` + 设置页）写到 `html` 的 `data-theme` / `data-font`（song 书宋、hei 黑体、kai 文楷）/ `data-accent`（blue 求是蓝 #003F88、red 求是红即浙大 VI 的"创新红" #B01F24、shu 朱砂），存 localStorage。`--shu` 是"当前主题色"的变量名，不一定是朱色。 字号四档（小 / 标准 / 大 / 特大）写成 `--scale`，乘在根字号上，不提供自定义数值。
- 数字统一用 Source Serif 4 的等高数字（`AJ Digits` 只接管数字与常见符号的 unicode-range），不用 EB Garamond 的旧式数字。
- `Reveal` 动画结束会清掉 filter/transform：带 filter 的祖先会让 `position: fixed` 的后代（如铺满的播放器）只相对它定位。
- 导航只有主页、课表；回放页从主页回放条目进入，作业详情与提交在右侧侧页（`AssignmentSheet`）。主页为一屏布局（`.page-fit` + `.panes`），各区块内部滚动；根字号随视口缩放（`html { font-size: clamp(...) }`），小窗口时整体缩小而不是整页下滑。路由是 zustand `store.ts` 的 `page` 状态，`go`/`openReplay` 记入 `past`/`future`，鼠标侧键（button 3/4）返回 / 前进，作业侧页开着时返回先关侧页；主页滚到顶后继续上滚约三格触发刷新（`usePullRefresh`，刊头下一道细线示意）；登录状态变化时 `epoch` 自增，`useZju` 据此自动重拉。
- 节次作息表在 `lib/periods.ts`。
- 窗口无边框（`titleBarOverlay` 高 56px，与刊头同高），刊头右侧为系统按钮留出 140px；可拖动区域加 `.drag`。

### 窗口卡死（AppHang）教训

2026-10 排查结论：主进程事件循环从未阻塞（`diagnostics.ts` 有 >1s 卡顿监测，日志在 userData/logs/app.log；Windows 事件日志里是 `Application Hang`/AppHangB1，而非崩溃）。卡死总伴随 GPU 重负载（视频解码、Whisper CUDA ~80%）叠加昂贵的合成：全窗 `mix-blend-mode` 覆盖层、上千行逐行 `filter: blur` 动画、每条新结果整表重渲染。因此：
- 不要加全窗 blend/filter 覆盖层；纸纹画在 `body` 背景上（`--grain`）。
- 长列表与流式结果用普通元素，不做逐行 filter 动画；主进程推送需节流（转写 partial 每 250ms 合并一次）。
- 2026-10-23 再次在 Whisper 识别约一分半后 AppHang：CUDA 占满显卡时 Chromium GPU 进程被饿住，它挂在主窗口下的子窗口把主窗口拖成未响应。曾试过整个界面关闭硬件加速（`disableHardwareAcceleration`），转写不再卡死但界面明显卡顿，用户否决；现保留 GPU 合成、只关硬件视频解码，改为限制 Whisper 的显卡占空比（见上文转写）。Whisper/ffmpeg 子进程以低于正常优先级运行。
- **Claude 桌面版是 MSIX 包**：从会话里启动的 shell 及其子进程（含 `npm run dev`、手动启动的安装版）读写 `%APPDATA%` 会被重定向到 `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming`，看到的 userData（日志、cookie、Whisper 临时目录）不是用户真实使用的那份；用户自己启动的应用写在真实 `%APPDATA%`。要读真实日志，用 `Invoke-CimMethod Win32_Process Create` 起一个包外进程把文件复制到工作区外，读完即删。
- 排查时：转写临时目录 userData/whisper/task-* 里剩下的文件能看出卡在哪一步（有 audio.wav 无 transcript.json = 识别阶段）。
- 隐藏/最小化窗口时动画帧暂停，`AnimatePresence mode="wait"` 的页面切换会停在退场阶段，脚本化测试前先 `Page.bringToFront`。

### 构建细节

`package.json` 为 `"type": "module"`，但沙箱 preload 必须是 CommonJS，故 `electron.vite.config.ts` 将其输出为 `out/preload/index.cjs`，`src/main/index.ts` 按此路径加载，改一处需同步另一处。路径别名 `@shared/*`、`@renderer/*` 需同时在 vite 配置与对应 tsconfig 中维护。
