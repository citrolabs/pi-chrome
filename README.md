<div align="center">
  <h1>pi-browser-cdp-extension</h1>
  <p>A real-browser CDP execution extension for Pi agents.</p>
  <p>
    <a href="https://www.npmjs.com/package/pi-browser-cdp-extension"><img alt="npm version" src="https://img.shields.io/npm/v/pi-browser-cdp-extension.svg"></a>
    <a href="./package.json"><img alt="Pi package" src="https://img.shields.io/badge/Pi-package-6f42c1.svg"></a>
    <a href="./package.json"><img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D20.6.0-339933.svg"></a>
    <a href="#validation"><img alt="CI" src="https://img.shields.io/badge/CI-typecheck%20%2B%20tests-brightgreen.svg"></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
    <a href="https://github.com/citrolabs/pi-browser-cdp-extension"><img alt="GitHub stars" src="https://img.shields.io/github/stars/citrolabs/pi-browser-cdp-extension.svg?style=social"></a>
  </p>
</div>

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

## Why not just web search?

Web-search tools help Pi find and summarize information. `pi-browser-cdp-extension` gives Pi hands-on control of a real Chromium browser, so it can complete tasks that search/fetch tools cannot represent as plain text.

| Capability | `pi-web-access` / `@ollama/pi-web-search` | `pi-browser-cdp-extension` |
| --- | --- | --- |
| Search the public web | Strong fit | Not the primary goal |
| Fetch and summarize static pages | Strong fit | Possible, but usually overkill |
| Click buttons, type into forms, and follow UI flows | Limited or unavailable | Native browser automation through CDP |
| Use authenticated sessions | Usually requires API-level access or copied cookies | Reuses the user's authorized browser profile/session |
| Work with browser extensions and real browser behavior | No | Yes, because Pi drives the actual browser |
| Inspect dynamic DOM state after JavaScript runs | Limited to fetched HTML or rendered text | Direct live DOM and DevTools Protocol access |
| Verify what the user would actually see | Text-first | Screenshots returned as Pi image results |
| Keep state across multiple agent steps | Tool/backend dependent | Persistent CDP session inside the Pi process |

Use web-search packages when the task is "find information." Use this extension when the task is "operate the website."

## Who should use this

Use this when you need:

- Pi to operate a real Chrome page instead of only reading HTML.
- Login state, browser extensions, real browser behavior, or direct DevTools Protocol access.
- A coding agent to reuse one browser session across multiple tool calls.

Do not use this for:

- Pure unit testing; Playwright or Vitest is more direct.
- Untrusted pages or untrusted CDP endpoints. CDP can control the connected browser, so only connect to browsers you authorize.

## Auto-launching Chrome

When you pass a `profileDir` to `browser_execute`, the extension can automatically launch Chrome if no browser with remote debugging is already connected.

The tool accepts a `profileDir` parameter:

```javascript
await session.connect({
  profileDir: '/home/user/.ds4/browser',
  launchBrowser: true,
});
```

The extension will:
1. Create the profile directory if it doesn't exist
2. Launch Chrome with `--remote-debugging-port=0 --user-data-dir=<profileDir> --no-first-run --no-default-browser-check`
3. Wait for Chrome to write `DevToolsActivePort` and connect

If the directory already has a Chrome instance running with remote debugging, it reuses that instance.

To customize the Chrome executable path, set `BROWSER_PATH` or `CHROME_BIN` environment variable.

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
