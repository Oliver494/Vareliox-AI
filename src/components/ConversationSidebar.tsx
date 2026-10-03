import { AlertCircle, Archive, Bot, Check, Code2, Files, FolderClosed, FolderPlus, LoaderCircle, MessageSquarePlus, MessagesSquare, Pin, Plus, Search, Settings2, ShieldQuestion, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { conversationMatches, sortConversations } from "../services/conversationActions";
import { usePreferences } from "../services/preferences";
import type { AssistantWorkspace, Conversation, ProjectInfo } from "../types";
import { ConversationDialog } from "./ConversationDialog";
import { ConversationMenu, type ConversationMenuAction } from "./ConversationMenu";

type Props = {
  mode: AssistantWorkspace;
  interactive: boolean;
  open: boolean;
  projectName: string;
  projectPath: string | null;
  projects: ProjectInfo[];
  conversations: Conversation[];
  activeId: string;
  generatingConversationId: string | null;
  persistenceError?: string;
  onAddProject: () => void;
  onSelectProject: (path: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onAction: (id: string, action: ConversationMenuAction, value?: string) => void;
  isBusy: (conversation: Conversation) => boolean;
  onWorkspaceChange: (mode: "chat" | "code") => void;
  onOpenExplorer: () => void;
  onOpenPreferences: () => void;
  onClose: () => void;
};

type DialogState = { kind: "rename" | "delete" | "clear"; conversation: Conversation } | null;

export function ConversationSidebar({ mode, interactive, open, projectName, projectPath, projects, conversations, activeId, generatingConversationId, persistenceError, onAddProject, onSelectProject, onSelect, onNew, onAction, isBusy, onWorkspaceChange, onOpenExplorer, onOpenPreferences, onClose }: Props) {
  const { t } = usePreferences();
  const [archivedView, setArchivedView] = useState(false);
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setArchivedView(false); setQuery(""); setMenuId(null); setDialog(null); }, [projectPath]);
  useEffect(() => {
    if (!interactive) return;
    const shortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.ctrlKey && event.key.toLocaleLowerCase() === "n") { event.preventDefault(); setArchivedView(false); onNew(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [interactive, onNew]);

  const visible = useMemo(() => sortConversations(conversations.filter((item) => conversationMatches(item, query)), archivedView), [conversations, archivedView, query]);
  const pinned = archivedView ? [] : visible.filter((item) => item.pinned);
  const regular = archivedView ? visible : visible.filter((item) => !item.pinned);

  function requestAction(conversation: Conversation, action: ConversationMenuAction) {
    if (action === "rename" || action === "delete" || action === "clear") setDialog({ kind: action, conversation });
    else { if (action === "duplicate") setArchivedView(false); onAction(conversation.id, action); }
  }

  const renderRow = (item: Conversation) => <div key={item.id} className={`conversation-row ${item.id === activeId ? "is-active" : ""}`} onContextMenu={(event) => { event.preventDefault(); setMenuId(item.id); }}>
    <button className="conversation-row__select" onClick={() => onSelect(item.id)} onKeyDown={(event) => {
      if (event.key === "F2") { event.preventDefault(); setDialog({ kind: "rename", conversation: item }); }
      if (event.key === "Delete") { event.preventDefault(); setDialog({ kind: "delete", conversation: item }); }
    }}>
      <span>{item.title}</span>
      <small className="conversation-statuses">
        {item.pinned && <i title={t("Fijado", "Pinned")}><Pin size={10} /><span className="sr-only">{t("Fijado", "Pinned")}</span></i>}
        {generatingConversationId === item.id && <i title={t("Respuesta en curso", "Response in progress")}><LoaderCircle className="spin" size={10} /><span className="sr-only">{t("Respuesta en curso", "Response in progress")}</span></i>}
        {item.agentTask?.state === "awaiting_approval" && <i title={t("Pendiente de aprobación", "Awaiting approval")}><ShieldQuestion size={10} /><span className="sr-only">{t("Pendiente de aprobación", "Awaiting approval")}</span></i>}
        {(item.lastError || item.agentTask?.state === "failed") && <i className="is-error" title={t("Terminó con error", "Ended with an error")}><AlertCircle size={10} /><span className="sr-only">{t("Terminó con error", "Ended with an error")}</span></i>}
        {item.archived && <i title={t("Archivado", "Archived")}><Archive size={10} /><span className="sr-only">{t("Archivado", "Archived")}</span></i>}
      </small>
    </button>
    <ConversationMenu conversation={item} open={menuId === item.id} onOpen={() => setMenuId(item.id)} onClose={() => setMenuId(null)} onAction={(action) => requestAction(item, action)} />
  </div>;

  return <aside className={`thread-sidebar thread-sidebar--${mode} ${open ? "" : "thread-sidebar--closed"}`} inert={!open} aria-hidden={!open}>
    <div className="unified-sidebar-head"><div className="unified-wordmark">V</div><div className="unified-workspace-switcher"><button className={mode === "chat" ? "is-active" : ""} onClick={() => onWorkspaceChange("chat")}><Bot size={16} /><span>Chat</span></button><button className={mode === "code" ? "is-active" : ""} onClick={() => onWorkspaceChange("code")}><Code2 size={16} /><span>Code</span></button></div><button type="button" className="unified-sidebar-close" onClick={onClose} title={t("Ocultar barra lateral", "Hide sidebar")} aria-label={t("Ocultar barra lateral", "Hide sidebar")}><X size={17} /></button></div>
    {mode === "code" && <div className="sidebar-mode-tabs" role="tablist"><button role="tab" aria-selected="true"><MessagesSquare size={16} />{t("Chats", "Chats")}</button><button role="tab" aria-selected="false" onClick={onOpenExplorer}><Files size={16} />{t("Explorador", "Explorer")}</button></div>}
    <header><strong>{archivedView ? t("Archivados", "Archived") : t("Chats", "Chats")}</strong><div><button onClick={() => setArchivedView((value) => !value)} title={archivedView ? t("Volver a chats", "Back to chats") : t("Ver archivados", "View archived")} aria-label={archivedView ? t("Volver a chats", "Back to chats") : t("Ver archivados", "View archived")}>{archivedView ? <MessageSquarePlus size={15} /> : <Archive size={14} />}</button><button onClick={() => { setArchivedView(false); onNew(); }} title={`${t("Nueva conversación", "New conversation")} (Ctrl+N)`} aria-label={t("Nueva conversación", "New conversation")}><Plus size={15} /></button></div></header>
    <div className="thread-projects">
      <div className="thread-projects__heading"><span>{t("Proyectos", "Projects")}</span><button type="button" onClick={onAddProject} title={t("Nuevo proyecto", "New project")} aria-label={t("Nuevo proyecto", "New project")}><FolderPlus size={15} /></button></div>
      {projects.map((item) => { const active = projectPath?.toLocaleLowerCase() === item.path.toLocaleLowerCase(); return <button type="button" key={item.path} className={active ? "is-active" : ""} onClick={() => onSelectProject(item.path)} title={item.path}><FolderClosed size={15} strokeWidth={1.8} /><strong>{item.name}</strong>{active && <Check size={14} />}</button>; })}
      {!projects.length && <button type="button" className="thread-projects__empty" onClick={onAddProject}><FolderPlus size={15} />{t("Añadir proyecto", "Add project")}</button>}
    </div>
    <div className="conversation-search"><Search size={13} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Buscar chats", "Search chats")} aria-label={t("Buscar conversaciones", "Search conversations")} />{query && <button onClick={() => setQuery("")} title={t("Limpiar búsqueda", "Clear search")} aria-label={t("Limpiar búsqueda", "Clear search")}><X size={12} /></button>}</div>
    <div className="thread-list">
      {!!pinned.length && <section className="conversation-section"><h2>{t("Fijados", "Pinned")}</h2>{pinned.map(renderRow)}</section>}
      {!!regular.length && <section className="conversation-section"><h2>{archivedView ? t("Archivados", "Archived") : pinned.length ? t("Recientes", "Recent") : t("Conversaciones", "Conversations")}</h2>{regular.map(renderRow)}</section>}
      {!visible.length && <div className="conversation-empty"><Search size={16} /><span>{query ? t("No hay resultados", "No results") : archivedView ? t("No hay chats archivados", "No archived chats") : t("No hay conversaciones", "No conversations")}</span></div>}
    </div>
    {persistenceError && <div className="conversation-persistence-error" role="alert"><AlertCircle size={13} /><span>{persistenceError}</span></div>}
    <footer className="unified-sidebar-footer"><button onClick={onOpenPreferences}><Settings2 size={17} />{t("Ajustes", "Settings")}</button></footer>
    {dialog && <ConversationDialog kind={dialog.kind} conversation={dialog.conversation} projectName={projectName} busy={isBusy(dialog.conversation)} onClose={() => setDialog(null)} onConfirm={(value) => { onAction(dialog.conversation.id, dialog.kind, value); setDialog(null); }} />}
  </aside>;
}
