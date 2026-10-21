# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ZJU All in One：聚合浙江大学学业信息（课表、考试、作业、智云课堂回放）并提供课堂工具（PPT 提取、课堂转写）的桌面应用。核心诉求：**只登录一次统一身份认证**；**主页一屏给出所有必要信息**，板块越少越好。

技术栈：Electron + electron-vite（Vite 8 / rolldown）+ React 19 + TypeScript 7 + Tailwind CSS v4 + motion + zustand。包管理用 npm。

## 常用命令

```bash
npm run dev                  # 开发模式
ZJU_DEMO=1 npm run dev       # 演示数据模式：不登录即可调前端（数据通道全部换成 services/demo.ts）
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
- 登录态组合在 `ipc.ts`：`auth:state` = 有 CAS cookie 时调 `zdbk.fetchProfile()` 取姓名（失败时 `user: null` 但仍算已登录）；`auth:logout` 清 cookie 后调用各 service 的 `reset()`。
- 每个 service 自己维护一次性的 `ensureLogin()` 与 `reset()`，请求一律走 `src/main/http.ts` 的 `zjuFetch`。**不要用 `session.fetch`**：Electron 45 下它跟随跳转后 `response.url` 恒为空串，`redirect: 'manual'` 则直接抛错；`zjuFetch` 基于 `net.request` 的 `redirect` 事件记录最终 URL。重定向后不在目标站点即视为未登录，抛 `Error('未登录')`。渲染进程把这类错误显示为"登录后显示"。

### 数据源（未以登录态实测，字段处有"推测"注释）

优先参考已实测的开源实现，而非臆测：教务/学在浙大见 [Celechron](https://github.com/Celechron/Celechron)（`lib/http/zjuServices/`、`lib/model/`），学在浙大/智云课堂见 [zju-learning-assistant](https://github.com/PeiPei233/zju-learning-assistant)（`src-tauri/src/zju_assist.rs`）。新增数据源时先找这类现成轮子，把相关源码片段交给 Astra 对照实现。

- `services/zdbk.ts` 本科教务：SSO 入口 `/jwglxt/xtgl/login_ssologin.html` → zjuam。课表 `kbcx/xskbcx_cxXsKb.html?gnmkdm=N253508`，表单 `xnm=2025-2026`、`xqm=1|秋` 等；考试 `xskscx/kscx_cxXsgrksIndex.html`（含期中 `qz*` 字段）。端点参考开源项目 Celechron。
- `services/courses.ts` 学在浙大（TronClass）：经 `identity.zju.edu.cn`（Keycloak，broker 到 zjuam）SSO，待办来自 `/api/todos`。
- `services/classroom.ts` 智云课堂：以下从其前端 bundle 逆向得到，可信度较高——token 在 `.zju.edu.cn` 的 `_token` cookie（PHP 序列化，正则提取），请求头 `Authorization: Bearer <token>`；无 token 时访问 `https://tgmedia.cmc.zju.edu.cn?forward=…&tenant_code=112` 走 CAS 换取。课程月历 `courseapi/v2/course-live/get-my-course-month`，课件 `pptnote/v1/schedule/search-ppt`，平台自带 AI 转写 `courseapi/v3/web-socket/search-trans-result`，回放页 `/livingpage?course_id&sub_id&tenant_code=112`。`listSlides`/`getTranscript` 已实现但尚未接 IPC，是两个课堂工具的内核。

### 回放、转写、作业提交

