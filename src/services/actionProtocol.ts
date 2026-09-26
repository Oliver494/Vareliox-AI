import type { AiProjectAction } from "../types";

type ActionContainer = { actions?: unknown; operations?: unknown; changes?: unknown };

function normalizedType(value: unknown): AiProjectAction["type"] | null {
  if (typeof value !== "string") return null;
  const type = value.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
  if (["write", "create", "update", "edit", "replace", "create_file", "update_file"].includes(type)) return "write";
  if (["mkdir", "create_directory", "create_folder", "directory", "folder"].includes(type)) return "mkdir";
  if (["rename", "move", "rename_file", "move_file"].includes(type)) return "rename";
  if (["delete", "remove", "unlink", "delete_file", "delete_directory"].includes(type)) return "delete";
  return null;
}

function normalizeAction(value: unknown): AiProjectAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const type = normalizedType(item.type ?? item.action ?? item.operation ?? item.op);
  const path = item.path ?? item.file ?? item.filePath ?? item.file_path ?? item.ruta;
  if (!type || typeof path !== "string" || !path.trim()) return null;
  const rootId = item.rootId ?? item.root_id;
  const base = {
    type,
    path: path.trim(),
    ...(typeof rootId === "string" && rootId.trim() ? { rootId: rootId.trim() } : {}),
  } as AiProjectAction;
  if (type === "write") {
    const content = item.content ?? item.code ?? item.text ?? item.contenido;
    return typeof content === "string" ? { ...base, content } : null;
  }
  if (type === "rename") {
    const newPath = item.newPath ?? item.new_path ?? item.destination ?? item.target ?? item.to ?? item.destino;
    return typeof newPath === "string" && newPath.trim() ? { ...base, newPath: newPath.trim() } : null;
  }
  return base;
}

function stripTrailingCommas(value: string) {
  let result = "";
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; result += character; continue; }
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(value[next] || "")) next += 1;
      if (value[next] === "}" || value[next] === "]") continue;
    }
    result += character;
  }
  return result;
}

function parseJson(value: string): unknown {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^\uFEFF/, "");
  try { return JSON.parse(cleaned); } catch {
    // Trailing commas are a frequent harmless mistake in local models. The
    // scanner leaves commas inside source-code strings untouched.
    try { return JSON.parse(stripTrailingCommas(cleaned)); } catch { return null; }
  }
}

function balancedJson(content: string) {
  const start = content.search(/[\[{]/);
  if (start < 0) return "";
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === "{" || character === "[") stack.push(character);
    if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return "";
      if (!stack.length) return content.slice(start, index + 1);
    }
  }
  return "";
}

export function validActions(value: unknown): AiProjectAction[] {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!parsed) return [];
  const container = parsed as ActionContainer;
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(container.actions)
      ? container.actions
      : Array.isArray(container.operations)
        ? container.operations
        : Array.isArray(container.changes)
          ? container.changes
          : [parsed];
  const actions = raw.map(normalizeAction).filter((item): item is AiProjectAction => !!item);
  const seen = new Set<string>();
  return actions.filter((item) => {
    const key = `${item.type}\0${item.rootId || ""}\0${item.path}\0${item.newPath || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function proposedActions(content: string): AiProjectAction[] {
  const wrapped = content.match(/<(?:nova_actions|nova-actions|novaactions)\b[^>]*>([\s\S]*?)(?:<\/(?:nova_actions|nova-actions|novaactions)>|$)/i);
  if (wrapped) {
    const actions = validActions(wrapped[1]);
    if (actions.length) return actions;
  }
  for (const block of content.matchAll(/```(?:json)?\s*\r?\n([\s\S]*?)```/gi)) {
    const actions = validActions(block[1]);
    if (actions.length) return actions;
  }
  const direct = validActions(content);
  if (direct.length) return direct;
  return validActions(balancedJson(content));
}

export function actionRepairPrompt(originalPrompt: string, attempt: number) {
  return `La operación de archivos anterior no pudo interpretarse. Corrige solamente el formato y ejecuta la petición original: ${JSON.stringify(originalPrompt)}. Intento ${attempt} de 2. Conserva exactamente la intención: si pidió eliminar usa delete; si pidió renombrar usa rename; si pidió crear o editar un archivo usa write; si pidió una carpeta usa mkdir. No inventes una operación write para una eliminación. Devuelve exclusivamente JSON dentro de <nova_actions> y nada más. Esquema admitido: <nova_actions>{"actions":[{"type":"write","path":"ruta/archivo.ext","content":"contenido completo"},{"type":"mkdir","path":"ruta/carpeta"},{"type":"rename","path":"ruta/origen","newPath":"ruta/destino"},{"type":"delete","path":"ruta/elemento"}]}</nova_actions>. Incluye solo las operaciones necesarias, usa rutas relativas al proyecto y JSON válido sin comentarios ni comas finales.`;
}

export function canUseCodeBlockAsWrite(prompt: string) {
  const normalized = prompt.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  return !/\b(?:elimin|borr|delete|remove|renombr|rename|muev|move)\w*/u.test(normalized);
}
