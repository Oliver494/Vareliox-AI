use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

mod agent;
mod ai;
mod git;
mod linux_compat;
mod system;
mod updates;
mod web;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TREE_DEPTH: usize = 32;
const MAX_TREE_ENTRIES: usize = 20_000;
const MAX_RECOVERY_BYTES: u64 = 50 * 1024 * 1024;
const MAX_RECOVERY_ENTRIES: usize = 5_000;
const ALWAYS_IGNORED: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".cache",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".next",
    ".nuxt",
    ".idea",
    ".vscode",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInfo {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    name: String,
    path: String,
    relative_path: String,
    is_directory: bool,
    children: Vec<FileNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileContent {
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) content: String,
    pub(crate) size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadedAttachment {
    name: String,
    path: String,
    mime_type: String,
    kind: String,
    data: String,
    size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextReference {
    path: String,
    start_line: usize,
    end_line: usize,
    truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiFileChange {
    path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiProjectAction {
    #[serde(rename = "type")]
    action_type: String,
    path: String,
    content: Option<String>,
    new_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryEntry {
    action_type: String,
    path: String,
    new_path: Option<String>,
    original_kind: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryManifest {
    id: String,
    project_root: String,
    created_at: u64,
    entries: Vec<RecoveryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoverySnapshotInfo {
    id: String,
    created_at: u64,
    action_count: usize,
    summary: Vec<String>,
}

fn clean_root(root: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(root);
    let canonical = path
        .canonicalize()
        .map_err(|_| "La carpeta del proyecto ya no existe o no es accesible.".to_string())?;
    if !canonical.is_dir() {
        return Err("La ruta seleccionada no es una carpeta.".to_string());
    }
    Ok(canonical)
}

fn reject_unsafe_components(path: &Path) -> Result<(), String> {
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("La ruta solicitada intenta salir del proyecto.".to_string());
    }
    Ok(())
}

fn existing_project_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    reject_unsafe_components(relative_path)?;
    let joined = root.join(relative_path);
    let mut current = root.to_path_buf();
    for component in relative_path.components() {
        if let Component::Normal(part) = component {
            current.push(part);
            if fs::symlink_metadata(&current)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
            {
                return Err(
                    "No se permiten operaciones a través de enlaces simbólicos.".to_string()
                );
            }
        }
    }
    let canonical = joined
        .canonicalize()
        .map_err(|_| format!("No se encontró ‘{}’ dentro del proyecto.", relative))?;
    if !canonical.starts_with(root) {
        return Err(
            "La ruta solicitada está fuera del proyecto o atraviesa un enlace simbólico."
                .to_string(),
        );
    }
    Ok(canonical)
}

fn new_project_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    reject_unsafe_components(relative_path)?;
    let name = relative_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "El nombre no es válido.".to_string())?;
    validate_name(name)?;
    let parent_relative = relative_path.parent().unwrap_or_else(|| Path::new(""));
    let parent = existing_project_path(root, &parent_relative.to_string_lossy())?;
    if !parent.is_dir() {
        return Err("La ubicación elegida no es una carpeta.".to_string());
    }
    Ok(parent.join(name))
}

fn validate_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed
            .chars()
            .any(|character| character == '/' || character.is_control())
    {
        return Err("El nombre contiene caracteres no permitidos por el sistema.".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        let invalid = ['<', '>', ':', '"', '\\', '|', '?', '*'];
        if trimmed.ends_with('.')
            || trimmed.ends_with(' ')
            || trimmed
                .chars()
                .any(|character| invalid.contains(&character))
        {
            return Err("El nombre contiene caracteres no permitidos en Windows.".to_string());
        }
        let stem = trimmed.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];
        if reserved.contains(&stem.as_str()) {
            return Err("Ese nombre está reservado por Windows.".to_string());
        }
    }
    Ok(())
}

fn gitignore_for(root: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(root);
    let ignore_file = root.join(".gitignore");
    if ignore_file.is_file() {
        let _ = builder.add(ignore_file);
    }
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

fn is_ignored(root: &Path, path: &Path, is_dir: bool, matcher: &Gitignore) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if ALWAYS_IGNORED.contains(&name)
        || name.ends_with('~')
        || name.ends_with(".tmp")
        || name.ends_with(".temp")
        || name == ".DS_Store"
    {
        return true;
    }
    matcher
        .matched_path_or_any_parents(path.strip_prefix(root).unwrap_or(path), is_dir)
        .is_ignore()
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    matcher: &Gitignore,
    depth: usize,
    count: &mut usize,
) -> Result<Vec<FileNode>, String> {
    if depth > MAX_TREE_DEPTH {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("No se pudo leer ‘{}’: {}", directory.display(), error))?;
    let mut nodes = Vec::new();
    for entry in entries {
        if *count >= MAX_TREE_ENTRIES {
            break;
        }
        let entry = entry.map_err(|error| format!("No se pudo leer una entrada: {}", error))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("No se pudo inspeccionar ‘{}’: {}", path.display(), error))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let is_directory = metadata.is_dir();
        if is_ignored(root, &path, is_directory, matcher) {
            continue;
        }
        *count += 1;
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let children = if is_directory {
            scan_directory(root, &path, matcher, depth + 1, count)?
        } else {
            Vec::new()
        };
        nodes.push(FileNode {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            relative_path: relative,
            is_directory,
            children,
        });
    }
    nodes.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(nodes)
}

#[tauri::command]
fn open_project(path: String) -> Result<ProjectInfo, String> {
    let root = clean_root(&path)?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Proyecto")
        .to_string();
    Ok(ProjectInfo {
        name,
        path: root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn scan_project(root: String) -> Result<Vec<FileNode>, String> {
    let root = clean_root(&root)?;
    let matcher = gitignore_for(&root);
    scan_directory(&root, &root, &matcher, 0, &mut 0)
}

#[tauri::command]
fn read_project_file(root: String, relative_path: String) -> Result<FileContent, String> {
    read_project_file_inner(root, relative_path)
}

pub(crate) fn read_project_file_inner(
    root: String,
    relative_path: String,
) -> Result<FileContent, String> {
    let root = clean_root(&root)?;
    let path = existing_project_path(&root, &relative_path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("La ruta seleccionada no es un archivo.".to_string());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "El archivo ocupa más de {} MB y no se abrirá para evitar bloquear la aplicación.",
            MAX_FILE_BYTES / 1024 / 1024
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(&path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|error| format!("No se pudo leer el archivo: {}", error))?;
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err("Este archivo parece ser binario y no puede editarse como texto.".to_string());
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| "El archivo no utiliza una codificación UTF-8 compatible.".to_string())?;
    Ok(FileContent {
        path: path.to_string_lossy().to_string(),
        relative_path,
        content,
        size: metadata.len(),
    })
}

pub(crate) fn ensure_context_file_allowed(root: &str, relative_path: &str) -> Result<(), String> {
    let root = clean_root(root)?;
    let path = existing_project_path(&root, relative_path)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("No se pudo inspeccionar el archivo: {error}"))?;
    if is_ignored(&root, &path, metadata.is_dir(), &gitignore_for(&root)) {
        return Err(
            "El archivo está excluido por .gitignore o por las reglas seguras de Vareliox Code."
                .into(),
        );
    }
    Ok(())
}

#[tauri::command]
fn write_project_file(root: String, relative_path: String, content: String) -> Result<(), String> {
    let root = clean_root(&root)?;
    let path = existing_project_path(&root, &relative_path)?;
    if !path.is_file() {
        return Err("Solo se pueden guardar archivos de texto existentes.".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta del archivo.".to_string())?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("No se pudo preparar el guardado seguro: {}", error))?;
    temporary
        .write_all(content.as_bytes())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("No se pudieron escribir los cambios: {}", error))?;
    temporary
        .persist(&path)
        .map_err(|error| format!("No se pudo reemplazar el archivo original: {}", error.error))?;
    Ok(())
}

#[tauri::command]
fn create_project_item(root: String, relative_path: String, directory: bool) -> Result<(), String> {
    let root = clean_root(&root)?;
    let path = new_project_path(&root, &relative_path)?;
    if path.exists() {
        return Err("Ya existe un archivo o carpeta con ese nombre.".to_string());
    }
    if directory {
        fs::create_dir(&path).map_err(|error| format!("No se pudo crear la carpeta: {}", error))?;
    } else {
        File::create(&path).map_err(|error| format!("No se pudo crear el archivo: {}", error))?;
    }
    Ok(())
}

#[tauri::command]
fn rename_project_item(
    root: String,
    relative_path: String,
    new_name: String,
) -> Result<(), String> {
    validate_name(&new_name)?;
    let root = clean_root(&root)?;
    let current = existing_project_path(&root, &relative_path)?;
    let parent = current
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta actual.".to_string())?;
    let destination = parent.join(new_name.trim());
    if destination.exists() {
        return Err("Ya existe un elemento con ese nombre.".to_string());
    }
    fs::rename(&current, &destination)
        .map_err(|error| format!("No se pudo renombrar: {}", error))?;
    Ok(())
}

#[tauri::command]
fn delete_project_item(root: String, relative_path: String) -> Result<(), String> {
    let root = clean_root(&root)?;
    let path = existing_project_path(&root, &relative_path)?;
    if path == root {
        return Err("No se puede eliminar la carpeta raíz del proyecto.".to_string());
    }
    if path.is_dir() {
        fs::remove_dir_all(&path)
            .map_err(|error| format!("No se pudo eliminar la carpeta: {}", error))?;
    } else {
        fs::remove_file(&path)
            .map_err(|error| format!("No se pudo eliminar el archivo: {}", error))?;
    }
    Ok(())
}

fn attachment_mime(path: &Path) -> (&'static str, &'static str) {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => ("image/png", "image"),
        "jpg" | "jpeg" => ("image/jpeg", "image"),
        "webp" => ("image/webp", "image"),
        "gif" => ("image/gif", "image"),
        "md" => ("text/markdown", "text"),
        "json" => ("application/json", "text"),
        "html" => ("text/html", "text"),
        "css" => ("text/css", "text"),
        "js" | "jsx" | "mjs" => ("text/javascript", "text"),
        "ts" | "tsx" => ("text/typescript", "text"),
        "py" | "rs" | "java" | "go" | "c" | "cpp" | "h" | "hpp" | "toml" | "yaml" | "yml"
        | "xml" | "txt" | "log" | "csv" => ("text/plain", "text"),
        _ => ("application/octet-stream", "unsupported"),
    }
}

#[tauri::command]
fn load_chat_attachment(path: String) -> Result<LoadedAttachment, String> {
    let path = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| "No se encontró el archivo adjunto.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Solo se pueden adjuntar archivos normales.".into());
    }
    let (mime_type, kind) = attachment_mime(&path);
    if kind == "unsupported" {
        return Err("Este tipo de archivo todavía no puede enviarse a la IA.".into());
    }
    let limit = if kind == "image" {
        10 * 1024 * 1024
    } else {
        2 * 1024 * 1024
    };
    if metadata.len() > limit {
        return Err(format!(
            "El archivo supera el límite de {} MB.",
            limit / 1024 / 1024
        ));
    }
    let bytes = fs::read(&path).map_err(|error| format!("No se pudo leer el adjunto: {error}"))?;
    let data = if kind == "image" {
        BASE64.encode(bytes)
    } else {
        String::from_utf8(bytes).map_err(|_| "El archivo de texto no utiliza UTF-8.".to_string())?
    };
    Ok(LoadedAttachment {
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("archivo")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        mime_type: mime_type.to_string(),
        kind: kind.to_string(),
        data,
        size: metadata.len(),
    })
}

fn context_files(
    root: &Path,
    directory: &Path,
    matcher: &Gitignore,
    output: &mut Vec<(String, PathBuf)>,
    limit: usize,
) -> Result<(), String> {
    if output.len() >= limit {
        return Ok(());
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("No se pudo leer el proyecto: {error}"))?
        .flatten()
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());
    for entry in entries {
        if output.len() >= limit {
            break;
        }
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || is_ignored(root, &path, metadata.is_dir(), matcher)
        {
            continue;
        }
        if metadata.is_dir() {
            context_files(root, &path, matcher, output, limit)?;
        } else if metadata.is_file() && metadata.len() <= 256 * 1024 {
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            output.push((relative, path));
        }
    }
    Ok(())
}

