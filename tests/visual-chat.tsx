// Browser-only regression fixture. IPC is mocked: no files, keys or commands
// from the desktop are accessed. Exercise actual production chat components.
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { PreferencesProvider } from "../src/services/preferences";
import { createConversation, saveConversations } from "../src/services/conversations";
import { ChatPane } from "../src/components/ChatPane";
import type { AiSettings, Diagnostic, ProviderConfig } from "../src/types";
import "../src/App.css";
import "../src/workspace-polish.css";

const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
localStorage.setItem("novaai-code:preferences", JSON.stringify({ theme, language: "es" }));
const config: ProviderConfig = {
  configId: "ollama", provider: "ollama", displayName: "Ollama", logoDataUrl: null,
  endpoint: "http://127.0.0.1:11434", model: "test-chat-model",
  models: { chat: "test-chat-model", image: "vareliox-sd15-q4", video: "vareliox-animatediff-v3" },
  capabilities: ["chat", "image", "video"], reasoningEffort: "medium", apiKeyConfigured: false,
  connectTimeoutSecs: 5, firstResponseTimeoutSecs: 90, inactivityTimeoutSecs: 30, maxResponseTimeoutSecs: 600,
};
const settings: AiSettings = { activeProvider: "ollama", activeConfigId: "ollama", providers: [config] };
const project = { name: "Vareliox visual test", path: "/private/mock/project with spaces" };
const conversation = createConversation(project.path, "code");
conversation.messages = [
  { id: "question", role: "user", content: "Este mensaje debe verse completo, tanto al principio como al final. " + "Texto largo con una ruta y símbolos para comprobar el ajuste de línea. ".repeat(8), createdAt: Date.now() },
  { id: "answer", role: "assistant", content: "Listo. El mensaje permanece dentro del panel.\n\n- Texto legible y sin recortes.\n- Controles de permisos y adjuntos accesibles.", createdAt: Date.now() },
];
saveConversations(project.path, [conversation], "code");
let pending: ((error: Diagnostic) => void) | undefined;
mockIPC((command, args) => {
  if (command === "generate_media") return new Promise((_resolve, reject) => { pending = reject; });
  if (command === "cancel_ai_chat") {
    pending?.({ code: "CANCELLED", title: "Cancelado", explanation: "Prueba cancelada", action: "", cause: "", technicalDetails: null, retryable: false });
    return true;
  }
  if (command === "save_ai_settings") return args?.settings;
  if (command === "list_ai_models") return [{ id: config.model, name: config.model, loaded: true }];
  if (command === "detect_project_commands" || command === "list_computer_roots") return [];
  return null;
});

const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}
function assert(condition: unknown, description: string) {
  if (!condition) throw new Error(description);
  results.push(description);
}
const results: string[] = [];
declare global { interface Window { varelioxVisualResult?: { status: string; results: string[]; error?: string } } }
function type(value: string) {
  const textarea = query<HTMLTextAreaElement>(".chat-composer textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function verify() {
  await pause(); await pause();
  const panel = query(".chat-messages").getBoundingClientRect();
  const bubble = query(".chat-message--user .message-body").getBoundingClientRect();
  assert(bubble.left >= panel.left && bubble.right <= panel.right + 1, "El mensaje del usuario no se recorta");
  const textarea = query<HTMLTextAreaElement>(".chat-composer textarea");
  const heights: number[] = [];
  for (const lines of [1, 5, 12, 30]) {
    type(Array.from({ length: lines }, (_, i) => `Línea ${i + 1}`).join("\n"));
    await pause();
    heights.push(textarea.clientHeight);
  }
  assert(heights[1] > heights[0] && heights[2] >= heights[1], "El compositor crece con el texto");
  assert(heights[3] <= innerHeight * .4 + 1 && getComputedStyle(textarea).overflowY === "auto", "El compositor limita su altura y permite desplazamiento");
  type("Un texto de prueba"); await pause();
  query<HTMLButtonElement>(".composer-button--attach").click(); await pause();
  assert(document.querySelector(".attachment-menu"), "El menú + se abre");
  query(".chat-messages").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); await pause();
  assert(!document.querySelector(".attachment-menu"), "El menú + se cierra al pulsar fuera");
  query<HTMLButtonElement>(".composer-button--attach").click(); await pause();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await pause();
  assert(!document.querySelector(".attachment-menu"), "Escape cierra el menú +");
  query<HTMLButtonElement>(".approval-picker__trigger").click(); await pause();
  assert(document.querySelectorAll('[role="menuitemradio"]').length === 3, "Hay tres modos de permisos en un menú diseñado");
  const selected = query<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]');
  selected.focus();
  const options = Array.from(document.querySelectorAll('[role="menuitemradio"]'));
  const nextOption = options[(options.indexOf(selected) + 1) % options.length];
  selected.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert(document.activeElement === nextOption, "Los permisos se pueden recorrer con teclado");
  query<HTMLButtonElement>(".approval-picker__option--full").click(); await pause();
  assert(document.querySelector(".approval-picker--full .lucide-shield-alert"), "Acceso completo usa un escudo de advertencia");
  assert(!document.querySelector(".approval-picker__menu"), "Elegir permisos cierra el menú");
  type("crea una imagen de un perro"); await pause();
  query<HTMLButtonElement>(".send-button").click(); await pause();
  const stop = query<HTMLButtonElement>(".stop-button");
  const background = getComputedStyle(stop).backgroundColor;
  const rgb = background.match(/\d+/g)!.map(Number);
  assert(rgb[0] > rgb[1] * 2 && rgb[0] > rgb[2] * 2, "Detener es rojo, no blanco");
  stop.click(); await pause(); await pause();
  assert(!document.querySelector(".stop-button") && document.querySelector(".send-button"), "Cancelar vuelve a habilitar el compositor");
  assert(document.querySelector(".chat-messages")!.textContent!.includes("Creación cancelada") && !document.querySelector(".diagnostic-card"), "Cancelar no se presenta como un fallo de generación");
  assert(config.models.chat === "test-chat-model", "Crear una imagen no sustituye el modelo de chat");
  // Leave a second mocked operation active for the screenshot of the red stop control.
  type("crea una imagen de un paisaje"); await pause();
  query<HTMLButtonElement>(".send-button").click(); await pause();
  window.varelioxVisualResult = { status: "passed", results };
  document.documentElement.dataset.qa = "passed";
}

function Fixture() {
  useEffect(() => { void verify().catch((error: Error) => {
    window.varelioxVisualResult = { status: "failed", results, error: error.message };
    document.documentElement.dataset.qa = "failed";
    document.documentElement.dataset.qaError = error.message;
  }); }, []);
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
    <ChatPane mode="code" activeWorkspace project={project} projects={[project]} openFiles={[]} settings={settings} sidebarOpen={false} onAddProject={() => {}} onSelectProject={() => {}} onConfigure={() => {}} onSettingsChange={() => {}} onFilesChanged={async () => {}} onNotify={() => {}} onWorkspaceChange={() => {}} onOpenExplorer={() => {}} onOpenPreferences={() => {}} onCloseSidebar={() => {}} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<PreferencesProvider><Fixture /></PreferencesProvider>);
