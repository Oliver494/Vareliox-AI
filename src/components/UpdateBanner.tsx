import { ArrowUpRight, BellRing, Clock3, Download, LoaderCircle, X } from "lucide-react";
import { usePreferences } from "../services/preferences";
import { useUpdates } from "../services/updates";

export function UpdateBanner() {
  const { t } = usePreferences();
  const updates = useUpdates();
  const release = updates.lastResult?.release;
  if (!updates.bannerVisible || !release) return null;
  const directInstaller = (/Windows/i.test(navigator.userAgent) && release.assetUrl?.endsWith(".exe")) || (/Macintosh|Mac OS X/i.test(navigator.userAgent) && release.assetUrl?.endsWith(".dmg"));
  const summary = release.notes.trim().split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, "") ?? t("Incluye mejoras y correcciones.", "Includes improvements and fixes.");
  return <aside className="update-banner" aria-live="polite"><div className="update-banner__icon"><BellRing size={17} /></div><div className="update-banner__content"><strong>{t("Nueva versión disponible", "New version available")}</strong><span>{updates.installedVersion} → {release.version}</span><p>{updates.installError ?? summary}</p><div>{directInstaller ? <button className="update-banner__primary" disabled={updates.installing} onClick={() => void updates.install()}>{updates.installing ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}{updates.installing ? t("Descargando…", "Downloading…") : t("Descargar e instalar", "Download and install")}</button> : <button className="update-banner__primary" onClick={() => void updates.openRelease()}>{t("Ver actualización", "View update")}<ArrowUpRight size={13} /></button>}<button disabled={updates.installing} onClick={updates.remindLater}><Clock3 size={13} />{t("Recordar más tarde", "Remind me later")}</button></div></div><button className="update-banner__close" onClick={updates.closeBanner} aria-label={t("Cerrar", "Close")}><X size={14} /></button></aside>;
}
