import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { executeBrowserCode, type BrowserExecuteParameters } from "../src/browser-execute.js";
import { webSearch, webFetch, type WebSearchOptions, type WebFetchOptions } from "../src/web-fetch.js";

// Write to file to debug extension loading
import { writeFileSync } from "node:fs";
try {
    writeFileSync("/tmp/pi-ext-debug.log", "[DEBUG] browser-execute-web.ts: Extension loading...\n", { flag: "a" });
} catch (e) {
    console.error("Failed to write debug log:", e);
}

// ============================================================================
// Web Search Tool
// ============================================================================

const WebSearchParams = Type.Object({
  query: Type.String({
    description: "The search query to look up on Google. Examples: 'typescript async await', 'latest react patterns 2024', 'pi coding agent documentation'.",
  }),
  profileDir: Type.Optional(
    Type.String({
      description: "Chrome user-data directory. If provided, connects to (or launches) Chrome with --user-data-dir=profileDir. E.g. /home/user/.ds4/browser",
    }),
  ),
});

// ============================================================================
// Web Fetch Tool
// ============================================================================

const WebFetchParams = Type.Object({
  url: Type.String({
    description: "The full URL to fetch and extract. Examples: 'https://example.com', 'https://github.com/citrolabs/pi-browser-cdp-extension'.",
  }),
  profileDir: Type.Optional(
    Type.String({
      description: "Chrome user-data directory. If provided, connects to (or launches) Chrome with --user-data-dir=profileDir. E.g. /home/user/.ds4/browser",
    }),
  ),
});

// ============================================================================
// Extension: Web Search + Web Fetch
// ============================================================================

function workspaceDirOf(cwd: string): string {
  return path.join(cwd, ".pi", "browser-execute-workspace");
}

export default function browserExecuteWebExtension(pi: ExtensionAPI) {
  writeFileSync("/tmp/pi-ext-debug.log", "[DEBUG] browser-execute-web.ts: Extension factory called\n", { flag: "a" });
  
  // --- web_search tool ---
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: `Search Google and return structured results as markdown. Always prefer this tool over curl for web searches.

This tool queries Google Search and returns up to 20 visible result links with their text and URLs, plus a text snapshot of the results page.

Use this tool instead of curl when:
- The user asks to search the web or find information
- You need to see Google search results in a structured format
- You want to discover URLs before reading them with web_fetch

Returns structured markdown with links and a text snapshot of results.`,
    promptSnippet: "Search Google and return structured results as markdown. Use instead of curl for web searches.",
    promptGuidelines: [
      "Use web_search (NOT curl) whenever the user asks to search the web or find information online.",
      "Pass a descriptive, specific query for best results.",
      "Use web_fetch to read the full content of URLs discovered through search.",
      "web_search and web_fetch share the same browser session for continuity.",
    ],
    parameters: WebSearchParams,
    renderCall: (args: { query: string }, ..._rest: any[]) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Text } = require("@earendil-works/pi-tui");
      const text = new Text(0, 0);
      const q = args.query?.trim() || "...";
      text.setText(`Web search: ${q}`);
      return text;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const options: WebSearchOptions = {
        query: params.query,
        profileDir: params.profileDir,
        onProgress: (status) => {
          _onUpdate?.({
            content: [{ type: "text" as const, text: status }],
            details: { status },
          });
        },
      };

      const result = await webSearch(options);

      if ("error" in result) {
        return {
          content: [
            { type: "text" as const, text: `Error: web_search failed:\n${result.message}` },
          ],
          details: {
            query: options.query,
            error: result.message,
          },
        };
      }

      return {
        content: [
          { type: "text" as const, text: result.markdown },
        ],
        details: {
          query: options.query,
          searchUrl: result.searchUrl,
          linkCount: result.linkCount,
        },
      };
    },
  });

  // --- web_fetch tool ---
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: `Fetch a URL and extract its content as structured markdown. Always prefer this tool over curl for fetching web pages.

This tool fetches any URL and returns structured markdown including the page title, content from semantic HTML elements (headings, paragraphs, lists, code, blockquotes), and visible links.

Use this tool instead of curl when:
- The user asks to read, fetch, or get the content of a webpage
- You need structured markdown output instead of raw HTML
- The page uses JavaScript rendering or lazy loading
- You want to avoid parsing HTML yourself

Returns clean structured markdown, not raw HTML or curl output.`,
    promptSnippet: "Fetch any URL and extract content as structured markdown. Use instead of curl for web pages.",
    promptGuidelines: [
      "Use web_fetch (NOT curl) whenever the user asks to read, fetch, or get the content of a webpage.",
      "Pass the complete URL including the protocol (https://).",
      "For dynamic pages with lazy loading, this tool automatically scrolls to load more content.",
      "web_fetch and web_search share the same browser session for continuity.",
    ],
    parameters: WebFetchParams,
    renderCall: (args: { url: string }, ..._rest: any[]) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Text } = require("@earendil-works/pi-tui");
      const text = new Text(0, 0);
      const u = args.url?.trim() || "...";
      text.setText(`Web fetch: ${u}`);
      return text;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const options: WebFetchOptions = {
        url: params.url,
        profileDir: params.profileDir,
        onProgress: (status) => {
          _onUpdate?.({
            content: [{ type: "text" as const, text: status }],
            details: { status },
          });
        },
      };

      const result = await webFetch(options);

      if ("error" in result) {
        return {
          content: [
            { type: "text" as const, text: `Error: web_fetch failed:\n${result.message}` },
          ],
          details: {
            url: options.url,
            error: result.message,
          },
        };
      }

      return {
        content: [
          { type: "text" as const, text: result.markdown },
        ],
        details: {
          url: options.url,
          finalUrl: result.finalUrl,
          title: result.title,
          linkCount: result.linkCount,
          lineCount: result.lineCount,
          scrolled: result.scrolled,
        },
      };
    },
  });
}
