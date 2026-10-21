# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ZJU All in One：聚合浙江大学学业信息（课表、考试、作业、智云课堂回放）并提供实用工具（直播课 PPT 提取、课堂音频转文字）的桌面应用。核心诉求：**只登录一次统一身份认证**；界面简约、动效精致。

技术栈：Electron + electron-vite（Vite 8 / rolldown）+ React 19 + TypeScript 7 + Tailwind CSS v4 + motion（framer-motion 的新包名）+ zustand + lucide-react。包管理用 npm。

## 常用命令

```bash
npm run dev        # 开发模式（渲染进程 HMR，主进程/预加载改动会自动重启）
npm run build      # 构建到 out/
npm run preview    # 运行构建产物
npm run typecheck  # 分别对 node（main/preload/shared）和 web（renderer）两套 tsconfig 做类型检查
```

目前没有测试和 lint 配置。

Electron 二进制从 GitHub 下载在国内网络下会失败（`fetch failed`）。重新安装依赖时设置镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，或安装后手动执行 `node node_modules/electron/install.js`（同样带该环境变量）。

## 架构

三层进程，`src/shared/` 为两端共享的类型：

- **`src/main/`** — 所有网络请求都在主进程中发出（无 CORS 限制，可共享 cookie）。
- **`src/preload/`** — 将 IPC 通道按 1:1 暴露为 `window.zju[channel]`。
- **`src/renderer/`** — React UI，只通过 `window.zju` 获取数据，从不直接访问 ZJU 站点。

### IPC 契约（新增功能时最关键）

`src/shared/ipc.ts` 中的 `ZjuApi` 接口是唯一事实来源：每个键即一个 `ipcMain.handle` 通道。新增通道需：
1. 在 `ZjuApi` 中添加签名，并加入 `ZJU_CHANNELS` 数组；
2. 在 `src/main/ipc.ts` 的 `handlers` 中实现（`Handlers` 类型会强制覆盖每个通道）；
3. preload 自动遍历 `ZJU_CHANNELS`，无需修改。

当前通道均无参数；若需要带参数的通道，要同时修改 preload 的转发逻辑和 `ipc.ts` 的 handler 签名。

### 认证（`src/main/auth/zjuam.ts`）

统一身份认证 CAS 位于 `zjuam.zju.edu.cn/cas`。登录方式是弹出一个真实的 `BrowserWindow` 让用户手动登录（自然处理验证码与 RSA 加密表单），而非无头模拟。所有 cookie 存放在持久化分区 `persist:zju` 中；以出现 `iPlanetDirectoryPro` cookie 作为登录成功的判定。

各服务模块应通过 `zjuSession().fetch(casLoginUrl(<service>))` 复用 CAS 会话完成 SSO，**不要**另建 session 或另存 cookie。

### 数据服务（`src/main/services/`）

每个数据源一个模块：`zdbk.ts`（本科教务：课表、考试）、`courses.ts`（学在浙大：作业）、`classroom.ts`（智云课堂：回放，后续的 PPT/音频工具也基于它）。所有函数返回 `DataResult<T>`，其 `source: 'live' | 'mock'` 会让 UI 显示“示例数据”标记。目前**全部返回 `mock.ts` 中的占位数据**——各模块注释中的 TODO 说明了待接入的真实接口（端点尚未验证）。接入真实数据时把 `mock(...)` 换成 `{ data, source: 'live', fetchedAt }`。

### 渲染进程

- 路由是 zustand store（`store.ts`）里的 `page` 状态，不使用 react-router；`App.tsx` 用 `PAGES` 映射 + `AnimatePresence` 做页面切换动画。新增页面 = 在 `PageId` 中加 id、在 `PAGES` 和 `Sidebar.tsx` 的 `NAV` 中注册。
- `hooks/useZju.ts`：`useZju('data:xxx')` 在挂载时拉取任意 `data:*` 通道，返回 `{ data, source, loading, error, reload }`，类型从 `ZjuApi` 自动推导。
- 设计 token 定义在 `styles.css` 的 `@theme` 中（`canvas/surface/line/ink/muted/accent/...`），深色模式通过 `prefers-color-scheme` 覆盖同名 CSS 变量。组件使用 `bg-surface`、`text-muted` 等语义类，不要硬编码颜色。
- 通用 UI 原语（`PageHeader`、`Card`、`Stagger`/`StaggerItem` 交错入场动画）在 `components/ui.tsx`。
- 窗口为无边框（`titleBarStyle: 'hidden'` + `titleBarOverlay`）：可拖动区域加 `.drag` 类；按钮/链接/输入框已默认 `no-drag`。

### 构建细节

`package.json` 为 `"type": "module"`，但沙箱化的 preload 必须是 CommonJS，因此 `electron.vite.config.ts` 中将 preload 输出强制为 `out/preload/index.cjs`，`src/main/index.ts` 也按此路径加载。修改其中一处时需同步另一处。路径别名：`@shared/*`（三端可用）、`@renderer/*`（仅渲染进程），需同时在 `electron.vite.config.ts` 与对应 tsconfig 中维护。
