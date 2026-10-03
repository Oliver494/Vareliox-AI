import { Check, CircleAlert, Cloud, HardDrive, ImagePlus, KeyRound, LibraryBig, LoaderCircle, Plus, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeProviderConfig, ai, asDiagnostic, providerChatModel, providerDisplayName, providerMeta, providerSupports } from "../services/ai";
import { customImageVerified } from "../services/providerCapabilities";
import { supportsReasoningEffort } from "../services/reasoningEffort";
import { usePreferences } from "../services/preferences";
import { LocalModelCatalog } from "./LocalModelCatalog";
import type { AiSettings, Diagnostic, LocalModelCatalogItem, MediaGenerationResult, MediaMode, ModelInfo, ProviderConfig, ProviderId, ProviderTestResult, ReasoningEffort } from "../types";
import { ProviderLogo } from "./ProviderLogo";

type Props = { projectPath: string | null; settings: AiSettings; onChange: (settings: AiSettings) => void; onClose: () => void };

// Keep the visual order stable even when an older saved configuration receives
// a newly added provider during migration.
const providerOrder: ProviderId[] = ["ollama", "lm_studio", "open_ai", "anthropic", "gemini", "nvidia", "zai", "kimi", "custom"];
const orderProviders = (items: ProviderConfig[]) => [...items].sort((left, right) => {
  const providerDifference = providerOrder.indexOf(left.provider) - providerOrder.indexOf(right.provider);
  return providerDifference || providerDisplayName(left).localeCompare(providerDisplayName(right));
});

