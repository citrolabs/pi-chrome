# pi-browser-cdp-extension

[![CI](https://img.shields.io/badge/CI-typecheck%20%2B%20tests-brightgreen.svg)](#validation) [![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](./package.json)

A CDP-powered browser execution extension for Pi. It adds a BrowserCode-style `browser_execute` tool to `pi-coding-agent`, allowing Pi to connect to Chromium/Chrome through the DevTools Protocol, run JavaScript, drive pages, inspect the DOM, capture screenshots, and return screenshots as image results.

The motivation is simple: `pi-coding-agent` is excellent for code work, but it does not provide built-in web search or browser access. This project gives Pi a small, explicit bridge to a user-authorized browser, so an agent can work with live web pages when the task requires it.

This is not a standalone browser testing framework and does not host a daemon. It is a Pi extension that reuses a persistent CDP session inside the Pi process.

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

After installation, talk to Pi normally and ask it to use the browser. Pi can call the extension's `browser_execute` tool when it needs to operate a real page.

Example:

```text
Open https://example.com in the browser, tell me the page title, and return a screenshot.
```

Pi will connect to an authorized Chromium browser, drive the page, inspect the result, and attach the screenshot.

## What it gives Pi

- `browser_execute`: Pi-callable tool name.
- `session`: persistent CDP session; multiple calls in the same Pi session reuse browser state.
- `console`: captures `log`, `error`, `warn`, `info`, and `debug` output and streams it back in the tool result.
- Screenshot collection: successful `Page.captureScreenshot` calls are automatically converted into Pi image content.
- Workspace support: reusable scripts can live in `.pi/browser-execute-workspace` and be loaded from snippets with `await import(...)`.

## Compared with web search tools

Popular Pi web-search packages such as `pi-web-access` and `@ollama/pi-web-search` are optimized for search, fetch, and text extraction. This extension is optimized for controlling a real browser.

| Project | Primary focus | Where this extension is stronger |
| --- | --- | --- |
| `pi-web-access` | Broad web research: search, URL fetching, GitHub repo cloning, PDFs, YouTube, and local video analysis. | Real browser operation: click, type, navigate, inspect live DOM state, reuse login sessions and extensions, and return screenshots from the actual page. |
| `@ollama/pi-web-search` | Lightweight search and fetch through Ollama's web APIs. | Provider-independent CDP control: Pi can drive an authorized Chromium browser directly instead of depending on one search/fetch backend. |
| `pi-browser-cdp-extension` | Browser execution through Chrome DevTools Protocol. | Best fit when the task needs interaction, authenticated pages, browser-only behavior, visual verification, or persistent page state across steps. |

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

## Acknowledgements

The shape of this project was inspired by the following work:

- [browser-use/browser-harness](https://github.com/browser-use/browser-harness)
- [browser-use/browsercode](https://github.com/browser-use/browsercode)
- [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=citrolabs/pi-browser-cdp-extension&type=Date)](https://star-history.com/#citrolabs/pi-browser-cdp-extension&Date)
