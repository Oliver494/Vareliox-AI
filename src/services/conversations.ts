import type { Conversation, ConversationMode } from "../types";

const LEGACY_PREFIX = "novaai-code:conversations:v1:";
const PREFIX = "novaai-code:conversations:v2:";

function scope(projectPath: string | null) {
  return encodeURIComponent((projectPath || "global").toLowerCase());
}

function storageKey(mode: ConversationMode, projectPath: string | null) {
  return `${PREFIX}${mode}:${mode === "chat" ? "global" : scope(projectPath)}`;
}

function sameProject(left: string | null | undefined, right: string | null) {
  return (left || null)?.toLowerCase() === (right || null)?.toLowerCase();
}

export type ConversationSaveResult = { ok: true } | { ok: false; message: string };

export function migrateConversation(item: Partial<Conversation>, projectPath: string | null): Conversation | null {
  if (!item || !Array.isArray(item.messages) || !sameProject(item.projectPath, projectPath)) return null;
  const now = Date.now();
  const lastMessage = item.messages[item.messages.length - 1];
  const interruptedResponse = item.messages.length >= 2 && lastMessage?.role === "assistant" && !lastMessage.content.trim() && !lastMessage.appliedChanges?.length;
  const messages = interruptedResponse ? item.messages.slice(0, -1) : item.messages;
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title?.trim() || "Nueva conversación",
    customTitle: item.customTitle ?? false,
    projectPath,
    pinned: item.pinned ?? false,
    pinnedOrder: typeof item.pinnedOrder === "number" ? item.pinnedOrder : null,
    archived: item.archived ?? false,
    archivedAt: typeof item.archivedAt === "number" ? item.archivedAt : null,
    lastError: item.lastError ?? interruptedResponse,
    assistantMode: item.assistantMode === "chat" ? "chat" : "code",
    approvalMode: item.approvalMode || "ask",
    externalFolders: Array.isArray(item.externalFolders) ? item.externalFolders.filter((folder) => folder && typeof folder.id === "string" && typeof folder.path === "string" && (folder.access === "read" || folder.access === "write")) : [],
    agentTask: item.agentTask && ["analyzing", "planning", "awaiting_approval", "executing", "testing", "correcting"].includes(item.agentTask.state)
      ? { ...item.agentTask, state: "interrupted" as const }
      : item.agentTask,
    compactedContext: item.compactedContext,
    compactedAt: item.compactedAt,
    messages,
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
  };
}

function parseStored(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as Partial<Conversation>[];
  } catch {
    return [];
  }
}

function mergeUnique(current: Conversation[], incoming: Conversation[]) {
  const known = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !known.has(item.id))];
}

/**
 * Loads one isolated product workspace. The first read also imports the old v1
 * store, but never removes it: a failed migration can therefore be retried.
 */
export function loadConversations(projectPath: string | null, mode: ConversationMode = projectPath ? "code" : "chat"): Conversation[] {
  try {
    const key = storageKey(mode, projectPath);
    const current = parseStored(key)
      .map((item) => migrateConversation(item, mode === "chat" ? null : projectPath))
      .filter((item): item is Conversation => !!item)
      .map((item) => ({ ...item, projectPath: mode === "chat" ? null : projectPath, assistantMode: mode }));
    if (localStorage.getItem(key) !== null) return current;

    const legacy = parseStored(`${LEGACY_PREFIX}${scope(projectPath)}`)
      .map((item) => migrateConversation(item, projectPath))
      .filter((item): item is Conversation => !!item);
    const selected = legacy
      .filter((item) => (item.assistantMode === "chat" ? "chat" : "code") === mode)
      .map((item) => ({ ...item, projectPath: mode === "chat" ? null : projectPath, assistantMode: mode }));

    // A project could previously contain a Vareliox Chat chat. Move a copy into the
    // global chat workspace while preserving the legacy source as a backup.
    if (mode === "code") {
      const globalKey = storageKey("chat", null);
      const global = parseStored(globalKey)
        .map((item) => migrateConversation(item, null))
        .filter((item): item is Conversation => !!item);
      const chats = legacy.filter((item) => item.assistantMode === "chat")
        .map((item) => ({ ...item, projectPath: null, assistantMode: "chat" as const }));
      if (chats.length) localStorage.setItem(globalKey, JSON.stringify(mergeUnique(global, chats)));
    }

    localStorage.setItem(key, JSON.stringify(selected));
    return selected;
  } catch {
    return [];
  }
}

export function saveConversations(projectPath: string | null, conversations: Conversation[], mode: ConversationMode = projectPath ? "code" : "chat"): ConversationSaveResult {
  try {
    const isolated = conversations
      .filter((item) => item.assistantMode === mode && sameProject(item.projectPath, mode === "chat" ? null : projectPath));
    localStorage.setItem(storageKey(mode, projectPath), JSON.stringify(isolated));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "El almacenamiento local no está disponible." };
  }
}

export function referencedMediaUris() {
  const uris = new Set<string>();
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX) && !key?.startsWith(LEGACY_PREFIX)) continue;
      for (const conversation of parseStored(key)) {
        for (const item of conversation.messages ?? []) {
          const uri = item.generatedMedia?.uri;
          if (typeof uri === "string" && uri.trim()) uris.add(uri);
        }
      }
    }
  } catch { /* Storage can be unavailable in hardened environments. */ }
  return [...uris];
}

export function createConversation(projectPath: string | null, mode: ConversationMode = projectPath ? "code" : "chat"): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "Nueva conversación",
    customTitle: false,
    projectPath: mode === "chat" ? null : projectPath,
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    lastError: false,
    assistantMode: mode,
    approvalMode: "ask",
    externalFolders: [],
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}
