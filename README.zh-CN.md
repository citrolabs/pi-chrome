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

### 2. 启动带 CDP 的 Chrome

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$(pwd)/.pi/chrome-data-dir"
```

### 3. 在 Pi 里使用 `browser_execute`

```js
await session.connect({ wsUrl: "ws://127.0.0.1:9222/devtools/browser/<id>" })
const targets = (await session.Target.getTargets({})).targetInfos
const page = targets.find(t => t.type === "page" && !t.url.startsWith("chrome://"))
await session.use(page.targetId)
await session.Page.enable()
await session.Page.navigate({ url: "https://example.com" })
await session.waitFor("Page.loadEventFired")
await session.Page.captureScreenshot({ format: "png" })
```

如果不知道 `<id>`，先打开：

```bash
curl http://127.0.0.1:9222/json/version
```

复制返回里的 `webSocketDebuggerUrl`。

## 给 Pi 提供什么

- `browser_execute`：Pi 可调用的工具名。
- `session`：持久 CDP Session，同一个 Pi session 内多次调用会复用状态。
- `console`：捕获 `log/error/warn/info/debug`，作为工具输出流式返回。
- 截图收集：成功的 `Page.captureScreenshot` 会自动转成 Pi image content。
- Workspace：可复用脚本放在 `.pi/browser-execute-workspace`，snippet 里用 `await import(...)` 加载。

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
