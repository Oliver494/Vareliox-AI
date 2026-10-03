import { Code2, Download, Eye, HardDrive, Image, LoaderCircle, MessageCircle, Search, Sparkles, Trash2, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ai, asDiagnostic, providerMeta } from "../services/ai";
import { usePreferences } from "../services/preferences";
import type { Diagnostic, InstalledLocalModel, LocalModelCatalogItem, LocalModelDownloadEvent, ProviderConfig, ProviderId } from "../types";

type Props = { provider: Extract<ProviderId, "ollama" | "lm_studio">; config: ProviderConfig; onClose: () => void; onInstalled: (item: LocalModelCatalogItem) => void | Promise<void>; onRemoved: (ids: string[], runtime: InstalledLocalModel["runtime"]) => void | Promise<void> };
type Category = "all" | "chat" | "code" | "vision" | "image" | "video";

const categoryIcons = { all: Sparkles, chat: MessageCircle, code: Code2, vision: Eye, image: Image, video: Video } satisfies Record<Category, typeof Sparkles>;

export function LocalModelCatalog({ provider, config, onClose, onInstalled, onRemoved }: Props) {
  const { t } = usePreferences();
  const [items, setItems] = useState<LocalModelCatalogItem[]>([]);
  const [installed, setInstalled] = useState<InstalledLocalModel[]>([]);
  const [installedView, setInstalledView] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<InstalledLocalModel | null>(null);
  const [removing, setRemoving] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState("Cargando catálogo local…");
  const [error, setError] = useState<Diagnostic | null>(null);
  const mediaDownloadId = useRef<string | null>(null);

  useEffect(() => { ai.localCatalog().then((catalog) => setItems(catalog.filter((item) => item.runtimes.includes(provider) || item.runtimes.includes("vareliox")))).catch((cause) => setError(asDiagnostic(cause))); }, [provider]);
  useEffect(() => () => { if (mediaDownloadId.current) void ai.cancel(mediaDownloadId.current).catch(() => undefined); }, []);
  useEffect(() => { void refreshInstalled(); }, [provider, config.endpoint]);
  async function refreshInstalled() {
    try { setInstalled(await ai.installedLocalModels(config)); }
    catch (cause) { setError(asDiagnostic(cause)); }
  }
  async function remove() {
    if (!removeTarget || removing || downloading) return;
    setRemoving(true); setError(null);
    try {
      const ids = await ai.removeLocalModel(config, removeTarget);
      setInstalled((current) => current.filter((item) => !(item.id === removeTarget.id && item.runtime === removeTarget.runtime)));
      await onRemoved(ids, removeTarget.runtime);
      setRemoveTarget(null);
      await refreshInstalled();
    } catch (cause) { setError(asDiagnostic(cause)); }
    finally { setRemoving(false); }
  }
  const categories = useMemo(() => ([
    ["all", t("Todos", "All")], ["chat", t("Chat", "Chat")], ["code", t("Programación", "Coding")],
    ["vision", t("Visión", "Vision")],
    ["image", t("Crear imágenes", "Create images")], ["video", t("Crear vídeos", "Create videos")],
  ] as const).map(([id, label]) => ({ id, label, count: id === "all" ? items.length : items.filter((item) => item.category === id).length })), [items, t]);
  const filtered = useMemo(() => items.filter((item) => {
    const search = `${item.name} ${item.family} ${item.description} ${item.capabilities.join(" ")}`.toLocaleLowerCase();
    return (category === "all" || item.category === category) && search.includes(query.toLocaleLowerCase());
  }), [items, category, query]);

  async function download(item: LocalModelCatalogItem) {
    setDownloading(item.id); setProgress(0); setError(null); setStatus(`Preparando ${item.name}…`);
    try {
      const onEvent = (event: LocalModelDownloadEvent) => {
        if (event.type === "status") { setStatus(event.message); setProgress(event.progress); }
        else if (event.type === "error") setError(event.diagnostic);
      };
      if (item.runtimes.includes("vareliox")) {
        const requestId = crypto.randomUUID();
        mediaDownloadId.current = requestId;
        await ai.downloadLocalMediaModel(item.id, requestId, onEvent);
      } else {
        await ai.downloadLocalModel(config, item.id, onEvent);
      }
      await onInstalled(item);
      await refreshInstalled();
      setStatus(`${item.name} está listo para usar.`);
      setProgress(100);
    } catch (cause) { setError(asDiagnostic(cause)); } finally { setDownloading(null); mediaDownloadId.current = null; }
  }

  async function cancelDownload() {
    const id = mediaDownloadId.current;
    if (!id) return;
    try { await ai.cancel(id); }
    catch (cause) { setError(asDiagnostic(cause)); }
  }

  const source = providerMeta[provider].name;
  return <div className="local-model-overlay" role="dialog" aria-modal="true" aria-label={t("Biblioteca de IA local", "Local AI library")}>
    <section className="local-model-catalog">
      <header className="local-model-catalog__header"><div className="local-model-catalog__title"><span className="local-model-catalog__glyph"><HardDrive size={18} /></span><div><strong>{t("Biblioteca de IA local", "Local AI library")}</strong><span>{source}</span></div></div><button className="icon-button" onClick={onClose} aria-label={t("Cerrar biblioteca", "Close library")}><X size={18} /></button></header>
      <div className="local-model-catalog__tools"><label className="local-model-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Buscar modelo o capacidad…", "Search model or capability…")} autoFocus /></label><div className="local-model-filters" aria-label={t("Tipos de IA", "AI types")}>{categories.map(({ id, label, count }) => { const Icon = categoryIcons[id]; return <button key={id} className={category === id ? "is-active" : ""} onClick={() => setCategory(id)}><Icon size={14} /><span>{label}</span><small>{count}</small></button>; })}</div></div>
      {downloading && <div className="local-download-status"><div><LoaderCircle className="spin" size={16} /><span>{status}</span></div>{progress !== null && <><div className="local-download-status__track"><i style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong></>}{mediaDownloadId.current && <button type="button" className="secondary-button" onClick={() => void cancelDownload()}>{t("Cancelar", "Cancel")}</button>}</div>}
      {error && <div className="local-model-error"><strong>{error.title}</strong><span>{error.explanation}</span><small>{error.action}</small></div>}
      <div className="model-capability-tabs"><button type="button" aria-pressed={!installedView} onClick={() => setInstalledView(false)}>{t("Descargar", "Download")}</button><button type="button" aria-pressed={installedView} onClick={() => { setInstalledView(true); void refreshInstalled(); }}>{t("Instalados", "Installed")} · {installed.length}</button></div>
      {removeTarget && <section className="local-model-confirm" role="alertdialog" aria-label={t("Eliminar modelo", "Delete model")}><strong>{t("Eliminar modelo", "Delete model")}: {removeTarget.name}</strong><p>{t("Se eliminará el modelo del disco, no tus conversaciones ni imágenes. Los archivos compartidos se conservarán si otro modelo los necesita.", "The model will be removed from disk, not your conversations or images. Shared files are kept if another model needs them.")}</p><button className="secondary-button" disabled={removing} onClick={() => setRemoveTarget(null)}>{t("Cancelar", "Cancel")}</button><button className="secondary-button" disabled={removing} onClick={() => void remove()}><Trash2 size={16} />{removing ? t("Eliminando…", "Deleting…") : t("Eliminar", "Delete")}</button></section>}
      {installedView ? <div className="local-installed-list">{installed.filter((item) => `${item.name} ${item.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((item) => <article key={`${item.runtime}:${item.id}`}><span><strong>{item.name}</strong><small> · {item.runtime}</small></span><button className="secondary-button" disabled={removing || !!downloading} onClick={() => setRemoveTarget(item)}><Trash2 size={16} />{t("Eliminar", "Delete")}</button></article>)}{!installed.length && <p>{t("No hay modelos disponibles.", "No models available.")}</p>}</div> : <div className="local-model-grid">{filtered.map((item) => {
        return <article className={`local-model-card local-model-card--${item.category}`} key={item.id}><div className="local-model-card__top"><span>{item.family}</span>{item.recommended && <em><Sparkles size={12} />{t("Recomendado", "Recommended")}</em>}</div><h3>{item.name}</h3><p>{item.description}</p><div className="local-model-card__capabilities">{item.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div><div className="local-model-card__facts"><span>{item.parameters}</span><span>{item.size}</span><span>{item.runtimes.includes("vareliox") ? "Vareliox" : source}</span></div><button className="secondary-button" disabled={Boolean(downloading)} onClick={() => void download(item)}>{downloading === item.id ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{downloading === item.id ? t("Descargando", "Downloading") : t("Descargar", "Download")}</button></article>;
      })}{!filtered.length && <div className="local-model-empty">{t("No hay resultados para esta búsqueda.", "No results for this search.")}</div>}</div>}
      <footer className="local-model-catalog__footer"><span>{source}</span><button className="secondary-button" onClick={onClose}>{t("Listo", "Done")}</button></footer>
    </section>
  </div>;
}