fn collect_context_files(root: &str, limit: usize) -> Result<Vec<(String, PathBuf)>, String> {
    let root = clean_root(root)?;
    let mut files = Vec::new();
    context_files(&root, &root, &gitignore_for(&root), &mut files, limit)?;
    Ok(files)
}

pub(crate) fn project_context_tree(root: &str, limit: usize) -> Result<String, String> {
    let mut output = String::new();
    for (relative, _) in collect_context_files(root, 2_000)? {
        let line = format!("{relative}\n");
        if output.len() + line.len() > limit {
            output.push_str("[Estructura truncada]\n");
            break;
        }
        output.push_str(&line);
    }
    Ok(output)
}

fn prompt_terms(prompt: &str) -> Vec<String> {
    const IGNORED: &[&str] = &[
        "para", "como", "este", "esta", "crear", "crea", "haz", "hacer", "quiero", "puedes",
        "puede", "archivo", "carpeta", "proyecto", "sobre", "with", "that", "this", "from", "make",
        "create", "please", "code",
    ];
    let mut terms = prompt
        .to_ascii_lowercase()
        .split(|character: char| {
            !character.is_ascii_alphanumeric() && character != '_' && character != '-'
        })
        .filter(|term| term.len() >= 3 && !IGNORED.contains(term))
        .map(str::to_string)
        .collect::<Vec<_>>();
    terms.sort();
    terms.dedup();
    terms
}

