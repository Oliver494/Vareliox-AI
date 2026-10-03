// IPC-only simulation of the Download -> install -> select -> save workflow.
// Real asset verification and inference are tested in the Rust hardware test.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { PreferencesProvider } from "../src/services/preferences";
import { ProviderPanel } from "../src/components/ProviderPanel";
import type { AiSettings, LocalModelCatalogItem, ProviderConfig } from "../src/types";
import "../src/App.css";
import "../src/workspace-polish.css";

localStorage.setItem("novaai-code:preferences", JSON.stringify({ theme: "dark", language: "es" }));
const local: ProviderConfig = {
  configId: "ollama", provider: "ollama", displayName: "Ollama", logoDataUrl: null,
  endpoint: "http://127.0.0.1:11434", model: "local-chat", models: { chat: "local-chat", image: "", video: "" },
  capabilities: ["chat"], reasoningEffort: "medium", apiKeyConfigured: false,
  connectTimeoutSecs: 5, firstResponseTimeoutSecs: 180, inactivityTimeoutSecs: 30, maxResponseTimeoutSecs: 600,
};
const cloud: ProviderConfig = { ...local, configId: "gemini", provider: "gemini", displayName: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", model: "cloud-chat", models: { chat: "cloud-chat", image: "", video: "" }, apiKeyConfigured: true };
const initial: AiSettings = { activeProvider: "gemini", activeConfigId: "gemini", providers: [local, cloud] };
const item: LocalModelCatalogItem = {
  id: "vareliox-sd15-q4", name: "Stable Diffusion 1.5 Q4", family: "Stable Diffusion",
  description: "Motor integrado de Vareliox", parameters: "Imagen", size: "1.57 GB + motor",
  ollamaId: "", lmStudioId: "", recommended: true, category: "image", capabilities: ["Texto a imagen"], runtimes: ["vareliox"], guideUrl: null,
};
let installed = false;
let saved: AiSettings | undefined;
let downloaded: string | undefined;
let removed = false;
mockIPC((command, args) => {
  if (command === "list_installed_local_models") return installed ? [{ id: item.id, name: item.name, runtime: "vareliox" }] : [];
  if (command === "remove_installed_local_model") { if (args?.modelId !== item.id || args?.runtime !== "vareliox") throw new Error("Wrong deletion target"); removed = true; installed = false; return [item.id]; }
  if (command === "list_ai_models") return [{ id: (args?.config as ProviderConfig).model, name: "Chat", loaded: true }];
  if (command === "list_local_media_models") return installed ? [{ id: item.id, name: item.name, capabilities: ["image"], loaded: true }] : [];
  if (command === "list_local_model_catalog") return [item];
  if (command === "download_local_media_model") { downloaded = args?.modelId as string; installed = true; return null; }
  if (command === "save_ai_settings") { saved = args?.settings as AiSettings; return saved; }
  return null;
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
function button(selector: string, label: string) {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((node) => node.textContent?.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function Fixture() {
  const [settings, setSettings] = useState(initial);
  useEffect(() => { void (async () => {
    await pause(); await pause();
    button(".provider-group button", "Ollama").click(); await pause();
    button(".provider-form button", "Explorar y descargar modelos").click(); await pause();
    button(".local-model-card button", "Descargar").click(); await pause(); await pause();
    if (downloaded !== item.id) throw new Error("Download did not use the managed model command");
    if (!saved || saved.activeConfigId !== "gemini" || saved.activeProvider !== "gemini") throw new Error("Downloading media replaced the conversation provider");
    const configured = saved.providers.find((provider) => provider.configId === "ollama")!;
    if (configured.models.image !== item.id || configured.models.chat !== "local-chat") throw new Error("Media was not saved independently of chat");
    if (saved.providers.find((provider) => provider.configId === "gemini")!.models.chat !== "cloud-chat") throw new Error("Cloud conversation model changed");
    button(".local-model-catalog .model-capability-tabs button", "Instalados").click(); await pause();
    button(".local-installed-list button", "Eliminar").click(); await pause();
    if (removed) throw new Error("Model was removed before confirmation");
    button(".local-model-confirm button", "Cancelar").click(); await pause();
    if (removed) throw new Error("Cancel removed a model");
    button(".local-installed-list button", "Eliminar").click(); await pause();
    button(".local-model-confirm button", "Eliminar").click(); await pause(); await pause();
    if (!removed || installed) throw new Error("Confirmed removal did not remove the model");
    if (saved.providers.find((provider) => provider.configId === "ollama")!.models.image || saved.activeConfigId !== "gemini") throw new Error("Removal did not clear only the image selection");
    window.varelioxVisualResult = { status: "passed", results: ["Descargar prepara el modelo local integrado", "La selección multimedia se guarda", "La descarga no cambia el proveedor ni el modelo de conversación", "Cancelar la eliminación conserva el modelo", "Eliminar requiere confirmación y limpia la selección sin cambiar el chat"] };
  })().catch((error: Error) => { window.varelioxVisualResult = { status: "failed", results: [], error: error.message }; }); }, []);
  return <ProviderPanel projectPath={null} settings={settings} onChange={setSettings} onClose={() => {}} />;
}
createRoot(document.getElementById("root")!).render(<PreferencesProvider><Fixture /></PreferencesProvider>);
