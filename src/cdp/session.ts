/**
 * CDP Session: one persistent WebSocket to Chrome's browser endpoint.
 * Auto-injects sessionId for the active target on page-level calls.
 *
 * Connect with flatten:true so all sessions share one WebSocket.
 */

import { readFile, stat, mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn } from "node:child_process";
import { bindDomains, type Domains, type Transport } from "./generated.js";
import path from "node:path";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export type ConnectOptions = {
  /** Full browser-level WS URL: ws://host:port/devtools/browser/<id>. */
  wsUrl?: string;
  /** Read DevToolsActivePort from a browser profile/user-data directory. */
  profileDir?: string;
  /** Per-candidate WS-open timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Launch Chrome with --user-data-dir=profileDir when no existing browser is detected. */
  launchBrowser?: boolean;
};

export type DetectedBrowser = {
  name: string;
  profileDir: string;
  port: number;
  wsPath: string;
  wsUrl: string;
  mtimeMs: number;
};

export class Session implements Transport {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private activeSessionId: string | undefined;
  private chromeProcess?: import("node:child_process").ChildProcess;
  private eventListeners: Array<(method: string, params: unknown, sessionId?: string) => void> = [];
  private callResultListeners: Array<(method: string, params: unknown, result: unknown) => void> = [];

  domains!: Domains;

  constructor() {
    this.domains = bindDomains(this);
    for (const key of Object.keys(this.domains) as Array<keyof Domains>) {
      (this as unknown as Record<string, unknown>)[key as string] = this.domains[key];
    }
  }

  async connect(opts: ConnectOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 5_000;

    if (opts.wsUrl) {
      await this.openWs(opts.wsUrl, timeoutMs);
      return;
    }

    if (opts.profileDir) {
      const parsed = await tryReadDevToolsActivePort(opts.profileDir);
      if (parsed) {
        try {
          await this.openWs(`ws://127.0.0.1:${parsed.port}${parsed.path}`, timeoutMs);
          return;
        } catch {
          // Fall through to launch if connection failed
        }
      }

      if (opts.launchBrowser) {
        const wsUrl = await this.launchChrome(opts.profileDir, timeoutMs);
        await this.openWs(wsUrl, timeoutMs);
        return;
      }

      const wsUrl = await resolveWsUrl(opts, timeoutMs);
      await this.openWs(wsUrl, timeoutMs);
      return;
    }

    const envWsUrl = process.env.BU_CDP_WS ?? process.env.BU_CDP_URL;
    if (envWsUrl) {
      await this.openWs(envWsUrl, timeoutMs);
      return;
    }

    const browsers = await detectBrowsers();
    if (browsers.length > 0) {
      const errors: string[] = [];
      for (const browser of browsers) {
        try {
          await this.openWs(browser.wsUrl, timeoutMs);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`  ${browser.name} @ ${browser.wsUrl}: ${message}`);
        }
      }
      throw new Error(
        `No detected browser accepted a connection. If one of these is the browser you want, click "Allow" on its remote-debugging prompt and retry:\n${errors.join("\n")}`,
      );
    }

    if (opts.launchBrowser) {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
      const defaultProfile = path.join(home, ".pi-browser-profile");
      const wsUrl = await this.launchChrome(defaultProfile, timeoutMs);
      await this.openWs(wsUrl, timeoutMs);
      return;
    }

