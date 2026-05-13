import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeBrowserCode, MAX_TIMEOUT_MS, serialize } from "../src/browser-execute.js";
import { SessionStore } from "../src/session-store.js";

const tempDirs: string[] = [];
const sessionIds = new Set<string>();

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function trackSession(sessionID: string): string {
  sessionIds.add(sessionID);
  return sessionID;
}

async function flushAsyncFileWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

afterEach(async () => {
  for (const sessionID of sessionIds) SessionStore.evict(sessionID);
  sessionIds.clear();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  delete process.env.BCODE_SCREENSHOT_DIR;
});

describe("browser_execute core", () => {
  it("captures console output and serializes return values", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const result = await executeBrowserCode(
      {
        description: "Exercise console capture",
        code: `console.log("hello", { ok: true }); console.debug("debug-line"); return { n: 1n };`,
      },
      { sessionID: trackSession("console-session"), workspaceDir },
    );

    expect(result.output).toContain("hello");
    expect(result.output).toContain('"ok": true');
    expect(result.output).toContain("debug-line");
    expect(JSON.parse(result.result)).toEqual({ n: "1" });
    expect(result.screenshots).toEqual([]);
  });

  it("creates the workspace before running the snippet", async () => {
    const root = await tmp("pi-browser-root-");
    const workspaceDir = path.join(root, "nested", "workspace");
    const result = await executeBrowserCode(
      {
        description: "Check workspace exists",
        code: `const fs = await import("node:fs/promises"); return (await fs.stat(${JSON.stringify(workspaceDir)})).isDirectory();`,
      },
      { sessionID: trackSession("workspace-session"), workspaceDir },
    );

    expect(JSON.parse(result.result)).toBe(true);
  });

  it("streams accumulated console output through onChunk", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const chunks: string[] = [];

    await executeBrowserCode(
      {
        description: "Stream output chunks",
        code: `console.log("first"); console.warn("second"); return "ok";`,
      },
      { sessionID: trackSession("chunk-session"), workspaceDir, onChunk: (output) => chunks.push(output) },
    );

    expect(chunks).toEqual(["first\n", "first\nsecond\n"]);
  });

  it("keeps SessionStore state across calls with the same session id", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const sessionID = trackSession("reuse-session");

    await executeBrowserCode(
      {
        description: "Set session state",
        code: `session.__testValue = 42; return null;`,
      },
      { sessionID, workspaceDir },
    );

    const result = await executeBrowserCode(
      {
        description: "Read session state",
        code: `return session.__testValue;`,
      },
      { sessionID, workspaceDir },
    );

    expect(JSON.parse(result.result)).toBe(42);
  });

  it("isolates SessionStore state for different session ids", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");

    await executeBrowserCode(
      {
        description: "Set isolated state",
        code: `session.__testValue = "left"; return null;`,
      },
      { sessionID: trackSession("left-session"), workspaceDir },
    );

    const result = await executeBrowserCode(
      {
        description: "Read isolated state",
        code: `return session.__testValue ?? null;`,
      },
      { sessionID: trackSession("right-session"), workspaceDir },
    );

    expect(JSON.parse(result.result)).toBeNull();
  });

  it("collects screenshot results observed during the snippet", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const sessionID = trackSession("screenshot-session");
    const png = Buffer.from("png-bytes").toString("base64");
    const jpeg = Buffer.from("jpeg-bytes").toString("base64");

    const result = await executeBrowserCode(
      {
        description: "Collect screenshots",
        code: `
          for (const fn of session.callResultListeners) fn("Page.captureScreenshot", { format: "png" }, { data: ${JSON.stringify(png)} });
          for (const fn of session.callResultListeners) fn("Page.captureScreenshot", { format: "jpeg" }, { data: ${JSON.stringify(jpeg)} });
          return "done";
        `,
      },
      { sessionID, workspaceDir },
    );

    expect(result.screenshots).toEqual([
      { mime: "image/png", base64: png },
      { mime: "image/jpeg", base64: jpeg },
    ]);
  });

  it("ignores malformed screenshot results", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const result = await executeBrowserCode(
      {
        description: "Ignore malformed screenshot",
        code: `
          for (const fn of session.callResultListeners) fn("Page.captureScreenshot", {}, { data: 123 });
          for (const fn of session.callResultListeners) fn("Runtime.evaluate", {}, { data: "not-a-shot" });
          return "done";
        `,
      },
      { sessionID: trackSession("malformed-screenshot-session"), workspaceDir },
    );

    expect(result.screenshots).toEqual([]);
  });

  it("dumps screenshots to BCODE_SCREENSHOT_DIR when configured", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const dumpDir = await tmp("pi-browser-shotdump-");
    process.env.BCODE_SCREENSHOT_DIR = dumpDir;
    const base64 = Buffer.from("shot-bytes").toString("base64");

    await executeBrowserCode(
      {
        description: "Dump screenshot",
        code: `for (const fn of session.callResultListeners) fn("Page.captureScreenshot", { format: "webp" }, { data: ${JSON.stringify(base64)} });`,
      },
      { sessionID: trackSession("dump-session"), workspaceDir },
    );

    await flushAsyncFileWrites();
    const files = await readdir(dumpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.webp$/);
    expect(await readFile(path.join(dumpDir, files[0]!), "utf8")).toBe("shot-bytes");
  });

  it("unsubscribes screenshot listener after success", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const sessionID = trackSession("unsubscribe-success-session");
    const session = SessionStore.get(sessionID);
    const originalOnCallResult = session.onCallResult.bind(session);
    const unsub = vi.fn();
    vi.spyOn(session, "onCallResult").mockImplementation((fn) => {
      const realUnsub = originalOnCallResult(fn);
      return () => {
        realUnsub();
        unsub();
      };
    });

    await executeBrowserCode(
      { description: "Return successfully", code: `return "ok";` },
      { sessionID, workspaceDir },
    );

    expect(unsub).toHaveBeenCalledOnce();
  });

  it("unsubscribes screenshot listener after snippet failure", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const sessionID = trackSession("unsubscribe-failure-session");
    const session = SessionStore.get(sessionID);
    const originalOnCallResult = session.onCallResult.bind(session);
    const unsub = vi.fn();
    vi.spyOn(session, "onCallResult").mockImplementation((fn) => {
      const realUnsub = originalOnCallResult(fn);
      return () => {
        realUnsub();
        unsub();
      };
    });

    await expect(
      executeBrowserCode({ description: "Throw failure", code: `throw new Error("boom");` }, { sessionID, workspaceDir }),
    ).rejects.toThrow(/boom/);

    expect(unsub).toHaveBeenCalledOnce();
  });

  it("surfaces syntax errors as clean failures", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    await expect(
      executeBrowserCode(
        {
          description: "Trigger syntax error",
          code: "const x = (",
        },
        { sessionID: trackSession("syntax-session"), workspaceDir },
      ),
    ).rejects.toThrow(/syntax error in browser_execute snippet/);
  });

  it("surfaces runtime failures with stack context", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    await expect(
      executeBrowserCode(
        {
          description: "Trigger runtime error",
          code: `throw new Error("runtime-boom")`,
        },
        { sessionID: trackSession("runtime-session"), workspaceDir },
      ),
    ).rejects.toThrow(/browser_execute snippet threw: .*runtime-boom/s);
  });

  it("times out snippets that yield", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    await expect(
      executeBrowserCode(
        {
          description: "Trigger timeout",
          timeout: 10,
          code: "await new Promise((resolve) => setTimeout(resolve, 100)); return 'late';",
        },
        { sessionID: trackSession("timeout-session"), workspaceDir },
      ),
    ).rejects.toThrow(/browser_execute timed out/);
  });

  it("caps requested timeout at MAX_TIMEOUT_MS", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    let observedDelay: number | undefined;
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      observedDelay = Number(timeout);
      return originalSetTimeout(handler, 0, ...args) as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);

    await executeBrowserCode(
      {
        description: "Cap timeout",
        timeout: MAX_TIMEOUT_MS + 1,
        code: `return "ok";`,
      },
      { sessionID: trackSession("max-timeout-session"), workspaceDir },
    );

    expect(observedDelay).toBe(MAX_TIMEOUT_MS);
  });

  it("serializes circular values as strings", () => {
    const obj: { self?: unknown } = {};
    obj.self = obj;
    expect(JSON.parse(serialize(obj))).toContain("[object Object]");
  });

  it("supports workspace dynamic imports", async () => {
    const workspaceDir = await tmp("pi-browser-workspace-");
    const helperPath = path.join(workspaceDir, "helper.mjs");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(helperPath, `export function answer() { return 42; }`, "utf8");

    const result = await executeBrowserCode(
      {
        description: "Import workspace helper",
        code: `const mod = await import(${JSON.stringify(helperPath)} + "?t=" + Date.now()); return mod.answer();`,
      },
      { sessionID: trackSession("import-session"), workspaceDir },
    );

    expect(JSON.parse(result.result)).toBe(42);
  });
});
