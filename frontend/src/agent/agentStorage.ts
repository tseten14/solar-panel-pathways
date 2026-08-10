/** Keeps the visible transcript across reloads, so a page refresh mid-scan
 *  doesn't wipe the conversation. */
import type { AgentMessage } from "./types";

const STORAGE_KEY = "solartrace-agent-chat";

export interface StoredAgentChat {
  sessionId: string;
  messages: AgentMessage[];
}

export function loadStoredChat(): StoredAgentChat | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAgentChat;
    if (!parsed?.sessionId || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredChat(data: StoredAgentChat): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded or private mode — the chat still works, it just won't persist.
  }
}

export function clearStoredChat(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
