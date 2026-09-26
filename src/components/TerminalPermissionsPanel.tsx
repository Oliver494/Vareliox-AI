import { AlertTriangle, Check, Command, Info, Shield, ShieldAlert, SquareTerminal } from "lucide-react";
import { useNovaPermissions, type TerminalAccess, type TerminalShell } from "../services/permissions";
import { usePreferences } from "../services/preferences";

export function TerminalPermissionsPanel() {
  const { permissions, setPermissions } = useNovaPermissions();
  const { t } = usePreferences();
  const levels: { id: TerminalAccess; title: string; description: string; icon: typeof Shield }[] = [
    { id: "disabled", title: t("Desactivada", "Disabled"), description: t("Vareliox no puede ejecutar ningún comando.", "Vareliox cannot run any commands."), icon: Shield },
    { id: "project", title: t("Herramientas del proyecto", "Project tools"), description: t("Solo pruebas, compilaciones y programas de una lista segura dentro del proyecto.", "Only tests, builds, and allowlisted programs inside the project."), icon: Command },
    { id: "shell", title: t("Terminal del usuario", "User terminal"), description: t("Permite comandos completos con tus permisos normales de Windows, macOS o Linux.", "Allow full commands with your normal Windows, macOS, or Linux permissions."), icon: SquareTerminal },
    { id: "admin", title: t("Administrador", "Administrator"), description: t("Usa los permisos actuales de Vareliox. La elevación automática aún no está implementada.", "Uses Vareliox’s current permissions. Automatic elevation is not implemented yet."), icon: ShieldAlert },
  ];
  const shells: { id: TerminalShell; label: string; platforms: string }[] = [
    { id: "automatic", label: t("Automática", "Automatic"), platforms: t("Recomendada para el sistema actual", "Recommended for the current system") },
    { id: "cmd", label: "Command Prompt (CMD)", platforms: "Windows" },
    { id: "powershell", label: "PowerShell", platforms: "Windows" },
    { id: "bash", label: "Bash", platforms: "Linux / macOS" },
    { id: "zsh", label: "Zsh", platforms: "macOS / Linux" },
  ];
  const isWindows = /Windows/i.test(navigator.userAgent);
  const availableShells = shells.filter((shell) => shell.id === "automatic" || (isWindows ? shell.id === "cmd" || shell.id === "powershell" : shell.id === "bash" || shell.id === "zsh"));

  function chooseLevel(level: TerminalAccess) {
    if (level === "admin" && permissions.terminalAccess !== "admin") {
      const accepted = window.confirm(t("Este modo habilita comandos completos, pero no eleva los permisos del proceso. ¿Activarlo?", "This mode enables full commands but does not elevate the process permissions. Enable it?"));
      if (!accepted) return;
    }
    setPermissions({ ...permissions, terminalAccess: level });
  }

  return <section className="terminal-permissions">
    <div className="terminal-levels" role="radiogroup" aria-label={t("Nivel de terminal", "Terminal level")}>
      {levels.map((level) => { const Icon = level.icon; const active = permissions.terminalAccess === level.id; return <button type="button" role="radio" aria-checked={active} key={level.id} className={`${active ? "is-active" : ""} is-${level.id}`} onClick={() => chooseLevel(level.id)}><span><Icon size={18} /></span><div><strong>{level.title}</strong><small>{level.description}</small></div>{active && <Check size={16} />}</button>; })}
    </div>
    {permissions.terminalAccess !== "disabled" && <><div className="terminal-shell-heading"><div><strong>{t("Intérprete", "Shell")}</strong><small>{t("Vareliox adapta los comandos al sistema operativo.", "Vareliox adapts commands to the operating system.")}</small></div></div><div className="terminal-shells">{availableShells.map((shell) => <button type="button" key={shell.id} className={permissions.terminalShell === shell.id ? "is-active" : ""} onClick={() => setPermissions({ ...permissions, terminalShell: shell.id })}><span><strong>{shell.label}</strong><small>{shell.platforms}</small></span>{permissions.terminalShell === shell.id && <Check size={14} />}</button>)}</div></>}
    {permissions.terminalAccess === "admin" && <div className="terminal-admin-warning"><AlertTriangle size={16} /><span>{t("La terminal no acepta contraseñas ni inicia UAC o sudo interactivo. Un comando sin privilegios suficientes mostrará su error.", "The terminal does not accept passwords or start UAC or interactive sudo. A command without sufficient privileges will report its error.")}</span></div>}
    <p className="terminal-output-note"><Info size={14} />{t("La salida del comando se envía al modelo seleccionado para que Vareliox pueda interpretarla. Con un proveedor en la nube, evita aprobar comandos que muestren secretos.", "Command output is sent to the selected model so Vareliox can interpret it. With a cloud provider, avoid approving commands that display secrets.")}</p>
  </section>;
}
