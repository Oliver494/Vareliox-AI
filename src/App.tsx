import {
  CircleHelp,
  CircleCheck,
  Code2,
  FolderOpen,
  FolderPlus,
  MessagesSquare,
  Files,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./App.css";
import "./workspace-polish.css";
import varelioxBlackLogo from "./assets/vareliox-black.png";
import varelioxWhiteLogo from "./assets/vareliox-white.png";
import { ActionDialog, type DialogRequest } from "./components/ActionDialog";
import { NovaChatWorkspace } from "./components/NovaChatWorkspace";
import { NovaCodeWorkspace } from "./components/NovaCodeWorkspace";
import { FileTree } from "./components/FileTree";
import { FirstRunWizard, shouldShowFirstRun } from "./components/FirstRunWizard";
import { ProviderPanel } from "./components/ProviderPanel";
import { PreferencesPanel } from "./components/PreferencesPanel";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { ProjectFolderDialog } from "./components/ProjectFolderDialog";
import { UpdateBanner } from "./components/UpdateBanner";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { ai } from "./services/ai";
import { chooseProjectFolder, errorMessage, projectFiles } from "./services/fileSystem";
import { usePreferences } from "./services/preferences";
import { forgetProject, loadProjects, rememberProject } from "./services/projects";
import type { AiSettings, AssistantWorkspace, FileNode, Notice, OpenFile, ProjectInfo } from "./types";

const LAST_PROJECT_KEY = "novaai-code:last-project";
const LAST_WORKSPACE_KEY = "novaai-code:last-workspace";
const EditorPane = lazy(() => import("./components/EditorPane").then((module) => ({ default: module.EditorPane })));

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true">
    <img className="brand-mark__light" src={varelioxBlackLogo} alt="" draggable={false} />
    <img className="brand-mark__dark" src={varelioxWhiteLogo} alt="" draggable={false} />
  </div>;
}

