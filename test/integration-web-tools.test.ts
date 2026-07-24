/**
 * Integration tests that connect to a real Chrome browser via CDP.
 *
 * Chrome must be running with --remote-debugging-port=9333:
 *   chromium --remote-debugging-port=9333
 *
 * Each test navigates to a page and leaves the tab visible for 15 seconds
 * so you can visually verify the tab actually opened.
 */

import { describe, it, expect } from "vitest";
import { Session } from "../src/cdp/session.js";

function getChromeWsUrl(): Promise<string> {
  return fetch("http://127.0.0.1:9333/json/version")
    .then((res) => res.json())
    .then((data) => {
      const wsUrl = (data as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
      if (!wsUrl) throw new Error("no webSocketDebuggerUrl from Chrome");
      return wsUrl;
    });
}

describe("integration: real Chrome via CDP", () => {
  it(
    "connects to Chrome, opens visible tab, navigates to Google, leaves open 15s",
    async () => {
      const session = new Session();
      const wsUrl = await getChromeWsUrl();
      await session.connect({ wsUrl });

      // Verify Chrome is alive
      const version = await session.domains.Browser.getVersion();
      const productName = (version as { product?: string })?.product;
      expect(productName).toMatch(/Chrome|Chromium/i);

      // Open a new visible tab (background: false by default)
      const target = await session.domains.Target.createTarget({ url: "about:blank" });

      // Attach to the new tab with flatten: true so page-level calls work
      await session.use(target.targetId);

      // Enable Page domain
      await session.domains.Page.enable();

      // Navigate to Google search
      await session.domains.Page.navigate({ url: "https://www.google.com/search?q=ds4+antirez" });

      // Wait for page to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get page title to verify navigation worked
      const titleResult = await session.domains.Runtime.evaluate({
        expression: "document.title",
      });
      const title = (titleResult as { result?: { value?: string } })?.result?.value;
      expect(title).toMatch(/Google/i);

      // Leave tab visible for 15 seconds so you can see it
      console.log("[integration] Tab is now visible for 15 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Clean up - close the tab
      await session.domains.Target.closeTarget({ targetId: target.targetId });
      session.close();
    },
    60000, // 60s timeout: 2s load + 15s visible + margin
  );

  it(
    "navigates to example.com, extracts content, leaves tab open 15s",
    async () => {
      const session = new Session();
      const wsUrl = await getChromeWsUrl();
      await session.connect({ wsUrl });

      // Open a new visible tab
      const target = await session.domains.Target.createTarget({ url: "about:blank" });
      await session.use(target.targetId);

      // Enable domains
      await session.domains.Page.enable();

      // Navigate to example.com
      await session.domains.Page.navigate({ url: "https://example.com" });

      // Wait for page to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get page title
      const titleResult = await session.domains.Runtime.evaluate({
        expression: "document.title",
      });
      const title = (titleResult as { result?: { value?: string } })?.result?.value;
      expect(title).toContain("Example Domain");

      // Get page content
      const contentResult = await session.domains.Runtime.evaluate({
        expression: "document.body.innerText",
      });
      const content = (contentResult as { result?: { value?: string } })?.result?.value;
      expect(content).toContain("Example Domain");

      // Leave tab visible for 15 seconds so you can see it
      console.log("[integration] Tab is now visible for 15 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Clean up - close the tab
      await session.domains.Target.closeTarget({ targetId: target.targetId });
      session.close();
    },
    60000, // 60s timeout
  );
});