pub(crate) fn project_context_relevant_snapshot(
    root: &str,
    prompt: &str,
    limit: usize,
    max_files: usize,
) -> Result<String, String> {
    let selections = relevant_context_selections(root, prompt, limit, max_files)?;
    let mut output = String::new();
    for (reference, content) in selections {
        output.push_str(&format!(
            "\n--- {}:{}-{} ---\n{}\n",
            reference.path, reference.start_line, reference.end_line, content
        ));
        if reference.truncated {
            output.push_str("[Archivo truncado]\n");
        }
    }
    if output.is_empty() {
        output.push_str("[No hay archivos de texto relevantes disponibles]\n");
    }
    Ok(output)
}

fn relevant_context_selections(
    root: &str,
    prompt: &str,
    limit: usize,
    max_files: usize,
) -> Result<Vec<(ContextReference, String)>, String> {
    let terms = prompt_terms(prompt);
    let mut ranked = collect_context_files(root, 2_000)?
        .into_iter()
        .map(|(relative, path)| {
            let name = relative.to_ascii_lowercase();
            let matches = terms
                .iter()
                .filter(|term| name.contains(term.as_str()))
                .count();
            let fallback = usize::from(
                name.starts_with("src/")
                    || name.starts_with("app/")
                    || name.contains("/index.")
                    || name.contains("/main.")
                    || name == "readme.md"
                    || name.ends_with("package.json")
                    || name.ends_with("cargo.toml"),
            );
            (matches * 100 + fallback * 10, relative, path)
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    let mut selections = Vec::new();
    let mut used = 0_usize;
    for (_, relative, path) in ranked.into_iter().take(max_files) {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.iter().take(8192).any(|byte| *byte == 0) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        let remaining = limit.saturating_sub(used);
        if remaining == 0 {
            break;
        }
        let original_len = content.len();
        let selected = if original_len <= remaining {
            content
        } else {
            content.chars().take(remaining).collect()
        };
        let truncated = selected.len() < original_len;
        let end_line = selected.lines().count().max(1);
        used = used.saturating_add(selected.len());
        selections.push((
            ContextReference {
                path: relative,
                start_line: 1,
                end_line,
                truncated,
            },
            selected,
        ));
        if truncated {
            break;
        }
    }
    Ok(selections)
}

#[tauri::command]
fn preview_project_context(root: String, prompt: String) -> Result<Vec<ContextReference>, String> {
    Ok(relevant_context_selections(&root, &prompt, 48 * 1024, 6)?
        .into_iter()
        .map(|(reference, _)| reference)
        .collect())
}

#[tauri::command]
fn apply_ai_changes(root: String, changes: Vec<AiFileChange>) -> Result<Vec<String>, String> {
    if changes.is_empty() || changes.len() > 20 {
        return Err("La propuesta debe contener entre 1 y 20 archivos.".into());
    }
    if changes
        .iter()
        .map(|change| change.content.len())
        .sum::<usize>()
        > 2 * 1024 * 1024
    {
        return Err("La propuesta supera el límite seguro de 2 MB.".into());
    }
    let root = clean_root(&root)?;
    let mut prepared = Vec::new();
    for change in changes {
        if change.path.trim().is_empty() {
            return Err("La propuesta contiene una ruta vacía.".into());
        }
        let candidate = root.join(Path::new(&change.path));
        let destination = if candidate.exists() {
            let path = existing_project_path(&root, &change.path)?;
            if !path.is_file() {
                return Err(format!("‘{}’ no es un archivo.", change.path));
            }
            path
        } else {
            new_project_path(&root, &change.path)?
        };
        prepared.push((change.path, destination, change.content));
    }
    let mut applied = Vec::new();
    for (relative, destination, content) in prepared {
        let parent = destination
            .parent()
            .ok_or_else(|| "No se pudo determinar la carpeta de destino.".to_string())?;
        let mut temporary = NamedTempFile::new_in(parent)
            .map_err(|error| format!("No se pudo preparar el cambio: {error}"))?;
        temporary
            .write_all(content.as_bytes())
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| format!("No se pudo escribir ‘{relative}’: {error}"))?;
        temporary
            .persist(&destination)
            .map_err(|error| format!("No se pudo aplicar ‘{relative}’: {}", error.error))?;
        applied.push(relative);
    }
    Ok(applied)
}

fn ensure_ai_action_allowed(root: &Path, relative: &str, is_directory: bool) -> Result<(), String> {
    let relative_path = Path::new(relative);
    reject_unsafe_components(relative_path)?;
    for component in relative_path.components() {
        if let Component::Normal(value) = component {
            let name = value.to_string_lossy();
            if ALWAYS_IGNORED
                .iter()
                .any(|ignored| ignored.eq_ignore_ascii_case(&name))
            {
                return Err(format!(
                    "Vareliox no puede modificar ‘{relative}’ porque está protegido o ignorado."
                ));
            }
        }
    }
    let candidate = root.join(relative_path);
    if is_ignored(root, &candidate, is_directory, &gitignore_for(root)) {
        return Err(format!(
            "Vareliox no puede modificar ‘{relative}’ porque está excluido por .gitignore."
        ));
    }
    Ok(())
}

fn validate_planned_project_path(root: &Path, relative: &str) -> Result<(), String> {
    let relative_path = Path::new(relative);
    reject_unsafe_components(relative_path)?;
    let mut current = root.to_path_buf();
    let mut existing_prefix = PathBuf::new();
    for component in relative_path.components() {
        if let Component::Normal(part) = component {
            let name = part.to_str().ok_or_else(|| {
                "La ruta contiene un nombre no compatible con Windows.".to_string()
            })?;
            validate_name(name)?;
            current.push(part);
            existing_prefix.push(part);
            if current.exists() {
                existing_project_path(root, &existing_prefix.to_string_lossy())?;
            }
        }
    }
    Ok(())
}

fn recovery_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn recovery_project_dir(app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    let project_id = hex::encode(hasher.finalize());
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo localizar la carpeta de recuperación: {error}"))?
        .join("recovery")
        .join(&project_id[..24]);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo preparar la recuperación: {error}"))?;
    Ok(directory)
}

fn remove_any(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("No se pudo inspeccionar ‘{}’: {error}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err("La recuperación rechazó un enlace simbólico inesperado.".into());
    }
    if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
    .map_err(|error| format!("No se pudo limpiar ‘{}’: {error}", path.display()))
}

fn copy_for_recovery(
    source: &Path,
    destination: &Path,
    bytes: &mut u64,
    entries: &mut usize,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("No se pudo preparar la copia de recuperación: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("La recuperación no copia enlaces simbólicos.".into());
    }
    *entries += 1;
    if *entries > MAX_RECOVERY_ENTRIES {
        return Err(
            "La operación afecta demasiados elementos para crear una recuperación segura.".into(),
        );
    }
    if metadata.is_dir() {
        fs::create_dir_all(destination)
            .map_err(|error| format!("No se pudo crear la copia de recuperación: {error}"))?;
        for entry in fs::read_dir(source)
            .map_err(|error| format!("No se pudo leer la carpeta para recuperarla: {error}"))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_for_recovery(
                &entry.path(),
                &destination.join(entry.file_name()),
                bytes,
                entries,
            )?;
        }
    } else {
        *bytes = bytes.saturating_add(metadata.len());
        if *bytes > MAX_RECOVERY_BYTES {
            return Err("La copia de recuperación superaría el límite seguro de 50 MB.".into());
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("No se pudo preparar la copia de recuperación: {error}")
            })?;
        }
        fs::copy(source, destination)
            .map_err(|error| format!("No se pudo copiar ‘{}’: {error}", source.display()))?;
    }
    Ok(())
}

