//! Managed diffusion runtime: downloading a model also prepares its private engine.
//! No shell, global installation, Python environment or external server is used.
use super::{error::Diagnostic, types::*, AiState};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio_util::sync::CancellationToken;

const VERSION: &str = "master-929-3f8527a";
pub const IMAGE_MODEL: &str = "vareliox-sd15-q4";
pub const VIDEO_MODEL: &str = "vareliox-animatediff-v3";

#[derive(Clone, Copy)]
struct Asset {
    filename: &'static str,
    url: &'static str,
    hash: &'static str,
    size: u64,
}

const SD15: Asset = Asset {
    filename: "sd15-q4.gguf",
    url: "https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF/resolve/031b5f5df991f511b3f5fa8fed6d99048ababb69/stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf",
    hash: "b8944e9fe0b69b36ae1b5bb0185b3a7b8ef14347fe0fa9af6c64c4829022261f",
    size: 1_566_768_416,
};
const MOTION: Asset = Asset {
    filename: "animatediff-v3.safetensors",
    url: "https://huggingface.co/conrevo/AnimateDiff-A1111/resolve/aa4a0ef5bd366a0ec898e7a64b6fc0f612e37444/motion_module/mm_sd15_v3.safetensors",
    hash: "a8ca0eadb18c6ad6652bca344a458f31780901a87f765bf95a81ef9c5be55f29",
    size: 836_618_008,
};

fn runtime_asset() -> Result<Asset, Diagnostic> {
    if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok(Asset {
            filename: "runtime.zip",
            url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-929-3f8527a/sd-master-3f8527a-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip",
            hash: "e35cc73cf5ba9637d1dc1d717760e7b8428376a4905d57e72ec8c871864f62c7",
            size: 36_886_217,
        })
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Ok(Asset {
            filename: "runtime.zip",
            url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-929-3f8527a/sd-master-3f8527a-bin-win-cpu-x64.zip",
            hash: "5e7caca2080321b25a12c1fa4175cb7d953f2b182309f8f73bfc9c725231d26c",
            size: 17_486_440,
        })
    } else {
        Err(failure(
            "UNSUPPORTED_PLATFORM",
            "Motor local no disponible",
            "La descarga integrada de este motor todavía no está preparada para esta plataforma.",
        ))
    }
}

fn failure(code: &str, title: &str, detail: impl Into<String>) -> Diagnostic {
    Diagnostic::new(
        code,
        title,
        detail,
        "El motor local no completó la operación.",
        "Reintenta o revisa la biblioteca de modelos locales.",
        code != "CANCELLED",
    )
}
fn cancelled() -> Diagnostic {
    failure(
        "CANCELLED",
        "Creación o descarga cancelada",
        "El proceso local se detuvo a petición del usuario.",
    )
}
fn io_error(error: impl std::fmt::Display) -> Diagnostic {
    failure(
        "LOCAL_MEDIA_ERROR",
        "No se pudo preparar la IA local",
        error.to_string(),
    )
}
fn emit(events: &Channel<LocalModelDownloadEvent>, message: &str, progress: Option<u8>) {
    let _ = events.send(LocalModelDownloadEvent::Status {
        message: message.into(),
        progress,
    });
}

pub fn is_model(id: &str) -> bool {
    matches!(id, IMAGE_MODEL | VIDEO_MODEL)
}
fn files(id: &str) -> Result<Vec<Asset>, Diagnostic> {
    match id {
        IMAGE_MODEL => Ok(vec![SD15]),
        VIDEO_MODEL => Ok(vec![SD15, MOTION]),
        _ => Err(failure(
            "MODEL_NOT_FOUND",
            "Modelo local desconocido",
            "Elige un modelo de la biblioteca de Vareliox.",
        )),
    }
}

