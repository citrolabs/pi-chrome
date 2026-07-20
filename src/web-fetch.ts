/**
 * Web Fetch & Search: high-level browser tools that wrap the CDP session.
 *
 * Ported from ds4_web.c (ds4 checkout on aimax). Provides:
 * - web_search: searches Google via Chrome and extracts results as markdown
 * - web_fetch: visits a URL via Chrome and extracts page content as structured markdown
 *
 * Both tools reuse the existing CDP session infrastructure (visible Chrome with
 * user profile, CDP communication via WebSocket).
 */

import { Session } from "./cdp/session.js";

// ============================================================================
// Types
// ============================================================================

export type WebSearchOptions = {
  query: string;
  profileDir?: string | undefined;
  timeoutMs?: number;
};

export type WebFetchOptions = {
  url: string;
  profileDir?: string | undefined;
  timeoutMs?: number;
};

export type WebSearchResult = {
  /** Markdown text of search results (visible links + text snapshot). */
  markdown: string;
  /** URL of the Google search page used. */
  searchUrl: string;
  /** Total number of visible result links extracted. */
  linkCount: number;
};

export type WebFetchResult = {
  /** Markdown text of the page content. */
  markdown: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** Page title. */
  title: string;
  /** Whether the page was dynamically scrolled to load more content. */
  scrolled: boolean;
  /** Number of links extracted. */
  linkCount: number;
  /** Total line count of the extracted content. */
  lineCount: number;
};

export type WebError = {
  error: true;
  message: string;
};

export type WebResult = WebSearchResult | WebFetchResult | WebError;

// ============================================================================
// Helper to build strings with backticks (port from ds4_web.c C code)
// ============================================================================

function t(str: string): string {
  return str;
}

// ============================================================================
// Google Search JavaScript (port from ds4_web.c:web_extract_search_js)
// ============================================================================

const GOOGLE_CONSENT_CLICK_JS = t(`(() => {
  const clean=s=>(s||'').replace(/\\s+/g,' ').trim();
  const pats=[/accept all/i,/i agree/i,/agree/i,/accetta tutto/i,/tout accepter/i,/aceptar todo/i,/alle akzeptieren/i];
  const els=[...document.querySelectorAll('button,[role=button],input[type=submit],a')];
  for (const el of els){const t=clean(el.innerText||el.value||el.textContent);
  if(!t)continue; if(pats.some(p=>p.test(t))){el.click(); return 'clicked '+t;}}
  return '';
})()`);

const GOOGLE_SEARCH_EXTRACT_JS = t(`(() => {
  const clean=s=>(s||'').replace(/\\s+/g,' ').trim();
  const esc=s=>clean(s).replace(/\\\\/g,'\\\\\\\\').replace(/\\[/g,'\\\\[').replace(/\\]/g,'\\\\]').replace(/\\n/g,' ');
  const visible=el=>{const r=el.getBoundingClientRect();const st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'&&st.opacity!=='0'};
  const bad=h=>(/(^|\\.)google\\./.test(h)||/(^|\\.)gstatic\\./.test(h)||/(^|\\.)googleusercontent\\./.test(h));
  const lines=['# Google search results','',\`URL: \${location.href}\`,'','## Visible links'];
  const seen=new Set();
  for(const a of document.querySelectorAll('a[href]')){if(!visible(a))continue;let href=a.href||'';
  try{const u=new URL(href);if(u.pathname==='/url'&&u.searchParams.get('q'))href=u.searchParams.get('q');}catch{}
  let u;try{u=new URL(href);}catch{continue;}if(!/^https?:$/.test(u.protocol))continue;if(bad(u.hostname))continue;
  const text=esc(a.innerText||a.textContent);if(text.length<3)continue;if(seen.has(u.href))continue;seen.add(u.href);
  lines.push(\`- [\${text.slice(0,180)}](\${u.href})\`);if(seen.size>=20)break;}
  lines.push('','## Text snapshot',clean(document.body.innerText).slice(0,1200));
  return lines.join('\\n');
})()`);

// ============================================================================
// Page Content JavaScript (port from ds4_web.c:web_extract_page_js)
// ============================================================================

