import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SessionStore } from "./session-store.js";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 10 * 60_000;

export type BrowserExecuteParameters = {
  code: string;
  description: string;
  timeout?: number;
};

export type ExecuteContext = {
  sessionID: string;
  workspaceDir: string;
  profileDir: string | undefined;
  launchBrowser: boolean | undefined;
  onChunk?: (output: string) => void;
};

export type CollectedScreenshot = {
  mime: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
};

export type ExecuteResult = {
  output: string;
  result: string;
  screenshots: CollectedScreenshot[];
};

const SCREENSHOT_FORMAT_TO_MIME: Record<string, CollectedScreenshot["mime"]> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const SCREENSHOT_FORMAT_TO_EXT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...injected: unknown[]) => Promise<unknown>;
const dynamicImport = (specifier: string) => import(specifier);

function screenshotMime(format: unknown): CollectedScreenshot["mime"] {
  return SCREENSHOT_FORMAT_TO_MIME[typeof format === "string" ? format : "png"] ?? "image/png";
}

function screenshotExt(format: unknown): string {
  return SCREENSHOT_FORMAT_TO_EXT[typeof format === "string" ? format : "png"] ?? "png";
}

export function serialize(value: unknown): string {
  if (value === undefined) return "null";
  try {
    return (
      JSON.stringify(
        value,
        (_key, val) => {
          if (typeof val === "bigint") return val.toString();
          return val;
        },
        2,
      ) ?? "null"
    );
  } catch {
    return JSON.stringify(String(value));
  }
}

function timeoutSignal(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("browser_execute timed out")), ms);
  });
}

export async function executeBrowserCode(args: BrowserExecuteParameters, ctx: ExecuteContext): Promise<ExecuteResult> {
  const session = SessionStore.get(ctx.sessionID);
  await mkdir(ctx.workspaceDir, { recursive: true });

  // Auto-connect if profileDir is provided
  if (ctx.profileDir && !session.isConnected()) {
    await session.connect({
      profileDir: ctx.profileDir,
      launchBrowser: ctx.launchBrowser ?? true,
      timeoutMs: args.timeout ?? DEFAULT_TIMEOUT_MS,
    });
  }

  let wrapped: (...injected: unknown[]) => Promise<unknown>;
  try {
    wrapped = new AsyncFunction("session", "console", "__import", args.code.replaceAll("import(", "__import("));
  } catch (error) {
    throw new Error(`syntax error in browser_execute snippet: ${error instanceof Error ? error.message : String(error)}`);
  }

  let output = "";
  const tee = (...values: unknown[]) => {
    output += values.map((value) => (typeof value === "string" ? value : serialize(value))).join(" ") + "\n";
    ctx.onChunk?.(output);
  };

  const snippetConsole = Object.assign(Object.create(console) as Console, {
    log: tee,
    error: tee,
    warn: tee,
    info: tee,
    debug: tee,
  });

  const screenshots: CollectedScreenshot[] = [];
  const dumpDir = process.env.BCODE_SCREENSHOT_DIR;
  const startedAt = Date.now();
  let seq = 0;

  const unsubscribe = session.onCallResult((method, params, result) => {
    if (method !== "Page.captureScreenshot") return;
    const response = result as { data?: unknown };
    if (typeof response?.data !== "string") return;

    const callParams = (params ?? {}) as { format?: unknown };
    const mime = screenshotMime(callParams.format);
    const ext = screenshotExt(callParams.format);
    const idx = seq++;
    screenshots.push({ mime, base64: response.data });

    if (dumpDir) {
      const filename = `${ctx.sessionID}-${startedAt}-${String(idx).padStart(3, "0")}.${ext}`;
      void mkdir(dumpDir, { recursive: true })
        .then(() => writeFile(path.join(dumpDir, filename), Buffer.from(response.data as string, "base64")))
        .catch(() => {
          // Best-effort eval/diagnostic artifact only.
        });
    }
  });

  const backupUncaught = process.listeners("uncaughtException");
  const backupUnhandled = process.listeners("unhandledRejection");
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");

  let snippetError: Error | null = null;
  const errorHandler = (error: unknown) => {
    snippetError = error instanceof Error ? error : new Error(String(error));
  };

  process.on("uncaughtException", errorHandler);
  process.on("unhandledRejection", errorHandler);

  try {
    const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const ran = await Promise.race([wrapped(session, snippetConsole, dynamicImport), timeoutSignal(timeoutMs)]);
    await new Promise((resolve) => setImmediate(resolve));
    if (snippetError) {
      throw snippetError;
    }
    return { output, result: serialize(ran), screenshots };
  } catch (error) {
    await new Promise((resolve) => setImmediate(resolve));
    const finalError = snippetError ?? error;
    throw new Error(`browser_execute snippet threw: ${finalError instanceof Error ? finalError.stack ?? finalError.message : String(finalError)}`);
  } finally {
    process.off("uncaughtException", errorHandler);
    process.off("unhandledRejection", errorHandler);
    for (const l of backupUncaught) process.on("uncaughtException", l);
    for (const l of backupUnhandled) process.on("unhandledRejection", l);
    unsubscribe();
  }
}