export function ProviderPanel({ projectPath, settings, onChange, onClose }: Props) {
  const { t } = usePreferences();
  const initial = activeProviderConfig(settings) ?? settings.providers[0];
  const [selected, setSelected] = useState<string>(initial.configId);
  const [draft, setDraft] = useState<ProviderConfig>(initial);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [localMediaModels, setLocalMediaModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [startingLocal, setStartingLocal] = useState(false);
  const [testingMedia, setTestingMedia] = useState(false);
  const [mediaTestResult, setMediaTestResult] = useState<MediaGenerationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ProviderTestResult | null>(null);
  const [error, setError] = useState<Diagnostic | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const mediaTestRequestId = useRef<string | null>(null);
  const mediaTestAborted = useRef(false);

  const meta = providerMeta[draft.provider];
  const groups = useMemo(() => ({
    local: orderProviders(settings.providers.filter((item) => providerMeta[item.provider].type === "local")),
    cloud: orderProviders(settings.providers.filter((item) => providerMeta[item.provider].type === "cloud")),
  }), [settings.providers]);

  useEffect(() => {
    const next = settings.providers.find((item) => item.configId === selected);
    if (!next) return;
    let cancelled = false;
    setDraft(next);
    setModels([]);
    setResult(null);
    setMediaTestResult(null);
    setError(null);
    setKey("");
    if (providerMeta[next.provider].type === "local") {
      ai.localMediaModels().then((items) => { if (!cancelled) setLocalMediaModels(items); }).catch((cause) => { if (!cancelled) setError(asDiagnostic(cause)); });
    }

    if (!providerMeta[next.provider].requiresKey || next.apiKeyConfigured) {
      setModelsLoading(true);
      ai.models(next, projectPath)
        .then((items) => { if (!cancelled) setModels(items); })
        .catch((cause) => { if (!cancelled) setError(asDiagnostic(cause)); })
        .finally(() => { if (!cancelled) setModelsLoading(false); });
    }
    return () => { cancelled = true; };
    // The panel is remounted when project settings change. Avoid clearing the model list after each save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, projectPath]);

  async function loadModels(config = draft) {
    setModelsLoading(true);
    setError(null);
    try {
      const items = await ai.models(config, projectPath);
      setModels(items);
      return items;
    } catch (cause) {
      setError(asDiagnostic(cause));
      return [];
    } finally {
      setModelsLoading(false);
    }
  }

  async function persist(nextDraft = draft, savePendingKey = true, activateForChat = true) {
    setSaving(true);
    setError(null);
    try {
      if (savePendingKey && key.trim()) {
        await ai.setKey(nextDraft, projectPath, key);
        nextDraft = { ...nextDraft, apiKeyConfigured: true, mediaVerification: null };
      }
      const next: AiSettings = {
        activeProvider: activateForChat ? nextDraft.provider : settings.activeProvider,
        activeConfigId: activateForChat ? nextDraft.configId : settings.activeConfigId,
        providers: settings.providers.map((item) => item.configId === selected ? nextDraft : item),
      };
      const saved = await ai.saveSettings(projectPath, next);
      const savedDraft = saved.providers.find((item) => item.configId === selected)!;
      onChange(saved);
      setDraft(savedDraft);
      if (savePendingKey && key.trim()) setKey("");
      return saved;
    } catch (cause) {
      setError(asDiagnostic(cause));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveKey() {
    if (!key.trim()) return;
    const saved = await persist(draft, true);
    if (saved) await loadModels(saved.providers.find((item) => item.configId === selected)!);
  }

  async function test() {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const saved = await persist();
      if (!saved) return;
      const active = saved.providers.find((item) => item.configId === selected)!;
      const tested = await ai.test(active, projectPath);
      setResult(tested);
      setModels(tested.models);
      if (tested.models.length && !providerChatModel(active)) {
        const chat = tested.models.find((model) => model.loaded !== false)?.id ?? tested.models[0].id;
        const updated = { ...active, model: chat, models: { ...active.models, chat } };
        setDraft(updated);
        await persist(updated, false);
      }
    } catch (cause) {
      setError(asDiagnostic(cause));
    } finally {
      setTesting(false);
    }
  }

  async function startLocalServer() {
    setStartingLocal(true);
    setError(null);
    try {
      await ai.startLmStudio(draft.endpoint);
      await test();
    } catch (cause) {
      setError(asDiagnostic(cause));
    } finally {
      setStartingLocal(false);
    }
  }

  async function selectLocalMedia(mode: MediaMode, model: string) {
    const updated: ProviderConfig = { ...draft, models: { ...draft.models, [mode]: model }, capabilities: model ? Array.from(new Set([...draft.capabilities, mode])) : draft.capabilities.filter((capability) => capability !== mode) };
    setDraft(updated);
    if (!await persist(updated, false, false)) throw new Error("No se pudo guardar la selección del modelo local.");
  }

  async function localModelInstalled(item: LocalModelCatalogItem) {
    if (item.runtimes.includes("vareliox") && (item.category === "image" || item.category === "video")) {
      setLocalMediaModels(await ai.localMediaModels());
      await selectLocalMedia(item.category, item.id);
    } else {
      await loadModels();
    }
  }

  async function localModelRemoved(ids: string[], runtime: "vareliox" | "ollama" | "lm_studio") {
    const next: AiSettings = { ...settings, providers: settings.providers.map((config) => {
      const affected = runtime === "vareliox" ? config.provider === "ollama" || config.provider === "lm_studio" : config.provider === draft.provider && config.endpoint === draft.endpoint;
      if (!affected) return config;
      return { ...config, model: ids.includes(config.model) ? "" : config.model, models: {
        chat: ids.includes(config.models.chat) ? "" : config.models.chat,
        image: ids.includes(config.models.image) ? "" : config.models.image,
        video: ids.includes(config.models.video) ? "" : config.models.video,
      } };
    }) };
    const saved = await ai.saveSettings(projectPath, next);
    onChange(saved);
    const updated = saved.providers.find((config) => config.configId === selected)!;
    setDraft(updated);
    setLocalMediaModels(await ai.localMediaModels());
    await loadModels(updated);
  }

  async function testCustomImage() {
    if (draft.provider !== "custom" || !draft.models.image.trim() || testingMedia) return;
    setTestingMedia(true);
    setMediaTestResult(null);
    setError(null);
    const requestId = crypto.randomUUID();
    mediaTestAborted.current = false;
    mediaTestRequestId.current = requestId;
    try {
      const saved = await persist(draft);
      if (!saved || mediaTestAborted.current) return;
      const active = saved.providers.find((item) => item.configId === selected);
      if (!active) return;
      const image = await ai.generateMedia({
        requestId,
        config: active,
        mode: "image",
        model: active.models.image.trim(),
        prompt: "A simple blue circle on a white background",
      }, projectPath);
      if (mediaTestAborted.current) return;
      const verified: ProviderConfig = {
        ...active,
        capabilities: Array.from(new Set([...active.capabilities, "image" as const])),
        mediaVerification: { endpoint: active.endpoint, imageModel: active.models.image.trim() },
      };
      if (!await persist(verified, false)) return;
      setMediaTestResult(image);
    } catch (cause) {
      setError(asDiagnostic(cause));
    } finally {
      if (mediaTestRequestId.current === requestId) mediaTestRequestId.current = null;
      setTestingMedia(false);
    }
  }

  async function selectModel(model: string) {
    const next = { ...draft, model, models: { ...draft.models, chat: model } };
    setDraft(next);
    await persist(next);
  }

  async function selectEffort(reasoningEffort: ReasoningEffort) {
    const next = { ...draft, reasoningEffort };
    setDraft(next);
    await persist(next, false);
  }

  async function removeKey() {
    try {
      await ai.deleteKey(draft, projectPath);
      const next = { ...draft, apiKeyConfigured: false, mediaVerification: null, capabilities: draft.provider === "custom" ? draft.capabilities.filter((item) => item !== "image") : draft.capabilities };
      setDraft(next);
      setModels([]);
      const updated = { ...settings, providers: settings.providers.map((item) => item.configId === selected ? next : item) };
      onChange(await ai.saveSettings(projectPath, updated));
    } catch (cause) {
      setError(asDiagnostic(cause));
    }
  }

  async function closePanel() {
    if (mediaTestRequestId.current) {
      mediaTestAborted.current = true;
      try { await ai.cancel(mediaTestRequestId.current); } catch { /* The request may have finished already. */ }
    }
    if (key.trim() && !await persist()) return;
    onClose();
  }

  const update = <K extends keyof ProviderConfig>(field: K, value: ProviderConfig[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const chatModel = providerChatModel(draft);
  const currentOutsideCatalog = chatModel && !models.some((model) => model.id === chatModel);
  const connectionDiagnostic = error ?? result?.diagnostic;
  const canStartLmStudio = draft.provider === "lm_studio" && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/v1\/?$/.test(draft.endpoint) && !!connectionDiagnostic && ["CONNECTION_REFUSED", "SERVER_OFFLINE", "PROVIDER_NOT_INSTALLED"].includes(connectionDiagnostic.code);

  function addCustomProvider() {
    const configId = `custom:${crypto.randomUUID()}`;
    const custom: ProviderConfig = {
      configId,
      provider: "custom",
      displayName: t("Nuevo proveedor", "New provider"),
      logoDataUrl: null,
      endpoint: providerMeta.custom.defaultEndpoint,
      model: "",
      models: { chat: "", image: "", video: "" },
      capabilities: ["chat"],
      reasoningEffort: "medium",
      connectTimeoutSecs: 5,
      firstResponseTimeoutSecs: 90,
      inactivityTimeoutSecs: 30,
      maxResponseTimeoutSecs: 600,
      apiKeyConfigured: false,
    };
    onChange({ ...settings, activeProvider: "custom", activeConfigId: configId, providers: [...settings.providers, custom] });
    setSelected(configId);
    setDraft(custom);
  }

  async function deleteCustomProvider() {
    if (draft.provider !== "custom") return;
    const name = providerDisplayName(draft);
    if (!window.confirm(t(`¿Eliminar el proveedor “${name}”? Su configuración y clave guardada se eliminarán.`, `Delete provider “${name}”? Its settings and stored key will be removed.`))) return;
    try {
      await ai.deleteKey(draft, projectPath);
      const remaining = settings.providers.filter((item) => item.configId !== draft.configId);
      const fallback = remaining.find((item) => item.provider === "ollama") ?? remaining[0];
      const saved = await ai.saveSettings(projectPath, { activeProvider: fallback?.provider ?? null, activeConfigId: fallback?.configId ?? null, providers: remaining });
      onChange(saved);
      if (fallback) setSelected(fallback.configId);
    } catch (cause) { setError(asDiagnostic(cause)); }
  }

  function selectLogo(file: File | undefined) {
    if (!file) return;
    if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(file.type)) {
      setError({ code: "INVALID_LOGO", title: t("Logo no compatible", "Unsupported logo"), explanation: t("Usa una imagen PNG, JPG o WebP.", "Use a PNG, JPG, or WebP image."), cause: t("El formato elegido no es seguro para mostrarlo como logo.", "The selected format is not safe to display as a logo."), action: t("Elige otra imagen.", "Choose another image."), technicalDetails: null, retryable: false });
      return;
    }
    if (file.size > 512 * 1024) {
      setError({ code: "LOGO_TOO_LARGE", title: t("Logo demasiado grande", "Logo too large"), explanation: t("El logo debe pesar 512 KB o menos.", "The logo must be 512 KB or smaller."), cause: t("La imagen seleccionada supera el límite.", "The selected image exceeds the limit."), action: t("Reduce la imagen y vuelve a intentarlo.", "Resize the image and try again."), technicalDetails: null, retryable: false });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update("logoDataUrl", typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  return <div className="provider-overlay" role="dialog" aria-modal="true" aria-label={t("Proveedores de IA", "AI providers")}>
    <div className="provider-panel">
      <header><div><strong>{t("Proveedores", "Providers")}</strong><span>{projectPath ? t("Configuración del proyecto", "Project settings") : t("Configuración global", "Global settings")}</span></div><button className="icon-button" onClick={() => void closePanel()} aria-label={t("Cerrar", "Close")}><X size={17} /></button></header>
      <div className="provider-panel__body">
        <nav className="provider-list" aria-label={t("Lista de proveedores", "Provider list")}>
          <ProviderGroup title={t("Locales", "Local")} icon={<HardDrive size={14} />} items={groups.local} selected={selected} onSelect={setSelected} />
          <ProviderGroup title="API" icon={<Cloud size={14} />} items={groups.cloud} selected={selected} onSelect={setSelected} />
          <button className="provider-add-custom" type="button" onClick={addCustomProvider}><Plus size={15} />{t("Nuevo proveedor", "New provider")}</button>
        </nav>
        <section className="provider-form">
          <div className="provider-form__scroll">
          <div className="provider-form__heading"><div className="provider-heading-brand"><ProviderLogo provider={draft.provider} customLogo={draft.logoDataUrl} label={providerDisplayName(draft)} size="large" /><div><h2>{providerDisplayName(draft)}</h2><span>{meta.type === "local" ? t("En este equipo", "On this computer") : t("Proveedor externo", "External provider")}</span></div></div>{result && <span className={`connection-badge ${result.connected ? "is-connected" : "is-error"}`}>{result.connected ? <Check size={13} /> : <CircleAlert size={13} />}{result.connected ? `${t("Conectado", "Connected")} · ${result.durationMs} ms` : t("Error", "Error")}</span>}</div>
          {draft.provider === "custom" && <><div className="custom-provider-identity"><label>{t("Nombre del proveedor", "Provider name")}<input value={draft.displayName} maxLength={48} onChange={(event) => update("displayName", event.target.value)} placeholder="DeepSeek" /></label><div className="custom-provider-logo"><span>{t("Logo", "Logo")}</span><div><ProviderLogo provider="custom" customLogo={draft.logoDataUrl} label={providerDisplayName(draft)} size="large" /><button className="secondary-button" type="button" onClick={() => logoInput.current?.click()}><ImagePlus size={14} />{draft.logoDataUrl ? t("Cambiar", "Change") : t("Elegir imagen", "Choose image")}</button>{draft.logoDataUrl && <button className="icon-button" type="button" onClick={() => update("logoDataUrl", null)} title={t("Quitar logo", "Remove logo")}><Trash2 size={14} /></button>}<input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { selectLogo(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div></div></div><div className="custom-provider-note"><strong>{t("API compatible con OpenAI", "OpenAI-compatible API")}</strong><span>{t("Usa una URL base que termine en /v1. Vareliox consultará /models y enviará el chat a /chat/completions.", "Use a base URL ending in /v1. Vareliox will query /models and send chat to /chat/completions.")}</span></div></>}
          <label>Endpoint<div className="input-with-action"><input value={draft.endpoint} onChange={(event) => update("endpoint", event.target.value)} spellCheck={false} /><button className="icon-button" title={t("Restaurar endpoint", "Restore endpoint")} onClick={() => update("endpoint", meta.defaultEndpoint)}><RotateCcw size={15} /></button></div></label>
          {(meta.requiresKey || draft.provider === "custom") && <label>API key {draft.provider === "custom" && <span className="field-hint">{t("Opcional: déjala vacía si tu servidor no usa autenticación.", "Optional: leave it empty if your server does not use authentication.")}</span>}<div className="key-row"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={draft.apiKeyConfigured ? t("Guardada de forma segura", "Stored securely") : t("Pega tu clave", "Paste your key")} autoComplete="new-password" /><span className={draft.apiKeyConfigured ? "key-state is-set" : "key-state"}><KeyRound size={13} />{draft.apiKeyConfigured ? t("Configurada", "Configured") : draft.provider === "custom" ? t("Opcional", "Optional") : t("Sin clave", "No key")}</span>{key.trim() && <button className="icon-button" onClick={() => void saveKey()} title={t("Guardar clave", "Save key")} disabled={saving}><Check size={15} /></button>}{draft.apiKeyConfigured && <button className="icon-button" onClick={() => void removeKey()} title={t("Eliminar clave", "Delete key")}><Trash2 size={15} /></button>}</div></label>}
          <div className="provider-model-capabilities">
            {meta.type === "local" && (["image", "video"] as MediaMode[]).map((mode) => <label key={mode}>{mode === "image" ? t("Modelo de imagen", "Image model") : t("Modelo de vídeo", "Video model")}<select value={draft.models[mode]} onChange={(event) => void selectLocalMedia(mode, event.target.value).catch((cause) => setError(asDiagnostic(cause)))} disabled={saving}><option value="">{t("Seleccionar modelo", "Select model")}</option>{localMediaModels.filter((model) => model.capabilities.includes(mode)).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>)}
            <label>{t("Modelo de chat", "Chat model")}<div className="input-with-action"><select value={chatModel} onChange={(event) => void selectModel(event.target.value)} disabled={modelsLoading}><option value="">{modelsLoading ? t("Cargando modelos…", "Loading models…") : t("Seleccionar modelo", "Select model")}</option>{currentOutsideCatalog && <option value={chatModel}>{chatModel}</option>}{models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.loaded === false ? ` · ${t("no cargado", "not loaded")}` : ""}</option>)}</select><button className="icon-button" title={t("Actualizar modelos", "Refresh models")} onClick={() => void loadModels()} disabled={modelsLoading || (meta.requiresKey && !draft.apiKeyConfigured && !key.trim())}>{modelsLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button></div><input className="model-manual" value={chatModel} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value, models: { ...current.models, chat: event.target.value } }))} onBlur={() => { if (chatModel.trim()) void persist(draft, false); }} placeholder={t("O escribe el identificador exacto", "Or enter the exact identifier")} spellCheck={false} />{models.length > 0 && <small>{models.length} {t("modelos disponibles", "models available")}</small>}{meta.type === "local" && <button className="local-library-button" type="button" onClick={() => setCatalogOpen(true)}><LibraryBig size={15} />{t("Explorar y descargar modelos", "Browse and download models")}</button>}</label>
            {(draft.provider === "nvidia" || draft.provider === "open_ai" || draft.provider === "gemini" || draft.provider === "custom") && <>
              <label>{t("Modelo de imagen", "Image model")}<input value={draft.models.image} onChange={(event) => setDraft((current) => ({ ...current, models: { ...current.models, image: event.target.value }, mediaVerification: current.provider === "custom" ? null : current.mediaVerification, capabilities: current.provider === "custom" || !event.target.value ? current.capabilities.filter((item) => item !== "image") : Array.from(new Set([...current.capabilities, "image" as const])) }))} onBlur={() => { if (draft.provider !== "custom") void persist(draft, false); }} placeholder={draft.provider === "nvidia" ? "black-forest-labs/flux.1-schnell" : draft.provider === "gemini" ? "gemini-3.1-flash-image" : "gpt-image-1"} /></label>
              {draft.provider === "nvidia" && <label>{t("Modelo de vídeo", "Video model")}<input value={draft.models.video} onChange={(event) => setDraft((current) => ({ ...current, models: { ...current.models, video: event.target.value }, capabilities: event.target.value ? Array.from(new Set([...current.capabilities, "video" as const])) : current.capabilities.filter((item) => item !== "video") }))} onBlur={() => void persist(draft, false)} placeholder="stabilityai/stable-video-diffusion" /></label>}
            </>}
          </div>
          {draft.provider === "custom" && <div className="provider-media-test">
            <strong>{customImageVerified(draft) ? t("Imagen verificada", "Image verified") : t("Imagen aún no verificada", "Image not verified yet")}</strong>
            <span>{t("Una prueba real confirma que este endpoint devuelve una imagen. Puede consumir créditos del proveedor; no cambia tu modelo de chat.", "A real test confirms this endpoint returns an image. It may use provider credits; it does not change your chat model.")}</span>
            <div><button className="secondary-button" type="button" disabled={!draft.models.image.trim() || saving || testingMedia} onClick={() => void testCustomImage()}>{testingMedia ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />}{testingMedia ? t("Probando imagen…", "Testing image…") : t("Probar modelo de imagen", "Test image model")}</button>{testingMedia && <button className="secondary-button" type="button" onClick={() => { mediaTestAborted.current = true; if (mediaTestRequestId.current) void ai.cancel(mediaTestRequestId.current); }}>{t("Cancelar", "Cancel")}</button>}</div>
            {mediaTestResult?.dataUrl && <img src={mediaTestResult.dataUrl} alt={t("Imagen generada durante la prueba", "Image generated during the test")} />}
          </div>}
          {chatModel && (supportsReasoningEffort(draft.provider, chatModel) ? <label>{t("Esfuerzo", "Effort")}<span className="field-hint">{t("Controla cuánto razona el modelo antes de responder.", "Controls how much the model reasons before responding.")}</span><div className="provider-effort" role="group" aria-label={t("Esfuerzo de razonamiento", "Reasoning effort")}>{(["low", "medium", "high"] as ReasoningEffort[]).map((effort) => <button type="button" key={effort} className={(draft.reasoningEffort ?? "medium") === effort ? "is-active" : ""} onClick={() => void selectEffort(effort)} disabled={saving}>{effort === "low" ? t("Bajo", "Low") : effort === "medium" ? t("Medio", "Medium") : t("Alto", "High")}</button>)}</div></label> : <div className="provider-effort-unavailable"><strong>{t("Esfuerzo predeterminado", "Default effort")}</strong><span>{t("Este modelo no permite cambiarlo.", "This model does not allow changing it.")}</span></div>)}
          <div className="timeout-grid"><label>{t("Conexión", "Connection")}<input type="number" min="1" max="60" value={draft.connectTimeoutSecs} onChange={(event) => update("connectTimeoutSecs", Number(event.target.value))} /><span>s</span></label><label>{t("Inicio", "Start")}<input type="number" min="1" max="300" value={draft.firstResponseTimeoutSecs} onChange={(event) => update("firstResponseTimeoutSecs", Number(event.target.value))} /><span>s</span></label><label>{t("Inactividad", "Inactivity")}<input type="number" min="1" max="300" value={draft.inactivityTimeoutSecs} onChange={(event) => update("inactivityTimeoutSecs", Number(event.target.value))} /><span>s</span></label><label>{t("Máximo", "Maximum")}<input type="number" min="10" max="3600" value={draft.maxResponseTimeoutSecs} onChange={(event) => update("maxResponseTimeoutSecs", Number(event.target.value))} /><span>s</span></label></div>
          {connectionDiagnostic && <div className="provider-result"><strong>{connectionDiagnostic.title}</strong><p>{connectionDiagnostic.explanation}</p><span>{connectionDiagnostic.action}</span>{canStartLmStudio && <button type="button" className="secondary-button" disabled={startingLocal || testing} onClick={() => void startLocalServer()}>{startingLocal ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{startingLocal ? t("Iniciando servidor…", "Starting server…") : t("Iniciar servidor local", "Start local server")}</button>}</div>}
          </div>
          <footer><span>{saving ? t("Guardando cambios…", "Saving changes…") : t("Configuración segura del proyecto", "Secure project settings")}</span>{draft.provider === "custom" && <button className="danger-text-button" disabled={saving || testing || testingMedia} onClick={() => void deleteCustomProvider()}><Trash2 size={14} />{t("Eliminar proveedor", "Delete provider")}</button>}<button className="secondary-button" disabled={saving || testing || testingMedia || (draft.provider === "custom" && !draft.displayName.trim())} onClick={() => void persist()}>{saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{t("Guardar", "Save")}</button><button className="primary-button" disabled={saving || testing || testingMedia || (draft.provider === "custom" && !draft.displayName.trim())} onClick={() => void test()}>{testing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{testing ? t("Probando conexión…", "Testing connection…") : t("Probar conexión", "Test connection")}</button></footer>
        </section>
      </div>
    </div>
    {catalogOpen && (draft.provider === "ollama" || draft.provider === "lm_studio") && <LocalModelCatalog provider={draft.provider} config={draft} onClose={() => setCatalogOpen(false)} onInstalled={localModelInstalled} onRemoved={localModelRemoved} />}
  </div>;
}

function ProviderGroup({ title, icon, items, selected, onSelect }: { title: string; icon: React.ReactNode; items: ProviderConfig[]; selected: string; onSelect: (id: string) => void }) {
  const { t } = usePreferences();
  return <div className="provider-group"><span>{icon}{title}</span>{items.map((item) => <button key={item.configId} className={selected === item.configId ? "is-active" : ""} onClick={() => onSelect(item.configId)}><ProviderLogo provider={item.provider} customLogo={item.logoDataUrl} label={providerDisplayName(item)} size="medium" /><span><strong>{providerDisplayName(item)}</strong><small>{providerChatModel(item) || (providerMeta[item.provider].type === "local" ? t("Local", "Local") : t("Sin modelo", "No model"))}</small><span className="provider-capability-badges"><i>Chat</i>{providerSupports(item, "image") && <i>{t("Imagen", "Image")}</i>}{providerSupports(item, "video") && <i>{t("Vídeo", "Video")}</i>}</span></span><em className={item.apiKeyConfigured || providerMeta[item.provider].type === "local" ? "is-ready" : ""}>{item.apiKeyConfigured ? <KeyRound size={12} /> : <i />}</em></button>)}</div>;
}