const PAGE_EXTRACT_JS = t(`(() => {
  const clean=s=>(s||'').replace(/\\s+/g,' ').trim();
  const esc=s=>clean(s).replace(/\\\\/g,'\\\\\\\\').replace(/\\[/g,'\\\\[').replace(/\\]/g,'\\\\]').replace(/\\n/g,' ');
  const visible=el=>{const r=el.getBoundingClientRect();const st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'&&st.opacity!=='0'};
  const inline=n=>{if(!n)return'';if(n.nodeType===3)return n.nodeValue;if(n.nodeType!==1)return'';const el=n;
  if(el.tagName==='SCRIPT'||el.tagName==='STYLE'||el.tagName==='NOSCRIPT')return'';
  if(el.tagName==='A'){const t=esc(el.innerText||el.textContent);const h=el.href||'';return t&&h?\`[\${t}](\${h})\`:t;}
  if(el.tagName==='CODE')return '\`' + clean(el.innerText||el.textContent).replace(/\`/g,'\\\\\`') + '\`';
  return [...el.childNodes].map(inline).join('');};
  const lines=[\`# \${clean(document.title)||location.href}\`,'',\`URL: \${location.href}\`,'','## Content'];
  const blocks=[...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,[id="content-text"],[class*="comment-body"],[class*="comment-content"],[data-testid*="comment-text"]')];
  const seen=new Set();
  for(const el of blocks){if(!visible(el))continue;let s='';const tag=el.tagName;
  if(/^H[1-6]$/.test(tag)){s='#'.repeat(Number(tag[1]))+' '+inline(el);}
  else if(tag==='LI'){s='- '+inline(el);}
  else if(tag==='PRE'){s='\\x60\\x60\\x60\\n'+(el.innerText||el.textContent||'').trimEnd()+'\\n\\x60\\x60\\x60';}
  else if(tag==='BLOCKQUOTE'){s='> '+clean(el.innerText||el.textContent);}
  else{s=inline(el);}s=s.trim();if(!s||seen.has(s))continue;seen.add(s);lines.push('',s);
  if(lines.join('\\n').length>900000){lines.push('','[Content truncated by browser extractor.]');break;}}
  lines.push('','## Visible links');let n=0;const linkSeen=new Set();
  for(const a of document.querySelectorAll('a[href]')){if(!visible(a))continue;const t=esc(a.innerText||a.textContent);if(t.length<3)continue;
  let u;try{u=new URL(a.href);}catch{continue;}if(!/^https?:$/.test(u.protocol)||linkSeen.has(u.href))continue;linkSeen.add(u.href);
  lines.push(\`- [\${t.slice(0,160)}](\${u.href})\`);if(++n>=80)break;}
  return lines.join('\\n');
})()`);

// ============================================================================
// Dynamic Scroll JavaScript (port from ds4_web.c:web_scroll_dynamic_page)
// ============================================================================

const DYNAMIC_SCROLL_JS = t(`(() => new Promise(resolve => {
  const root=()=>document.scrollingElement||document.documentElement||document.body;
  const blockSel='h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th,[id="content-text"],[class*="comment-body"],[class*="comment-content"],[data-testid*="comment-text"]';
  const lazySel='[onscroll],[loading="lazy"],[data-src],[data-lazy],[class*="lazy"],[class*="infinite"],[class*="virtual"],[role="feed"],[id*="comment"],[class*="comment"],[data-testid*="comment"]';
  const hookCount=()=>{let n=0;try{if(window.onscroll)n++;if(document.onscroll)n++;if(document.body&&document.body.onscroll)n++;}catch(e){}
  try{if(typeof getEventListeners==='function'){for(const o of [window,document,document.body]){if(!o)continue;const ev=getEventListeners(o);if(ev&&ev.scroll)n+=ev.scroll.length;}}}catch(e){}
  try{n+=document.querySelectorAll(lazySel).length;}catch(e){}return n;};
  const metrics=()=>{const r=root();return {
  height:r?r.scrollHeight:0,
  view:innerHeight||900,
  y:scrollY||(r&&r.scrollTop)||0,
  text:((document.body&&document.body.innerText)||'').length,
  links:document.links?document.links.length:0,
  blocks:document.body?document.body.querySelectorAll(blockSel).length:0,
  hooks:hookCount()};};
  const sig=m=>[m.height,m.text,m.links,m.blocks].join('|');
  const grew=(a,b)=>b.height>a.height+20||b.text>a.text+200||b.links>a.links+2||b.blocks>a.blocks+2;
  const scrollOnce=()=>{const r=root();if(!r)return;
  const h=Math.max(700,Math.floor((innerHeight||900)*0.85));
  window.scrollTo(0,Math.min(r.scrollHeight,(scrollY||r.scrollTop||0)+h));};
  let last=metrics(),lastSig=sig(last),same=0,steps=0;
  const scrollable=last.height>last.view*1.35;
  if(!scrollable||last.hooks===0){resolve('scroll skipped hooks='+last.hooks+' text='+last.text);return;}
  const tick=()=>{
  if(steps>=28){resolve('scrolled '+steps+' text='+last.text);return;}
  const before=last;
  scrollOnce();steps++;
  setTimeout(()=>{const now=metrics(),nowSig=sig(now);
  if(nowSig===lastSig)same++;else same=0;
  const loaded=grew(before,now);
  last=now;lastSig=nowSig;
  if(steps===1&&!loaded){resolve('scroll probe unchanged text='+now.text);return;}
  const atBottom=now.y+now.view+20>=now.height;
  if(same>=4||(atBottom&&same>=1)){resolve('scrolled '+steps+' text='+now.text);return;}
  tick();},900);};tick();
}))()`);

