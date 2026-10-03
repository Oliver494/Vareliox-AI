import type { ProjectInfo } from "../types";

const PROJECTS_KEY = "novaai-code:projects";

function normalizePath(path: string) {
  return path.trim().replace(/[\\/]+$/, "").toLocaleLowerCase();
}

function sortProjects(projects: ProjectInfo[]) {
  return [...projects].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }) || left.path.localeCompare(right.path, undefined, { sensitivity: "base", numeric: true }));
}

export function loadProjects(): ProjectInfo[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    const unique = new Map<string, ProjectInfo>();
    for (const item of stored) {
      if (!item || typeof item !== "object") continue;
      const value = item as Partial<ProjectInfo>;
      if (typeof value.path !== "string" || typeof value.name !== "string" || !value.path.trim() || !value.name.trim()) continue;
      unique.set(normalizePath(value.path), { path: value.path, name: value.name });
    }
    return sortProjects([...unique.values()]);
  } catch {
    return [];
  }
}

export function rememberProject(projects: ProjectInfo[], project: ProjectInfo) {
  const key = normalizePath(project.path);
  const next = sortProjects([project, ...projects.filter((item) => normalizePath(item.path) !== key)]);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
  return next;
}

export function forgetProject(projects: ProjectInfo[], path: string) {
  const key = normalizePath(path);
  const next = sortProjects(projects.filter((item) => normalizePath(item.path) !== key));
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
  return next;
}
