import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectBrowsers, listPageTargets, resolveWsUrl, Session } from "../src/cdp/session.js";

// Mock child_process for ESM compatibility
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

const tempDirs: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CDP session helpers", () => {
  it("resolves explicit wsUrl unchanged", async () => {
    await expect(resolveWsUrl({ wsUrl: "ws://127.0.0.1:9222/devtools/browser/id" }, 10)).resolves.toBe(
      "ws://127.0.0.1:9222/devtools/browser/id",
    );
  });

  it("resolves profileDir from DevToolsActivePort", async () => {
    const profileDir = await tmp("pi-browser-profile-");
    await writeFile(path.join(profileDir, "DevToolsActivePort"), "9222\n/devtools/browser/abc\n", "utf8");

    await expect(resolveWsUrl({ profileDir }, 100)).resolves.toBe("ws://127.0.0.1:9222/devtools/browser/abc");
  });

  it("rejects malformed DevToolsActivePort content", async () => {
    const profileDir = await tmp("pi-browser-profile-");
    await writeFile(path.join(profileDir, "DevToolsActivePort"), "not-a-port\n/devtools/browser/abc\n", "utf8");

    await expect(resolveWsUrl({ profileDir }, 20)).rejects.toThrow(/malformed port line|Polled/);
  });

  it("detectBrowsers does not report malformed candidates", async () => {
    const originalHome = process.env.HOME;
    const home = await tmp("pi-browser-home-");
    process.env.HOME = home;
    try {
      const chromeDir = path.join(home, "Library", "Application Support", "Google", "Chrome");
      await mkdir(chromeDir, { recursive: true });
      await writeFile(path.join(chromeDir, "DevToolsActivePort"), "bad\n/devtools/browser/abc\n", "utf8");

      expect(await detectBrowsers()).toEqual([]);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("listPageTargets filters internal non-page targets", async () => {
    const session = new Session();
    session.domains.Target.getTargets = async () => ({
      targetInfos: [
        { targetId: "1", title: "Chrome", url: "chrome://settings", type: "page", attached: false, canAccessOpener: false },
        { targetId: "2", title: "DevTools", url: "devtools://devtools/bundled/inspector.html", type: "page", attached: false, canAccessOpener: false },
        { targetId: "3", title: "Worker", url: "https://example.com/worker.js", type: "service_worker", attached: false, canAccessOpener: false },
        { targetId: "4", title: "Example", url: "https://example.com", type: "page", attached: false, canAccessOpener: false },
      ],
    });

    await expect(listPageTargets(session)).resolves.toEqual([
      { targetId: "4", title: "Example", url: "https://example.com", type: "page", attached: false, canAccessOpener: false },
    ]);
  });

  it("routes page-level CDP calls through the active session id", async () => {
    const session = new Session();
    const sent: string[] = [];
    const fakeWs = {
      readyState: WebSocket.OPEN,
      send(raw: string) {
        sent.push(raw);
      },
      close() {
        for (const pending of (session as unknown as { pending: Map<number, { reject(error: unknown): void }> }).pending.values()) {
          pending.reject(new Error("CDP socket closed"));
        }
      },
    };
    Object.defineProperty(session, "ws", { value: fakeWs, configurable: true });
    session.setActiveSession("attached-session");

    const pagePromise = session._call("Page.navigate", { url: "https://example.com" });
    const browserPromise = session._call("Target.getTargets", {});

    const [pageMsg, browserMsg] = sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
    expect(pageMsg).toMatchObject({ method: "Page.navigate", sessionId: "attached-session" });
    expect(browserMsg).toMatchObject({ method: "Target.getTargets" });
    expect(browserMsg).not.toHaveProperty("sessionId");

    // Close rejects outstanding promises so this test does not leak pending work.
    session.close();
    await expect(pagePromise).rejects.toThrow(/CDP socket closed/);
    await expect(browserPromise).rejects.toThrow(/CDP socket closed/);
  });

  it("connect auto-launches Chrome when launchBrowser is true and profileDir is empty", async () => {
    const profileDir = await tmp("pi-browser-launch-");
    const session = new Session();

    // Mock spawn to simulate Chrome starting and writing the port file
    const { spawn } = await import("node:child_process");
    const mockChild: any = {
      on: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    };
    vi.mocked(spawn).mockReturnValue(mockChild);

    // Mock WebSocket connection so it doesn't try to open a real WS connection
    const openWsSpy = vi.spyOn(session as any, "openWs").mockResolvedValue(undefined);

    // Simulate Chrome writing the file after a short delay
    setTimeout(async () => {
      await writeFile(path.join(profileDir, "DevToolsActivePort"), "9222\n/devtools/browser/abc\n", "utf8");
    }, 50);

    await session.connect({
      profileDir,
      launchBrowser: true,
      timeoutMs: 1000,
    });

    expect(spawn).toHaveBeenCalled();
    expect(openWsSpy).toHaveBeenCalledWith("ws://127.0.0.1:9222/devtools/browser/abc", 1000);

    vi.mocked(spawn).mockReset();
    openWsSpy.mockRestore();
  });

  it("connect reuses existing Chrome instance if profileDir has active port", async () => {
    const profileDir = await tmp("pi-browser-reuse-");
    const session = new Session();

    const { spawn } = await import("node:child_process");
    const openWsSpy = vi.spyOn(session as any, "openWs").mockResolvedValue(undefined);

    // Write DevToolsActivePort beforehand to simulate a running browser
    await writeFile(path.join(profileDir, "DevToolsActivePort"), "9225\n/devtools/browser/xyz\n", "utf8");

    await session.connect({
      profileDir,
      launchBrowser: true,
      timeoutMs: 1000,
    });

    // It should connect directly without calling spawn
    expect(spawn).not.toHaveBeenCalled();
    expect(openWsSpy).toHaveBeenCalledWith("ws://127.0.0.1:9225/devtools/browser/xyz", 1000);

    vi.mocked(spawn).mockReset();
    openWsSpy.mockRestore();
  });
});
