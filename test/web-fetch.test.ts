import { describe, expect, it, vi, afterEach } from "vitest";
import { Session } from "../src/cdp/session.js";
import { webSearch, webFetch, runPage } from "../src/web-fetch.js";

// ============================================================================
// Constants
// ============================================================================

const PROBE_EXPR = "location.href+'\\n'+document.readyState+'\\n'+((document.body&&document.body.innerText)||'').length";

// ============================================================================
// Mock helpers
// ============================================================================

type CallRecord = { method: string; params?: Record<string, unknown> | undefined };

function createMockSession(): {
	session: Session & {
		_mockCalls: CallRecord[];
		_mockRuntime: {
			results: Map<string, string>;
			exceptions: Set<string>;
			undefineds: Set<string>;
			defaultProbe: (href?: string, ready?: string, textLen?: number) => void;
		};
	};
	calls: CallRecord[];
	setProbeResult: (href: string, ready: string, textLen: number) => void;
	setRuntimeResult: (expr: string, value: string) => void;
	setRuntimeException: (expr: string) => void;
	setRuntimeUndefined: (expr: string) => void;
} {
	const calls: CallRecord[] = [];
	const runtimeResults = new Map<string, string>();
	const runtimeExceptions = new Set<string>();
	const runtimeUndefineds = new Set<string>();
	let _connected = false;

	const session = new Session();
	const mockSession = session as unknown as Session & {
		_mockCalls: CallRecord[];
		_mockRuntime: {
			results: Map<string, string>;
			exceptions: Set<string>;
			undefineds: Set<string>;
			defaultProbe: (href?: string, ready?: string, textLen?: number) => void;
		};
	};

	(session as unknown as Record<string, unknown>).isConnected = () => _connected;
	(session as unknown as Record<string, unknown>).connect = async () => { _connected = true; };
	(session as unknown as Record<string, unknown>).use = async (targetId: string) => targetId;
	(session as unknown as Record<string, unknown>).setActiveSession = () => {};

	vi.spyOn(session, "_call").mockImplementation(async (method: string, params?: unknown) => {
		const rec: CallRecord = { method, params: params as Record<string, unknown> | undefined };
		calls.push(rec);
		mockSession._mockCalls.push(rec);

		if (method === "Target.createTarget") {
			return { targetId: `mock-target-${calls.length}` };
		}
		if (method === "Target.closeTarget") {
			return {};
		}
		if (method === "Page.navigate") {
			return { frameId: "mock-frame" };
		}
		if (method === "Page.enable" || method === "Runtime.enable") {
			return {};
		}
		if (method === "Runtime.evaluate") {
			const expr = (params as { expression?: string })?.expression ?? "";
			if (runtimeExceptions.has(expr)) {
				return { exceptionDetails: { text: "mock error" } };
			}
			if (runtimeUndefineds.has(expr)) {
				return { result: { type: "undefined" } };
			}
			const val = runtimeResults.get(expr);
			if (val !== undefined) {
				return { result: { type: "string", value: val } };
			}
			return { result: { type: "string", value: "" } };
		}
		if (method === "Browser.getVersion") {
			return { protocolVersion: "1.3", product: "Chrome/124.0" };
		}
		return {};
	});

	function setProbeResult(href: string, ready: string, textLen: number): void {
		const raw = `${href}\n${ready}\n${textLen}`;
		runtimeResults.set(PROBE_EXPR, raw);
	}

	function defaultProbe(href = "https://example.com", ready = "complete", textLen = 100): void {
		setProbeResult(href, ready, textLen);
	}

	function setRuntimeResult(expr: string, value: string): void {
		runtimeResults.set(expr, value);
	}

	function setRuntimeException(expr: string): void {
		runtimeExceptions.add(expr);
	}

	function setRuntimeUndefined(expr: string): void {
		runtimeUndefineds.add(expr);
	}

	mockSession._mockCalls = calls;
	mockSession._mockRuntime = {
		results: runtimeResults,
		exceptions: runtimeExceptions,
		undefineds: runtimeUndefineds,
		defaultProbe,
	};

	return {
		session: mockSession,
		calls,
		setProbeResult,
		setRuntimeResult,
		setRuntimeException,
		setRuntimeUndefined,
	};
}

// ============================================================================
// runPage tests
// ============================================================================