fn create_recovery_snapshot(
    project_dir: &Path,
    root: &Path,
    actions: &[AiProjectAction],
) -> Result<(RecoveryManifest, PathBuf), String> {
    let created_at = recovery_now();
    let id = format!("{created_at}-{}", std::process::id());
    let snapshot_dir = project_dir.join(&id);
    let files_dir = snapshot_dir.join("files");
    fs::create_dir_all(&files_dir)
        .map_err(|error| format!("No se pudo crear la recuperación: {error}"))?;
    let mut bytes = 0_u64;
    let mut copied_entries = 0_usize;
    let mut recovery_entries = Vec::with_capacity(actions.len());
    for action in actions {
        let source = root.join(Path::new(&action.path));
        let original_kind = if source.exists() {
            let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err(
                    "No se puede crear una recuperación a través de enlaces simbólicos.".into(),
                );
            }
            copy_for_recovery(
                &source,
                &files_dir.join(Path::new(&action.path)),
                &mut bytes,
                &mut copied_entries,
            )?;
            if metadata.is_dir() {
                "directory"
            } else {
                "file"
            }
        } else {
            "missing"
        };
        recovery_entries.push(RecoveryEntry {
            action_type: action.action_type.clone(),
            path: action.path.clone(),
            new_path: action.new_path.clone(),
            original_kind: original_kind.into(),
        });
    }
    let manifest = RecoveryManifest {
        id,
        project_root: root.to_string_lossy().to_string(),
        created_at,
        entries: recovery_entries,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("No se pudo describir la recuperación: {error}"))?;
    fs::write(snapshot_dir.join("manifest.json"), manifest_bytes)
        .map_err(|error| format!("No se pudo guardar la recuperación: {error}"))?;
    prune_recovery_snapshots(project_dir, 20);
    Ok((manifest, snapshot_dir))
}

