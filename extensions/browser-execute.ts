import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeBrowserCode, type BrowserExecuteParameters } from "../src/browser-execute.js";

const MAX_METADATA_LENGTH = 30_000;

const BrowserExecuteParams = Type.Object({
  code: Type.String({
    description:
      "JavaScript snippet to execute. `session` (persistent CDP Session) and captured `console` are in scope. Use await import(...) for external modules.",
  }),
  description: Type.String({
    description:
      "Clear, concise description of what this snippet does in 3-7 words. Examples: Connect to local Chrome; Scrape product titles; Screenshot homepage.",
  }),
  timeout: Type.Optional(
    Type.Number({
      description: "Optional timeout in milliseconds. Default 60000; maximum 600000. CPU-bound snippets without await yield points may overrun.",
    }),
  ),
});

function preview(text: string): string {
  return text.length <= MAX_METADATA_LENGTH ? text : "...\n\n" + text.slice(-MAX_METADATA_LENGTH);
}

function workspaceDirOf(cwd: string): string {
  return path.join(cwd, ".pi", "browser-execute-workspace");
}

function sessionIDOf(ctx: { sessionId?: string; sessionID?: string; cwd: string }): string {
  return ctx.sessionId ?? ctx.sessionID ?? `cwd:${ctx.cwd}`;
}

export default function browserExecuteExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "browser_execute",
    label: "Browser Execute",
    description: `Execute JavaScript against a Chromium browser through the Chrome DevTools Protocol (CDP).

The snippet receives a persistent CDP session as \`session\` and a captured \`console\`. Connect once with \`await session.connect()\`, \`await session.connect({ wsUrl })\`, or \`await session.connect({ profileDir })\`, then attach a page target with \`await session.use(targetId)\`. The session persists across later browser_execute calls in the same Pi process/session key. Every successful \`Page.captureScreenshot\` call is returned as an image part. Reusable scripts belong in \`.pi/browser-execute-workspace\` and can be loaded with \`await import(absPath + "?t=" + Date.now())\`.

Security: CDP controls the connected browser. Only use this tool against browsers/endpoints the user authorized.`,
    promptSnippet: "Execute JavaScript snippets against a real Chromium browser via CDP.",
    promptGuidelines: [
      "Use browser_execute whenever the task requires driving, inspecting, or screenshotting a real browser through CDP.",
      "Before using browser_execute for page operations, connect with session.connect(), choose a page target from Target.getTargets, and call session.use(targetId).",
      "browser_execute snippets have session and console in scope; write reusable helper modules under .pi/browser-execute-workspace and import them with await import(...).",
      "browser_execute automatically returns Page.captureScreenshot results as image parts; do not manually decode screenshots unless processing bytes is required.",
    ],
    parameters: BrowserExecuteParams,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const sessionID = sessionIDOf(ctx as { sessionId?: string; sessionID?: string; cwd: string });
      const workspaceDir = workspaceDirOf(ctx.cwd);

      const result = await executeBrowserCode(params as BrowserExecuteParameters, {
        sessionID,
        workspaceDir,
        onChunk: (output) => {
          onUpdate?.({
            content: [{ type: "text", text: preview(output) }],
            details: { output: preview(output) },
          });
        },
      });

      const text = [
        result.output.trimEnd(),
        result.result === "null" ? "" : `=> ${result.result}`,
        result.screenshots.length > 0
          ? `(${result.screenshots.length} screenshot${result.screenshots.length === 1 ? "" : "s"} attached)`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        content: [
          { type: "text" as const, text: text || "browser_execute completed" },
          ...result.screenshots.map((screenshot) => ({
            type: "image" as const,
            mimeType: screenshot.mime,
            data: screenshot.base64,
          })),
        ],
        details: {
          description: params.description,
          result: result.result,
          output: preview(result.output),
          screenshotCount: result.screenshots.length,
          workspaceDir,
        },
      };
    },
  });
}
