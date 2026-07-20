import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionStore } from "../src/session-store.js";
import browserExecuteWebExtension from "../extensions/browser-execute-web.js";

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

function loadTools(): { webSearch: ToolDefinition<any, any, any>; webFetch: ToolDefinition<any, any, any> } {
  let webSearch: ToolDefinition<any, any, any> | undefined;
  let webFetch: ToolDefinition<any, any, any> | undefined;

  browserExecuteWebExtension({
    registerTool(tool: ToolDefinition<any, any, any>) {
      if (tool.name === "web_search") webSearch = tool;
      if (tool.name === "web_fetch") webFetch = tool;
    },
  } as ExtensionAPI);

  if (!webSearch) throw new Error("extension did not register web_search");
  if (!webFetch) throw new Error("extension did not register web_fetch");
  return { webSearch, webFetch };
}

afterEach(async () => {
  for (const sessionID of sessionIds) SessionStore.evict(sessionID);
  sessionIds.clear();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

function getTextContent(result: { content: Array<unknown> }): Record<string, unknown> {
  const first = result.content[0];
  expect(first).toBeDefined();
  expect((first as Record<string, unknown>).type).toBe("text");
  return first as Record<string, unknown>;
}

// ============================================================================
// web_search tests
// ============================================================================

describe("web_search Pi extension adapter", () => {
  it("registers the web_search tool with prompt guidance", () => {
    const { webSearch } = loadTools();

    expect(webSearch.name).toBe("web_search");
    expect(webSearch.label).toBe("Web Search");
    expect(webSearch.promptSnippet).toContain("Google");
    expect(webSearch.promptGuidelines?.some((line) => line.includes("web_fetch"))).toBe(true);
  });

  it("returns text content with error message for empty query", async () => {
    const cwd = await tmp("pi-websearch-cwd-");
    const { webSearch } = loadTools();
    const sessionID = "websearch-session";
    sessionIds.add(sessionID);

    const result = await webSearch.execute(
      "tool-call-1",
      { query: "" },
      undefined,
      undefined,
      minimalContext(cwd, sessionID),
    );

    const textContent = getTextContent(result);
    const text = textContent.text as string;
    expect(text).toContain("Error");
    expect(text).toContain("requires a query parameter");
  });

  it("returns details with query for error case", async () => {
    const cwd = await tmp("pi-websearch-cwd-");
    const { webSearch } = loadTools();
    const sessionID = "websearch-details-session";
    sessionIds.add(sessionID);

    const result = await webSearch.execute(
      "tool-call-1",
      { query: "" },
      undefined,
      undefined,
      minimalContext(cwd, sessionID),
    );

    expect(result.details).toMatchObject({
      query: "",
      error: expect.any(String),
    });
  });
});

// ============================================================================
// web_fetch tests
// ============================================================================

describe("web_fetch Pi extension adapter", () => {
  it("registers the web_fetch tool with prompt guidance", () => {
    const { webFetch } = loadTools();

    expect(webFetch.name).toBe("web_fetch");
    expect(webFetch.label).toBe("Web Fetch");
    expect(webFetch.promptSnippet).toContain("Chrome");
    expect(webFetch.promptGuidelines?.some((line) => line.includes("web_search"))).toBe(true);
  });

  it("returns text content with error message for empty url", async () => {
    const cwd = await tmp("pi-webfetch-cwd-");
    const { webFetch } = loadTools();
    const sessionID = "webfetch-session";
    sessionIds.add(sessionID);

    const result = await webFetch.execute(
      "tool-call-1",
      { url: "" },
      undefined,
      undefined,
      minimalContext(cwd, sessionID),
    );

    const textContent = getTextContent(result);
    const text = textContent.text as string;
    expect(text).toContain("Error");
    expect(text).toContain("requires a url parameter");
  });

  it("returns details with url for error case", async () => {
    const cwd = await tmp("pi-webfetch-cwd-");
    const { webFetch } = loadTools();
    const sessionID = "webfetch-details-session";
    sessionIds.add(sessionID);

    const result = await webFetch.execute(
      "tool-call-1",
      { url: "" },
      undefined,
      undefined,
      minimalContext(cwd, sessionID),
    );

    expect(result.details).toMatchObject({
      url: "",
      error: expect.any(String),
    });
  });
});

// ============================================================================
// Combined tests
// ============================================================================

describe("web_search + web_fetch together", () => {
  it("both tools are registered by the extension", () => {
    let registeredNames: string[] = [];

    browserExecuteWebExtension({
      registerTool(tool: ToolDefinition<any, any, any>) {
        registeredNames.push(tool.name);
      },
    } as ExtensionAPI);

    expect(registeredNames).toContain("web_search");
    expect(registeredNames).toContain("web_fetch");
    expect(registeredNames).toHaveLength(2);
  });

  it("web_search has guidance referencing web_fetch", () => {
    const { webSearch } = loadTools();
    const guidance = webSearch.promptGuidelines ?? [];
    expect(guidance.some((g) => g.toLowerCase().includes("web_fetch"))).toBe(true);
  });

  it("web_fetch has guidance referencing web_search", () => {
    const { webFetch } = loadTools();
    const guidance = webFetch.promptGuidelines ?? [];
    expect(guidance.some((g) => g.toLowerCase().includes("web_search"))).toBe(true);
  });
});
