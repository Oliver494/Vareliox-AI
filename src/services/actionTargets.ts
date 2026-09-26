import type { AiProjectAction, AiTerminalAction, ExternalFolderGrant } from "../types";

export type ActionTargetResolution = {
  actions: AiProjectAction[];
  requestedPath: string | null;
  unauthorizedPath: string | null;
};

export type TerminalTargetResolution = {
  action: AiTerminalAction | null;
  unauthorizedPath: string | null;
};

const INSIDE_CREATED_FOLDER = /\b(?:entra (?:en|dentro de) (?:ella|la carpeta)|dentro de (?:ella|esa carpeta|la carpeta)|en su interior|inside (?:it|that folder|the folder)|into (?:it|that folder|the folder))\b/iu;

function cleanPath(value: string) {
  const trimmed = value.trim().replace(/^['"`]|['"`]$/g, "").replace(/[.,;!?]+$/g, "");
  if (/^[a-z]:[\\/]/i.test(trimmed)) return trimmed.replace(/\//g, "\\").replace(/[\\]+$/g, "");
  if (trimmed.startsWith("/")) return trimmed.replace(/\\/g, "/").replace(/\/+$/g, "") || "/";
  return trimmed;
}

function comparable(value: string) {
  const cleaned = cleanPath(value).replace(/\\/g, "/");
  return /^[a-z]:(?:\/|$)/i.test(cleaned) ? cleaned.toLocaleLowerCase() : cleaned;
}

function isInside(root: string, target: string) {
  const normalizedRoot = comparable(root).replace(/\/+$/g, "");
  const normalizedTarget = comparable(target).replace(/\/+$/g, "");
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function relativeTo(root: string, target: string) {
  const cleanedRoot = cleanPath(root).replace(/\\/g, "/").replace(/\/+$/g, "");
  const cleanedTarget = cleanPath(target).replace(/\\/g, "/").replace(/\/+$/g, "");
  return cleanedTarget.slice(cleanedRoot.length).replace(/^\/+/, "");
}

function relativeActionPath(value: string, base: string, root: string) {
  const cleaned = cleanPath(value).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  const path = /^[a-z]:\//i.test(cleaned) || value.trim().startsWith("/")
    ? relativeTo(root, value)
    : cleaned;
  if (!base) return path;
  const normalizedBase = base.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (path === normalizedBase || path.startsWith(`${normalizedBase}/`)) return path;
  return `${normalizedBase}/${path}`;
}

function absoluteFileTarget(value: string) {
  const normalized = cleanPath(value).replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (!/^[^./][^/]*\.[a-z0-9][a-z0-9._-]*$/i.test(name)) return null;
  return { directory: normalized.slice(0, normalized.lastIndexOf("/")) || "/", name };
}

export function requestedFilesystemPath(prompt: string) {
  const quoted = prompt.match(/['"`]((?:[a-z]:[\\/]|\/)[^'"`\r\n]+)['"`]/i)?.[1];
  if (quoted) return cleanPath(quoted);
  const windowsStart = prompt.search(/(?:^|\s)[a-z]:[\\/]/i);
  if (windowsStart >= 0) {
    const value = prompt.slice(windowsStart).trimStart();
    const stop = value.search(/\s+(?:que|y|e|donde|para|con|debe|inicia|inicializa|instala|crea|llamad[oa]|and|where|then|which|with|create|install|initialize)\b/iu);
    return cleanPath(stop > 0 ? value.slice(0, stop) : value);
  }
  const unix = prompt.match(/(?:^|\s)(\/(?:[^\s/]+\/)*[^\s.,;!?]*)(?=\s*$|[.,;!?]\s*$)/)?.[1];
  return unix ? cleanPath(unix) : null;
}

export function normalizeCreatedFolderContents(
  actions: AiProjectAction[],
  prompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
) {
  const recentUserRequest = [...history].reverse().find((item) => item.role === "user")?.content ?? "";
  if (!INSIDE_CREATED_FOLDER.test(`${recentUserRequest}\n${prompt}`)) return actions;
  const directories = actions.filter((action) => action.type === "mkdir");
  if (directories.length !== 1) return actions;
  const directory = directories[0].path.replace(/[\\/]+$/g, "");
  return actions.map((action) => {
    if (action.type !== "write" || /[\\/]/.test(action.path)) return action;
    return { ...action, path: `${directory}/${action.path}` };
  });
}

export function ensureNodeProjectActions(prompt: string, actions: AiProjectAction[]) {
  const normalized = prompt.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const initializesNode = /\bnode(?:\.js|js)?\b/.test(normalized) && /\b(?:inicia\w*|inicializa\w*|init|proyecto)\b/.test(normalized);
  if (!initializesNode) return actions;
  const withoutGeneratedDependencies = actions.filter((action) => !/(?:^|[\\/])node_modules(?:[\\/]|$)/i.test(action.path));
  const directories = withoutGeneratedDependencies.filter((action) => action.type === "mkdir");
  if (directories.length !== 1) return withoutGeneratedDependencies;
  const directory = directories[0].path.replace(/[\\/]+$/g, "");
  const packagePath = `${directory}/package.json`;
  const packageActions = withoutGeneratedDependencies.filter((action) => action.type === "write" && /(?:^|[\\/])package\.json$/i.test(action.path));
  if (packageActions.length) {
    let keptPackage = false;
    return withoutGeneratedDependencies.flatMap((action) => {
      if (action.type !== "write" || !/(?:^|[\\/])package\.json$/i.test(action.path)) return [action];
      if (keptPackage) return [];
      keptPackage = true;
      let content = action.content || "";
      try { JSON.parse(content); }
      catch { content = `${JSON.stringify({ name: directory.split(/[\\/]/).pop() || "node-project", version: "1.0.0", private: true }, null, 2)}\n`; }
      return [{ ...action, path: packagePath, content }];
    });
  }
  return [...withoutGeneratedDependencies, {
    type: "write" as const,
    path: packagePath,
    content: `${JSON.stringify({ name: directory.split(/[\\/]/).pop() || "node-project", version: "1.0.0", private: true }, null, 2)}\n`,
  }];
}

export function resolveRequestedActionTarget(
  prompt: string,
  actions: AiProjectAction[],
  projectPath: string,
  authorizedFolders: ExternalFolderGrant[],
): ActionTargetResolution {
  const requestedPath = requestedFilesystemPath(prompt);
  if (!requestedPath) return { actions, requestedPath: null, unauthorizedPath: null };

  const candidates: Array<{ id?: string; path: string; access: "read" | "write" }> = [
    { path: projectPath, access: "write" },
    ...authorizedFolders,
  ];
  const target = candidates
    .filter((candidate) => isInside(candidate.path, requestedPath))
    .sort((left, right) => comparable(right.path).length - comparable(left.path).length)[0];
  if (!target || target.access !== "write") {
    return { actions: [], requestedPath, unauthorizedPath: requestedPath };
  }

  const fileTarget = actions.length === 1 && actions[0].type !== "mkdir" ? absoluteFileTarget(requestedPath) : null;
  const base = relativeTo(target.path, fileTarget?.directory ?? requestedPath);
  const resolved = actions.map((action) => {
    const path = fileTarget
      ? relativeTo(target.path, requestedPath)
      : relativeActionPath(action.path, base, target.path);
    return {
      ...action,
      path,
      ...(action.newPath ? { newPath: relativeActionPath(action.newPath, base, target.path) } : {}),
      rootId: target.id,
    };
  });
  return { actions: resolved, requestedPath, unauthorizedPath: null };
}

export function resolveRequestedTerminalTarget(
  prompt: string,
  action: AiTerminalAction,
  projectPath: string,
  authorizedFolders: ExternalFolderGrant[],
  resolvedActions: AiProjectAction[],
): TerminalTargetResolution {
  const requestedPath = requestedFilesystemPath(prompt);
  if (!requestedPath) {
    const packageJson = resolvedActions.find((item) => item.type === "write" && /(?:^|[\\/])package\.json$/i.test(item.path));
    const packageDirectory = packageJson?.path.replace(/[/\\][^/\\]+$/, "");
    const createdDirectory = resolvedActions.find((item) => item.type === "mkdir")?.path;
    return {
      action: {
        ...action,
        rootId: action.rootId ?? packageJson?.rootId ?? resolvedActions[0]?.rootId,
        cwd: action.cwd?.trim() || packageDirectory || createdDirectory || "",
      },
      unauthorizedPath: null,
    };
  }
  const candidates: Array<{ id?: string; path: string; access: "read" | "write" }> = [
    { path: projectPath, access: "write" },
    ...authorizedFolders,
  ];
  const target = candidates
    .filter((candidate) => isInside(candidate.path, requestedPath))
    .sort((left, right) => comparable(right.path).length - comparable(left.path).length)[0];
  if (!target || target.access !== "write") return { action: null, unauthorizedPath: requestedPath };

  const base = relativeTo(target.path, requestedPath);
  const packageJson = resolvedActions.find((item) => item.type === "write" && /(?:^|[\\/])package\.json$/i.test(item.path));
  const packageDirectory = packageJson?.path.replace(/[/\\][^/\\]+$/, "");
  const createdDirectory = resolvedActions.find((item) => item.type === "mkdir")?.path;
  const inferred = packageDirectory || createdDirectory || base;
  let cwd = action.cwd?.trim() || inferred;
  if (/^(?:[a-z]:[\\/]|\/)/i.test(cwd)) cwd = relativeTo(target.path, cwd);
  else if (base && cwd !== base && !cwd.replace(/\\/g, "/").startsWith(`${base.replace(/\\/g, "/")}/`)) cwd = `${base}/${cwd}`;
  return { action: { ...action, rootId: target.id, cwd: cwd.replace(/\\/g, "/") }, unauthorizedPath: null };
}
