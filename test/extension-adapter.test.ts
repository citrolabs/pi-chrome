import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import browserExecuteExtension from "../extensions/browser-execute.js";
import { SessionStore } from "../src/session-store.js";

const tempDirs: string[] = [];
const sessionIds = new Set<string>();

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function minimalContext(cwd: string, sessionId?: string): ExtensionContext & { sessionId?: string } {
  const ctx: ExtensionContext & { sessionId?: string } = {
    cwd,
    ui: {} as ExtensionContext["ui"],
    hasUI: false,
    sessionManager: {} as ExtensionContext["sessionManager"],
    modelRegistry: {} as ExtensionContext["modelRegistry"],
    model: undefined,
    signal: undefined,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
  };
  if (sessionId !== undefined) ctx.sessionId = sessionId;
  return ctx;
}

function loadTool(): ToolDefinition<any, any, any> {
  let registered: ToolDefinition<any, any, any> | undefined;
  browserExecuteExtension({
    registerTool(tool: ToolDefinition<any, any, any>) {
      registered = tool;
    },
  } as ExtensionAPI);

  if (!registered) throw new Error("extension did not register a tool");
  return registered;
}

afterEach(async () => {
  for (const sessionID of sessionIds) SessionStore.evict(sessionID);
  sessionIds.clear();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("browser_execute Pi extension adapter", () => {
  it("registers the browser_execute tool with prompt guidance", () => {
    const tool = loadTool();

    expect(tool.name).toBe("browser_execute");
    expect(tool.label).toBe("Browser Execute");
    expect(tool.promptSnippet).toContain("CDP");
    expect(tool.promptGuidelines?.some((line) => line.includes("session.connect"))).toBe(true);
  });

  it("returns text content and execution details", async () => {
    const cwd = await tmp("pi-browser-cwd-");
    const tool = loadTool();
    const updates: unknown[] = [];
    const sessionID = "adapter-session";
    sessionIds.add(sessionID);

    const result = await tool.execute(
      "tool-call-1",
      {
        description: "Adapter smoke test",
        code: `console.log("adapter-output"); return { ok: true };`,
      },
      undefined,
      (update) => updates.push(update),
      minimalContext(cwd, sessionID),
    );

    expect(result.content).toEqual([{ type: "text", text: 'adapter-output\n\n=> {\n  "ok": true\n}' }]);
    expect(result.details).toMatchObject({
      description: "Adapter smoke test",
      result: '{\n  "ok": true\n}',
      output: "adapter-output\n",
      screenshotCount: 0,
      workspaceDir: path.join(cwd, ".pi", "browser-execute-workspace"),
    });
    expect(updates).toEqual([{ content: [{ type: "text", text: "adapter-output\n" }], details: { output: "adapter-output\n" } }]);
  });

  it("falls back to cwd-derived session id when context lacks session id", async () => {
    const cwd = await tmp("pi-browser-cwd-");
    const tool = loadTool();
    const fallbackID = `cwd:${cwd}`;
    sessionIds.add(fallbackID);

    await tool.execute(
      "tool-call-1",
      { description: "Set fallback state", code: `session.__adapterState = "persisted"; return null;` },
      undefined,
      undefined,
      minimalContext(cwd),
    );

    const result = await tool.execute(
      "tool-call-2",
      { description: "Read fallback state", code: `return session.__adapterState;` },
      undefined,
      undefined,
      minimalContext(cwd),
    );

    expect(result.content[0]).toEqual({ type: "text", text: '=> "persisted"' });
  });

  it("converts collected screenshots to Pi image content", async () => {
    const cwd = await tmp("pi-browser-cwd-");
    const tool = loadTool();
    const sessionID = "adapter-screenshot-session";
    sessionIds.add(sessionID);
    const base64 = Buffer.from("image-bytes").toString("base64");

    const result = await tool.execute(
      "tool-call-1",
      {
        description: "Adapter screenshot test",
        code: `for (const fn of session.callResultListeners) fn("Page.captureScreenshot", { format: "png" }, { data: ${JSON.stringify(base64)} });`,
      },
      undefined,
      undefined,
      minimalContext(cwd, sessionID),
    );

    expect(result.content).toEqual([
      { type: "text", text: "(1 screenshot attached)" },
      { type: "image", mimeType: "image/png", data: base64 },
    ]);
    expect(result.details).toMatchObject({ screenshotCount: 1 });
  });

  it("truncates streamed output previews", async () => {
    const cwd = await tmp("pi-browser-cwd-");
    const tool = loadTool();
    const updates: Array<{ content?: Array<{ type: string; text: string }> }> = [];
    const sessionID = "adapter-preview-session";
    sessionIds.add(sessionID);

    await tool.execute(
      "tool-call-1",
      {
        description: "Adapter preview truncation",
        code: `console.log("x".repeat(30050)); return null;`,
      },
      undefined,
      (update) => updates.push(update as { content?: Array<{ type: string; text: string }> }),
      minimalContext(cwd, sessionID),
    );

    const text = updates.at(-1)?.content?.[0]?.text;
    expect(text?.startsWith("...\n\n")).toBe(true);
    expect(text?.length).toBe(30_005);
  });
});
