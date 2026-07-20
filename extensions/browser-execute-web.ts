import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeBrowserCode, type BrowserExecuteParameters } from "../src/browser-execute.js";
import { webSearch, webFetch, type WebSearchOptions, type WebFetchOptions } from "../src/web-fetch.js";

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
  // --- web_search tool ---
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: `Search Google using a visible Chrome browser via CDP and extract the search results as structured markdown.

The tool opens a Chrome tab, navigates to Google Search, handles consent dialogs automatically, and extracts up to 20 visible result links along with a text snapshot of the results page.

Results include:
- Visible links section with link text and URLs (up to 20 results)
- A text snapshot of the search results content

This tool is ideal for finding information on the web. Use web_fetch to read the full content of any URL discovered through search.`,
    promptSnippet: "Search Google using Chrome via CDP and extract search results as markdown.",
    promptGuidelines: [
      "Use web_search when the user asks to find information on the web.",
      "Pass a descriptive, specific query for best results.",
      "After getting search results, use web_fetch to read full pages of interest.",
      "web_search and web_fetch share the same Chrome profile for session continuity.",
      "Both tools can use profileDir to reuse an existing Chrome session.",
    ],
    parameters: WebSearchParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const options: WebSearchOptions = {
        query: params.query,
        profileDir: params.profileDir,
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
    description: `Fetch and extract page content from a URL using a visible Chrome browser via CDP.

The tool opens a Chrome tab, navigates to the URL, handles consent dialogs, dynamically scrolls the page to trigger lazy loading, then extracts structured markdown content.

Extracted content includes:
- Page title as a heading
- Content from semantic HTML elements (headings, paragraphs, lists, code blocks, blockquotes)
- A visible links section (up to 80 links)
- Content truncated at 900KB

This tool is ideal for reading full pages when you need the structured content. Use web_search to discover URLs first.`,
    promptSnippet: "Fetch and extract structured markdown content from a URL using Chrome via CDP.",
    promptGuidelines: [
      "Use web_fetch when you need the full content of a specific URL.",
      "Pass the complete URL including the protocol (https://).",
      "For dynamic pages with lazy loading, the tool automatically scrolls to extract more content.",
      "web_fetch and web_search share the same Chrome profile for session continuity.",
      "Both tools can use profileDir to reuse an existing Chrome session.",
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const options: WebFetchOptions = {
        url: params.url,
        profileDir: params.profileDir,
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
