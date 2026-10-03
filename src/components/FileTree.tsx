import {
  ChevronRight,
  ChevronsDownUp,
  Copy,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type { FileNode, OpenFile } from "../types";
import { errorMessage } from "../services/fileSystem";
import { usePreferences } from "../services/preferences";
import { FileTypeIcon } from "./FileTypeIcon";

type ContextState = { node: FileNode; x: number; y: number } | null;

type Props = {
  projectName: string;
  nodes: FileNode[];
  selectedPath: string | null;
  loading: boolean;
  openFiles: OpenFile[];
  activePath: string | null;
  onActivateOpen: (path: string) => void;
  onSelect: (node: FileNode) => void;
  onOpen: (node: FileNode) => void;
  onRefresh: () => void;
  onCreate: (kind: "new-file" | "new-folder", target?: FileNode) => void;
  onRename: (node: FileNode, name: string) => Promise<void>;
  onDelete: (node: FileNode) => void;
  onReveal: (node: FileNode) => void;
  onCopy: (value: string, label: string) => void;
};

function NodeIcon({ node, expanded }: { node: FileNode; expanded: boolean }) {
  if (node.isDirectory) return expanded ? <FolderOpen size={15} strokeWidth={1.8} /> : <Folder size={15} strokeWidth={1.8} />;
  return <FileTypeIcon name={node.name} />;
}

type RenameState = {
  editingPath: string | null;
  renameValue: string;
  renameError: string;
  renameBusy: boolean;
  onBeginRename: (node: FileNode) => void;
  onRenameValue: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
};

function TreeNode({ node, depth, collapseSignal, query, ...props }: { node: FileNode; depth: number; collapseSignal: number; query: string } & Omit<Props, "nodes" | "loading" | "onRefresh" | "openFiles" | "activePath" | "onActivateOpen"> & RenameState) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(depth === 0);
  useEffect(() => setExpanded(false), [collapseSignal]);
  useEffect(() => { if (query) setExpanded(true); }, [query]);
  const openNode = () => {
    props.onSelect(node);
    if (node.isDirectory) setExpanded((current) => !current);
    else props.onOpen(node);
  };
  return (
    <li>
      {props.editingPath === node.relativePath ? <div className="tree-row tree-row--editing" style={{ paddingLeft: 7 + depth * 12 }}>
        <ChevronRight className={`tree-chevron ${expanded ? "tree-chevron--open" : ""} ${node.isDirectory ? "" : "tree-chevron--hidden"}`} size={12} strokeWidth={1.8} />
        <NodeIcon node={node} expanded={expanded} />
        <input autoFocus value={props.renameValue} onChange={(event) => props.onRenameValue(event.target.value)} onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") { event.preventDefault(); props.onCommitRename(); }
          if (event.key === "Escape") { event.preventDefault(); props.onCancelRename(); }
        }} onBlur={() => { if (!props.renameBusy && !props.renameError) props.onCommitRename(); }} disabled={props.renameBusy} aria-label={t("Nuevo nombre", "New name")} aria-invalid={!!props.renameError} />
        {props.renameError && <small className="tree-rename-error" role="alert" title={props.renameError}>{props.renameError}</small>}
      </div> : <button
        className={`tree-row ${props.selectedPath === node.relativePath ? "tree-row--selected" : ""}`}
        style={{ paddingLeft: 7 + depth * 12 }}
        onClick={openNode}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onSelect(node);
          window.dispatchEvent(new CustomEvent("nova-context", { detail: { node, x: event.clientX, y: event.clientY } }));
        }}
        onKeyDown={(event) => {
          if (event.key === "F2") { event.preventDefault(); props.onBeginRename(node); }
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            props.onSelect(node);
            window.dispatchEvent(new CustomEvent("nova-context", { detail: { node, x: bounds.left + 28, y: bounds.bottom } }));
          }
        }}
        title={node.relativePath}
      >
        <ChevronRight className={`tree-chevron ${expanded ? "tree-chevron--open" : ""} ${node.isDirectory ? "" : "tree-chevron--hidden"}`} size={12} strokeWidth={1.8} />
        <NodeIcon node={node} expanded={expanded} />
        <span>{node.name}</span>
      </button>}
      {node.isDirectory && expanded && node.children.length > 0 && (
        <ul>{node.children.map((child) => <TreeNode key={child.relativePath} node={child} depth={depth + 1} collapseSignal={collapseSignal} query={query} {...props} />)}</ul>
      )}
    </li>
  );
}

