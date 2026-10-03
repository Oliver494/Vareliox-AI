import { Check, ChevronRight, Cloud, Cpu, Database, GitBranch, History, Languages, Monitor, Moon, Palette, Rocket, Search, ShieldCheck, SquareTerminal, Stethoscope, Sun, X } from "lucide-react";
import { useMemo, useState } from "react";
import { usePreferences, type AppLanguage, type LanguagePreference, type ThemePreference } from "../services/preferences";
import { UpdateSettings } from "./UpdateSettings";
import { DoctorPanel } from "./DoctorPanel";
import { RecoveryPanel } from "./RecoveryPanel";
import type { AiSettings } from "../types";
import { HardwarePanel } from "./HardwarePanel";
import { GitPanel } from "./GitPanel";
import { PermissionsPanel } from "./PermissionsPanel";
import { TerminalPermissionsPanel } from "./TerminalPermissionsPanel";
import { StoragePanel } from "./StoragePanel";

type Props = { onClose: () => void; onOpenProviders: () => void; projectPath: string | null; settings: AiSettings | null; onFilesRestored: (paths: string[]) => void };
type PreferenceSection = "appearance" | "language" | "permissions" | "terminal" | "doctor" | "hardware" | "git" | "recovery" | "storage" | "updates";

export function PreferencesPanel({ onClose, onOpenProviders, projectPath, settings, onFilesRestored }: Props) {
  const { theme, language, resolvedLanguage, setTheme, setLanguage, t } = usePreferences();
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<PreferenceSection>("appearance");
  const themes: { id: ThemePreference; label: string; description: string; icon: typeof Monitor }[] = [
    { id: "system", label: t("Sistema", "System"), description: t("Sigue el sistema", "Follows the system"), icon: Monitor },
    { id: "light", label: t("Claro", "Light"), description: t("Interfaz luminosa", "Light interface"), icon: Sun },
    { id: "dark", label: t("Oscuro", "Dark"), description: t("Cómodo con poca luz", "Comfortable in low light"), icon: Moon },
  ];
  const languageNames: Record<AppLanguage, [string, string]> = { es: ["Español", "Spanish"], en: ["English", "Inglés"], fr: ["Français", "French"], de: ["Deutsch", "German"], pt: ["Português", "Portuguese"], it: ["Italiano", "Italian"], zh: ["中文", "Chinese"], ja: ["日本語", "Japanese"], ko: ["한국어", "Korean"], ru: ["Русский", "Russian"], ar: ["العربية", "Arabic"], hi: ["हिन्दी", "Hindi"] };
  const languages: { id: LanguagePreference; name: string; nativeName: string; detail: string }[] = [
    { id: "auto", name: t("Automático", "Automatic"), nativeName: t("Idioma del sistema", "System language"), detail: languageNames[resolvedLanguage][0] },
    ...(Object.entries(languageNames) as [AppLanguage, [string, string]][]).map(([id, names]) => ({ id, name: names[0], nativeName: names[1], detail: names[0] })),
  ];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return languages.filter((item) => !normalized || `${item.name} ${item.nativeName} ${item.detail}`.toLocaleLowerCase().includes(normalized));
  }, [languages, query]);
  const navigation = [
    { id: "appearance" as const, label: t("Apariencia", "Appearance"), description: t("Tema visual", "Visual theme"), icon: Palette },
    { id: "language" as const, label: t("Idioma", "Language"), description: t("Idioma de la interfaz", "Interface language"), icon: Languages },
    { id: "permissions" as const, label: t("Permisos", "Permissions"), description: t("Archivos e Internet", "Files and Internet"), icon: ShieldCheck },
    { id: "terminal" as const, label: t("Terminal", "Terminal"), description: t("Shell y elevación", "Shell and elevation"), icon: SquareTerminal },
    { id: "providers" as const, label: t("Proveedores", "Providers"), description: t("Modelos y conexiones", "Models and connections"), icon: Cloud },
    { id: "doctor" as const, label: "Doctor", description: t("Diagnóstico del sistema", "System diagnostics"), icon: Stethoscope },
    { id: "hardware" as const, label: t("Equipo", "Hardware"), description: t("RAM, GPU y modelos", "RAM, GPU, and models"), icon: Cpu },
    { id: "git" as const, label: "Git", description: t("Estado y diff local", "Local status and diff"), icon: GitBranch },
    { id: "recovery" as const, label: t("Recuperación", "Recovery"), description: t("Deshacer cambios del agente", "Undo agent changes"), icon: History },
    { id: "storage" as const, label: t("Almacenamiento", "Storage"), description: t("Multimedia y espacio local", "Media and local space"), icon: Database },
    { id: "updates" as const, label: t("Actualizaciones", "Updates"), description: t("Versión y canal", "Version and channel"), icon: Rocket },
  ];
  const activeLabel = navigation.find((item) => item.id === section)?.label;

  return <div className="preferences-overlay" role="dialog" aria-modal="true" aria-label={t("Configuración", "Settings")}>
    <section className="preferences-panel">
      <header><div><strong>{t("Configuración", "Settings")}</strong><span>{t("Personaliza Vareliox Code", "Customize Vareliox Code")}</span></div><button className="icon-button" onClick={onClose} aria-label={t("Cerrar", "Close")}><X size={18} /></button></header>
      <div className="preferences-layout">
        <nav className="preferences-navigation" aria-label={t("Secciones de configuración", "Settings sections")}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.id === section;
            return <button type="button" key={item.id} title={item.label} aria-label={item.label} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} onClick={() => item.id === "providers" ? onOpenProviders() : setSection(item.id)}><Icon size={18} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{item.id === "providers" ? <ChevronRight size={16} /> : active ? <span className="preferences-navigation__active" /> : null}</button>;
          })}
        </nav>
        <main className="preferences-content">
          <div className="preferences-page-title"><strong>{activeLabel}</strong><span>{section === "appearance" ? t("Elige cómo se muestra Vareliox Code", "Choose how Vareliox Code looks") : section === "language" ? t("Automático usa el idioma del sistema", "Automatic uses the system language") : section === "permissions" ? t("Decide a qué puede acceder Vareliox y qué acciones puede realizar", "Choose what Vareliox can access and which actions it can perform") : section === "terminal" ? t("Controla qué comandos puede ejecutar el agente", "Control which commands the agent can run") : section === "doctor" ? t("Comprueba el proyecto y la conexión activa", "Check the project and active connection") : section === "hardware" ? t("Comprueba qué modelos locales caben en tu equipo", "Check which local models fit your hardware") : section === "git" ? t("Revisa cambios sin modificar el repositorio", "Inspect changes without modifying the repository") : section === "recovery" ? t("Restaura cambios recientes del agente", "Restore recent agent changes") : section === "storage" ? t("Administra los archivos generados sin perder los que usan tus chats", "Manage generated files without losing those used by your chats") : t("Controla cómo recibes nuevas versiones", "Control how you receive new versions")}</span></div>
          {section === "appearance" && <section className="preference-section"><div className="theme-options">{themes.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={theme === item.id ? "is-active" : ""} onClick={() => setTheme(item.id)}><Icon size={19} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{theme === item.id && <Check size={15} />}</button>; })}</div></section>}
          {section === "language" && <section className="preference-section"><div className="language-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Buscar idioma…", "Search languages…")} autoFocus /></div><div className="language-list">{filtered.map((item) => <button type="button" key={item.id} className={language === item.id ? "is-active" : ""} onClick={() => setLanguage(item.id)}><span className="language-symbol">{item.id === "auto" ? <Monitor size={16} /> : item.id.toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.nativeName}{item.id === "auto" ? ` · ${item.detail}` : ""}</small></span>{language === item.id && <Check size={15} />}</button>)}{!filtered.length && <p>{t("No encontramos ese idioma.", "No languages found.")}</p>}</div></section>}
          {section === "permissions" && <PermissionsPanel />}
          {section === "terminal" && <TerminalPermissionsPanel />}
          {section === "doctor" && <DoctorPanel projectPath={projectPath} settings={settings} onOpenProviders={onOpenProviders} />}
          {section === "hardware" && <HardwarePanel projectPath={projectPath} />}
          {section === "git" && <GitPanel projectPath={projectPath} />}
          {section === "recovery" && <RecoveryPanel projectPath={projectPath} onRestored={onFilesRestored} />}
          {section === "storage" && <StoragePanel />}
          {section === "updates" && <UpdateSettings />}
        </main>
      </div>
      <footer><span>{t("Los cambios se guardan automáticamente", "Changes are saved automatically")}</span><button type="button" className="primary-button" onClick={onClose}>{t("Listo", "Done")}</button></footer>
    </section>
  </div>;
}
