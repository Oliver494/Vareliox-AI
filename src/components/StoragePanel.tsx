import { HardDrive, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ai, asDiagnostic } from "../services/ai";
import { referencedMediaUris } from "../services/conversations";
import { usePreferences } from "../services/preferences";
import type { MediaStorageStats } from "../types";

function readableBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function StoragePanel() {
  const { t } = usePreferences();
  const [stats, setStats] = useState<MediaStorageStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setError("");
    try { setStats(await ai.mediaStorageStats()); }
    catch (cause) { setError(asDiagnostic(cause).explanation); }
  }

  useEffect(() => { void refresh(); }, []);

  async function clean() {
    if (!window.confirm(t("¿Eliminar los archivos multimedia que ya no usa ningún chat?", "Delete media files that are no longer used by any chat?"))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const before = stats?.files ?? 0;
      const next = await ai.cleanupOrphanedMedia(referencedMediaUris());
      setStats(next);
      setMessage(`${Math.max(0, before - next.files)} ${t("archivos sin uso eliminados", "unused files removed")}`);
    } catch (cause) { setError(asDiagnostic(cause).explanation); }
    finally { setBusy(false); }
  }

  return <section className="storage-panel">
    <article><HardDrive size={20} /><div><strong>{t("Multimedia generada", "Generated media")}</strong><span>{stats ? `${stats.files} ${t("archivos", "files")} · ${readableBytes(stats.bytes)}` : t("Calculando almacenamiento…", "Calculating storage…")}</span></div><button className="icon-button" onClick={() => void refresh()} disabled={busy} title={t("Actualizar", "Refresh")}><RefreshCw size={15} /></button></article>
    <p>{t("Las imágenes y los vídeos nuevos se guardan fuera del historial para evitar chats pesados. La limpieza conserva todo archivo que siga referenciado por una conversación.", "New images and videos are stored outside chat history to keep conversations lightweight. Cleanup preserves every file still referenced by a conversation.")}</p>
    <button className="secondary-button" onClick={() => void clean()} disabled={busy || !stats?.files}>{busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{t("Limpiar archivos sin uso", "Clean unused files")}</button>
    {message && <span className="storage-panel__success">{message}</span>}
    {error && <span className="storage-panel__error" role="alert">{error}</span>}
  </section>;
}