pub fn catalog() -> Vec<LocalModelCatalogItem> {
    if runtime_asset().is_err() {
        return vec![];
    }
    [(IMAGE_MODEL, "Stable Diffusion 1.5 · Q4", "Stable Diffusion", "Crea imágenes en este equipo. Descargar prepara automáticamente el motor de Vareliox.", "Imagen", "1.57 GB + motor", "image", vec!["Texto a imagen", "Sin servidor externo"]),
     (VIDEO_MODEL, "AnimateDiff v3", "AnimateDiff", "Crea clips cortos desde texto o anima una imagen. Incluye su modelo base y el motor local.", "Animación", "2.40 GB + motor", "video", vec!["Texto a vídeo", "Imagen a vídeo"])]
        .into_iter().map(|(id, name, family, description, parameters, size, category, capabilities)| LocalModelCatalogItem {
            id: id.into(), name: name.into(), family: family.into(), description: description.into(), parameters: parameters.into(), size: size.into(),
            ollama_id: String::new(), lm_studio_id: String::new(), recommended: true, category: category.into(),
            capabilities: capabilities.into_iter().map(String::from).collect(), runtimes: vec!["vareliox".into()], guide_url: None,
        }).collect()
}

fn root(app: &AppHandle) -> Result<PathBuf, Diagnostic> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(io_error)?
        .join("local-media");
    safe_directory(&dir)?;
    Ok(dir)
}
fn safe_directory(dir: &Path) -> Result<(), Diagnostic> {
    fs::create_dir_all(dir).map_err(io_error)?;
    if fs::symlink_metadata(dir)
        .map_err(io_error)?
        .file_type()
        .is_symlink()
    {
        return Err(io_error(
            "La carpeta del motor local es un enlace simbólico.",
        ));
    }
    Ok(())
}
fn executable(dir: &Path) -> PathBuf {
    dir.join(if cfg!(target_os = "windows") {
        "sd-cli.exe"
    } else {
        "sd-cli"
    })
}
fn runtime_directory(root: &Path) -> PathBuf {
    root.join(VERSION)
}
fn installed_asset(root: &Path, asset: Asset) -> bool {
    let target = root.join(asset.filename);
    fs::symlink_metadata(&target).is_ok_and(|meta| {
        meta.is_file() && !meta.file_type().is_symlink() && meta.len() == asset.size
    }) && fs::read_to_string(root.join(format!("{}.sha256", asset.filename)))
        .is_ok_and(|hash| hash == asset.hash)
}
fn runtime_ready(root: &Path) -> bool {
    let dir = runtime_directory(root);
    !fs::symlink_metadata(&dir).is_ok_and(|meta| meta.file_type().is_symlink())
        && fs::symlink_metadata(executable(&dir))
            .is_ok_and(|meta| meta.is_file() && !meta.file_type().is_symlink())
        && fs::read_to_string(dir.join(".ready")).is_ok_and(|version| version == VERSION)
}

#[tauri::command]
pub fn list_local_media_models(app: AppHandle) -> Result<Vec<ModelInfo>, Diagnostic> {
    let root = root(&app)?;
    if !runtime_ready(&root) {
        return Ok(vec![]);
    }
    Ok(catalog()
        .into_iter()
        .filter(|model| {
            !root.join(format!("{}.disabled", model.id)).exists()
                && files(&model.id)
                    .is_ok_and(|items| items.into_iter().all(|asset| installed_asset(&root, asset)))
        })
        .map(|model| ModelInfo {
            id: model.id,
            name: model.name,
            loaded: Some(true),
            context_window: None,
            capabilities: vec![model.category],
        })
        .collect())
}

pub(super) fn remove_model(app: &AppHandle, id: &str) -> Result<(), Diagnostic> {
    remove_model_at(&root(app)?, id)
}

fn remove_model_at(root: &Path, id: &str) -> Result<(), Diagnostic> {
    files(id)?; // Only fixed catalog filenames may be removed, never caller paths.
    safe_directory(root)?;
    let marker = root.join(format!("{id}.disabled"));
    if fs::symlink_metadata(&marker).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(io_error("El marcador del modelo es un enlace simbólico."));
    }
    fs::write(marker, b"removed by user").map_err(io_error)?;
    let assets = if id == VIDEO_MODEL {
        let mut assets = vec![MOTION];
        if root.join(format!("{IMAGE_MODEL}.disabled")).exists() {
            assets.push(SD15);
        }
        assets
    } else if root.join(MOTION.filename).exists() {
        vec![] // AnimateDiff still needs the base weights.
    } else {
        vec![SD15]
    };
    for asset in assets {
        for name in [
            asset.filename.to_string(),
            format!("{}.sha256", asset.filename),
        ] {
            let path = root.join(name);
            if fs::symlink_metadata(&path).is_ok() {
                fs::remove_file(path).map_err(io_error)?;
            }
        }
    }
    Ok(())
}

