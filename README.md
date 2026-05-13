# pi-browser-cdp-extension

[![CI](https://img.shields.io/badge/CI-typecheck%20%2B%20tests-brightgreen.svg)](#validation) [![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](./package.json)

CDP browser execution extension for Pi. It brings a BrowserCode-style `browser_execute` tool to `pi-coding-agent`, so Pi can connect directly to Chromium/Chrome DevTools Protocol, run JavaScript, drive pages, inspect the DOM, capture screenshots, and return screenshots as image results.

> Unlike Playwright or Puppeteer, this package is not a standalone browser testing framework and does not host a daemon. It is a Pi extension tool that reuses a persistent CDP session inside the Pi process, which is useful when a coding agent needs temporary access to a real browser you explicitly authorize.

中文文档: [README.zh-CN.md](./README.zh-CN.md)

## Quick Start

### 1. Install the extension

```bash
pi install git:github.com/citrolabs/pi-browser-cdp-extension
```

For local development:

```bash
pi install .
```

### 2. Start Chrome with CDP enabled

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$(pwd)/.pi/chrome-data-dir"
```

### 3. Use `browser_execute` in Pi

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

If you do not know the `<id>`, open:

```bash
curl http://127.0.0.1:9222/json/version
```

Then copy the returned `webSocketDebuggerUrl`.

## What it gives Pi

- `browser_execute`: Pi-callable tool name.
- `session`: persistent CDP session; multiple calls in the same Pi session reuse browser state.
- `console`: captures `log`, `error`, `warn`, `info`, and `debug` output and streams it back in the tool result.
- Screenshot collection: successful `Page.captureScreenshot` calls are automatically converted into Pi image content.
- Workspace support: reusable scripts can live in `.pi/browser-execute-workspace` and be loaded from snippets with `await import(...)`.

## Who should use this

Use this when you need:

- Pi to operate a real Chrome page instead of only reading HTML.
- Login state, browser extensions, real browser behavior, or direct DevTools Protocol access.
- A coding agent to reuse one browser session across multiple tool calls.

Do not use this for:

- Pure unit testing; Playwright or Vitest is more direct.
- Untrusted pages or untrusted CDP endpoints. CDP can control the connected browser, so only connect to browsers you authorize.

## Configuration

Environment variables:

- `BU_CDP_WS` / `BU_CDP_URL`: default browser WebSocket endpoint used by `session.connect()`.
- `BCODE_SCREENSHOT_DIR`: optional directory where screenshots are also dumped locally.

One-off extension load:

```bash
pi -e ./extensions/browser-execute.ts
```

## Validation

The repository covers core execution, CDP session helpers, and the Pi extension adapter.

```bash
npm run typecheck
npm test
```

Current tests cover session reuse/isolation, workspace imports, console streaming, timeout handling, screenshot collection, CDP target filtering, active `sessionId` routing, and Pi image content conversion.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=citrolabs/pi-browser-cdp-extension&type=Date)](https://star-history.com/#citrolabs/pi-browser-cdp-extension&Date)
