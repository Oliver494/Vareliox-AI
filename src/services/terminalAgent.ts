import type { AiTerminalAction } from "../types";

const LOCAL_DEVICE = /\b(?:mi|mis|tengo|tiene mi|en este|este equipo|este pc|mi pc|mi ordenador|mi computadora|my|this (?:pc|computer|device|machine))\b/iu;
const SYSTEM_DETAIL = /\b(?:almacenamiento|espacio(?: libre| disponible)?|disco|unidad|nvme|ssd|hdd|gb|ram|memoria|cpu|procesador|gpu|tarjeta gr[aá]fica|sistema operativo|versi[oó]n de windows|storage|disk|drive|free space|memory|processor|graphics|operating system|windows version)\b/iu;
const OBSOLETE_SYSTEM_PROBE = /\b(?:wmic|win32_logicaldisk|get-wmiobject|get-ciminstance|logicaldisk|systeminfo|df\s+-h|free\s+-h|uname\s+-a)\b/iu;

/** A read-only local hardware question that Vareliox can answer deterministically. */
export function systemInfoActionForPrompt(prompt: string): AiTerminalAction | null {
  if (!LOCAL_DEVICE.test(prompt) || !SYSTEM_DETAIL.test(prompt)) return null;
  return {
    program: "nova-system-info",
    args: [],
    purpose: "Consultar información real del sistema y del almacenamiento",
  };
}

/**
 * Small models often reach for WMIC (removed from recent Windows versions) or
 * invent fragile PowerShell. Route those probes through Vareliox's native,
 * cross-platform implementation instead.
 */
export function normalizeTerminalAction(prompt: string, action: AiTerminalAction): AiTerminalAction {
  const native = systemInfoActionForPrompt(prompt);
  const preview = `${action.program || ""} ${action.command || ""} ${(action.args || []).join(" ")}`;
  if (native && (OBSOLETE_SYSTEM_PROBE.test(preview) || action.program?.toLocaleLowerCase() !== "nova-system-info")) return native;
  return action;
}

export function terminalActionLabel(action: AiTerminalAction) {
  return action.command?.trim() || `${action.program || ""} ${(action.args || []).join(" ")}`.trim();
}

export function packageInstallActionForPrompt(prompt: string): AiTerminalAction | null {
  const normalized = prompt.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  if (!/\b(?:node(?:\.js|js)?|npm)\b/.test(normalized) || !/\b(?:instal\w*|intal\w*|add)\b/.test(normalized)) return null;
  const direct = normalized.match(/\bnpm\s+(?:install|i|add)\s+((?:@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?(?:\s+|$))+)/i)?.[1];
  const named = [...normalized.matchAll(/\b(?:libreria|librerias|paquete|paquetes|dependencia|dependencias|library|libraries|package|packages)\s+(@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?)/gi)].map((match) => match[1]);
  const packages = (direct ? direct.trim().split(/\s+/) : named).filter((value, index, values) => value && values.indexOf(value) === index);
  if (!packages.length) return null;
  return { program: "npm", args: ["install", ...packages], purpose: `Instalar ${packages.join(", ")} en el proyecto Node.js` };
}