async fn download(
    root: &Path,
    asset: Asset,
    client: &reqwest::Client,
    token: &CancellationToken,
    events: &Channel<LocalModelDownloadEvent>,
) -> Result<PathBuf, Diagnostic> {
    let destination = root.join(asset.filename);
    if installed_asset(root, asset) {
        return Ok(destination);
    }
    emit(events, &format!("Descargando {}…", asset.filename), Some(0));
    let response = tokio::select! {
        _ = token.cancelled() => return Err(cancelled()),
        response = tokio::time::timeout(Duration::from_secs(30), client.get(asset.url).send()) => response.map_err(|_| failure("REQUEST_TIMEOUT", "La descarga no pudo iniciar", "El servidor no respondió en 30 segundos."))?.map_err(io_error)?.error_for_status().map_err(io_error)?,
    };
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(io_error)?;
    let mut stream = response.bytes_stream();
    let mut hash = Sha256::new();
    let mut received = 0u64;
    let mut last_progress = 0;
    loop {
        let chunk = tokio::select! {
            _ = token.cancelled() => return Err(cancelled()),
            next = tokio::time::timeout(Duration::from_secs(90), stream.next()) => next.map_err(|_| failure("REQUEST_TIMEOUT", "La descarga se interrumpió", "No llegaron datos del servidor durante 90 segundos."))?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk.map_err(io_error)?;
        received += chunk.len() as u64;
        if received > asset.size {
            return Err(io_error(
                "El tamaño descargado no coincide con el catálogo.",
            ));
        }
        hash.update(&chunk);
        temporary.write_all(&chunk).map_err(io_error)?;
        let progress = ((received * 100) / asset.size) as u8;
        if progress != last_progress {
            emit(
                events,
                &format!("Descargando {}…", asset.filename),
                Some(progress),
            );
            last_progress = progress;
        }
    }
    if received != asset.size || hex::encode(hash.finalize()) != asset.hash {
        return Err(failure(
            "DOWNLOAD_INVALID",
            "Descarga no válida",
            "El archivo no coincide con el tamaño y la firma SHA-256 publicados. No se activó.",
        ));
    }
    temporary.as_file().sync_all().map_err(io_error)?;
    temporary.persist(&destination).map_err(io_error)?;
    fs::write(root.join(format!("{}.sha256", asset.filename)), asset.hash).map_err(io_error)?;
    Ok(destination)
}

fn unpack_runtime(archive: &Path, destination: &Path) -> Result<(), Diagnostic> {
    let mut archive =
        zip::ZipArchive::new(fs::File::open(archive).map_err(io_error)?).map_err(io_error)?;
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(io_error)?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| io_error("El paquete del motor contiene una ruta no válida."))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(io_error(
                "El paquete del motor contiene un enlace simbólico.",
            ));
        }
        let path = destination.join(relative);
        total += entry.size();
        if total > 500_000_000 || archive_entry_too_deep(&path, destination) {
            return Err(io_error("El paquete del motor supera sus límites."));
        }
        if entry.is_dir() {
            safe_directory(&path)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            safe_directory(parent)?;
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(io_error)?;
        std::io::copy(&mut entry, &mut output).map_err(io_error)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(executable(destination), fs::Permissions::from_mode(0o755))
            .map_err(io_error)?;
    }
    Ok(())
}
fn archive_entry_too_deep(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root)
        .map_or(true, |relative| relative.components().count() > 8)
}

fn engine_command(runtime: &Path) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(executable(runtime));
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000);
    command
}