function joinRelative(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

function parentPath(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function hasDirtyFiles(files: OpenFile[]) {
  return files.some((file) => file.content !== file.savedContent);
}

function App() {
  const { t } = usePreferences();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>(loadProjects);
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
  const [workspaceView, setWorkspaceView] = useState<"files" | "chat">("files");
  const [assistantWorkspace, setAssistantWorkspace] = useState<AssistantWorkspace>(() => {
    const stored = localStorage.getItem(LAST_WORKSPACE_KEY);
    return stored === "chat" ? "chat" : "code";
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.min(420, Math.max(260, Number(localStorage.getItem("vareliox:sidebar-width")) || 300)));
  const [providerOpen, setProviderOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [firstRunOpen, setFirstRunOpen] = useState(shouldShowFirstRun);
  const [chatSettings, setChatSettings] = useState<AiSettings | null>(null);
  const [codeSettings, setCodeSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [projectFolderDialogOpen, setProjectFolderDialogOpen] = useState(false);
  const [projectFolderPath, setProjectFolderPath] = useState("");
  const [projectFolderBusy, setProjectFolderBusy] = useState(false);
  const [projectFolderError, setProjectFolderError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const scanRunning = useRef(false);
  const noticeId = useRef(1);

  const notify = useCallback((tone: Notice["tone"], message: string) => {
    const id = noticeId.current++;
    setNotices((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 4500);
  }, []);

  useEffect(() => {
    let active = true;
    ai.settings(null)
      .then((value) => { if (active) setChatSettings(value); })
      .catch((error) => notify("error", errorMessage(error)));
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    let active = true;
    ai.settings(project?.path ?? null)
      .then((value) => { if (active) setCodeSettings(value); })
      .catch((error) => notify("error", errorMessage(error)));
    return () => { active = false; };
  }, [project?.path, notify]);

  useEffect(() => { localStorage.setItem(LAST_WORKSPACE_KEY, assistantWorkspace); }, [assistantWorkspace]);
  useEffect(() => { localStorage.setItem("vareliox:sidebar-width", String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setSidebarOpen(false);
  }, [assistantWorkspace, workspaceView, project?.path]);
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 900px)");
    const closeOnNarrow = (event: MediaQueryListEvent) => { if (event.matches) setSidebarOpen(false); };
    compact.addEventListener("change", closeOnNarrow);
    return () => compact.removeEventListener("change", closeOnNarrow);
  }, []);

  const startSidebarResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const move = (next: PointerEvent) => setSidebarWidth(Math.min(420, Math.max(260, next.clientX)));
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }, []);

  const refreshTree = useCallback(async (quiet = false) => {
    if (!project || scanRunning.current) return;
    scanRunning.current = true;
    if (!quiet) setLoading(true);
    try {
      setNodes(await projectFiles.scan(project.path));
    } catch (error) {
      if (!quiet) notify("error", errorMessage(error));
    } finally {
      scanRunning.current = false;
      if (!quiet) setLoading(false);
    }
  }, [notify, project]);

  const loadProject = useCallback(async (path: string, restoring = false) => {
    if (hasDirtyFiles(openFiles) && !window.confirm("Hay archivos sin guardar. ¿Quieres cerrar el proyecto y descartar esos cambios?")) return false;
    setLoading(true);
    try {
      const info = await projectFiles.openProject(path);
      const tree = await projectFiles.scan(info.path);
      setProject(info);
      setNodes(tree);
      setOpenFiles([]);
      setActivePath(null);
      setSelectedNode(null);
      setProjects((current) => rememberProject(current, info));
      localStorage.setItem(LAST_PROJECT_KEY, info.path);
      if (!restoring) notify("success", "Proyecto abierto");
      return true;
    } catch (error) {
      if (restoring) {
        localStorage.removeItem(LAST_PROJECT_KEY);
        setProjects((current) => forgetProject(current, path));
      }
      notify("error", errorMessage(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, [notify, openFiles]);

  useEffect(() => {
    const saved = localStorage.getItem(LAST_PROJECT_KEY);
    const initial = saved ?? projects[0]?.path;
    if (initial) void loadProject(initial, true);
    // Restore only once on startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!project) return;
    const timer = window.setInterval(() => void refreshTree(true), 4000);
    return () => window.clearInterval(timer);
  }, [project, refreshTree]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (hasDirtyFiles(openFiles)) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [openFiles]);

  async function chooseFolder() {
    setProjectFolderPath(project?.path ?? "");
    setProjectFolderError(null);
    setProjectFolderDialogOpen(true);
  }

  async function browseProjectFolder() {
    try {
      const path = await chooseProjectFolder();
      if (path) {
        setProjectFolderPath(path);
        setProjectFolderError(null);
      }
    } catch (error) {
      setProjectFolderError(errorMessage(error));
    }
  }

  async function confirmProjectFolder() {
    const path = projectFolderPath.trim();
    if (!path || projectFolderBusy) return;
    setProjectFolderBusy(true);
    setProjectFolderError(null);
    try {
      if (await loadProject(path)) setProjectFolderDialogOpen(false);
      else setProjectFolderError(t("No se pudo abrir esa carpeta. Comprueba la ruta y los permisos.", "Could not open that folder. Check the path and permissions."));
    } finally {
      setProjectFolderBusy(false);
    }
  }

  function removeRegisteredProject(path: string) {
    const isActive = project?.path.toLocaleLowerCase() === path.toLocaleLowerCase();
    if (isActive && hasDirtyFiles(openFiles) && !window.confirm("Hay archivos sin guardar. ¿Quieres quitar el proyecto de la lista y descartar esos cambios?")) return;
    setProjects((current) => forgetProject(current, path));
    if (!isActive) return;
    setProject(null);
    setNodes([]);
    setOpenFiles([]);
    setActivePath(null);
    setSelectedNode(null);
    localStorage.removeItem(LAST_PROJECT_KEY);
  }

  async function openFile(node: FileNode) {
    const existing = openFiles.find((file) => file.relativePath === node.relativePath);
    if (existing) {
      setActivePath(existing.relativePath);
      return;
    }
    if (!project) return;
    try {
      const file = await projectFiles.read(project.path, node.relativePath);
      const opened: OpenFile = { ...file, name: node.name, savedContent: file.content };
      setOpenFiles((current) => [...current, opened]);
      setActivePath(opened.relativePath);
    } catch (error) {
      notify("error", errorMessage(error));
    }
  }

  function updateContent(path: string, content: string) {
    setOpenFiles((current) => current.map((file) => file.relativePath === path ? { ...file, content } : file));
  }

  async function saveFile(path: string, quiet = false) {
    const file = openFiles.find((item) => item.relativePath === path);
    if (!project || !file || file.content === file.savedContent) return true;
    setSaving(true);
    try {
      await projectFiles.write(project.path, file.relativePath, file.content);
      setOpenFiles((current) => current.map((item) => item.relativePath === path ? { ...item, savedContent: item.content } : item));
      if (!quiet) notify("success", "Archivo guardado");
      return true;
    } catch (error) {
      notify("error", errorMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAll() {
    const dirty = openFiles.filter((file) => file.content !== file.savedContent);
    if (!dirty.length) return;
    let saved = 0;
    for (const file of dirty) if (await saveFile(file.relativePath, true)) saved += 1;
    if (saved === dirty.length) notify("success", saved === 1 ? "Archivo guardado" : "Archivos guardados");
  }

  const reloadChangedFiles = useCallback(async (paths: string[]) => {
    if (!project) return;
    const changed = new Set(paths);
    const replacements = new Map<string, OpenFile>();
    for (const file of openFiles.filter((item) => changed.has(item.relativePath))) {
      try {
        const loaded = await projectFiles.read(project.path, file.relativePath);
        replacements.set(file.relativePath, { ...file, ...loaded, content: loaded.content, savedContent: loaded.content });
      } catch { /* A newly deleted or unavailable file will be reflected by the tree refresh. */ }
    }
    if (replacements.size) setOpenFiles((items) => items.map((item) => replacements.get(item.relativePath) ?? item));
    notify("success", `${paths.length} archivo${paths.length === 1 ? "" : "s"} actualizado${paths.length === 1 ? "" : "s"} por Vareliox`);
    // The write has already completed. Refreshing a large tree can take much
    // longer than creating the file, so keep it out of the critical path.
    void refreshTree(true);
  }, [notify, openFiles, project, refreshTree]);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (event.shiftKey) void saveAll();
      else if (activePath) void saveFile(activePath);
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });

  function closeFile(path: string) {
    const file = openFiles.find((item) => item.relativePath === path);
    if (!file) return;
    if (file.content !== file.savedContent && !window.confirm(`“${file.name}” tiene cambios sin guardar. ¿Quieres descartarlos?`)) return;
    const index = openFiles.findIndex((item) => item.relativePath === path);
    const remaining = openFiles.filter((item) => item.relativePath !== path);
    setOpenFiles(remaining);
    if (activePath === path) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.relativePath ?? null);
  }

  function createRequest(kind: "new-file" | "new-folder", target = selectedNode ?? undefined) {
    const targetPath = target?.isDirectory ? target.relativePath : target ? parentPath(target.relativePath) : "";
    setDialog({ kind, targetPath });
    setDialogError(null);
  }

  async function renameNode(node: FileNode, name: string) {
    if (!project) return;
    const oldPath = node.relativePath;
    const newPath = joinRelative(parentPath(oldPath), name);
    await projectFiles.rename(project.path, oldPath, name);
    setOpenFiles((current) => current.map((file) => {
      if (file.relativePath !== oldPath && !file.relativePath.startsWith(`${oldPath}/`)) return file;
      const relativePath = `${newPath}${file.relativePath.slice(oldPath.length)}`;
      return { ...file, relativePath, name: relativePath.split("/").pop() ?? file.name };
    }));
    setActivePath((current) => current === oldPath || current?.startsWith(`${oldPath}/`) ? `${newPath}${current.slice(oldPath.length)}` : current);
    setSelectedNode(null);
    notify("success", "Nombre actualizado");
    await refreshTree();
  }

  async function confirmDialog(value: string) {
    if (!project || !dialog) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      if (dialog.kind === "new-file" || dialog.kind === "new-folder") {
        const relative = joinRelative(dialog.targetPath, value);
        await projectFiles.create(project.path, relative, dialog.kind === "new-folder");
        notify("success", dialog.kind === "new-folder" ? "Carpeta creada" : "Archivo creado");
      } else if (dialog.kind === "rename") {
        const oldPath = dialog.targetPath;
        const newPath = joinRelative(parentPath(oldPath), value);
        await projectFiles.rename(project.path, oldPath, value);
        setOpenFiles((current) => current.map((file) => {
          if (file.relativePath !== oldPath && !file.relativePath.startsWith(`${oldPath}/`)) return file;
          const relativePath = `${newPath}${file.relativePath.slice(oldPath.length)}`;
          return { ...file, relativePath, name: relativePath.split("/").pop() ?? file.name };
        }));
        if (activePath === oldPath || activePath?.startsWith(`${oldPath}/`)) setActivePath(`${newPath}${activePath.slice(oldPath.length)}`);
        notify("success", "Nombre actualizado");
      } else {
        await projectFiles.remove(project.path, dialog.targetPath);
        setOpenFiles((current) => current.filter((file) => file.relativePath !== dialog.targetPath && !file.relativePath.startsWith(`${dialog.targetPath}/`)));
        if (activePath === dialog.targetPath || activePath?.startsWith(`${dialog.targetPath}/`)) setActivePath(null);
        notify("success", dialog.isDirectory ? "Carpeta eliminada" : "Archivo eliminado");
      }
      setDialog(null);
      setSelectedNode(null);
      await refreshTree();
    } catch (error) {
      setDialogError(errorMessage(error));
    } finally {
      setDialogBusy(false);
    }
  }

  const dirtyCount = useMemo(() => openFiles.filter((file) => file.content !== file.savedContent).length, [openFiles]);
  const activeSettings = assistantWorkspace === "code" ? codeSettings : chatSettings;

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <a className="skip-link" href="#main-content">{t("Saltar al contenido", "Skip to content")}</a>
      <aside className={`project-sidebar ${sidebarOpen && assistantWorkspace === "code" && workspaceView === "files" ? "" : "project-sidebar--closed"}`} inert={!sidebarOpen || assistantWorkspace !== "code" || workspaceView !== "files"} aria-hidden={!sidebarOpen || assistantWorkspace !== "code" || workspaceView !== "files"}>
        <div className="unified-sidebar-head"><BrandMark /><WorkspaceSwitcher value={assistantWorkspace} onChange={(value) => { setAssistantWorkspace(value); if (value === "code") setWorkspaceView("chat"); }} /><button type="button" className="unified-sidebar-close" onClick={() => setSidebarOpen(false)} title={t("Ocultar barra lateral", "Hide sidebar")} aria-label={t("Ocultar barra lateral", "Hide sidebar")}><X size={17} /></button></div>
        <div className="sidebar-mode-tabs" role="tablist"><button role="tab" aria-selected={false} onClick={() => setWorkspaceView("chat")}><MessagesSquare size={16} />{t("Chats", "Chats")}</button><button role="tab" aria-selected={true}><Files size={16} />{t("Explorador", "Explorer")}</button></div>
        <div className="sidebar-brand">
          <div className="sidebar-brand__title"><span>{t("Proyectos", "Projects")}</span><small>{projects.length}</small></div>
          <button type="button" className="sidebar-new-project" onClick={() => void chooseFolder()} title={t("Añadir proyecto", "Add project")} aria-label={t("Añadir proyecto", "Add project")}><FolderPlus size={16} strokeWidth={1.8} /></button>
        </div>
        {project ? <>
          <div className="sidebar-projects" aria-label={t("Proyectos", "Projects")}>
            {projects.map((item) => {
              const isActive = project.path.toLocaleLowerCase() === item.path.toLocaleLowerCase();
              return <button type="button" key={item.path} className={isActive ? "is-active" : ""} onClick={() => void loadProject(item.path)} title={item.path} aria-current={isActive ? "true" : undefined}><span className="sidebar-project-icon"><FolderOpen size={16} strokeWidth={1.8} /></span><strong>{item.name}</strong>{isActive && <CircleCheck className="sidebar-project-check" size={14} strokeWidth={2} />}</button>;
            })}
          </div>
          <FileTree key={project.path} projectName={project.name} nodes={nodes} selectedPath={selectedNode?.relativePath ?? null} loading={loading} openFiles={openFiles} activePath={activePath} onActivateOpen={setActivePath} onSelect={setSelectedNode} onOpen={openFile} onRefresh={() => void refreshTree()} onCreate={createRequest} onRename={renameNode} onDelete={(node) => { setDialog({ kind: "delete", targetPath: node.relativePath, targetName: node.name, isDirectory: node.isDirectory }); setDialogError(null); }} onReveal={(node) => projectFiles.reveal(node.path).catch((error) => notify("error", errorMessage(error)))} onCopy={(value, label) => navigator.clipboard.writeText(value).then(() => notify("success", label)).catch(() => notify("error", "No se pudo copiar la ruta."))} />
        </> : <div className="sidebar-empty"><CircleHelp size={16} /><span>{t("Abre un proyecto para ver sus archivos.", "Open a project to view its files.")}</span></div>}
      </aside>
      {sidebarOpen && <button type="button" className="sidebar-mobile-backdrop" onClick={() => setSidebarOpen(false)} aria-label={t("Ocultar barra lateral", "Hide sidebar")} />}

      <main className="workspace" id="main-content">
        <header className="topbar">
          <div className="topbar__left"><button className="icon-button" onClick={() => setSidebarOpen((value) => !value)} title={sidebarOpen ? t("Ocultar barra lateral", "Hide sidebar") : t("Mostrar barra lateral", "Show sidebar")} aria-label={sidebarOpen ? t("Ocultar barra lateral", "Hide sidebar") : t("Mostrar barra lateral", "Show sidebar")}>{sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>{assistantWorkspace === "code" && <ProjectSwitcher active={project} projects={projects} onAdd={() => void chooseFolder()} onSelect={(path) => void loadProject(path)} onRemove={removeRegisteredProject} />}</div>
          <div className="topbar__right">{assistantWorkspace === "code" && project && <div className={`topbar__status ${dirtyCount ? "topbar__status--dirty" : ""}`}>{dirtyCount ? <span className="unsaved-mark" /> : <CircleCheck size={14} strokeWidth={1.8} />}{dirtyCount ? `${dirtyCount} ${t("sin guardar", "unsaved")}` : t("Guardado", "Saved")}</div>}<button className="topbar-settings" onClick={() => setPreferencesOpen(true)}><Settings2 size={17} />{t("Ajustes", "Settings")}</button></div>
        </header>
        <div className={`workspace-view ${assistantWorkspace === "chat" ? "" : "workspace-view--hidden"}`}>
          <NovaChatWorkspace activeWorkspace={assistantWorkspace === "chat"} project={null} projects={[]} openFiles={[]} settings={chatSettings} sidebarOpen={sidebarOpen} onAddProject={() => void chooseFolder()} onSelectProject={(path) => void loadProject(path)} onConfigure={() => setProviderOpen(true)} onSettingsChange={setChatSettings} onFilesChanged={async () => {}} onNotify={notify} onWorkspaceChange={(value) => { setAssistantWorkspace(value); if (value === "code") setWorkspaceView("chat"); }} onOpenExplorer={() => { setAssistantWorkspace("code"); setWorkspaceView("files"); }} onOpenPreferences={() => setPreferencesOpen(true)} onCloseSidebar={() => setSidebarOpen(false)} />
        </div>
        <div className={`workspace-view ${assistantWorkspace === "code" && workspaceView === "chat" ? "" : "workspace-view--hidden"}`}>
          {project ? <NovaCodeWorkspace activeWorkspace={assistantWorkspace === "code" && workspaceView === "chat"} project={project} projects={projects} openFiles={openFiles} settings={codeSettings} sidebarOpen={sidebarOpen} onAddProject={() => void chooseFolder()} onSelectProject={(path) => void loadProject(path)} onConfigure={() => setProviderOpen(true)} onSettingsChange={setCodeSettings} onFilesChanged={reloadChangedFiles} onNotify={notify} onWorkspaceChange={(value) => { setAssistantWorkspace(value); if (value === "code") setWorkspaceView("chat"); }} onOpenExplorer={() => setWorkspaceView("files")} onOpenPreferences={() => setPreferencesOpen(true)} onCloseSidebar={() => setSidebarOpen(false)} /> : <section className="welcome-state welcome-state--code"><div className="welcome-state__icon"><Code2 size={22} strokeWidth={1.7} /></div><h1>{t("Empieza con Vareliox Code", "Start with Vareliox Code")}</h1><p>{t("Abre un proyecto para que el agente pueda explorar y trabajar con su código.", "Open a project so the agent can explore and work with its code.")}</p><button className="primary-button primary-button--large" onClick={() => void chooseFolder()}><FolderPlus size={17} />{t("Abrir proyecto", "Open project")}</button></section>}
        </div>
        <div className={`workspace-view ${assistantWorkspace === "code" && workspaceView === "files" ? "" : "workspace-view--hidden"}`}>
          {project ? <Suspense fallback={<div className="editor-loading">{t("Preparando editor…", "Preparing editor…")}</div>}><EditorPane files={openFiles} activePath={activePath} saving={saving} onActivate={setActivePath} onChange={updateContent} onClose={closeFile} onSave={(path) => void saveFile(path)} onSaveAll={() => void saveAll()} /></Suspense> : <section className="welcome-state"><div className="welcome-state__icon"><FolderPlus size={22} strokeWidth={1.7} /></div><h1>{t("Crea tu primer proyecto", "Create your first project")}</h1><p>{t("Elige una carpeta existente o crea una nueva desde el selector del sistema.", "Choose an existing folder or create a new one in the system picker.")}</p><button className="primary-button primary-button--large" onClick={() => void chooseFolder()}><FolderPlus size={17} strokeWidth={1.8} />{t("Nuevo proyecto", "New project")}</button><small>{t("Después podrás añadir más desde el botón Nuevo proyecto de la izquierda.", "You can add more later from the New project button on the left.")}</small></section>}
        </div>
      </main>
      {sidebarOpen && <div className="sidebar-resize-handle" onPointerDown={startSidebarResize} role="separator" aria-label={t("Cambiar ancho de la barra lateral", "Resize sidebar")} />}

      <div className="notice-stack" aria-live="polite">{notices.map((notice) => <div key={notice.id} className={`notice notice--${notice.tone}`}>{notice.message}<button onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))} aria-label={t("Cerrar aviso", "Dismiss notification")}><X size={14} /></button></div>)}</div>
      <UpdateBanner />
      {dialog && <ActionDialog request={dialog} busy={dialogBusy} error={dialogError} onCancel={() => !dialogBusy && setDialog(null)} onConfirm={(value) => void confirmDialog(value)} />}
      {projectFolderDialogOpen && <ProjectFolderDialog path={projectFolderPath} busy={projectFolderBusy} error={projectFolderError} onPathChange={(value) => { setProjectFolderPath(value); setProjectFolderError(null); }} onBrowse={() => void browseProjectFolder()} onConfirm={() => void confirmProjectFolder()} onCancel={() => !projectFolderBusy && setProjectFolderDialogOpen(false)} />}
      {providerOpen && activeSettings && <ProviderPanel projectPath={assistantWorkspace === "code" ? project?.path ?? null : null} settings={activeSettings} onChange={assistantWorkspace === "code" ? setCodeSettings : setChatSettings} onClose={() => setProviderOpen(false)} />}
      {preferencesOpen && <PreferencesPanel projectPath={assistantWorkspace === "code" ? project?.path ?? null : null} settings={activeSettings} onFilesRestored={(paths) => { void reloadChangedFiles(paths); void refreshTree(true); notify("success", t("Proyecto restaurado", "Project restored")); }} onClose={() => setPreferencesOpen(false)} onOpenProviders={() => { setPreferencesOpen(false); setProviderOpen(true); }} />}
      {firstRunOpen && <FirstRunWizard hasProject={!!project} onAddProject={() => void chooseFolder()} onConfigure={() => setProviderOpen(true)} onClose={() => setFirstRunOpen(false)} />}
    </div>
  );
}

export default App;
