import assert from "node:assert/strict";
import test from "node:test";
import { archiveConversation, conversationMatches, duplicateConversation, isConversationBusy, pinConversation, renameConversation, shouldRequestApproval, sortConversations } from "../src/services/conversationActions.ts";
import { createConversation, loadConversations, migrateConversation, saveConversations } from "../src/services/conversations.ts";
import type { Conversation } from "../src/types.ts";

function conversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    customTitle: false,
    projectPath: "C:\\proyecto",
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    assistantMode: "code",
    approvalMode: "ask",
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("solo el modo solicitar aprobación detiene comandos para pedir permiso", () => {
  assert.equal(shouldRequestApproval("ask"), true);
  assert.equal(shouldRequestApproval("auto"), false);
  assert.equal(shouldRequestApproval("full"), false);
});

test("fija, desfija y conserva el orden manual de los fijados", () => {
  let items = [conversation("a"), conversation("b")];
  items = pinConversation(items, "b", true);
  items = pinConversation(items, "a", true);
  items = items.map((item) => item.id === "b" ? { ...item, updatedAt: 999 } : item);
  assert.deepEqual(sortConversations(items, false).map((item) => item.id), ["b", "a"]);
  items = pinConversation(items, "b", false);
  assert.equal(items.find((item) => item.id === "b")?.pinned, false);
});

test("renombra, recorta a 80 caracteres y rechaza títulos vacíos", () => {
  const original = [conversation("a")];
  assert.equal(renameConversation(original, "a", "  Proyecto Vareliox  ")[0].title, "Proyecto Vareliox");
  assert.equal(renameConversation(original, "a", " ")[0], original[0]);
  assert.equal(renameConversation(original, "a", "x".repeat(100))[0].title.length, 80);
});

test("archiva, restaura y ordena por fecha de archivo", () => {
  const archived = archiveConversation([conversation("a", { pinned: true, pinnedOrder: 0 })], "a", true)[0];
  assert.equal(archived.archived, true);
  assert.equal(archived.pinned, false);
  assert.equal(archiveConversation([archived], "a", false)[0].archived, false);
  const items = [conversation("a", { archived: true, archivedAt: 2 }), conversation("b", { archived: true, archivedAt: 8 })];
  assert.deepEqual(sortConversations(items, true).map((item) => item.id), ["b", "a"]);
});

test("busca por título o mensajes ignorando mayúsculas y acentos", () => {
  const item = conversation("a", { title: "Revisión", messages: [{ id: "m", role: "user", content: "Árbol binario", createdAt: 1 }] });
  assert.equal(conversationMatches(item, "revision"), true);
  assert.equal(conversationMatches(item, "ARBOL"), true);
  assert.equal(conversationMatches(item, "ajedrez"), false);
});

test("duplica sin compartir estado mutable ni tarea activa", () => {
  const source = conversation("a", { messages: [{ id: "m", role: "user", content: "Hola", createdAt: 1 }], agentTask: { id: "t", state: "executing", startedAt: 1, updatedAt: 1, steps: [] } });
  const copy = duplicateConversation(source);
  copy.messages[0].content = "Modificado";
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.agentTask, undefined);
  assert.equal(source.messages[0].content, "Hola");
});

test("detecta generaciones y tareas activas antes de borrar", () => {
  const item = conversation("a");
  assert.equal(isConversationBusy(item, "a"), true);
  assert.equal(isConversationBusy(conversation("b", { agentTask: { id: "t", state: "awaiting_approval", startedAt: 1, updatedAt: 1, steps: [] } }), null), true);
  assert.equal(isConversationBusy(item, null), false);
});

test("migra conversaciones antiguas con valores seguros", () => {
  const migrated = migrateConversation({ id: "old", title: "Anterior", projectPath: "C:\\proyecto", messages: [], createdAt: 1, updatedAt: 2 }, "C:\\proyecto");
  assert.ok(migrated);
  assert.equal(migrated.pinned, false);
  assert.equal(migrated.archived, false);
  assert.equal(migrated.customTitle, false);
  assert.equal(migrated.assistantMode, "code");
  assert.equal(migrateConversation({ id: "otro", projectPath: "C:\\otro", messages: [] }, "C:\\proyecto"), null);
});

test("recuerda el modo y usa Vareliox Code por defecto cuando hay proyecto", () => {
  assert.equal(createConversation("C:\\proyecto").assistantMode, "code");
  assert.equal(createConversation(null).assistantMode, "chat");
  assert.equal(migrateConversation({ ...conversation("chat"), assistantMode: "chat" }, "C:\\proyecto")?.assistantMode, "chat");
});

test("recupera un chat cuya respuesta quedó vacía al cerrarse", () => {
  const item = conversation("interrupted", { messages: [
    { id: "u", role: "user", content: "continúa", createdAt: 1 },
    { id: "a", role: "assistant", content: "", createdAt: 2 },
  ] });
  const migrated = migrateConversation(item, "C:\\proyecto")!;
  assert.equal(migrated.messages.length, 1);
  assert.equal(migrated.lastError, true);
});

test("persistencia mantiene aislamiento entre proyectos", () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  assert.deepEqual(saveConversations("C:\\proyecto", [conversation("a"), conversation("x", { projectPath: "C:\\otro" })]), { ok: true });
  assert.deepEqual(loadConversations("C:\\proyecto").map((item) => item.id), ["a"]);
  assert.deepEqual(loadConversations("C:\\otro"), []);
});

test("Vareliox Chat y Vareliox Code usan almacenes independientes", () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  const chat = conversation("chat", { projectPath: null, assistantMode: "chat" });
  const code = conversation("code", { projectPath: "C:\\proyecto", assistantMode: "code" });
  assert.deepEqual(saveConversations(null, [chat], "chat"), { ok: true });
  assert.deepEqual(saveConversations("C:\\proyecto", [code], "code"), { ok: true });
  assert.deepEqual(loadConversations(null, "chat").map((item) => item.id), ["chat"]);
  assert.deepEqual(loadConversations("C:\\proyecto", "code").map((item) => item.id), ["code"]);
  assert.deepEqual(loadConversations(null, "chat").map((item) => item.assistantMode), ["chat"]);
  assert.deepEqual(loadConversations("C:\\proyecto", "code").map((item) => item.assistantMode), ["code"]);
});

test("migra un chat general guardado antes dentro de un proyecto", () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  const legacyKey = `novaai-code:conversations:v1:${encodeURIComponent("c:\\proyecto")}`;
  store.set(legacyKey, JSON.stringify([
    conversation("general", { assistantMode: "chat" }),
    conversation("agent", { assistantMode: "code" }),
  ]));
  assert.deepEqual(loadConversations("C:\\proyecto", "code").map((item) => item.id), ["agent"]);
  const migrated = loadConversations(null, "chat");
  assert.deepEqual(migrated.map((item) => item.id), ["general"]);
  assert.equal(migrated[0].projectPath, null);
});
