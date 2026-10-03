import { Check, ChevronDown, KeyRound, LoaderCircle, RefreshCw, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeProviderConfig, ai, asDiagnostic, providerChatModel, providerDisplayName, providerMeta } from "../services/ai";
import { supportsReasoningEffort } from "../services/reasoningEffort";
import { selectMediaProvider } from "../services/providerCapabilities";
import { usePreferences } from "../services/preferences";
import type { AiSettings, ModelInfo, ProviderConfig, ProviderId, ReasoningEffort } from "../types";
import { ProviderLogo } from "./ProviderLogo";

type Props = {
  projectPath: string | null;
  settings: AiSettings;
  disabled?: boolean;
  onChange: (settings: AiSettings) => void;
  onConfigure: () => void;
  capability?: "chat" | "image" | "video";
  mediaConfigId?: string;
  onCapabilityChange?: (capability: "chat" | "image" | "video") => void;
  onMediaProviderChange?: (configId: string) => void;
};

const providerOrder: ProviderId[] = ["ollama", "lm_studio", "open_ai", "anthropic", "gemini", "nvidia", "zai", "kimi", "custom"];
const effortOptions: ReasoningEffort[] = ["low", "medium", "high"];

export function ChatModelPicker({ projectPath, settings, disabled, onChange, onConfigure, capability = "chat", mediaConfigId, onCapabilityChange, onMediaProviderChange }: Props) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const initial = activeProviderConfig(settings) ?? settings.providers[0] ?? null;
  const [selected, setSelected] = useState<string>(initial?.configId ?? "");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const catalogRequest = useRef(0);
  const chatActive = activeProviderConfig(settings);
  const active = capability === "chat" ? chatActive : settings.providers.find((item) => item.configId === mediaConfigId) ?? selectMediaProvider(settings.providers, capability, chatActive?.configId) ?? settings.providers.find((item) => !!item.models?.[capability]) ?? chatActive;
  const modelFor = (config: ProviderConfig | null | undefined) => capability === "chat" ? providerChatModel(config) : config?.models?.[capability] ?? "";
  const selectedConfig = settings.providers.find((item) => item.configId === selected) ?? initial;
  const effortSupported = capability === "chat" && selectedConfig ? supportsReasoningEffort(selectedConfig.provider, providerChatModel(selectedConfig)) : false;
  const canLoad = selectedConfig ? !providerMeta[selectedConfig.provider].requiresKey || selectedConfig.apiKeyConfigured : false;
  const orderedConfigs = useMemo(() => [...settings.providers].sort((left, right) => {
    const difference = providerOrder.indexOf(left.provider) - providerOrder.indexOf(right.provider);
    return difference || providerDisplayName(left).localeCompare(providerDisplayName(right));
  }), [settings.providers]);
  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return models.filter((model) => !value || `${model.name} ${model.id}`.toLocaleLowerCase().includes(value));
  }, [models, query]);

  useEffect(() => {
    const next = active;
    if (next) setSelected(next.configId);
    if (open && next) void loadModels(next.configId);
  }, [settings, capability, mediaConfigId]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  async function loadModels(configId = selectedConfig?.configId ?? "") {
    const request = ++catalogRequest.current;
    const config = settings.providers.find((item) => item.configId === configId);
    if (!config) { setModels([]); return; }
    if (providerMeta[config.provider].requiresKey && !config.apiKeyConfigured) { setModels([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const local = config.provider === "ollama" || config.provider === "lm_studio";
      const items = capability !== "chat" ? await ai.mediaModels(config, capability, projectPath) : await ai.models(config, projectPath);
      const matching = items.filter((item) => capability === "chat" ? !item.capabilities?.length || item.capabilities.includes("chat") : item.capabilities?.includes(capability));
      const configured = modelFor(config);
      if (capability !== "chat" && !local && configured && !matching.some((item) => item.id === configured)) matching.unshift({ id: configured, name: configured, capabilities: [capability], loaded: null, contextWindow: null });
      if (request === catalogRequest.current) setModels(matching);
    }
    catch (cause) { if (request === catalogRequest.current) {
      const configured = modelFor(config);
      const local = config.provider === "ollama" || config.provider === "lm_studio";
      setModels(capability !== "chat" && !local && configured ? [{ id: configured, name: configured, capabilities: [capability], loaded: null, contextWindow: null }] : []);
      setError(asDiagnostic(cause).explanation);
    } }
    finally { if (request === catalogRequest.current) setLoading(false); }
  }

  async function openPicker() {
    const next = !open;
    setOpen(next); setQuery(""); setError("");
    if (next) await loadModels(selectedConfig?.configId ?? "");
  }

  async function chooseProvider(config: ProviderConfig) {
    if (capability !== "chat") { setSelected(config.configId); onMediaProviderChange?.(config.configId); await loadModels(config.configId); return; }
    const request = ++catalogRequest.current;
    setSelected(config.configId); setModels([]); setLoading(false); setQuery(""); setError(""); setSaving(true);
    try {
      const saved = await ai.saveSettings(projectPath, { ...settings, activeProvider: config.provider, activeConfigId: config.configId });
      onChange(saved);
      const savedConfig = saved.providers.find((item) => item.configId === config.configId);
      if (savedConfig && (!providerMeta[savedConfig.provider].requiresKey || savedConfig.apiKeyConfigured)) {
        setLoading(true);
        try { const items = await ai.models(savedConfig, projectPath); if (request === catalogRequest.current) setModels(items); }
        catch (cause) { if (request === catalogRequest.current) setError(asDiagnostic(cause).explanation); }
        finally { if (request === catalogRequest.current) setLoading(false); }
      }
    } catch (cause) { setError(asDiagnostic(cause).explanation); }
    finally { setSaving(false); }
  }

  async function chooseModel(model: string) {
    if (!selectedConfig) return;
    setSaving(true); setError("");
    try {
      const next: AiSettings = {
        ...settings,
        ...(capability === "chat" ? { activeProvider: selectedConfig.provider, activeConfigId: selectedConfig.configId } : {}),
        providers: settings.providers.map((item) => item.configId === selectedConfig.configId ? { ...item, ...(capability === "chat" ? { model } : {}), models: { ...item.models, [capability]: model }, capabilities: Array.from(new Set([...item.capabilities, capability])) } : item),
      };
      onChange(await ai.saveSettings(projectPath, next));
      if (capability !== "chat") onMediaProviderChange?.(selectedConfig.configId);
      setOpen(false);
    } catch (cause) { setError(asDiagnostic(cause).explanation); }
    finally { setSaving(false); }
  }

  async function chooseEffort(reasoningEffort: ReasoningEffort) {
    if (!selectedConfig) return;
    setSaving(true); setError("");
    try {
      const next: AiSettings = {
        activeProvider: selectedConfig.provider,
        activeConfigId: selectedConfig.configId,
        providers: settings.providers.map((item) => item.configId === selectedConfig.configId ? { ...item, reasoningEffort } : item),
      };
      onChange(await ai.saveSettings(projectPath, next));
    } catch (cause) { setError(asDiagnostic(cause).explanation); }
    finally { setSaving(false); }
  }

  if (!selectedConfig) return <div className="chat-model-picker"><button className="chat-model-trigger" type="button" onClick={onConfigure} disabled={disabled}><Settings2 size={15} /><strong>{t("Configurar proveedor", "Configure provider")}</strong></button></div>;

  return <div className="chat-model-picker" ref={root}>
    <button className="chat-model-trigger" type="button" onClick={() => void openPicker()} disabled={disabled} title={t("Cambiar proveedor o modelo", "Change provider or model")} aria-expanded={open}>
      {active ? <ProviderLogo provider={active.provider} customLogo={active.logoDataUrl} label={providerDisplayName(active)} size="small" /> : <span className="provider-logo provider-logo--small" />}
      <strong>{active ? providerDisplayName(active) : t("Modelo", "Model")}</strong>
      <span className="chat-model-trigger__model">{modelFor(active) || t("Seleccionar", "Select")}</span>
      {active && supportsReasoningEffort(active.provider, providerChatModel(active)) && <span className="chat-model-trigger__effort">{active.reasoningEffort === "low" ? t("Bajo", "Low") : active.reasoningEffort === "high" ? t("Alto", "High") : t("Medio", "Medium")}</span>}
      <ChevronDown size={12} />
    </button>
    {open && <section className="chat-model-menu" aria-label={t("Seleccionar modelo", "Select model")}>
      <header><div><strong>{t("Modelo", "Model")}</strong><span>{t("Cambia sin salir del chat", "Switch without leaving the chat")}</span></div><button type="button" onClick={() => setOpen(false)} aria-label={t("Cerrar", "Close")}><X size={14} /></button></header>
      {onCapabilityChange && <div className="model-capability-tabs" role="group" aria-label={t("Tipo de modelo", "Model type")}>{(["chat", "image", "video"] as const).map((type) => <button key={type} type="button" aria-pressed={capability === type} onClick={() => onCapabilityChange(type)}>{type === "chat" ? t("Conversación", "Conversation") : type === "image" ? t("Imagen", "Image") : t("Vídeo", "Video")}</button>)}</div>}
      <div className="model-provider-grid">
        {orderedConfigs.map((config) => {
          return <button type="button" key={config.configId} className={selected === config.configId ? "is-active" : ""} onClick={() => void chooseProvider(config)} disabled={saving}>
            <ProviderLogo provider={config.provider} customLogo={config.logoDataUrl} label={providerDisplayName(config)} size="medium" />
            <span><strong>{providerDisplayName(config).replace("Google ", "").replace(" API", "")}</strong><small>{providerMeta[config.provider].type === "local" ? t("Local", "Local") : "API"}</small></span>
            <em>{providerMeta[config.provider].requiresKey && !config.apiKeyConfigured ? <KeyRound size={11} /> : providerChatModel(config) ? <Check size={11} /> : null}</em>
          </button>;
        })}
      </div>
      {!canLoad ? <div className="model-menu-empty"><KeyRound size={16} /><span>{t("Falta la API key de", "Missing API key for")} {providerDisplayName(selectedConfig)}.</span><button type="button" onClick={() => { setOpen(false); onConfigure(); }}><Settings2 size={12} />{t("Configurar", "Configure")}</button></div> : <>
        <div className="model-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Buscar modelo…", "Search models…")} autoFocus /><button type="button" onClick={() => void loadModels()} disabled={loading} title={t("Actualizar modelos", "Refresh models")}>{loading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button></div>
        <div className="model-option-list">
          {loading && !models.length ? <div className="model-menu-status"><LoaderCircle className="spin" size={14} />{t("Consultando modelos…", "Loading models…")}</div> : filtered.map((model) => <button type="button" key={model.id} className={modelFor(selectedConfig) === model.id ? "is-active" : ""} onClick={() => void chooseModel(model.id)} disabled={saving || (capability === "chat" && model.loaded === false)} title={model.id}>
            <ProviderLogo provider={selectedConfig.provider} customLogo={selectedConfig.logoDataUrl} label={providerDisplayName(selectedConfig)} size="medium" /><span className="model-option-copy"><strong>{model.name}</strong><small>{model.id}</small></span>
            {model.loaded === false && capability === "chat" ? <em>{t("No cargado", "Not loaded")}</em> : modelFor(selectedConfig) === model.id ? <Check size={14} /> : null}
          </button>)}
          {!loading && !filtered.length && <div className="model-menu-status">{selectedConfig.provider === "custom" ? t("No se pudo listar modelos. Puedes escribir el identificador exacto en Configuración.", "Models could not be listed. You can enter the exact identifier in Settings.") : t("No hay modelos disponibles.", "No models available.")}</div>}
        </div>
        {effortSupported ? <div className="reasoning-effort"><div><strong>{t("Esfuerzo", "Effort")}</strong><span>{t("Controla cuánto razona antes de responder", "Controls how much the model reasons before responding")}</span></div><div role="group" aria-label={t("Esfuerzo de razonamiento", "Reasoning effort")}>{effortOptions.map((item) => <button type="button" key={item} className={(selectedConfig.reasoningEffort ?? "medium") === item ? "is-active" : ""} onClick={() => void chooseEffort(item)} disabled={saving}>{item === "low" ? t("Bajo", "Low") : item === "high" ? t("Alto", "High") : t("Medio", "Medium")}</button>)}</div></div> : providerChatModel(selectedConfig) && <div className="reasoning-effort reasoning-effort--unavailable"><div><strong>{t("Esfuerzo predeterminado", "Default effort")}</strong><span>{t("Este modelo no permite cambiarlo", "This model does not allow changing it")}</span></div></div>}
      </>}
      {error && <div className="model-menu-error">{error}<button type="button" onClick={() => { setOpen(false); onConfigure(); }}>{t("Revisar configuración", "Review settings")}</button></div>}
    </section>}
  </div>;
}
