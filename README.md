# pi-browser-cdp-extension

Pi coding-agent package that exposes BrowserCode's CDP-powered `browser_execute` tool.

## Load


```bash
# 1.github install

pi install git:github.com/section9-lab/pi-browser-cdp-extension

# 2.local file
cd pi-browser-cdp-extension

pi install .
# or for one run
pi -e ./extensions/browser-execute.ts
```

## Tool

`browser_execute` runs JavaScript in-process with:

- `session`: persistent CDP session for this Pi process/session key.
- `console`: captured `log/error/warn/info/debug` output.
- standard JavaScript globals.

Connect first:

```js
await session.connect()
const targets = (await session.Target.getTargets({})).targetInfos
const page = targets.find(t => t.type === "page" && !t.url.startsWith("chrome://"))
await session.use(page.targetId)
await session.Page.enable()
await session.Page.navigate({ url: "https://example.com" })
await session.waitFor("Page.loadEventFired")
```

Environment overrides:

- `BU_CDP_WS` or `BU_CDP_URL`: fixed browser WebSocket endpoint for `session.connect()`.
- `BCODE_SCREENSHOT_DIR`: optional directory where captured screenshots are dumped.

Security: CDP controls the connected browser. Only enable this package from trusted source.