// ============================================================================
// Utility: wait for page readiness
// ============================================================================

async function waitForPageReady(session: Session): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      const state = (await session.domains.Runtime.evaluate({
        expression: "document.readyState",
        returnByValue: true,
      })) as { result?: { value?: string } };
      const ready = state?.result?.value as string;
      if (ready === "complete" || ready === "interactive") {
        await new Promise((r) => setTimeout(r, 800));
        return;
      }
    } catch {
      // Skip on transient errors
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ============================================================================
// Wait for navigation to complete
// ============================================================================

async function waitForNavigated(session: Session, maxAttempts = 100): Promise<boolean> {
  let lastLen = -1;
  let stable = 0;
  let sawRealUrl = false;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const probe = (await session.domains.Runtime.evaluate({
        expression:
          "location.href+'\\n'+document.readyState+'\\n'+((document.body&&document.body.innerText)||'').length",
        returnByValue: true,
      })) as { result?: { value?: string } };
      const raw = probe?.result?.value as string;
      if (!raw) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      const parts = raw.split('\n');
      if (parts.length < 3) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      const href = parts[0]?.trim() || '';
      const ready = parts[1]?.trim() || '';
      const textLen = Number(parts[2]) || 0;

      const realUrl = href && href.length > 0 &&
        href !== "about:blank" &&
        !href.startsWith("chrome://");
      const readyState = ready === "complete" || ready === "interactive";

      if (realUrl) sawRealUrl = true;
      if (textLen > 0 && textLen === lastLen) stable++;
      else stable = 0;
      lastLen = textLen;

      if (sawRealUrl && readyState && textLen > 0 && stable >= 2) {
        await new Promise((r) => setTimeout(r, 500));
        return true;
      }
      if (sawRealUrl && readyState && i >= 24) return true;
    } catch {
      // Skip on transient errors
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return true;
}

// ============================================================================
// Open a tab and attach to it via CDP
// ============================================================================

async function openTab(
  session: Session,
  url: string,
): Promise<string> {
  // Create a new visible target (tab) so user can see what's happening
  const result = (await session.domains.Target.createTarget({
    url,
    background: false,
    newWindow: false,
  })) as { targetId: string };
  return result.targetId;
}

// ============================================================================
// Execute JS on a page with error handling
// ============================================================================

async function evaluate(
  session: Session,
  expression: string,
): Promise<string | null> {
  const result = (await session.domains.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result?: { type?: string; value?: unknown; className?: string };
    exceptionDetails?: { text?: string };
  };

  if (result.exceptionDetails?.text) {
    throw new Error(`JavaScript evaluation failed: ${result.exceptionDetails.text}`);
  }

  if (result.result?.type === "undefined") return null;
  if (result.result?.type === "string") return result.result.value as string;
  if (result.result?.value !== undefined) return JSON.stringify(result.result.value);
  return null;
}

// ============================================================================
// Run a page with CDP: navigate, scroll (optional), and extract
// ============================================================================

export interface RunPageOptions {
  session: Session;
  url: string;
  extractJs: string;
  scrollDynamic?: boolean;
}

export async function runPage(opts: RunPageOptions): Promise<string> {
  const { session, url, extractJs, scrollDynamic = true } = opts;

  // Open a new tab for this operation
  const targetId = await openTab(session, "about:blank");

  // Attach to the tab
  const sessionId = await session.use(targetId);

  try {
    // Enable domains
    await session.domains.Page.enable();
    await session.domains.Runtime.enable();

    // Navigate to the target URL
    await session.domains.Page.navigate({ url });
    await waitForNavigated(session);

    // Try to click Google consent dialogs
    try {
      const consentResult = await evaluate(session, GOOGLE_CONSENT_CLICK_JS);
      if (consentResult && consentResult.length > 0) {
        // Consent was clicked; wait for any navigation
        await new Promise((r) => setTimeout(r, 1500));
        try {
          await waitForNavigated(session);
        } catch {
          // Ignore navigation wait failures after consent
        }
      }
    } catch {
      // Consent click is best-effort
    }

    // Optionally scroll the page to trigger lazy loading
    if (scrollDynamic) {
      try {
        await evaluate(session, DYNAMIC_SCROLL_JS);
      } catch {
        // Scrolling is best-effort
      }
    }

    // Extract content using the provided JS
    const content = await evaluate(session, extractJs);
    if (content === null) {
      throw new Error("Page extraction returned null");
    }
    return content;
  } finally {
    // Close the tab
    session.setActiveSession(undefined);
    try {
      await session.domains.Target.closeTarget({ targetId });
    } catch {
      // Ignore close errors
    }
  }
}

// ============================================================================
// Ensure Chrome is running and connected
// ============================================================================

async function ensureConnected(session: Session): Promise<void> {
  if (session.isConnected()) {
    // Check if browser is alive
    try {
      await session.domains.Browser.getVersion();
      return; // Browser is alive
    } catch {
      // Browser may have died; fall through
    }
  }
  // Session is not connected or browser is dead; connect will handle it
  // (user should have called session.connect() with profileDir)
  throw new Error("Browser is not connected. Call session.connect({ profileDir }) first.");
}

// ============================================================================
// Web Search
// ============================================================================

/**
 * Search Google using a visible Chrome browser via CDP.
 *
 * Returns markdown containing:
 * - Visible links (up to 20 results)
 * - A text snapshot of the search results page
 *
 * Handles Google consent dialogs automatically.
 */
export async function webSearch(opts: WebSearchOptions): Promise<WebSearchResult | WebError> {
  const { query, profileDir } = opts;
  if (!query || query.length === 0) {
    return { error: true, message: "web_search requires a query parameter" };
  }

  // Build the Google search URL
  const encoded = encodeURIComponent(query);
  const searchUrl = `https://www.google.com/search?q=${encoded}`;

  try {
    const sessionObj = new Session();
    if (profileDir) {
      await sessionObj.connect({ profileDir, launchBrowser: true });
    } else {
      await ensureConnected(sessionObj);
    }

    const result = await runPage({
      session: sessionObj,
      url: searchUrl,
      extractJs: GOOGLE_SEARCH_EXTRACT_JS,
      scrollDynamic: false,
    });

    // Count links
    const linkCount = (result.match(/^- \[/gm) || []).length;

    return {
      markdown: result,
      searchUrl,
      linkCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: true, message: `web_search failed: ${message}` };
  }
}

// ============================================================================
// Web Fetch
// ============================================================================

/**
 * Fetch and extract page content from a URL using a visible Chrome browser via CDP.
 *
 * Returns structured markdown containing:
 * - Page title as heading
 * - Content extracted from semantic HTML elements (headings, paragraphs, lists, code, blockquotes)
 * - Visible links section
 * - Truncation at 900KB
 *
 * Dynamically scrolls the page to trigger lazy loading before extraction.
 */
export async function webFetch(opts: WebFetchOptions): Promise<WebFetchResult | WebError> {
  const { url, profileDir } = opts;
  if (!url || url.length === 0) {
    return { error: true, message: "web_fetch requires a url parameter" };
  }

  try {
    const sessionObj = new Session();
    if (profileDir) {
      await sessionObj.connect({ profileDir, launchBrowser: true });
    } else {
      await ensureConnected(sessionObj);
    }

    const result = await runPage({
      session: sessionObj,
      url,
      extractJs: PAGE_EXTRACT_JS,
      scrollDynamic: true,
    });

    // Extract metadata
    const titleMatch = result.match(/^# (.+)$/m);
    const title = titleMatch?.[1] ?? "";
    const finalUrlMatch = result.match(/^URL: (.+)$/m);
    const finalUrl = finalUrlMatch?.[1] ?? url;
    const linkCount = (result.match(/^- \[/gm) || []).length;
    const lineCount = result.split('\n').length;

    // Determine if scrolled (look for scroll info in comments or content)
    const scrolled = result.includes("scrolled") || result.includes("Content truncated");

    return {
      markdown: result,
      finalUrl,
      title,
      scrolled,
      linkCount,
      lineCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: true, message: `web_fetch failed: ${message}` };
  }
}
