// Production Code UI, isolated mocked IPC: no credentials or real file writes.
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { PreferencesProvider } from "../src/services/preferences";
import { createConversation, loadConversations, saveConversations } from "../src/services/conversations";
import { ChatPane } from "../src/components/ChatPane";
import type { AiChatEvent, AiSettings, ProviderConfig } from "../src/types";
import "../src/App.css";
import "../src/workspace-polish.css";

localStorage.setItem("novaai-code:preferences", JSON.stringify({ theme: "dark", language: "es" }));
const project = { name: "Summary regression", path: "/private/mock/summary-project" };
const config: ProviderConfig = {
  configId: "ollama", provider: "ollama", displayName: "Ollama", logoDataUrl: null,
  endpoint: "http://127.0.0.1:11434", model: "mock-model", models: { chat: "mock-model", image: "", video: "" },
  capabilities: ["chat"], reasoningEffort: "medium", apiKeyConfigured: false,
  connectTimeoutSecs: 5, firstResponseTimeoutSecs: 90, inactivityTimeoutSecs: 30, maxResponseTimeoutSecs: 600,
};
const settings: AiSettings = { activeProvider: "ollama", activeConfigId: "ollama", providers: [config] };
const conversation = createConversation(project.path, "code");
saveConversations(project.path, [conversation], "code");
const results: string[] = [];
const summary = "Resumen del proyecto: frontend React, backend Rust.\n\nFin del resumen: no se modificó ningún archivo.";
const originalWriteAnswer = "Preparé una propuesta para crear el archivo solicitado.";
let scenario: "analysis" | "repair" | "repair-success" = "analysis";
let requests = 0;
let fileWrites = 0;
let finishRepair: (() => void) | undefined;
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
mockIPC(async (command, args) => {
  if (command === "chat_ai") {
    requests += 1;
    const channel = args!.onEvent as { onmessage: (event: AiChatEvent) => void };
    if (scenario === "repair" && requests === 2) {
      await new Promise<void>((resolve) => { finishRepair = () => {
        channel.onmessage({ type: "delta", text: '<nova_actions>{"actions":[{"type":"write","path":"ejemplo.txt","content":"No aplicar tras un error"}]}</nova_actions>' });
        channel.onmessage({ type: "error", diagnostic: { code: "RESPONSE_TIMEOUT", title: "Reintento agotado", explanation: "Timeout simulado", cause: "Mock", action: "Reintentar", technicalDetails: null, retryable: true } });
        resolve();
      }; });
      return null;
    }
    if (scenario === "repair-success" && requests === 2) {
      channel.onmessage({ type: "delta", text: '<nova_actions>{"actions":[{"type":"write","path":"ejemplo.txt","content":"Propuesta válida"}]}</nova_actions>' });
      channel.onmessage({ type: "done", elapsedMs: 120 });
      return null;
    }
    channel.onmessage({ type: "delta", text: scenario !== "analysis" ? originalWriteAnswer : summary.slice(0, 45) });
    await pause();
    if (scenario === "analysis") channel.onmessage({ type: "delta", text: summary.slice(45) });
    channel.onmessage({ type: "done", elapsedMs: 120 });
    return null;
  }
  if (command === "apply_ai_actions") { fileWrites += 1; throw new Error("This test must not write files"); }
  if (command === "detect_project_commands" || command === "list_computer_roots" || command === "preview_project_context") return [];
  return null;
});
function assert(condition: unknown, label: string) { if (!condition) throw new Error(label); results.push(label); }
function latestAnswer() { return Array.from(document.querySelectorAll(".chat-message--assistant .message-body")).at(-1)?.textContent || ""; }
function type(value: string) {
  const input = document.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function send(prompt: string) {
  type(prompt); await pause();
  document.querySelector<HTMLButtonElement>(".send-button")!.click();
  await pause(); await pause(); await pause();
}
async function verify() {
  await pause(); await pause();
  await send("hazme un análisis de un proyecto para hacerme un resumen");
  assert(requests === 1, "El resumen no inicia reparaciones ni solicitudes adicionales");
  assert(latestAnswer().includes("Fin del resumen"), "El resumen completo permanece visible después de done");
  assert(!document.querySelector(".waiting-text") && !document.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!.disabled, "Finalizar libera el compositor y elimina cargando");
  assert(loadConversations(project.path, "code")[0].messages.at(-1)?.content === summary, "El resumen completo se conserva en el historial persistido");
  scenario = "repair"; requests = 0;
  await send("crea un archivo ejemplo.txt");
  assert(requests === 2 && finishRepair, "Una escritura inválida solicita reparación");
  assert(latestAnswer().includes(originalWriteAnswer), "El reintento conserva la respuesta anterior mientras espera");
  finishRepair!(); await pause(); await pause();
  assert(latestAnswer().includes(originalWriteAnswer), "Un timeout del reintento no borra la respuesta anterior");
  assert(!document.querySelector(".change-overlay") && fileWrites === 0, "Un reintento fallido no aplica ni propone operaciones parciales");
  assert(!document.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!.disabled, "El error del reintento no bloquea la siguiente pregunta");
  scenario = "analysis"; requests = 0;
  await send("haz un resumen de README.md");
  assert(requests === 1 && latestAnswer().includes("Fin del resumen"), "Una nueva pregunta funciona después del error");
  assert(fileWrites === 0, "Analizar no ejecuta escrituras de archivos");
  scenario = "repair-success"; requests = 0;
  await send("crea un archivo ejemplo.txt");
  assert(requests === 2 && document.querySelector(".change-overlay"), "Una reparación válida sigue ofreciendo las operaciones para aprobar");
  assert(latestAnswer().includes(originalWriteAnswer), "Una reparación solo con JSON conserva la explicación original");
  assert(fileWrites === 0, "La reparación válida no omite la aprobación de archivos");
  (window as unknown as { varelioxVisualResult: unknown }).varelioxVisualResult = { status: "passed", results };
}
function Fixture() {
  useEffect(() => { void verify().catch((error: Error) => {
    (window as unknown as { varelioxVisualResult: unknown }).varelioxVisualResult = { status: "failed", results, error: error.message };
  }); }, []);
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}><ChatPane mode="code" activeWorkspace project={project} projects={[project]} openFiles={[]} settings={settings} sidebarOpen={false} onAddProject={() => {}} onSelectProject={() => {}} onConfigure={() => {}} onSettingsChange={() => {}} onFilesChanged={async () => {}} onNotify={() => {}} onWorkspaceChange={() => {}} onOpenExplorer={() => {}} onOpenPreferences={() => {}} onCloseSidebar={() => {}} /></div>;
}
createRoot(document.getElementById("root")!).render(<PreferencesProvider><Fixture /></PreferencesProvider>);
