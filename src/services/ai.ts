import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AiChatEvent, AiSettings, ChatUpload, Diagnostic, ExternalFolderGrant, MediaGenerationResult, MediaMode, MediaStorageStats, ProviderConfig, ProviderId, ProviderTestResult, ModelInfo, LocalModelCatalogItem, LocalModelDownloadEvent, WebSearchResult } from "../types";
export { providerSupports } from "./providerCapabilities";

export const providerMeta: Record<ProviderId, { name: string; type: "local" | "cloud"; defaultEndpoint: string; requiresKey: boolean }> = {
  ollama: { name: "Ollama", type: "local", defaultEndpoint: "http://127.0.0.1:11434", requiresKey: false },
  lm_studio: { name: "LM Studio", type: "local", defaultEndpoint: "http://127.0.0.1:1234/v1", requiresKey: false },
  open_ai: { name: "OpenAI", type: "cloud", defaultEndpoint: "https://api.openai.com/v1", requiresKey: true },
  anthropic: { name: "Anthropic", type: "cloud", defaultEndpoint: "https://api.anthropic.com/v1", requiresKey: true },
  gemini: { name: "Google Gemini", type: "cloud", defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta", requiresKey: true },
  nvidia: { name: "NVIDIA API", type: "cloud", defaultEndpoint: "https://integrate.api.nvidia.com/v1", requiresKey: true },
  zai: { name: "Z.AI", type: "cloud", defaultEndpoint: "https://api.z.ai/api/paas/v4", requiresKey: true },
  kimi: { name: "Kimi", type: "cloud", defaultEndpoint: "https://api.moonshot.ai/v1", requiresKey: true },
  custom: { name: "Personalizado", type: "cloud", defaultEndpoint: "http://127.0.0.1:8000/v1", requiresKey: false },
};

export const providerDisplayName = (config: ProviderConfig | null | undefined) =>
  config?.displayName?.trim() || (config ? providerMeta[config.provider].name : "");

export const activeProviderConfig = (settings: AiSettings | null | undefined) => {
  if (!settings) return null;
  return settings.providers.find((item) => item.configId === settings.activeConfigId)
    ?? settings.providers.find((item) => item.provider === settings.activeProvider)
    ?? null;
};

export const providerChatModel = (config: ProviderConfig | null | undefined) => config?.models?.chat || config?.model || "";
export const providerMediaModel = (config: ProviderConfig | null | undefined, mode: MediaMode) => config?.models?.[mode] || "";
export const withMigratedProviderModels = (config: ProviderConfig): ProviderConfig => ({
  ...config,
  model: config.models?.chat || config.model || "",
  models: { chat: config.models?.chat || config.model || "", image: config.models?.image || "", video: config.models?.video || "" },
  capabilities: config.capabilities?.length ? config.capabilities : ["chat"],
});

const migrateSettings = (settings: AiSettings): AiSettings => ({
  ...settings,
  providers: settings.providers.map(withMigratedProviderModels),
});

export const ai = {
  settings: (projectPath: string | null) => invoke<AiSettings>("get_ai_settings", { projectPath }).then(migrateSettings),
  saveSettings: (projectPath: string | null, settings: AiSettings) => invoke<AiSettings>("save_ai_settings", { projectPath, settings: { ...settings, providers: settings.providers.map(withMigratedProviderModels) } }).then(migrateSettings),
  setKey: (config: ProviderConfig, projectPath: string | null, apiKey: string) => invoke<void>("set_provider_key", { provider: config.provider, configId: config.configId, projectPath, apiKey }),
  deleteKey: (config: ProviderConfig, projectPath: string | null) => invoke<void>("delete_provider_key", { provider: config.provider, configId: config.configId, projectPath }),
  models: (config: ProviderConfig, projectPath: string | null) => invoke<ModelInfo[]>("list_ai_models", { config, projectPath }),
  localCatalog: () => invoke<LocalModelCatalogItem[]>("list_local_model_catalog"),
  localMediaModels: () => invoke<ModelInfo[]>("list_local_media_models"),
  mediaModels: (config: ProviderConfig, mode: MediaMode, projectPath: string | null) => invoke<ModelInfo[]>("list_media_models", { config, mode, projectPath }),
  installedLocalModels: (config: ProviderConfig) => invoke<import("../types").InstalledLocalModel[]>("list_installed_local_models", { config }),
  removeLocalModel: (config: ProviderConfig, model: import("../types").InstalledLocalModel) => invoke<string[]>("remove_installed_local_model", { config, modelId: model.id, runtime: model.runtime }),
  downloadLocalMediaModel: (modelId: string, requestId: string, onEvent: (event: LocalModelDownloadEvent) => void) => {
    const channel = new Channel<LocalModelDownloadEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("download_local_media_model", { modelId, requestId, onEvent: channel });
  },
  downloadLocalModel: (config: ProviderConfig, modelId: string, onEvent: (event: LocalModelDownloadEvent) => void) => {
    const channel = new Channel<LocalModelDownloadEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("download_local_model", { config, modelId, onEvent: channel });
  },
  downloadComfyUiModel: (modelId: string, onEvent: (event: LocalModelDownloadEvent) => void) => {
    const channel = new Channel<LocalModelDownloadEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("download_comfyui_model", { modelId, onEvent: channel });
  },
  openComfyUi: () => invoke<void>("open_comfyui_desktop"),
  test: (config: ProviderConfig, projectPath: string | null) => invoke<ProviderTestResult>("test_ai_provider", { config, projectPath }),
  startLmStudio: (endpoint: string) => invoke<void>("start_lm_studio_server", { endpoint }),
  generateMedia: (request: { requestId: string; config: ProviderConfig; mode: MediaMode; model: string; prompt: string; imageData?: string | null }, projectPath: string | null, onProgress?: (event: LocalModelDownloadEvent) => void) => {
    const channel = new Channel<LocalModelDownloadEvent>();
    channel.onmessage = onProgress ?? (() => {});
    return invoke<MediaGenerationResult>("generate_media", { request, projectPath, onEvent: channel }).then((result) => result.uri ? { ...result, dataUrl: convertFileSrc(result.uri) } : result);
  },
  persistLegacyMedia: (media: MediaGenerationResult) => invoke<string>("persist_legacy_media", { id: media.id, mimeType: media.mimeType, dataUrl: media.dataUrl }).then((uri) => ({ ...media, uri, dataUrl: convertFileSrc(uri) })),
  saveMediaToProject: (media: MediaGenerationResult, projectPath: string, relativePath: string) => invoke<string>("save_media_to_project", { sourceUri: media.uri, dataUrl: media.dataUrl, projectPath, relativePath }),
  exportMedia: async (media: MediaGenerationResult) => {
    const extension = media.mimeType === "image/jpeg" ? "jpg" : media.mimeType === "image/webp" ? "webp" : media.mimeType === "video/webm" ? "webm" : media.mediaType === "video" ? "mp4" : "png";
    const destination = await save({ title: "Descargar creación de Vareliox", defaultPath: `vareliox-${media.mediaType}-${media.id.slice(0, 8)}.${extension}`, filters: [{ name: media.mediaType === "image" ? "Imagen" : "Vídeo", extensions: [extension] }] });
    if (!destination) return false;
    await invoke<void>("export_media", { sourceUri: media.uri, dataUrl: media.uri ? "" : media.dataUrl, destination });
    return true;
  },
  mediaStorageStats: () => invoke<MediaStorageStats>("media_storage_stats"),
  cleanupOrphanedMedia: (keepUris: string[]) => invoke<MediaStorageStats>("cleanup_orphaned_media", { keepUris }),
  searchWeb: (query: string) => invoke<WebSearchResult>("search_web", { request: { query, maxResults: 4 } }),
  cancel: (requestId: string) => invoke<boolean>("cancel_ai_chat", { requestId }),
  chat: (request: { requestId: string; projectPath: string | null; config: ProviderConfig; messages: { role: "system" | "user" | "assistant"; content: string }[]; attachments: string[]; uploads: Pick<ChatUpload, "name" | "mimeType" | "kind" | "data">[]; externalFolders: ExternalFolderGrant[]; workspaceAccess: boolean; canEdit: boolean; codeMode: boolean; terminalAccess?: "disabled" | "project" | "shell" | "admin"; terminalShell?: "automatic" | "cmd" | "powershell" | "bash" | "zsh" }, onEvent: (event: AiChatEvent) => void) => {
    const channel = new Channel<AiChatEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("chat_ai", { request, onEvent: channel });
  },
};

export function asDiagnostic(error: unknown): Diagnostic {
  if (error && typeof error === "object" && "code" in error && "title" in error) return error as Diagnostic;
  return {
    code: "UNKNOWN_ERROR",
    title: "No se pudo completar la operación",
    explanation: typeof error === "string" ? error : error instanceof Error ? error.message : "Ocurrió un error inesperado.",
    cause: "No se pudo identificar la causa exacta.",
    action: "Comprueba la configuración y vuelve a intentarlo.",
    technicalDetails: null,
    retryable: true,
  };
}