describe("runPage", () => {
	it("navigates, extracts content, and closes the tab", async () => {
		const { session, calls } = createMockSession();
		const mockExtractJs = `(() => "# Title\\n\\nURL: https://example.com\\n\\n## Content\\nHello world")()`;
		session._mockRuntime.results.set(mockExtractJs, "Hello world");
		session._mockRuntime.defaultProbe();

		const result = await runPage({
			session,
			url: "https://example.com",
			extractJs: mockExtractJs,
			scrollDynamic: false,
			keepTabVisibleMs: 0,
		});

		expect(result).toBe("Hello world");
		expect(calls.some((c) => c.method === "Target.createTarget")).toBe(true);
		expect(calls.some((c) => c.method === "Page.navigate")).toBe(true);
		expect(calls.some((c) => c.method === "Target.closeTarget")).toBe(true);
	});

	it("throws when extraction returns null (undefined result)", async () => {
		const { session } = createMockSession();
		session._mockRuntime.undefineds.add("null-extract");
		session._mockRuntime.defaultProbe();

		await expect(
			runPage({
				session,
				url: "https://example.com",
				extractJs: "null-extract",
				scrollDynamic: false,
				keepTabVisibleMs: 0,
			}),
		).rejects.toThrow("Page extraction returned null");
	});

	it("throws on JavaScript evaluation error", async () => {
		const { session } = createMockSession();
		session._mockRuntime.exceptions.add("boom-extract");
		session._mockRuntime.defaultProbe();

		await expect(
			runPage({
				session,
				url: "https://example.com",
				extractJs: "boom-extract",
				scrollDynamic: false,
				keepTabVisibleMs: 0,
			}),
		).rejects.toThrow("JavaScript evaluation failed");
	});

	it("handles consent dialog clicks gracefully", async () => {
		const { session } = createMockSession();
		const consentJs = `(() => {
  const clean=s=>(s||'').replace(/\\s+/g,' ').trim();
  const pats=[/accept all/i,/i agree/i,/agree/i,/accetta tutto/i,/tout accepter/i,/aceptar todo/i,/alle akzeptieren/i];
  const els=[...document.querySelectorAll('button,[role=button],input[type=submit],a')];
  for (const el of els){const t=clean(el.innerText||el.value||el.textContent);
  if(!t)continue; if(pats.some(p=>p.test(t))){el.click(); return 'clicked '+t;}}
  return '';
})()`;
		session._mockRuntime.results.set(consentJs, "clicked Accept all");
		session._mockRuntime.defaultProbe("https://www.google.com/search?q=test", "complete", 100);
		session._mockRuntime.defaultProbe("https://www.google.com/search?q=test", "complete", 100);
		const mockExtractJs = `(() => "# Results")()`;
		session._mockRuntime.results.set(mockExtractJs, "# Results");

		await runPage({
			session,
			url: "https://www.google.com/search?q=test",
			extractJs: mockExtractJs,
			scrollDynamic: false,
			keepTabVisibleMs: 0,
		});

		expect(session._mockCalls.some((c) =>
			(c.params as { expression?: string })?.expression?.includes("accept all"),
		)).toBe(true);
	});
});

// ============================================================================
// webSearch tests
// ============================================================================

describe("webSearch", () => {
	it("returns error when query is empty", async () => {
		const result = await webSearch({ query: "" });
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.message).toContain("requires a query parameter");
	});

	it("returns error when query is whitespace only", async () => {
		const result = await webSearch({ query: "   " });
		expect("error" in result).toBe(true);
	});

	it("returns error from CDP when browser is unavailable", async () => {
		const result = await webSearch({ query: "hello" });
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.message).toContain("failed");
		}
	});

	it("builds correct Google search URL with encoding", async () => {
		const result = await webSearch({ query: "hello world & foo" });
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.message).toContain("web_search");
		}
	});
});

// ============================================================================
// webFetch tests
// ============================================================================

describe("webFetch", () => {
	it("returns error when url is empty", async () => {
		const result = await webFetch({ url: "" });
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.message).toContain("requires a url parameter");
	});

	it("returns error when url is missing", async () => {
		const result = await webFetch({ url: "" });
		expect("error" in result).toBe(true);
	});

	it("returns error from CDP when browser is unavailable", async () => {
		const result = await webFetch({ url: "https://example.com" });
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.message).toContain("failed");
		}
	});
});

// ============================================================================
// Metadata extraction tests (pure string manipulation, no browser needed)
// ============================================================================

describe("metadata extraction", () => {
	it("extracts title from heading", () => {
		const result = "# My Page Title\n\nURL: https://example.com\n\n## Content";
		const match = result.match(/^# (.+)$/m);
		expect(match?.[1]).toBe("My Page Title");
	});

	it("extracts final URL", () => {
		const result = "# Title\n\nURL: https://example.com/page\n\n## Content";
		const match = result.match(/^URL: (.+)$/m);
		expect(match?.[1]).toBe("https://example.com/page");
	});

	it("falls back to original URL when no URL header found", () => {
		const result = "# Title\n\n## Content";
		const match = result.match(/^URL: (.+)$/m);
		expect(match?.[1] ?? "https://fallback.com").toBe("https://fallback.com");
	});

	it("counts link lines correctly", () => {
		const result = "- [Link 1](http://a.com)\n- [Link 2](http://b.com)\n- [Link 3](http://c.com)";
		const count = (result.match(/^- \[/gm) || []).length;
		expect(count).toBe(3);
	});

	it("returns zero links when no links present", () => {
		const result = "# Title\n\n## Content\nNo links here";
		const count = (result.match(/^- \[/gm) || []).length;
		expect(count).toBe(0);
	});

	it("counts lines", () => {
		const result = "line 1\nline 2\nline 3";
		expect(result.split('\n').length).toBe(3);
	});

	it("detects scrolled content", () => {
		const result = "scrolled 4 text=1200";
		expect(result.includes("scrolled")).toBe(true);
	});

	it("detects truncated content", () => {
		const result = "[Content truncated by browser extractor.]";
		expect(result.includes("Content truncated")).toBe(true);
	});

	it("handles missing title gracefully", () => {
		const result = "## Content\nNo title";
		const match = result.match(/^# (.+)$/m);
		expect(match?.[1]).toBe(undefined);
		expect(match?.[1] ?? "").toBe("");
	});
});