async fn install(
    root: &Path,
    id: &str,
    token: &CancellationToken,
    events: &Channel<LocalModelDownloadEvent>,
) -> Result<(), Diagnostic> {
    if token.is_cancelled() {
        return Err(cancelled());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .user_agent("Vareliox local media")
        .build()
        .map_err(io_error)?;
    if !runtime_ready(root) {
        let archive = download(root, runtime_asset()?, &client, token, events).await?;
        emit(events, "Preparando el motor multimedia de Vareliox…", None);
        let temporary = tempfile::tempdir_in(root).map_err(io_error)?;
        unpack_runtime(&archive, temporary.path())?;
        let output = tokio::select! {
            _ = token.cancelled() => return Err(cancelled()),
            result = tokio::time::timeout(Duration::from_secs(20), engine_command(temporary.path()).arg("--help").output()) => result.map_err(|_| io_error("El motor no pudo iniciar en este equipo."))?.map_err(io_error)?,
        };
        if !output.status.success() {
            return Err(failure(
                "RUNTIME_UNAVAILABLE",
                "El motor no es compatible con este equipo",
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }
        fs::write(temporary.path().join(".ready"), VERSION).map_err(io_error)?;
        let destination = runtime_directory(root);
        if destination.exists() {
            if fs::symlink_metadata(&destination)
                .map_err(io_error)?
                .file_type()
                .is_symlink()
            {
                return Err(io_error("La instalación del motor es un enlace simbólico."));
            }
            // Preserve a broken installation rather than requiring manual cleanup.
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(io_error)?
                .as_nanos();
            let backup = root.join(format!("{VERSION}.incomplete-{stamp}"));
            fs::rename(&destination, backup).map_err(io_error)?;
        }
        fs::rename(temporary.path(), &destination).map_err(io_error)?;
    }
    for asset in files(id)? {
        download(root, asset, &client, token, events).await?;
    }
    let disabled = root.join(format!("{id}.disabled"));
    if disabled.exists() {
        fs::remove_file(disabled).map_err(io_error)?;
    }
    emit(
        events,
        "Modelo local listo para crear en el chat",
        Some(100),
    );
    let _ = events.send(LocalModelDownloadEvent::Done {
        model_id: id.into(),
    });
    Ok(())
}

async fn begin(state: &AiState, id: &str) -> Result<CancellationToken, Diagnostic> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(io_error("El identificador de la operación no es válido."));
    }
    let token = CancellationToken::new();
    let mut active = state.active.lock().await;
    if active.contains_key(id) {
        return Err(io_error("Esta operación ya está activa."));
    }
    active.insert(id.into(), token.clone());
    Ok(token)
}

#[tauri::command]
pub async fn download_local_media_model(
    app: AppHandle,
    model_id: String,
    request_id: String,
    on_event: Channel<LocalModelDownloadEvent>,
    state: State<'_, AiState>,
) -> Result<(), Diagnostic> {
    files(&model_id)?;
    let root = root(&app)?;
    let token = begin(&state, &request_id).await?;
    let result = async {
        let _worker = tokio::select! { _ = token.cancelled() => return Err(cancelled()), guard = state.media_worker.lock() => guard };
        install(&root, &model_id, &token, &on_event).await
    }.await;
    state.active.lock().await.remove(&request_id);
    result
}

async fn drain(
    mut stream: impl AsyncRead + Unpin,
    events: &Channel<LocalModelDownloadEvent>,
) -> Result<Vec<u8>, Diagnostic> {
    let mut tail = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut last = None;
    loop {
        let count = stream.read(&mut chunk).await.map_err(io_error)?;
        if count == 0 {
            break;
        }
        tail.extend_from_slice(&chunk[..count]);
        if tail.len() > 32_768 {
            tail.drain(..tail.len() - 32_768);
        }
        if let Some(progress) = parse_progress(&String::from_utf8_lossy(&chunk[..count])) {
            if last != Some(progress) {
                emit(events, "Generando con el modelo local…", Some(progress));
                last = Some(progress);
            }
        }
    }
    Ok(tail)
}
fn parse_progress(text: &str) -> Option<u8> {
    text.split_whitespace()
        .filter_map(|word| {
            let (done, total) = word.split_once('/')?;
            let done = done
                .trim_matches(|c: char| !c.is_ascii_digit())
                .parse::<u32>()
                .ok()?;
            let total = total
                .trim_matches(|c: char| !c.is_ascii_digit())
                .parse::<u32>()
                .ok()?;
            (total > 0 && done <= total && total <= 1000).then(|| (done * 100 / total) as u8)
        })
        .next_back()
}

struct EngineOutput {
    bytes: Vec<u8>,
    mime: &'static str,
    dimensions: u32,
}

// The production process path is shared with opt-in hardware integration tests.
// Tests use a private directory and never access user chats or provider credentials.
async fn run_engine(
    root: &Path,
    request: &MediaGenerationRequest,
    events: &Channel<LocalModelDownloadEvent>,
    token: &CancellationToken,
) -> Result<EngineOutput, Diagnostic> {
    emit(events, "Cargando modelo local…", None);
    let temporary = tempfile::tempdir_in(root).map_err(io_error)?;
    let image = request.mode == "image";
    let output_path = temporary
        .path()
        .join(if image { "output.png" } else { "output.webm" });
    let mut command = engine_command(&runtime_directory(root));
    command
        .current_dir(temporary.path())
        .args(["-M", if image { "img_gen" } else { "vid_gen" }, "-m"])
        .arg(root.join(SD15.filename));
    command
        .arg("-p")
        .arg(&request.prompt)
        .arg("-o")
        .arg(&output_path)
        .args([
            "--steps",
            "20",
            "--sampling-method",
            "euler",
            "--cfg-scale",
            if image { "7" } else { "8" },
            "--diffusion-fa",
            "--offload-to-cpu",
        ]);
    let dimensions = if image { 512u32 } else { 384u32 };
    command.args(["-W", &dimensions.to_string(), "-H", &dimensions.to_string()]);
    if !image {
        command
            .arg("--motion-module")
            .arg(root.join(MOTION.filename))
            .args([
                "--scheduler",
                "discrete",
                "--video-frames",
                "8",
                "--fps",
                "8",
            ]);
    }
    if let Some(data) = request.image_data.as_deref() {
        let input_path = temporary.path().join("input.png");
        fs::write(&input_path, super::decode_media_data_url(data)?).map_err(io_error)?;
        command
            .arg("-i")
            .arg(input_path)
            .args(["--strength", "0.75"]);
    }
    let mut child = command.spawn().map_err(io_error)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io_error("No hay salida del motor."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io_error("No hay canal de error del motor."))?;
    let timeout = Duration::from_secs(request.config.max_response_timeout_secs.clamp(180, 1800));
    let finished = tokio::select! {
        _ = token.cancelled() => {
            // Reap before deleting the working directory, especially on Windows.
            let _ = child.kill().await;
            return Err(cancelled());
        },
        finished = tokio::time::timeout(timeout, async { tokio::try_join!(async { child.wait().await.map_err(io_error) }, drain(stdout, events), drain(stderr, events)) }) => {
            match finished {
                Ok(result) => result?,
                Err(_) => {
                    let _ = child.kill().await;
                    return Err(failure("REQUEST_TIMEOUT", "La creación local tardó demasiado", "El proceso local alcanzó el tiempo máximo y se detuvo. Prueba una imagen o un equipo más rápido."));
                }
            }
        },
    };
    if !finished.0.success() {
        let details = format!(
            "{}\n{}",
            String::from_utf8_lossy(&finished.1),
            String::from_utf8_lossy(&finished.2)
        );
        return Err(failure(
            "LOCAL_MEDIA_ERROR",
            "La creación local falló",
            "El motor terminó con error y no se guardó un resultado incompleto.",
        )
        .technical(details));
    }
    emit(events, "Guardando creación local…", None);
    let bytes = fs::read(&output_path).map_err(io_error)?;
    let mime = if image { "image/png" } else { "video/webm" };
    validate_output(&bytes, mime)?;
    Ok(EngineOutput {
        bytes,
        mime,
        dimensions,
    })
}

pub async fn generate(
    app: &AppHandle,
    request: &MediaGenerationRequest,
    events: &Channel<LocalModelDownloadEvent>,
    state: &AiState,
) -> Result<MediaGenerationResult, Diagnostic> {
    let root = root(app)?;
    let assets = files(&request.model)?;
    let expected_mode = if request.model == IMAGE_MODEL {
        "image"
    } else {
        "video"
    };
    if request.mode != expected_mode {
        return Err(io_error(
            "El modelo no coincide con el tipo de creación solicitado.",
        ));
    }
    if root.join(format!("{}.disabled", request.model)).exists()
        || !runtime_ready(&root)
        || !assets.iter().all(|asset| installed_asset(&root, *asset))
    {
        return Err(failure(
            "MODEL_NOT_INSTALLED",
            "Descarga el modelo local",
            "Abre la biblioteca local y pulsa Descargar en este modelo antes de crear.",
        ));
    }
    let token = begin(state, &request.request_id).await?;
    let result = async {
        let _worker = tokio::select! { _ = token.cancelled() => return Err(cancelled()), guard = state.media_worker.lock() => guard };
        let output = run_engine(&root, request, events, &token).await?;
        let directory = super::media_storage_directory(app)?;
        let uri = super::store_media_bytes(&directory, &request.request_id, output.mime, &output.bytes)?;
        Ok(MediaGenerationResult { id: request.request_id.clone(), media_type: expected_mode.into(), data_url: String::new(), uri: Some(uri.to_string_lossy().into_owned()), mime_type: output.mime.into(), provider: request.config.provider, model: request.model.clone(), width: Some(output.dimensions), height: Some(output.dimensions), duration_ms: if expected_mode == "video" { Some(875) } else { None }, seed: Some(42) })
    }.await;
    state.active.lock().await.remove(&request.request_id);
    result
}

fn validate_output(bytes: &[u8], mime: &str) -> Result<(), Diagnostic> {
    let valid = match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() > 32,
        "video/webm" => bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) && bytes.len() > 128,
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(failure(
            "INVALID_RESPONSE",
            "No se generó un archivo válido",
            "El motor no devolvió el formato multimedia esperado.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uninstall_preserves_shared_base_then_removes_only_model_assets() {
        let dir = tempfile::tempdir().unwrap();
        for name in [SD15.filename, MOTION.filename, "keep.png"] {
            fs::write(dir.path().join(name), b"test").unwrap();
        }
        assert!(remove_model_at(dir.path(), "../../keep.png").is_err());
        remove_model_at(dir.path(), IMAGE_MODEL).unwrap();
        assert!(dir.path().join(SD15.filename).exists());
        assert!(dir.path().join(MOTION.filename).exists());
        remove_model_at(dir.path(), VIDEO_MODEL).unwrap();
        assert!(!dir.path().join(SD15.filename).exists());
        assert!(!dir.path().join(MOTION.filename).exists());
        assert!(dir.path().join("keep.png").exists());
    }
    #[test]
    fn uninstalling_video_keeps_an_enabled_image_model() {
        let dir = tempfile::tempdir().unwrap();
        for name in [SD15.filename, MOTION.filename] {
            fs::write(dir.path().join(name), b"test").unwrap();
        }
        remove_model_at(dir.path(), VIDEO_MODEL).unwrap();
        assert!(dir.path().join(SD15.filename).exists());
        assert!(!dir.path().join(MOTION.filename).exists());
    }
    #[test]
    fn managed_catalog_and_arguments_do_not_claim_chat_capabilities() {
        assert_eq!(files(IMAGE_MODEL).unwrap().len(), 1);
        assert_eq!(files(VIDEO_MODEL).unwrap().len(), 2);
        assert!(files("../../escape").is_err());
        for item in catalog() {
            assert_eq!(item.runtimes, vec!["vareliox"]);
            assert!(!item.capabilities.iter().any(|cap| cap == "Chat"));
        }
    }
    #[test]
    fn download_markers_require_the_complete_regular_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(SD15.filename), "partial").unwrap();
        fs::write(
            dir.path().join(format!("{}.sha256", SD15.filename)),
            SD15.hash,
        )
        .unwrap();
        assert!(!installed_asset(dir.path(), SD15));
    }
    #[test]
    fn rejects_empty_or_wrong_generated_media_and_parses_progress() {
        assert!(validate_output(b"", "image/png").is_err());
        assert!(validate_output(b"error", "video/webm").is_err());
        assert_eq!(parse_progress("|====> 4/20 - 10s"), Some(20));
        assert_eq!(parse_progress("file/model"), None);
    }

    #[test]
    fn runtime_archive_cannot_escape_its_directory() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("bad.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
        writer
            .start_file("../escaped", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"not allowed").unwrap();
        writer.finish().unwrap();
        let destination = dir.path().join("runtime");
        fs::create_dir(&destination).unwrap();
        assert!(unpack_runtime(&archive, &destination).is_err());
        assert!(!dir.path().join("escaped").exists());
    }

    #[tokio::test]
    async fn duplicate_requests_and_cancelled_downloads_do_not_activate_models() {
        let state = AiState::default();
        let token = begin(&state, "test-download").await.unwrap();
        assert!(begin(&state, "test-download").await.is_err());
        token.cancel();
        let dir = tempfile::tempdir().unwrap();
        let events = Channel::new(|_| Ok(()));
        assert_eq!(
            install(dir.path(), IMAGE_MODEL, &token, &events)
                .await
                .unwrap_err()
                .code,
            "CANCELLED"
        );
        assert!(!runtime_ready(dir.path()));
        assert!(!installed_asset(dir.path(), SD15));
    }

    #[tokio::test]
    #[ignore = "requires explicitly downloaded model assets and local inference hardware"]
    async fn live_engine_download_install_image_video_and_cancellation() {
        let source = PathBuf::from(
            std::env::var("VARELIOX_MEDIA_TEST_ASSETS")
                .expect("Set VARELIOX_MEDIA_TEST_ASSETS to a private verified asset directory"),
        );
        let output = std::env::var_os("VARELIOX_MEDIA_TEST_OUTPUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| source.clone());
        fs::create_dir_all(&output).unwrap();
        let temporary = tempfile::Builder::new()
            .prefix("Vareliox media test with spaces ")
            .tempdir_in(&source)
            .unwrap();
        let root = temporary.path();
        for (asset, filename) in [
            (runtime_asset().unwrap(), "vulkan.zip"),
            (SD15, "sd15.gguf"),
            (MOTION, "motion.safetensors"),
        ] {
            let original = source.join(filename);
            let path = if original.exists() {
                original
            } else {
                source.join(asset.filename)
            };
            let mut file = fs::File::open(&path).unwrap();
            let mut hash = Sha256::new();
            std::io::copy(&mut file, &mut hash).unwrap();
            assert_eq!(hex::encode(hash.finalize()), asset.hash);
            fs::hard_link(path, root.join(asset.filename)).unwrap();
            fs::write(root.join(format!("{}.sha256", asset.filename)), asset.hash).unwrap();
        }
        let events = Channel::new(|_| Ok(()));
        let token = CancellationToken::new();
        install(root, VIDEO_MODEL, &token, &events).await.unwrap();
        assert!(runtime_ready(root));
        assert!(installed_asset(root, SD15));
        assert!(installed_asset(root, MOTION));
        let mut request = MediaGenerationRequest {
            request_id: "live-image".into(),
            config: ProviderConfig::defaults(ProviderId::Ollama),
            mode: "image".into(),
            model: IMAGE_MODEL.into(),
            prompt: "a friendly brown dog sitting in a sunny park, photograph".into(),
            image_data: None,
        };
        let image = run_engine(root, &request, &events, &token).await.unwrap();
        assert_eq!(image.dimensions, 512);
        assert_eq!(image.mime, "image/png");
        assert!(image.bytes.len() > 1000);
        fs::write(output.join("backend-dog.png"), &image.bytes).unwrap();
        // Exercise the same cancellation registry and production subprocess path.
        request.mode = "video".into();
        request.model = VIDEO_MODEL.into();
        request.request_id = "live-cancel".into();
        let state = AiState::default();
        let token = begin(&state, &request.request_id).await.unwrap();
        let before = fs::read_dir(root).unwrap().count();
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            state
                .active
                .lock()
                .await
                .get(&request.request_id)
                .unwrap()
                .cancel();
        };
        let (result, _) = tokio::join!(run_engine(root, &request, &events, &token), cancel);
        assert_eq!(result.err().unwrap().code, "CANCELLED");
        state.active.lock().await.remove(&request.request_id);
        assert_eq!(fs::read_dir(root).unwrap().count(), before);
        request.request_id = "live-video".into();
        request.prompt = "a friendly dog slowly turning its head, photograph".into();
        // Also check image-to-video, not only the standalone text-to-video smoke test.
        use base64::Engine;
        request.image_data = Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&image.bytes)
        ));
        let video = run_engine(root, &request, &events, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(video.mime, "video/webm");
        assert_eq!(video.dimensions, 384);
        assert!(video.bytes.len() > 1000);
        fs::write(output.join("backend-animation.webm"), &video.bytes).unwrap();
        assert_eq!(fs::read_dir(root).unwrap().count(), before);
    }
}