    const scanned = getBrowserCandidates().map((candidate) => candidate.name).join(", ");
    throw new Error(
      `No running browser with remote debugging detected. Enable it from chrome://inspect > "Discover network targets", or pass { profileDir } / { wsUrl } explicitly. Scanned: ${scanned}.`,
    );
  }

  private openWs(wsUrl: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let done = false;

      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) {
          try {
            ws.close();
          } catch {
            // Ignore close failures while reporting the original connection error.
          }
          reject(error);
        } else {
          resolve();
        }
      };

      const timer = setTimeout(() => finish(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      ws.addEventListener("open", () => finish());
      ws.addEventListener("error", (event) =>
        finish(new Error(`WS error: ${(event as ErrorEvent)?.message ?? "connect failed (likely 403, permission not granted, or port closed)"}`)),
      );
      ws.addEventListener("message", (event) => this.onMessage(String(event.data)));
      ws.addEventListener("close", () => {
        for (const pending of this.pending.values()) pending.reject(new Error("CDP socket closed"));
        this.pending.clear();
        finish(new Error("WS closed before open (likely 403 or port closed)"));
      });

      this.ws = ws;
    });
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.ws?.close();
    if (this.chromeProcess) {
      this.chromeProcess.kill();
      this.chromeProcess = undefined;
    }
  }

  async use(targetId: string): Promise<string> {
    const result = (await this._call("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
    this.activeSessionId = result.sessionId;
    return result.sessionId;
  }

  setActiveSession(sessionId: string | undefined): void {
    this.activeSessionId = sessionId;
  }

  getActiveSession(): string | undefined {
    return this.activeSessionId;
  }

  onEvent(fn: (method: string, params: unknown, sessionId?: string) => void): () => void {
    this.eventListeners.push(fn);
    return () => {
      this.eventListeners = this.eventListeners.filter((listener) => listener !== fn);
    };
  }

  onCallResult(fn: (method: string, params: unknown, result: unknown) => void): () => void {
    this.callResultListeners.push(fn);
    return () => {
      this.callResultListeners = this.callResultListeners.filter((listener) => listener !== fn);
    };
  }

  waitFor<T = unknown>(method: string, predicate?: (params: T) => boolean, timeoutMs = 30_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);

      const unsubscribe = this.onEvent((eventMethod, params) => {
        if (eventMethod !== method) return;
        if (predicate && !predicate(params as T)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(params as T);
      });
    });
  }

  _call(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected. Call session.connect(...) first."));
    }

    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method, params: params ?? {} };
    if (this.activeSessionId && !isBrowserLevel(method)) {
      msg.sessionId = this.activeSessionId;
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => {
          for (const fn of this.callResultListeners) {
            try {
              fn(method, params, value);
            } catch {
              // Listener failures must not poison the CDP response path.
            }
          }
          resolve(value);
        },
        reject,
      });
      this.ws?.send(JSON.stringify(msg));
    });
  }

  private async launchChrome(profileDir: string, timeoutMs: number): Promise<string> {
    const chromePath = process.env.BROWSER_PATH ?? this.findChrome();
    if (!chromePath) {
      throw new Error("Chrome not found. Set BROWSER_PATH or install Chrome.");
    }

    await mkdir(profileDir, { recursive: true });

    const child = spawn(chromePath, [
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=OptimizationGuideModelDownloading,OptimizationGuideFetching,OptimizationTargetPrediction,OptimizationHints",
    ], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.chromeProcess = child;

    const filePath = `${profileDir}/DevToolsActivePort`;
    const deadline = Date.now() + timeoutMs;

    return new Promise<string>((resolve, reject) => {
      let lastErr = "unknown";

      const poll = async () => {
        try {
          const text = (await readFile(filePath, "utf8")).trim();
          const [portStr, path] = text.split("\n");
          const port = Number(portStr);
          if (!Number.isFinite(port)) {
            lastErr = `malformed port: ${portStr}`;
            if (Date.now() < deadline) setTimeout(poll, 250);
            else reject(new Error(`Chrome started but no valid DevToolsActivePort: ${lastErr}`));
            return;
          }
          if (!path || !path.startsWith("/devtools/")) {
            lastErr = `invalid path: ${path}`;
            if (Date.now() < deadline) setTimeout(poll, 250);
            else reject(new Error(`Chrome started but bad DevToolsActivePort: ${lastErr}`));
            return;
          }
          child.on("exit", () => {}); // ignore exit after successful connect
          resolve(`ws://127.0.0.1:${port}${path}`);
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (Date.now() < deadline) setTimeout(poll, 250);
          else reject(new Error(`Chrome may have exited: ${lastErr}`));
        }
      };

      (child.stdout ?? process.stdout).on("data", (chunk: Buffer) => {
        const msg = String(chunk).trim();
        if (msg) console.warn(`[chrome] ${msg}`);
      });

      (child.stderr ?? process.stderr).on("data", (chunk: Buffer) => {
        const msg = String(chunk).trim();
        if (msg) console.warn(`[chrome-stderr] ${msg}`);
      });

      child.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Chrome exited with code ${code ?? "null"}`));
        }
      });

      poll();
    });
  }

  private findChrome(): string | undefined {
    switch (process.platform) {
      case "darwin": return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      case "linux": return process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
      case "win32": {
        const local = process.env.LOCALAPPDATA ?? "";
        return local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : undefined;
      }
    }
    return undefined;
  }

  private onMessage(raw: string): void {
    let message: { id?: unknown; method?: unknown; params?: unknown; sessionId?: string; error?: { code: number; message: string; data?: unknown }; result?: unknown };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new CdpError(message.error.code, message.error.message, message.error.data));
      else pending.resolve(message.result);
      return;
    }

    if (typeof message.method === "string") {
      for (const fn of this.eventListeners) {
        try {
          fn(message.method, message.params, message.sessionId);
        } catch {
          // Event listeners are observational.
        }
      }
    }
  }
}

export class CdpError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(`CDP ${code}: ${message}`);
    this.name = "CdpError";
  }
}

function isBrowserLevel(method: string): boolean {
  return method.startsWith("Browser.") || method.startsWith("Target.");
}

export async function resolveWsUrl(opts: ConnectOptions, timeoutMs: number): Promise<string> {
  if (opts.wsUrl) return opts.wsUrl;
  if (opts.profileDir) {
    const { port, path } = await readDevToolsActivePort(opts.profileDir, timeoutMs);
    return `ws://127.0.0.1:${port}${path}`;
  }
  throw new Error("resolveWsUrl needs { wsUrl } or { profileDir }. For auto-detect, call session.connect() directly.");
}

async function readDevToolsActivePort(profileDir: string, timeoutMs: number): Promise<{ port: number; path: string }> {
  const filePath = `${profileDir}/DevToolsActivePort`;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    try {
      const text = (await readFile(filePath, "utf8")).trim();
      const [portStr, path] = text.split("\n");
      const port = Number(portStr);
      if (!Number.isFinite(port)) throw new Error(`malformed port line: ${portStr}`);
      if (!path || !path.startsWith("/devtools/")) {
        throw new Error(`missing/invalid path line in DevToolsActivePort: ${JSON.stringify(text)}`);
      }
      return { port, path };
    } catch (error) {
      lastErr = error;
      await sleep(250);
    }
  }

  throw new Error(
    `Polled ${filePath} for ${timeoutMs}ms: ${lastErr}. ` +
      `Chrome 147+ may not write this file when launched with --user-data-dir. ` +
      `Try fetch("http://127.0.0.1:<port>/json/version") -> webSocketDebuggerUrl, then session.connect({ wsUrl }).`,
  );
}

export type PageTarget = { targetId: string; title: string; url: string; type: string };

export async function listPageTargets(session: Session): Promise<PageTarget[]> {
  const { targetInfos } = (await session.domains.Target.getTargets({})) as { targetInfos: PageTarget[] };
  return targetInfos.filter((target) => target.type === "page" && !target.url.startsWith("chrome://") && !target.url.startsWith("devtools://"));
}

export async function detectBrowsers(): Promise<DetectedBrowser[]> {
  const candidates = getBrowserCandidates();
  const detected: DetectedBrowser[] = [];

  for (const { name, profileDir } of candidates) {
    const parsed = await tryReadDevToolsActivePort(profileDir);
    if (!parsed) continue;
    detected.push({
      name,
      profileDir,
      port: parsed.port,
      wsPath: parsed.path,
      wsUrl: `ws://127.0.0.1:${parsed.port}${parsed.path}`,
      mtimeMs: parsed.mtimeMs,
    });
  }

  detected.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return detected;
}

type BrowserCandidate = { name: string; profileDir: string };

function getBrowserCandidates(): BrowserCandidate[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const list: BrowserCandidate[] = [];
  const push = (name: string, profileDir: string) => list.push({ name, profileDir });

  if (process.platform === "darwin") {
    const base = `${home}/Library/Application Support`;
    push("Google Chrome", `${base}/Google/Chrome`);
    push("Chromium", `${base}/Chromium`);
    push("Microsoft Edge", `${base}/Microsoft Edge`);
    push("Brave", `${base}/BraveSoftware/Brave-Browser`);
    push("Arc", `${base}/Arc/User Data`);
    push("Vivaldi", `${base}/Vivaldi`);
    push("Opera", `${base}/com.operasoftware.Opera`);
    push("Comet", `${base}/Comet`);
    push("Google Chrome Canary", `${base}/Google/Chrome Canary`);
  } else if (process.platform === "linux") {
    const cfg = `${home}/.config`;
    push("Google Chrome", `${cfg}/google-chrome`);
    push("Chromium", `${cfg}/chromium`);
    push("Microsoft Edge", `${cfg}/microsoft-edge`);
    push("Brave", `${cfg}/BraveSoftware/Brave-Browser`);
    push("Vivaldi", `${cfg}/vivaldi`);
    push("Opera", `${cfg}/opera`);
    push("Google Chrome Canary", `${cfg}/google-chrome-unstable`);
  } else if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
    push("Google Chrome", `${local}\\Google\\Chrome\\User Data`);
    push("Chromium", `${local}\\Chromium\\User Data`);
    push("Microsoft Edge", `${local}\\Microsoft\\Edge\\User Data`);
    push("Brave", `${local}\\BraveSoftware\\Brave-Browser\\User Data`);
    push("Arc", `${local}\\Arc\\User Data`);
    push("Vivaldi", `${local}\\Vivaldi\\User Data`);
    push("Opera", `${local}\\Opera Software\\Opera Stable`);
    push("Google Chrome Canary", `${local}\\Google\\Chrome SxS\\User Data`);
  }

  return list;
}

async function tryReadDevToolsActivePort(profileDir: string): Promise<{ port: number; path: string; mtimeMs: number } | undefined> {
  try {
    const filePath = `${profileDir}/DevToolsActivePort`;
    const [text, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    const [portStr, path] = text.trim().split("\n");
    const port = Number(portStr);
    if (!Number.isFinite(port)) return undefined;
    if (!path || !path.startsWith("/devtools/")) return undefined;
    return { port, path, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}