fn prune_recovery_snapshots(project_dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(project_dir) else {
        return;
    };
    let mut snapshots = entries
        .flatten()
        .filter(|entry| entry.path().join("manifest.json").is_file())
        .collect::<Vec<_>>();
    snapshots.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    for entry in snapshots.into_iter().skip(keep) {
        let _ = fs::remove_dir_all(entry.path());
    }
}

fn restore_recovery_snapshot(
    root: &Path,
    snapshot_dir: &Path,
    manifest: &RecoveryManifest,
) -> Result<Vec<String>, String> {
    if manifest.project_root != root.to_string_lossy() {
        return Err("La recuperación pertenece a otro proyecto.".into());
    }
    let files_dir = snapshot_dir.join("files");
    let mut restored = Vec::new();
    for entry in manifest.entries.iter().rev() {
        if let Some(new_path) = entry.new_path.as_deref() {
            remove_any(&root.join(Path::new(new_path)))?;
        }
        let destination = root.join(Path::new(&entry.path));
        remove_any(&destination)?;
        if entry.original_kind != "missing" {
            copy_for_recovery(
                &files_dir.join(Path::new(&entry.path)),
                &destination,
                &mut 0_u64,
                &mut 0_usize,
            )?;
        }
        restored.push(entry.path.clone());
    }
    Ok(restored)
}

fn append_action_log(project_dir: &Path, manifest: &RecoveryManifest, status: &str) {
    let summary = manifest
        .entries
        .iter()
        .map(|entry| {
            serde_json::json!({
                "type": entry.action_type,
                "path": entry.path,
                "newPath": entry.new_path,
            })
        })
        .collect::<Vec<_>>();
    let line = serde_json::json!({
        "snapshotId": manifest.id,
        "createdAt": manifest.created_at,
        "status": status,
        "operations": summary,
    });
    let log_path = project_dir.join("actions.jsonl");
    if fs::metadata(&log_path)
        .map(|metadata| metadata.len() > 2 * 1024 * 1024)
        .unwrap_or(false)
    {
        let previous = project_dir.join("actions.previous.jsonl");
        let _ = fs::remove_file(&previous);
        let _ = fs::rename(&log_path, previous);
    }
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(file, "{line}");
    }
}

#[tauri::command]
fn list_recovery_snapshots(
    app: AppHandle,
    root: String,
) -> Result<Vec<RecoverySnapshotInfo>, String> {
    let root = clean_root(&root)?;
    let project_dir = recovery_project_dir(&app, &root)?;
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(project_dir)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let manifest_path = entry.path().join("manifest.json");
        let Ok(bytes) = fs::read(manifest_path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_slice::<RecoveryManifest>(&bytes) else {
            continue;
        };
        if manifest.project_root != root.to_string_lossy() {
            continue;
        }
        snapshots.push(RecoverySnapshotInfo {
            id: manifest.id,
            created_at: manifest.created_at,
            action_count: manifest.entries.len(),
            summary: manifest
                .entries
                .iter()
                .map(|item| format!("{}: {}", item.action_type, item.path))
                .collect(),
        });
    }
    snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    snapshots.truncate(20);
    Ok(snapshots)
}

#[tauri::command]
fn restore_recovery(
    app: AppHandle,
    root: String,
    snapshot_id: String,
) -> Result<Vec<String>, String> {
    if snapshot_id.is_empty()
        || !snapshot_id
            .chars()
            .all(|character| character.is_ascii_digit() || character == '-')
    {
        return Err("El identificador de recuperación no es válido.".into());
    }
    let root = clean_root(&root)?;
    let project_dir = recovery_project_dir(&app, &root)?;
    let snapshot_dir = project_dir.join(&snapshot_id);
    let manifest: RecoveryManifest = serde_json::from_slice(
        &fs::read(snapshot_dir.join("manifest.json"))
            .map_err(|_| "No se encontró la recuperación seleccionada.".to_string())?,
    )
    .map_err(|_| "La recuperación está dañada.".to_string())?;
    let restored = restore_recovery_snapshot(&root, &snapshot_dir, &manifest)?;
    append_action_log(&project_dir, &manifest, "restored");
    Ok(restored)
}

#[tauri::command]
fn apply_ai_actions(
    app: AppHandle,
    root: String,
    actions: Vec<AiProjectAction>,
) -> Result<Vec<String>, String> {
    let canonical_root = clean_root(&root)?;
    let project_recovery_dir = recovery_project_dir(&app, &canonical_root)?;
    apply_ai_actions_inner(
        canonical_root.to_string_lossy().to_string(),
        actions,
        project_recovery_dir,
    )
}