- 回放页（`pages/Replay.tsx`）：`<video>` 直接播放 `replay:playback` 返回的签名地址（`vod.cmc.zju.edu.cn`，签名见 `classroom.getPlaybackUrl`，部分账号 `phone` 为空按空串签）；默认 session 对 `*.cmc.zju.edu.cn` 补 Referer。课件图是 http 地址，靠 CSP 的 `upgrade-insecure-requests` 升级为 https。
- 转写：`src/main/asr/whisper.ts`，首次使用下载 whisper.cpp CUDA 12.4 构建（b5454，约 684MB）与 `ggml-large-v3-turbo-q5_0`（hf-mirror，约 574MB）到 userData/whisper；ffmpeg 来自 `ffmpeg-static`（安装时设 `FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static`）。GPU 失败时以 `-ng` 重跑一次。结果缓存在 userData/transcripts。**不使用智云自带转写**（用户认为效果差）。
- 导出：`src/main/export.ts`，课件用隐藏窗口 `printToPDF`，文字稿 txt/srt/md。
- 作业提交（`courses.submitHomework`）流程逆向自学在浙大前端：`POST /api/uploads` → `PUT upload_url` → `POST /api/course/activities/{id}/submissions`。**真实提交不可撤回，调试时不要替用户点提交**；界面上需两次点击确认。
- 直播：`sub_status` 1 直播中 / 2 未开始 / 3 回放生成中 / 5 无回放 / 6 回放；直播流为 `search-live-course-list` 的 `sub_content.output.m3u8` + `clientUUID`，渲染端用 hls.js 播放（CSP 需 `connect-src`，主进程对 cmc 域补 CORS 头）。
- 课表按周翻页依赖 Celechron 公开校历 `calendar.celechron.top/<学年-学期>.json`；`exchange` 键前 8 位为放假日、后 8 位为调休上课日（上课日按放假日课表排）。

### 渲染进程与设计语言

风格沿用 AoiKJuice 主站（`C:\Project\AoiKJuice\frontend\aoi-next`）："Stay Quiet"、去卡片化、高效率。
- 纸与墨配色 + 朱色（`--shu`）为唯一强调色；EB Garamond + 方正书宋（字体文件在 `src/renderer/public/type/`）；颗粒纸纹；空心描边大字（`OutlineWord`）作页面水印；进入动画为"上浮 + 去模糊"（`Reveal`，按 `i` 错落）。
- **界面不放解释性、冗余文字**：不写副标题、计数、来源注记、功能描述；空状态只写"无"。
- **不要用卡片**：信息用 `.rows/.row`（时间 · 正文 · 尾注，细线分隔）呈现，区块标题用 `SectionHead`；空/错/未登录状态统一用 `Quiet` 一行小字。样式类集中在 `styles.css`，颜色只用 CSS 变量（`--paper/--ink/--ink-2/--ink-3/--rule/--tint/--shu`）。
- 主题由 `html[data-theme]` 决定（`lib/theme.ts`，存 localStorage），刊头"昼/夜"切换。
- 导航只有主页、课表；回放页从主页回放条目进入，作业详情与提交在右侧侧页（`AssignmentSheet`）。主页为一屏布局（`.page-fit` + `.panes`），各区块内部滚动；根字号随视口缩放（`html { font-size: clamp(...) }`），小窗口时整体缩小而不是整页下滑。路由是 zustand `store.ts` 的 `page` 状态；登录状态变化时 `epoch` 自增，`useZju` 据此自动重拉。
- 节次作息表在 `lib/periods.ts`。
- 窗口无边框（`titleBarOverlay` 高 56px，与刊头同高），刊头右侧为系统按钮留出 140px；可拖动区域加 `.drag`。

### 窗口卡死（AppHang）教训

2026-10 排查结论：主进程事件循环从未阻塞（`diagnostics.ts` 有 >1s 卡顿监测，日志在 userData/logs/app.log；Windows 事件日志里是 `Application Hang`/AppHangB1，而非崩溃）。卡死总伴随 GPU 重负载（视频解码、Whisper CUDA ~80%）叠加昂贵的合成：全窗 `mix-blend-mode` 覆盖层、上千行逐行 `filter: blur` 动画、每条新结果整表重渲染。因此：
- 不要加全窗 blend/filter 覆盖层；纸纹画在 `body` 背景上（`--grain`）。
- 长列表与流式结果用普通元素，不做逐行 filter 动画；主进程推送需节流（转写 partial 每 250ms 合并一次）。
- Windows 上关闭了硬件视频解码（`index.ts`），Whisper/ffmpeg 子进程以低于正常优先级运行。
- 隐藏/最小化窗口时动画帧暂停，`AnimatePresence mode="wait"` 的页面切换会停在退场阶段，脚本化测试前先 `Page.bringToFront`。

### 构建细节

`package.json` 为 `"type": "module"`，但沙箱 preload 必须是 CommonJS，故 `electron.vite.config.ts` 将其输出为 `out/preload/index.cjs`，`src/main/index.ts` 按此路径加载，改一处需同步另一处。路径别名 `@shared/*`、`@renderer/*` 需同时在 vite 配置与对应 tsconfig 中维护。
