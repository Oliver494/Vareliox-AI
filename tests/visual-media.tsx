// Production UI with mocked IPC. No credentials or remote generation are used.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockConvertFileSrc, mockIPC } from "@tauri-apps/api/mocks";
import { PreferencesProvider } from "../src/services/preferences";
import { ChatPane } from "../src/components/ChatPane";
import type { AiSettings, ProviderConfig } from "../src/types";
import "../src/App.css";
import "../src/workspace-polish.css";

const params = new URLSearchParams(location.search);
const provider = (params.get("provider") || "lm_studio") as ProviderConfig["provider"];
const mode = params.get("mode") === "video" ? "video" : "image";
const local = provider === "lm_studio" || provider === "ollama";
const missing = params.get("missing") === "true";
const image = local ? "vareliox-sd15-q4" : provider === "open_ai" ? "gpt-image-1" : provider === "nvidia" ? "black-forest-labs/flux.1-schnell" : "gemini-2.5-flash-image";
localStorage.setItem("novaai-code:preferences", JSON.stringify({ theme: params.get("theme") || "dark", language: "es" }));
const config: ProviderConfig = {
  configId: provider, provider, displayName: provider, logoDataUrl: null, endpoint: "http://127.0.0.1:1234/v1", model: "",
  models: { chat: "", image: missing ? "" : image, video: local ? "vareliox-animatediff-v3" : "" },
  capabilities: ["chat", "image", ...(local ? ["video" as const] : [])], reasoningEffort: "medium", apiKeyConfigured: !local,
  connectTimeoutSecs: 5, firstResponseTimeoutSecs: 90, inactivityTimeoutSecs: 30, maxResponseTimeoutSecs: 600,
};
const initial: AiSettings = { activeProvider: provider, activeConfigId: provider, providers: [config] };
let request: { mode: string; model: string; prompt: string } | undefined;
let chatCalled = false;
mockConvertFileSrc("linux");
mockIPC((command, args) => {
  if (command === "generate_media") {
    request = args?.request as typeof request;
    return { id: "mock-media", mediaType: mode, provider, model: request!.model, uri: "/private/mock/image.png", mimeType: mode === "image" ? "image/png" : "video/webm", dataUrl: "", width: 512, height: 512 };
  }
  if (command === "start_ai_chat") { chatCalled = true; throw new Error("Media must not call the chat endpoint"); }
  if (command === "list_local_media_models") return [{ id: image, name: "Stable Diffusion 1.5 Q4", capabilities: ["image"], loaded: true }, { id: config.models.video, name: "AnimateDiff v3", capabilities: ["video"], loaded: true }];
  if (command === "list_media_models") return local ? [{ id: mode === "image" ? image : config.models.video, name: mode === "image" ? "Stable Diffusion 1.5 Q4" : "AnimateDiff v3", capabilities: [mode], loaded: true }] : [];
  // The cloud chat listing does not contain the configured generation model.
  if (command === "list_ai_models") return [];
  if (command === "save_ai_settings") return args?.settings;
  if (command === "detect_project_commands" || command === "list_computer_roots") return [];
  return null;
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
function button(selector: string, label?: string) {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((node) => !label || node.textContent?.includes(label));
  if (!found) throw new Error(`Missing button: ${selector} ${label}`);
  return found;
}
function Fixture() {
  const [settings, setSettings] = useState(initial);
  useEffect(() => { void (async () => {
    await pause(); await pause();
    button(".composer-button--attach").click(); await pause();
    const tool = button(".attachment-menu__tools button", mode === "image" ? "Crear imagen" : "Crear vídeo");
    if (tool.disabled) throw new Error("Tool is disabled with an empty prompt");
    tool.click(); await pause();
    const textarea = document.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    if (textarea.disabled || !document.querySelector(".composer-media-tool")) throw new Error("Media composer is unavailable without a chat model");
    if (!missing) {
      button(".chat-model-trigger").click(); await pause(); await pause();
      const choice = button(".model-option-list button", local ? mode === "image" ? "Stable Diffusion" : "AnimateDiff" : image);
      choice.click(); await pause(); await pause();
    }
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Un perro en un parque");
    textarea.dispatchEvent(new Event("input", { bubbles: true })); await pause();
    const send = button(".send-button");
    if (send.disabled) throw new Error("Send is disabled for a plain description without a chat model");
    send.click(); await pause(); await pause();
    if (missing) {
      if (request || !document.querySelector(".chat-messages")!.textContent!.includes("Configura un modelo multimedia")) throw new Error("Missing media model did not produce an actionable error");
    } else {
      if (!request || request.mode !== mode || request.model !== config.models[mode] || request.prompt !== "Un perro en un parque") throw new Error("Generation did not receive the selected media model and actual prompt");
      if (!document.querySelector(".chat-messages")!.textContent!.includes(mode === "image" ? "Imagen creada" : "Vídeo creado") || document.querySelector(".diagnostic-card")) throw new Error("Generation result was not rendered successfully");
    }
    if (chatCalled || config.models.chat !== "") throw new Error("Media replaced or used the conversation model");
    window.varelioxVisualResult = { status: "passed", results: ["El menú + permite elegir herramienta con el texto vacío", "Imagen y vídeo funcionan sin modelo de conversación", "El selector muestra modelos de la capacidad elegida", missing ? "Un proveedor no configurado muestra el error real" : "Una descripción normal usa generate_media y el modelo seleccionado", "El modelo de chat se conserva"] };
  })().catch((error: Error) => { window.varelioxVisualResult = { status: "failed", results: [], error: error.message }; }); }, []);
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}><ChatPane mode="chat" activeWorkspace project={null} projects={[]} openFiles={[]} settings={settings} sidebarOpen={false} onAddProject={() => {}} onSelectProject={() => {}} onConfigure={() => {}} onSettingsChange={setSettings} onFilesChanged={async () => {}} onNotify={() => {}} onWorkspaceChange={() => {}} onOpenExplorer={() => {}} onOpenPreferences={() => {}} onCloseSidebar={() => {}} /></div>;
}
createRoot(document.getElementById("root")!).render(<PreferencesProvider><Fixture /></PreferencesProvider>);
