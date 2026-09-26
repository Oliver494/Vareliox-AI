import type { Conversation } from "../types";

export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

export function conversationMatches(conversation: Conversation, query: string) {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  return normalizeSearch(`${conversation.title}\n${conversation.messages.map((item) => item.content).join("\n")}`).includes(needle);
}

export function sortConversations(conversations: Conversation[], archived: boolean) {
  return [...conversations].filter((item) => item.archived === archived).sort((left, right) => archived
    ? (right.archivedAt || 0) - (left.archivedAt || 0)
    : left.pinned !== right.pinned
      ? Number(right.pinned) - Number(left.pinned)
      : left.pinned
        ? (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER)
        : right.updatedAt - left.updatedAt);
}

export function pinConversation(conversations: Conversation[], id: string, pinned: boolean) {
  const nextOrder = conversations.reduce((maximum, item) => Math.max(maximum, item.pinnedOrder ?? -1), -1) + 1;
  return conversations.map((item) => item.id === id ? { ...item, pinned, pinnedOrder: pinned ? nextOrder : null } : item);
}

export function renameConversation(conversations: Conversation[], id: string, title: string) {
  const clean = title.trim().slice(0, 80);
  if (!clean) return conversations;
  return conversations.map((item) => item.id === id ? { ...item, title: clean, customTitle: true, updatedAt: Date.now() } : item);
}

export function archiveConversation(conversations: Conversation[], id: string, archived: boolean) {
  return conversations.map((item) => item.id === id ? { ...item, archived, archivedAt: archived ? Date.now() : null, pinned: archived ? false : item.pinned, pinnedOrder: archived ? null : item.pinnedOrder, updatedAt: Date.now() } : item);
}

export function duplicateConversation(source: Conversation): Conversation {
  const now = Date.now();
  return { ...structuredClone(source), id: crypto.randomUUID(), title: `${source.title} — Copia`.slice(0, 80), customTitle: true, pinned: false, pinnedOrder: null, archived: false, archivedAt: null, agentTask: undefined, messages: structuredClone(source.messages), createdAt: now, updatedAt: now };
}

export function isConversationBusy(conversation: Conversation, generatingConversationId: string | null) {
  const activeAgentStates = ["analyzing", "planning", "awaiting_approval", "executing", "testing", "correcting"];
  return generatingConversationId === conversation.id || !!conversation.agentTask && activeAgentStates.includes(conversation.agentTask.state);
}

export function shouldRequestApproval(mode: Conversation["approvalMode"]) {
  return mode === "ask";
}

export function conversationMarkdown(conversation: Conversation) {
  return `# ${conversation.title}\n\n${conversation.messages.map((item) => `## ${item.role === "user" ? "Tú" : "Vareliox"}\n\n${item.content}`).join("\n\n")}`;
}
