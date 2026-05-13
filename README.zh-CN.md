<div align="center">
  <h1>pi-browser-cdp-extension</h1>
  <p>让 Pi agent 操控真实浏览器的 CDP 执行扩展。</p>
  <p>
    <a href="https://www.npmjs.com/package/pi-browser-cdp-extension"><img alt="npm version" src="https://img.shields.io/npm/v/pi-browser-cdp-extension.svg"></a>
    <a href="./package.json"><img alt="Pi package" src="https://img.shields.io/badge/Pi-package-6f42c1.svg"></a>
    <a href="./package.json"><img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D20.6.0-339933.svg"></a>
    <a href="#validation"><img alt="CI" src="https://img.shields.io/badge/CI-typecheck%20%2B%20tests-brightgreen.svg"></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
    <a href="https://github.com/citrolabs/pi-browser-cdp-extension"><img alt="GitHub stars" src="https://img.shields.io/github/stars/citrolabs/pi-browser-cdp-extension.svg?style=social"></a>
  </p>
</div>

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

## 为什么不只用 web search？

Web-search 工具解决的是“帮 Pi 找资料、总结网页”。`pi-browser-cdp-extension` 解决的是“让 Pi 直接操控一个真实 Chromium 浏览器”，所以它能处理搜索/抓取工具很难表达成纯文本的任务。

| 能力 | `pi-web-access` / `@ollama/pi-web-search` | `pi-browser-cdp-extension` |
| --- | --- | --- |
| 搜索公开网页 | 很适合 | 不是主要目标 |
| 抓取并总结静态页面 | 很适合 | 可以做，但通常没必要 |
| 点击按钮、填写表单、走完整 UI 流程 | 受限或不支持 | 通过 CDP 原生操控浏览器 |
| 使用登录态 | 通常依赖 API 权限或手动复制 cookie | 直接复用用户已授权的浏览器 session |
| 使用浏览器扩展和真实浏览器行为 | 不支持 | 支持，因为 Pi 操控的就是实际浏览器 |
| 读取 JavaScript 运行后的动态 DOM | 通常只能拿到抓取 HTML 或文本 | 直接访问 live DOM 和 DevTools Protocol |
| 验证用户实际看到的页面 | 文本优先 | 截图会作为 Pi image result 返回 |
| 跨多轮 agent 步骤保持状态 | 取决于工具/后端 | Pi 进程内持久 CDP session |

任务是“找信息”时，用 web-search 包；任务是“操作网站”时，用这个扩展。

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
