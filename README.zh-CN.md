# pi-browser-cdp-extension 中文文档

[![CI](https://img.shields.io/badge/CI-typecheck%20%2B%20tests-brightgreen.svg)](#validation) [![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](./package.json)

这是一个为 Pi 提供 CDP 浏览器执行能力的扩展。它把 BrowserCode 风格的 `browser_execute` 工具带到 `pi-coding-agent`，让 Pi 可以通过 Chrome DevTools Protocol 连接 Chromium/Chrome，执行 JavaScript、驱动页面、读取 DOM、截图，并把截图作为图片结果返回。

这个项目的出发点很直接：`pi-coding-agent` 很适合处理代码任务，但框架本身不提供内置的 web search 或浏览器访问能力。这个扩展为 Pi 提供一个小而明确的入口，让 agent 在任务需要时可以使用由用户授权的真实浏览器。

它不是独立的浏览器测试框架，也不托管 daemon；它是一个 Pi 扩展，会复用 Pi 进程里的持久 CDP session。

English: [README.md](./README.md)

## 快速开始

### 1. 安装扩展

```bash
pi install git:github.com/citrolabs/pi-browser-cdp-extension
```

本地开发时也可以：

```bash
pi install .
```

安装完成后，正常和 Pi 对话，让它使用浏览器即可。需要操作真实页面时，Pi 会调用扩展提供的 `browser_execute` 工具。

例如：

```text
打开 https://example.com，告诉我页面标题，并返回一张截图。
```

Pi 会连接已授权的 Chromium 浏览器，打开页面、读取结果，并把截图附在回复里。

## 给 Pi 提供什么

- `browser_execute`：Pi 可调用的工具名。
- `session`：持久 CDP Session，同一个 Pi session 内多次调用会复用状态。
- `console`：捕获 `log/error/warn/info/debug`，作为工具输出流式返回。
- 截图收集：成功的 `Page.captureScreenshot` 会自动转成 Pi image content。
- Workspace：可复用脚本放在 `.pi/browser-execute-workspace`，snippet 里用 `await import(...)` 加载。

## 和 web search 工具对比

`pi-web-access`、`@ollama/pi-web-search` 这类热门 Pi web-search 包，核心能力是搜索、抓取和文本提取。这个扩展的重点不是再做一个搜索接口，而是让 Pi 操控真实浏览器。

| 项目 | 核心定位 | 这个扩展的优势 |
| --- | --- | --- |
| `pi-web-access` | 综合 web research：搜索、URL 抓取、GitHub repo clone、PDF、YouTube 和本地视频分析。 | 真实浏览器操作：点击、输入、跳转、读取 live DOM 状态、复用登录态和浏览器扩展，并返回真实页面截图。 |
| `@ollama/pi-web-search` | 基于 Ollama web API 的轻量搜索和网页抓取。 | 不绑定单一搜索/抓取后端；Pi 可以直接通过 CDP 操控已授权的 Chromium 浏览器。 |
| `pi-browser-cdp-extension` | 通过 Chrome DevTools Protocol 执行浏览器操作。 | 适合需要交互、登录态、浏览器真实行为、视觉验证、以及跨步骤持久页面状态的任务。 |

## 适用场景

适合：

- 想让 Pi 操作真实 Chrome 页面，而不是只读 HTML。
- 需要登录态、扩展、真实浏览器环境或 DevTools 协议能力。
- 希望 agent 在同一会话里持续复用 browser session。

不适合：

- 纯单元测试场景；用 Playwright/Vitest 更直接。
- 不可信网页或不可信 CDP endpoint。CDP 能控制浏览器，必须只连你授权的浏览器。

## 配置

环境变量：

- `BU_CDP_WS` / `BU_CDP_URL`：默认浏览器 WebSocket endpoint，供 `session.connect()` 使用。
- `BCODE_SCREENSHOT_DIR`：可选；把截图同时 dump 到本地目录。

一次性加载扩展：

```bash
pi -e ./extensions/browser-execute.ts
```

## Validation

本仓库覆盖核心执行、CDP session helper、Pi extension adapter 三层测试。

```bash
npm run typecheck
npm test
```

当前测试覆盖包括：session 复用/隔离、workspace import、console streaming、timeout、screenshot 收集、CDP target 过滤、active sessionId 路由、Pi image content 转换。

## 致谢

这个项目的设计思路受到以下项目启发：

- [browser-use/browser-harness](https://github.com/browser-use/browser-harness)
- [browser-use/browsercode](https://github.com/browser-use/browsercode)
- [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=citrolabs/pi-browser-cdp-extension&type=Date)](https://star-history.com/#citrolabs/pi-browser-cdp-extension&Date)