fn apply_ai_actions_inner(
    root: String,
    actions: Vec<AiProjectAction>,
    project_recovery_dir: PathBuf,
) -> Result<Vec<String>, String> {
    if actions.is_empty() || actions.len() > 500 {
        return Err("La propuesta debe contener entre 1 y 500 operaciones.".into());
    }
    let payload_size = actions
        .iter()
        .filter_map(|action| action.content.as_ref())
        .map(String::len)
        .sum::<usize>();
    if payload_size > 8 * 1024 * 1024 {
        return Err("Las operaciones superan el límite seguro de 8 MB.".into());
    }
    let root = clean_root(&root)?;
    let actions = expand_actions_for_parent_directories(&root, actions)?;
    if actions.len() > 500 {
        return Err(
            "La propuesta necesita demasiadas carpetas para aplicarse de forma segura.".into(),
        );
    }
    let mut planned_paths = HashSet::new();
    for action in &actions {
        let kind = action.action_type.as_str();
        ensure_ai_action_allowed(&root, &action.path, kind == "mkdir")?;
        match kind {
            "write" => {
                let candidate = root.join(Path::new(&action.path));
                if candidate.exists() {
                    existing_project_path(&root, &action.path)?;
                } else {
                    validate_planned_project_path(&root, &action.path)?;
                }
                planned_paths.insert(action.path.clone());
            }
            "mkdir" => {
                validate_planned_project_path(&root, &action.path)?;
                planned_paths.insert(action.path.clone());
            }
            "rename" => {
                if root.join(Path::new(&action.path)).exists() {
                    existing_project_path(&root, &action.path)?;
                } else if !planned_paths.contains(&action.path) {
                    return Err(format!(
                        "No se encontrÃ³ â€˜{}â€™ dentro del proyecto.",
                        action.path
                    ));
                }
                let new_path = action
                    .new_path
                    .as_deref()
                    .ok_or_else(|| format!("Falta el destino para renombrar ‘{}’.", action.path))?;
                ensure_ai_action_allowed(&root, new_path, false)?;
                validate_planned_project_path(&root, new_path)?;
                planned_paths.remove(&action.path);
                planned_paths.insert(new_path.to_string());
            }
            "delete" => {
                if root.join(Path::new(&action.path)).exists() {
                    existing_project_path(&root, &action.path)?;
                } else if !planned_paths.contains(&action.path) {
                    return Err(format!(
                        "No se encontrÃ³ â€˜{}â€™ dentro del proyecto.",
                        action.path
                    ));
                }
                planned_paths.remove(&action.path);
            }
            _ => return Err(format!("Operación desconocida: ‘{}’.", action.action_type)),
        }
    }
    let (manifest, snapshot_dir) =
        create_recovery_snapshot(&project_recovery_dir, &root, &actions)?;
    let result = (|| -> Result<Vec<String>, String> {
        let mut applied = Vec::new();
        for action in actions {
            let kind = action.action_type.as_str();
            match kind {
                "write" => {
                    let content = action
                        .content
                        .ok_or_else(|| format!("Falta el contenido para ‘{}’.", action.path))?;
                    let candidate = root.join(Path::new(&action.path));
                    let destination = if candidate.exists() {
                        existing_project_path(&root, &action.path)?
                    } else {
                        new_project_path(&root, &action.path)?
                    };
                    if destination.exists() && !destination.is_file() {
                        return Err(format!("‘{}’ no es un archivo.", action.path));
                    }
                    let parent = destination.parent().ok_or_else(|| {
                        "No se pudo determinar la carpeta de destino.".to_string()
                    })?;
                    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| {
                        format!("No se pudo preparar ‘{}’: {error}", action.path)
                    })?;
                    temporary
                        .write_all(content.as_bytes())
                        .and_then(|_| temporary.as_file().sync_all())
                        .map_err(|error| {
                            format!("No se pudo escribir ‘{}’: {error}", action.path)
                        })?;
                    temporary.persist(&destination).map_err(|error| {
                        format!("No se pudo aplicar ‘{}’: {}", action.path, error.error)
                    })?;
                    applied.push(action.path);
                }
                "mkdir" => {
                    let destination = new_project_path(&root, &action.path)?;
                    if destination.exists() {
                        return Err(format!("‘{}’ ya existe.", action.path));
                    }
                    fs::create_dir(&destination).map_err(|error| {
                        format!("No se pudo crear la carpeta ‘{}’: {error}", action.path)
                    })?;
                    applied.push(action.path);
                }
                "rename" => {
                    let new_path = action.new_path.ok_or_else(|| {
                        format!("Falta el destino para renombrar ‘{}’.", action.path)
                    })?;
                    ensure_ai_action_allowed(&root, &new_path, false)?;
                    let source = existing_project_path(&root, &action.path)?;
                    let destination = new_project_path(&root, &new_path)?;
                    if destination.exists() {
                        return Err(format!("‘{new_path}’ ya existe."));
                    }
                    fs::rename(&source, &destination)
                        .map_err(|error| format!("No se pudo mover ‘{}’: {error}", action.path))?;
                    applied.push(new_path);
                }
                "delete" => {
                    let target = existing_project_path(&root, &action.path)?;
                    if target == root {
                        return Err(
                            "Vareliox no puede eliminar la carpeta raíz del proyecto.".into()
                        );
                    }
                    if target.is_dir() {
                        fs::remove_dir_all(&target).map_err(|error| {
                            format!("No se pudo eliminar ‘{}’: {error}", action.path)
                        })?;
                    } else {
                        fs::remove_file(&target).map_err(|error| {
                            format!("No se pudo eliminar ‘{}’: {error}", action.path)
                        })?;
                    }
                    applied.push(action.path);
                }
                _ => return Err(format!("Operación desconocida: ‘{}’.", action.action_type)),
            }
        }
        Ok(applied)
    })();
    match result {
        Ok(applied) => {
            append_action_log(&project_recovery_dir, &manifest, "applied");
            Ok(applied)
        }
        Err(error) => {
            let rollback = restore_recovery_snapshot(&root, &snapshot_dir, &manifest);
            append_action_log(
                &project_recovery_dir,
                &manifest,
                if rollback.is_ok() {
                    "rolled_back"
                } else {
                    "rollback_failed"
                },
            );
            match rollback {
                Ok(_) => Err(format!(
                    "{error} Los cambios parciales se restauraron automáticamente."
                )),
                Err(restore_error) => Err(format!(
                    "{error} La recuperación automática también falló: {restore_error}"
                )),
            }
        }
    }
}

