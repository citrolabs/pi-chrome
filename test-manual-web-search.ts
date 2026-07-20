#!/usr/bin/env tsx
/**
 * Manual test script to verify Chrome tab visibility for web_search and web_fetch.
 *
 * Run this script to see Chrome open, navigate, and leave the tab visible for 15 seconds.
 *
 * Requirements:
 * - Chrome running with --remote-debugging-port=9333
 * - Profile directory: /home/dpavlin/.ds4/browser
 */

import { webSearch, webFetch } from "./src/web-fetch.js";

async function testWebSearch() {
  console.log("🔍 Testing web_search...");
  console.log("Chrome should open a tab with Google search results.");
  console.log("The tab will stay visible for 15 seconds after extraction.\n");

  const result = await webSearch({
    query: "ds4 antirez",
    profileDir: undefined, // Let detectBrowsers find Chrome on 9333
  });

  if ("error" in result) {
    console.error(`❌ web_search failed: ${result.message}`);
    return;
  }

  console.log(`✅ web_search extracted ${result.linkCount} links`);
  console.log(`   URL: ${result.searchUrl}`);
  console.log(`   ${result.markdown.length} characters of markdown\n`);
}

async function testWebFetch() {
  console.log("🌐 Testing web_fetch...");
  console.log("Chrome should open a tab with example.com.");
  console.log("The tab will stay visible for 15 seconds after extraction.\n");

  const result = await webFetch({
    url: "https://example.com",
    profileDir: undefined, // Let detectBrowsers find Chrome on 9333
  });

  if ("error" in result) {
    console.error(`❌ web_fetch failed: ${result.message}`);
    return;
  }

  console.log(`✅ web_fetch extracted ${result.lineCount} lines`);
  console.log(`   URL: ${result.finalUrl}`);
  console.log(`   Title: ${result.title}`);
  console.log(`   ${result.markdown.length} characters of markdown\n`);
}

async function main() {
  try {
    await testWebSearch();
    await testWebFetch();
    console.log("✅ Manual tests complete. Check Chrome for visible tabs.");
  } catch (error) {
    console.error(`❌ Test error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