export function FileTree(props: Props) {
  const { t } = usePreferences();
  const [context, setContext] = useState<ContextState>(null);
  const [query, setQuery] = useState("");
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [renamingNode, setRenamingNode] = useState<FileNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (event: Event) => setContext((event as CustomEvent<ContextState>).detail);
    const hide = () => setContext(null);
    window.addEventListener("nova-context", show);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("nova-context", show);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  const action = (callback: (node: FileNode) => void) => (event: MouseEvent) => {
    event.stopPropagation();
    if (context) callback(context.node);
    setContext(null);
  };

  function beginRename(node: FileNode) {
    setRenamingNode(node);
    setRenameValue(node.name);
    setRenameError("");
  }

  async function commitRename() {
    if (!renamingNode || renameBusy) return;
    const name = renameValue.trim();
    if (!name) { setRenameError(t("Escribe un nombre", "Enter a name")); return; }
    if (name === renamingNode.name) { setRenamingNode(null); return; }
    setRenameBusy(true);
    setRenameError("");
    try {
      await props.onRename(renamingNode, name);
      setRenamingNode(null);
    } catch (error) {
      setRenameError(errorMessage(error));
    } finally {
      setRenameBusy(false);
    }
  }

  const filteredNodes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return props.nodes;
    const filter = (nodes: FileNode[]): FileNode[] => nodes.flatMap((node) => {
      const children = node.isDirectory ? filter(node.children) : [];
      return node.name.toLocaleLowerCase().includes(needle) || children.length ? [{ ...node, children }] : [];
    });
    return filter(props.nodes);
  }, [props.nodes, query]);

  return (
    <div className="file-tree">
      <div className="explorer-toolbar">
        <div className="explorer-toolbar__title"><span>{t("Archivos", "Files")}</span><small title={props.projectName}>{props.projectName}</small></div>
        <div>
          <button onClick={() => props.onCreate("new-file")} title={t("Nuevo archivo", "New file")} aria-label={t("Nuevo archivo", "New file")}><FilePlus2 size={16} strokeWidth={1.8} /></button>
          <button onClick={() => props.onCreate("new-folder")} title={t("Nueva carpeta", "New folder")} aria-label={t("Nueva carpeta", "New folder")}><FolderPlus size={16} strokeWidth={1.8} /></button>
          <button onClick={props.onRefresh} title={t("Actualizar archivos", "Refresh files")} aria-label={t("Actualizar archivos", "Refresh files")} disabled={props.loading}><RefreshCw className={props.loading ? "spin" : ""} size={16} strokeWidth={1.8} /></button>
          <button onClick={() => setCollapseSignal((value) => value + 1)} title={t("Contraer todo", "Collapse all")} aria-label={t("Contraer todo", "Collapse all")}><ChevronsDownUp size={16} strokeWidth={1.8} /></button>
        </div>
      </div>
      {!!props.openFiles.length && <section className="open-editors"><header>{t("Archivos abiertos", "Open editors")}<small>{props.openFiles.length}</small></header>{props.openFiles.map((file) => <button key={file.relativePath} className={props.activePath === file.relativePath ? "is-active" : ""} onClick={() => props.onActivateOpen(file.relativePath)}><FileTypeIcon name={file.name} /><span>{file.name}</span>{file.content !== file.savedContent && <i aria-label={t("Sin guardar", "Unsaved")} />}</button>)}</section>}
      <label className="explorer-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Buscar archivos", "Search files")} />{query && <button onClick={() => setQuery("")} aria-label={t("Limpiar búsqueda", "Clear search")}><X size={14} /></button>}</label>
      <div className="tree-scroll">
        {props.loading && props.nodes.length === 0 ? <div className="tree-status">{t("Leyendo proyecto…", "Reading project…")}</div> : (
          <ul className="tree-root">{filteredNodes.map((node) => <TreeNode key={node.relativePath} node={node} depth={0} collapseSignal={collapseSignal} query={query} editingPath={renamingNode?.relativePath ?? null} renameValue={renameValue} renameError={renameError} renameBusy={renameBusy} onBeginRename={beginRename} onRenameValue={(value) => { setRenameValue(value); setRenameError(""); }} onCommitRename={() => void commitRename()} onCancelRename={() => setRenamingNode(null)} {...props} />)}</ul>
        )}
        {!props.loading && query && !filteredNodes.length && <div className="tree-status">{t("No hay archivos que coincidan", "No matching files")}</div>}
      </div>
      {context && (
        <div ref={menuRef} className="context-menu" style={{ left: Math.min(context.x, window.innerWidth - 220), top: Math.min(context.y, window.innerHeight - 300) }} onPointerDown={(event) => event.stopPropagation()} role="menu">
          {context.node.isDirectory && <><button role="menuitem" onClick={action((node) => props.onCreate("new-file", node))}><FilePlus2 size={16} strokeWidth={1.8} />{t("Nuevo archivo", "New file")}</button><button role="menuitem" onClick={action((node) => props.onCreate("new-folder", node))}><FolderPlus size={16} strokeWidth={1.8} />{t("Nueva carpeta", "New folder")}</button><span className="context-separator" /></>}
          <button role="menuitem" onClick={action(beginRename)}><Pencil size={16} strokeWidth={1.8} />{t("Renombrar", "Rename")}</button>
          <button role="menuitem" onClick={action(props.onReveal)}><FolderSearch size={16} strokeWidth={1.8} />{t("Mostrar en el Explorador", "Show in File Explorer")}</button>
          <button role="menuitem" onClick={action((node) => props.onCopy(node.path, t("Ruta copiada", "Path copied")))}><Copy size={16} strokeWidth={1.8} />{t("Copiar ruta", "Copy path")}</button>
          <button role="menuitem" onClick={action((node) => props.onCopy(node.relativePath, t("Ruta relativa copiada", "Relative path copied")))}><Copy size={16} strokeWidth={1.8} />{t("Copiar ruta relativa", "Copy relative path")}</button>
          <span className="context-separator" />
          <button role="menuitem" className="context-danger" onClick={action(props.onDelete)}><Trash2 size={16} strokeWidth={1.8} />{t("Eliminar", "Delete")}</button>
        </div>
      )}
    </div>
  );
}