fn expand_actions_for_parent_directories(
    root: &Path,
    actions: Vec<AiProjectAction>,
) -> Result<Vec<AiProjectAction>, String> {
    let mut missing_directories = BTreeSet::new();
    for action in &actions {
        let target = match action.action_type.as_str() {
            "write" | "mkdir" => Some(action.path.as_str()),
            "rename" => action.new_path.as_deref(),
            _ => None,
        };
        let Some(target) = target else { continue };
        let relative = Path::new(target);
        reject_unsafe_components(relative)?;
        for directory in relative.ancestors().skip(1) {
            if directory.as_os_str().is_empty() {
                break;
            }
            let directory = directory.to_string_lossy().replace('\\', "/");
            if root.join(&directory).exists() {
                existing_project_path(root, &directory)?;
            } else {
                ensure_ai_action_allowed(root, &directory, true)?;
                validate_planned_project_path(root, &directory)?;
                missing_directories.insert(directory);
            }
        }
    }
    let mut generated = missing_directories.into_iter().collect::<Vec<_>>();
    generated.sort_by(|left, right| {
        Path::new(left)
            .components()
            .count()
            .cmp(&Path::new(right).components().count())
            .then_with(|| left.cmp(right))
    });
    let generated_set = generated.iter().cloned().collect::<HashSet<_>>();
    let mut expanded = generated
        .into_iter()
        .map(|path| AiProjectAction {
            action_type: "mkdir".into(),
            path,
            content: None,
            new_path: None,
        })
        .collect::<Vec<_>>();
    expanded.extend(
        actions.into_iter().filter(|action| {
            action.action_type != "mkdir" || !generated_set.contains(&action.path)
        }),
    );
    Ok(expanded)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    linux_compat::configure_webview_runtime();
    tauri::Builder::default()
        .manage(ai::AiState::default())
        .manage(agent::AgentRuntime::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_project,
            scan_project,
            read_project_file,
            write_project_file,
            create_project_item,
            rename_project_item,
            delete_project_item,
            load_chat_attachment,
            preview_project_context,
            apply_ai_changes,
            apply_ai_actions,
            list_recovery_snapshots,
            restore_recovery,
            ai::get_ai_settings,
            ai::save_ai_settings,
            ai::set_provider_key,
            ai::delete_provider_key,
            ai::list_ai_models,
            ai::generate_media,
            ai::list_media_models,
            ai::persist_legacy_media,
            ai::save_media_to_project,
            ai::export_media,
            ai::media_storage_stats,
            ai::cleanup_orphaned_media,
            ai::search_web,
            ai::list_local_model_catalog,
            ai::local_media::list_local_media_models,
            ai::installed_models::list_installed_local_models,
            ai::installed_models::remove_installed_local_model,
            ai::local_media::download_local_media_model,
            ai::download_local_model,
            ai::download_comfyui_model,
            ai::open_comfyui_desktop,
            ai::test_ai_provider,
            ai::start_lm_studio_server,
            ai::chat_ai,
            ai::cancel_ai_chat,
            agent::list_agent_tools,
            agent::detect_project_commands,
            agent::run_agent_command,
            agent::cancel_agent_command,
            git::git_status,
            git::git_diff,
            git::git_commit,
            git::git_discard_changes,
            system::inspect_hardware,
            system::list_computer_roots,
            updates::check_for_updates,
            updates::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_file_lifecycle_stays_inside_root() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().to_string_lossy().to_string();

        create_project_item(root.clone(), "src".into(), true).unwrap();
        create_project_item(root.clone(), "src/main.rs".into(), false).unwrap();
        write_project_file(root.clone(), "src/main.rs".into(), "fn main() {}\n".into()).unwrap();

        let file = read_project_file(root.clone(), "src/main.rs".into()).unwrap();
        assert_eq!(file.content, "fn main() {}\n");

        rename_project_item(root.clone(), "src/main.rs".into(), "lib.rs".into()).unwrap();
        assert!(read_project_file(root.clone(), "src/lib.rs".into()).is_ok());
        assert!(read_project_file(root.clone(), "../outside.txt".into()).is_err());

        delete_project_item(root.clone(), "src/lib.rs".into()).unwrap();
        assert!(read_project_file(root, "src/lib.rs".into()).is_err());
    }

    #[test]
    fn scan_honors_default_and_gitignore_rules() {
        let temporary = tempfile::tempdir().unwrap();
        fs::create_dir(temporary.path().join("node_modules")).unwrap();
        fs::write(temporary.path().join("node_modules/hidden.js"), "hidden").unwrap();
        fs::write(temporary.path().join(".gitignore"), "secret.txt\n").unwrap();
        fs::write(temporary.path().join("secret.txt"), "secret").unwrap();
        fs::write(temporary.path().join("visible.txt"), "visible").unwrap();

        let nodes = scan_project(temporary.path().to_string_lossy().to_string()).unwrap();
        assert!(nodes.iter().any(|node| node.name == "visible.txt"));
        assert!(!nodes.iter().any(|node| node.name == "secret.txt"));
        assert!(!nodes.iter().any(|node| node.name == "node_modules"));
    }

    #[test]
    fn compact_context_keeps_structure_and_prioritizes_matching_files() {
        let temporary = tempfile::tempdir().unwrap();
        fs::create_dir(temporary.path().join("node_modules")).unwrap();
        fs::write(temporary.path().join("node_modules/hidden.js"), "hidden").unwrap();
        fs::write(temporary.path().join("index.html"), "<main>Login</main>").unwrap();
        fs::write(
            temporary.path().join("styles.css"),
            ".login { color: blue; }",
        )
        .unwrap();
        let root = temporary.path().to_string_lossy().to_string();
        let tree = project_context_tree(&root, 2_000).unwrap();
        let context =
            project_context_relevant_snapshot(&root, "mejora el CSS del login", 2_000, 2).unwrap();
        assert!(tree.contains("index.html"));
        assert!(!tree.contains("node_modules"));
        assert!(context.contains("styles.css"));
    }

    #[test]
    fn rejects_windows_reserved_and_unsafe_names() {
        if cfg!(target_os = "windows") {
            assert!(validate_name("CON").is_err());
            assert!(validate_name("bad?.txt").is_err());
        } else {
            assert!(validate_name("CON").is_ok());
            assert!(validate_name("bad?.txt").is_ok());
        }
        assert!(reject_unsafe_components(Path::new("../escape.txt")).is_err());
        assert!(validate_name("safe-file.ts").is_ok());
    }

    #[test]
    fn ai_changes_require_safe_project_relative_paths() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().to_string_lossy().to_string();
        fs::write(temporary.path().join("safe.txt"), "before").unwrap();
        let applied = apply_ai_changes(
            root.clone(),
            vec![AiFileChange {
                path: "safe.txt".into(),
                content: "after".into(),
            }],
        )
        .unwrap();
        assert_eq!(applied, vec!["safe.txt"]);
        assert_eq!(
            fs::read_to_string(temporary.path().join("safe.txt")).unwrap(),
            "after"
        );
        assert!(apply_ai_changes(
            root,
            vec![AiFileChange {
                path: "../escape.txt".into(),
                content: "blocked".into()
            }]
        )
        .is_err());
    }

    #[test]
    fn ai_actions_create_folders_files_rename_and_delete_inside_project() {
        let temporary = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        let root = temporary.path().to_string_lossy().to_string();
        let applied = apply_ai_actions_inner(
            root.clone(),
            vec![
                AiProjectAction {
                    action_type: "mkdir".into(),
                    path: "src".into(),
                    content: None,
                    new_path: None,
                },
                AiProjectAction {
                    action_type: "write".into(),
                    path: "src/index.html".into(),
                    content: Some("<h1>Vareliox</h1>".into()),
                    new_path: None,
                },
                AiProjectAction {
                    action_type: "rename".into(),
                    path: "src/index.html".into(),
                    content: None,
                    new_path: Some("src/home.html".into()),
                },
            ],
            recovery.path().to_path_buf(),
        )
        .unwrap();
        assert_eq!(applied.len(), 3);
        assert_eq!(
            fs::read_to_string(temporary.path().join("src/home.html")).unwrap(),
            "<h1>Vareliox</h1>"
        );
        apply_ai_actions_inner(
            root.clone(),
            vec![AiProjectAction {
                action_type: "delete".into(),
                path: "src/home.html".into(),
                content: None,
                new_path: None,
            }],
            recovery.path().to_path_buf(),
        )
        .unwrap();
        assert!(!temporary.path().join("src/home.html").exists());
        assert!(apply_ai_actions_inner(
            root.clone(),
            vec![AiProjectAction {
                action_type: "write".into(),
                path: "../escape.txt".into(),
                content: Some("blocked".into()),
                new_path: None
            }],
            recovery.path().to_path_buf(),
        )
        .is_err());
        assert!(apply_ai_actions_inner(
            root,
            vec![AiProjectAction {
                action_type: "mkdir".into(),
                path: ".git/hooks".into(),
                content: None,
                new_path: None
            }],
            recovery.path().to_path_buf(),
        )
        .is_err());
    }

    #[test]
    fn agent_write_creates_missing_safe_parent_directories() {
        let temporary = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        let root = temporary.path().to_string_lossy().to_string();
        let applied = apply_ai_actions_inner(
            root,
            vec![AiProjectAction {
                action_type: "write".into(),
                path: "src/pages/login.html".into(),
                content: Some("<h1>Login</h1>".into()),
                new_path: None,
            }],
            recovery.path().to_path_buf(),
        )
        .unwrap();
        assert_eq!(
            applied,
            vec![
                "src".to_string(),
                "src/pages".to_string(),
                "src/pages/login.html".to_string()
            ]
        );
        assert_eq!(
            fs::read_to_string(temporary.path().join("src/pages/login.html")).unwrap(),
            "<h1>Login</h1>"
        );
    }

    #[test]
    fn agent_changes_can_be_restored_without_logging_file_contents() {
        let temporary = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        let root = temporary.path().to_string_lossy().to_string();
        fs::write(temporary.path().join("existing.txt"), "before").unwrap();

        apply_ai_actions_inner(
            root.clone(),
            vec![
                AiProjectAction {
                    action_type: "write".into(),
                    path: "existing.txt".into(),
                    content: Some("private-content-after".into()),
                    new_path: None,
                },
                AiProjectAction {
                    action_type: "write".into(),
                    path: "created.txt".into(),
                    content: Some("new-private-content".into()),
                    new_path: None,
                },
            ],
            recovery.path().to_path_buf(),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(temporary.path().join("existing.txt")).unwrap(),
            "private-content-after"
        );
        let snapshot_dir = fs::read_dir(recovery.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| path.join("manifest.json").is_file())
            .unwrap();
        let manifest: RecoveryManifest =
            serde_json::from_slice(&fs::read(snapshot_dir.join("manifest.json")).unwrap()).unwrap();
        let canonical_root = clean_root(&root).unwrap();
        restore_recovery_snapshot(&canonical_root, &snapshot_dir, &manifest).unwrap();

        assert_eq!(
            fs::read_to_string(temporary.path().join("existing.txt")).unwrap(),
            "before"
        );
        assert!(!temporary.path().join("created.txt").exists());
        let log = fs::read_to_string(recovery.path().join("actions.jsonl")).unwrap();
        assert!(!log.contains("private-content-after"));
        assert!(!log.contains("new-private-content"));
    }

    #[test]
    fn large_project_context_stays_bounded_and_ignores_generated_folders() {
        let temporary = tempfile::tempdir().unwrap();
        fs::create_dir(temporary.path().join("src")).unwrap();
        fs::create_dir(temporary.path().join("node_modules")).unwrap();
        for index in 0..3_000 {
            fs::write(
                temporary
                    .path()
                    .join("src")
                    .join(format!("module-{index}.ts")),
                format!("export const module{index} = {index};\n"),
            )
            .unwrap();
        }
        fs::write(temporary.path().join("node_modules/hidden.js"), "hidden").unwrap();
        let root = temporary.path().to_string_lossy().to_string();
        let tree = project_context_tree(&root, 32 * 1024).unwrap();
        let snapshot =
            project_context_relevant_snapshot(&root, "module 2999", 12 * 1024, 6).unwrap();
        assert!(tree.len() <= 32 * 1024 + 64);
        assert!(!tree.contains("node_modules"));
        assert!(snapshot.len() <= 12 * 1024 + 512);
        assert!(snapshot.contains(":1-"));
    }
}
