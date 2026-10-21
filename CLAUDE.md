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

流程：把任务说明 + 相关文件内容写进一个 prompt 文件 → `node scripts/astra.mjs <prompt.md> <out.md>`（需环境变量 `ASTRA_API_KEY`；多个独立任务可各开一个进程并行）→ 审查回复 → `node scripts/astra-apply.mjs . <out.md>` 写入文件 → typecheck。给 Astra 的 prompt 必须附上 `src/shared/types.ts`，否则它会自拟字段名。逆向得到的真实接口事实（见下文）应一并提供给它，避免臆测端点。

## 架构

三层进程，`src/shared/` 为共享类型：
- **`src/main/`**：所有网络请求在主进程发出（无 CORS，共享 cookie）。
- **`src/preload/`**：将 IPC 通道 1:1 暴露为 `window.zju[channel]`。
- **`src/renderer/`**：React UI，只通过 `window.zju` 取数。

### IPC 契约

`src/shared/ipc.ts` 的 `ZjuApi` 是唯一事实来源。新增通道：加到 `ZjuApi` 和 `ZJU_CHANNELS` → 在 `src/main/ipc.ts` 的 `handlers` 实现（类型强制覆盖每个通道）→ preload 自动转发。现有通道均无参数；带参通道需同时改 preload 转发和 handler 签名。

### 认证与 SSO

- `auth/zjuam.ts` 只负责 CAS：弹出真实 `BrowserWindow` 让用户在 `zjuam.zju.edu.cn` 登录，cookie 存于持久分区 `persist:zju`，以 `iPlanetDirectoryPro` cookie 判定已登录。它**不得 import services**（避免循环依赖）。
- 登录态组合在 `ipc.ts`：`auth:state` = 有 CAS cookie 时调 `zdbk.fetchProfile()` 取姓名（失败时 `user: null` 但仍算已登录）；`auth:logout` 清 cookie 后调用各 service 的 `reset()`。
- 每个 service 自己维护一次性的 `ensureLogin()` 与 `reset()`，请求一律走 `src/main/http.ts` 的 `zjuFetch`。**不要用 `session.fetch`**：Electron 45 下它跟随跳转后 `response.url` 恒为空串，`redirect: 'manual'` 则直接抛错；`zjuFetch` 基于 `net.request` 的 `redirect` 事件记录最终 URL。重定向后不在目标站点即视为未登录，抛 `Error('未登录')`。渲染进程把这类错误显示为"登录后显示"。

### 数据源（未以登录态实测，字段处有"推测"注释）

优先参考已实测的开源实现，而非臆测：教务/学在浙大见 [Celechron](https://github.com/Celechron/Celechron)（`lib/http/zjuServices/`、`lib/model/`），学在浙大/智云课堂见 [zju-learning-assistant](https://github.com/PeiPei233/zju-learning-assistant)（`src-tauri/src/zju_assist.rs`）。新增数据源时先找这类现成轮子，把相关源码片段交给 Astra 对照实现。

- `services/zdbk.ts` 本科教务：SSO 入口 `/jwglxt/xtgl/login_ssologin.html` → zjuam。课表 `kbcx/xskbcx_cxXsKb.html?gnmkdm=N253508`，表单 `xnm=2025-2026`、`xqm=1|秋` 等；考试 `xskscx/kscx_cxXsgrksIndex.html`（含期中 `qz*` 字段）。端点参考开源项目 Celechron。
- `services/courses.ts` 学在浙大（TronClass）：经 `identity.zju.edu.cn`（Keycloak，broker 到 zjuam）SSO，待办来自 `/api/todos`。
- `services/classroom.ts` 智云课堂：以下从其前端 bundle 逆向得到，可信度较高——token 在 `.zju.edu.cn` 的 `_token` cookie（PHP 序列化，正则提取），请求头 `Authorization: Bearer <token>`；无 token 时访问 `https://tgmedia.cmc.zju.edu.cn?forward=…&tenant_code=112` 走 CAS 换取。课程月历 `courseapi/v2/course-live/get-my-course-month`，课件 `pptnote/v1/schedule/search-ppt`，平台自带 AI 转写 `courseapi/v3/web-socket/search-trans-result`，回放页 `/livingpage?course_id&sub_id&tenant_code=112`。`listSlides`/`getTranscript` 已实现但尚未接 IPC，是两个课堂工具的内核。

### 渲染进程与设计语言

风格沿用 AoiKJuice 主站（`C:\Project\AoiKJuice\frontend\aoi-next`）："Stay Quiet"、去卡片化、高效率。
- 纸与墨配色 + 朱色（`--shu`）为唯一强调色；EB Garamond + 方正书宋（字体文件在 `src/renderer/public/type/`）；颗粒纸纹；空心描边大字（`OutlineWord`）作页面水印；进入动画为"上浮 + 去模糊"（`Reveal`，按 `i` 错落）。
- **界面不放解释性、冗余文字**：不写副标题、计数、来源注记、功能描述；空状态只写"无"。
- **不要用卡片**：信息用 `.rows/.row`（时间 · 正文 · 尾注，细线分隔）呈现，区块标题用 `SectionHead`；空/错/未登录状态统一用 `Quiet` 一行小字。样式类集中在 `styles.css`，颜色只用 CSS 变量（`--paper/--ink/--ink-2/--ink-3/--rule/--tint/--shu`）。
- 主题由 `html[data-theme]` 决定（`lib/theme.ts`，存 localStorage），刊头"昼/夜"切换。
- 只有三个页面：主页（今日/明日课程、截止、回放、考试汇在一屏，顶部一句话总结）、课表（周网格）、工具。路由是 zustand `store.ts` 的 `page` 状态；登录状态变化时 `epoch` 自增，`useZju` 据此自动重拉。
- 节次作息表在 `lib/periods.ts`。
- 窗口无边框（`titleBarOverlay` 高 56px，与刊头同高），刊头右侧为系统按钮留出 140px；可拖动区域加 `.drag`。

### 构建细节

`package.json` 为 `"type": "module"`，但沙箱 preload 必须是 CommonJS，故 `electron.vite.config.ts` 将其输出为 `out/preload/index.cjs`，`src/main/index.ts` 按此路径加载，改一处需同步另一处。路径别名 `@shared/*`、`@renderer/*` 需同时在 vite 配置与对应 tsconfig 中维护。
