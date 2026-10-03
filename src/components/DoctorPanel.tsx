import { AlertTriangle, CheckCircle2, CircleDashed, Play, Stethoscope, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { activeProviderConfig, ai, asDiagnostic, providerChatModel, providerDisplayName, providerMeta } from "../services/ai";
import { usePreferences } from "../services/preferences";
import type { AiSettings, Diagnostic } from "../types";

type Props = { projectPath: string | null; settings: AiSettings | null; onOpenProviders: () => void };
type Result = { status: "ok" | "warning" | "error"; title: string; message: string };

export function DoctorPanel({ projectPath, settings, onOpenProviders }: Props) {
  const { t } = usePreferences();
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<Result | null>(null);
  const active = useMemo(() => activeProviderConfig(settings), [settings]);
  const checks: Result[] = [
    projectPath ? { status: "ok", title: t("Proyecto", "Project"), message: t("Carpeta accesible", "Folder available") } : { status: "warning", title: t("Proyecto", "Project"), message: t("No hay un proyecto abierto", "No project is open") },
    providerChatModel(active) ? { status: "ok", title: t("Modelo", "Model"), message: `${providerDisplayName(active)} · ${providerChatModel(active)}` } : { status: "warning", title: t("Modelo", "Model"), message: t("No hay un modelo seleccionado", "No model selected") },
    active && (!providerMeta[active.provider].requiresKey || active.apiKeyConfigured) ? { status: "ok", title: t("Credenciales", "Credentials"), message: t("Configuración disponible", "Configuration available") } : { status: "warning", title: t("Credenciales", "Credentials"), message: t("Falta configurar la clave", "API key is not configured") },
    { status: "ok", title: t("Protección de archivos", "File protection"), message: t("Acceso limitado al proyecto", "Access is limited to the project") },
    ...(connection ? [connection] : []),
  ];

  async function run() {
    if (!active) return;
    setTesting(true); setConnection(null);
    try {
      const result = await ai.test(active, projectPath);
      if (result.connected) setConnection({ status: "ok", title: t("Conexión", "Connection"), message: `${t("Conectado", "Connected")} · ${result.durationMs} ms` });
      else setConnection(fromDiagnostic(result.diagnostic, t));
    } catch (reason) { setConnection(fromDiagnostic(asDiagnostic(reason), t)); }
    finally { setTesting(false); }
  }

  return <section className="doctor-panel">
    <div className="settings-toolbar"><span>{t("Diagnóstico claro de la configuración actual", "Clear diagnosis of the current configuration")}</span><button className="primary-button" disabled={!active || testing} onClick={() => void run()}><Play size={15} />{testing ? t("Comprobando conexión…", "Testing connection…") : t("Ejecutar Doctor", "Run Doctor")}</button></div>
    <div className="doctor-list">{checks.map((item, index) => { const Icon = item.status === "ok" ? CheckCircle2 : item.status === "warning" ? AlertTriangle : XCircle; return <article className={`is-${item.status}`} key={`${item.title}-${index}`}><Icon size={18} /><span><strong>{item.title}</strong><small>{item.message}</small></span></article>; })}</div>
    {!active && <button className="secondary-button" onClick={onOpenProviders}><CircleDashed size={15} />{t("Configurar proveedores", "Configure providers")}</button>}
    <p className="settings-note"><Stethoscope size={14} />{t("La prueba de conexión solo se ejecuta cuando pulsas el botón.", "The connection test only runs when you press the button.")}</p>
  </section>;
}

function fromDiagnostic(diagnostic: Diagnostic | null, t: (es: string, en: string) => string): Result {
  return { status: "error", title: t("Conexión", "Connection"), message: diagnostic?.explanation ?? t("No se pudo comprobar la conexión", "The connection could not be tested") };
}
