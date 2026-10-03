import { ArrowRight, Check, FolderPlus, KeyRound, Laptop, ShieldCheck, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { usePreferences } from "../services/preferences";

const STORAGE_KEY = "novaai-code:first-run:v1";

type Props = { hasProject: boolean; onAddProject: () => void; onConfigure: () => void; onClose: () => void };

export function shouldShowFirstRun() {
  return localStorage.getItem(STORAGE_KEY) !== "done";
}

export function FirstRunWizard({ hasProject, onAddProject, onConfigure, onClose }: Props) {
  const { t } = usePreferences();
  const [step, setStep] = useState(0);
  const finish = (action?: () => void) => { localStorage.setItem(STORAGE_KEY, "done"); onClose(); action?.(); };
  return <div className="first-run-backdrop"><section className="first-run" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
    <header><span><Sparkles size={17} /></span><div><strong>Vareliox Code</strong><small>{t("Configuración inicial", "Initial setup")}</small></div><button className="icon-button" onClick={() => finish()} aria-label={t("Cerrar", "Close")}><X size={17} /></button></header>
    {step === 0 ? <main><div className="first-run-hero"><Laptop size={28} /><h1 id="first-run-title">{t("Tu código permanece bajo tu control", "Your code stays under your control")}</h1><p>{t("Usa modelos locales o conecta tu proveedor. El acceso fuera del proyecto depende de los permisos que concedas.", "Use local models or connect your own provider. Access outside the project depends on the permissions you grant.")}</p></div><div className="first-run-points"><span><ShieldCheck size={16} /><b>{t("Claves protegidas por el sistema", "Keys protected by the system")}</b></span><span><FolderPlus size={16} /><b>{t("Acceso limitado al proyecto", "Project-scoped access")}</b></span><span><Check size={16} /><b>{t("Revisión y recuperación de cambios", "Change review and recovery")}</b></span></div></main> : <main><div className="first-run-hero"><KeyRound size={28} /><h1 id="first-run-title">{t("Prepara tu espacio de trabajo", "Prepare your workspace")}</h1><p>{t("Añade una carpeta y configura un modelo. Puedes cambiar ambas cosas después.", "Add a folder and configure a model. You can change both later.")}</p></div><div className="first-run-actions"><button className={hasProject ? "is-complete" : ""} onClick={onAddProject}><FolderPlus size={18} /><span><strong>{hasProject ? t("Proyecto preparado", "Project ready") : t("Añadir proyecto", "Add project")}</strong><small>{t("Selecciona una carpeta de este equipo", "Select a folder on this computer")}</small></span>{hasProject && <Check size={16} />}</button><button onClick={() => finish(onConfigure)}><KeyRound size={18} /><span><strong>{t("Configurar modelo", "Configure model")}</strong><small>{t("Ollama, LM Studio o una API", "Ollama, LM Studio, or an API")}</small></span><ArrowRight size={16} /></button></div></main>}
    <footer><button className="text-action" onClick={() => finish()}>{t("Configurar más tarde", "Set up later")}</button>{step === 0 ? <button className="primary-button" onClick={() => setStep(1)}>{t("Continuar", "Continue")}<ArrowRight size={15} /></button> : <button className="primary-button" onClick={() => finish()}>{t("Terminar", "Finish")}</button>}</footer>
  </section></div>;
}
