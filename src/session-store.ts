// Process-scope per-pi-session CDP Session map.
//
// browser_execute looks up a Session keyed by the Pi tool context/session key so
// calls to session.connect(...) persist across later snippets in the same agent
// process. The Session itself owns one browser-level CDP WebSocket.

import { Session } from "./cdp/session.js";

const sessions = new Map<string, Session>();

export function get(sessionID: string): Session {
  const existing = sessions.get(sessionID);
  if (existing) return existing;

  const fresh = new Session();
  sessions.set(sessionID, fresh);
  return fresh;
}

export function evict(sessionID: string): void {
  const entry = sessions.get(sessionID);
  if (!entry) return;

  sessions.delete(sessionID);
  entry.close();
}

export const SessionStore = { get, evict };
