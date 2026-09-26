use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, State};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::{mpsc, Mutex},
};
use tokio_util::sync::CancellationToken;

const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_COMMAND_SECS: u64 = 900;

// Some Windows installers (including Nmap) do not add their program folder to
// PATH. Make commonly used local tools available to Vareliox's child process only;
// this does not alter the user's global Windows configuration.
#[cfg(target_os = "windows")]
fn add_known_windows_tool_paths(process: &mut Command) {
    let tool_paths = [
        PathBuf::from(r"C:\Program Files\Nmap"),
        PathBuf::from(r"C:\Program Files (x86)\Nmap"),
    ];
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    let mut changed = false;
    for path in tool_paths {
        if path.join("nmap.exe").is_file()
            && !paths.iter().any(|existing| {
                existing
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&path.to_string_lossy())
            })
        {
            paths.push(path);
            changed = true;
        }
    }
    if changed {
        if let Ok(value) = std::env::join_paths(paths) {
            process.env("PATH", value);
        }
    }
}

pub struct AgentRuntime {
    active: Mutex<HashMap<String, CancellationToken>>,
}
impl Default for AgentRuntime {
    fn default() -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolSpec {
    id: &'static str,
    description: &'static str,
    risk: &'static str,
    permission: &'static str,
    timeout_secs: u64,
    cancellable: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCommand {
    id: String,
    label: String,
    program: String,
    args: Vec<String>,
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandRequest {
    request_id: String,
    root: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    timeout_secs: u64,
    #[serde(default)]
    terminal_mode: String,
    #[serde(default)]
    shell: String,
    #[serde(default)]
    command: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum AgentCommandEvent {
    Started {
        command: String,
    },
    Output {
        stream: String,
        text: String,
    },
    Finished {
        exit_code: Option<i32>,
        duration_ms: u64,
        truncated: bool,
    },
    Cancelled,
    Error {
        code: String,
        title: String,
        explanation: String,
        action: String,
    },
}

#[tauri::command]
pub fn list_agent_tools() -> Vec<AgentToolSpec> {
    vec![
        AgentToolSpec {
            id: "list_directory",
            description: "Lista contenido dentro del proyecto",
            risk: "low",
            permission: "read",
            timeout_secs: 10,
            cancellable: false,
        },
        AgentToolSpec {
            id: "read_file",
            description: "Lee un archivo de texto seguro",
            risk: "low",
            permission: "read",
            timeout_secs: 10,
            cancellable: false,
        },
        AgentToolSpec {
            id: "search_text",
            description: "Busca texto en archivos del proyecto",
            risk: "low",
            permission: "read",
            timeout_secs: 30,
            cancellable: true,
        },
        AgentToolSpec {
            id: "write_file",
            description: "Crea o modifica un archivo mostrando diff",
            risk: "medium",
            permission: "write",
            timeout_secs: 10,
            cancellable: false,
        },
        AgentToolSpec {
            id: "delete_path",
            description: "Elimina un elemento tras aprobación explícita",
            risk: "high",
            permission: "destructive",
            timeout_secs: 10,
            cancellable: false,
        },
        AgentToolSpec {
            id: "run_command",
            description: "Ejecuta una herramienta permitida dentro del proyecto",
            risk: "medium",
            permission: "execute",
            timeout_secs: MAX_COMMAND_SECS,
            cancellable: true,
        },
        AgentToolSpec {
            id: "run_tests",
            description: "Ejecuta las pruebas detectadas del proyecto",
            risk: "medium",
            permission: "execute",
            timeout_secs: MAX_COMMAND_SECS,
            cancellable: true,
        },
        AgentToolSpec {
            id: "run_build",
            description: "Compila el proyecto con un comando detectado",
            risk: "medium",
            permission: "execute",
            timeout_secs: MAX_COMMAND_SECS,
            cancellable: true,
        },
    ]
}

fn canonical_root(value: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(value)
        .canonicalize()
        .map_err(|_| "La carpeta del proyecto no existe o no es accesible.".to_string())?;
    if !root.is_dir() {
        return Err("La ruta asignada no es una carpeta.".into());
    }
    Ok(root)
}

fn safe_cwd(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let requested = Path::new(relative.trim());
    let candidate = if relative.trim().is_empty() {
        root.to_path_buf()
    } else if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        root.join(requested)
    };
    let cwd = candidate
        .canonicalize()
        .map_err(|_| "La carpeta de ejecución no existe.".to_string())?;
    if !cwd.starts_with(root) || !cwd.is_dir() {
        return Err("La carpeta de ejecución está fuera de la ubicación autorizada.".into());
    }
    Ok(cwd)
}

fn is_system_info_request(request: &AgentCommandRequest) -> bool {
    let has_shell_command = request
        .command
        .as_deref()
        .is_some_and(|command| !command.trim().is_empty());
    !has_shell_command
        && request
            .program
            .trim()
            .eq_ignore_ascii_case("nova-system-info")
}

fn allowed_program(value: &str) -> Option<&'static str> {
    let name = value.trim().to_ascii_lowercase();
    match name.trim_end_matches(".exe").trim_end_matches(".cmd") {
        "npm" => Some(if cfg!(target_os = "windows") {
            "npm.cmd"
        } else {
            "npm"
        }),
        "npx" => Some(if cfg!(target_os = "windows") {
            "npx.cmd"
        } else {
            "npx"
        }),
        "pnpm" => Some(if cfg!(target_os = "windows") {
            "pnpm.cmd"
        } else {
            "pnpm"
        }),
        "yarn" => Some(if cfg!(target_os = "windows") {
            "yarn.cmd"
        } else {
            "yarn"
        }),
        "cargo" => Some("cargo"),
        "rustc" => Some("rustc"),
        "python" | "py" => Some(if cfg!(target_os = "windows") {
            "python"
        } else {
            "python3"
        }),
        "pytest" => Some("pytest"),
        "dotnet" => Some("dotnet"),
        "go" => Some("go"),
        "java" => Some("java"),
        "mvn" => Some(if cfg!(target_os = "windows") {
            "mvn.cmd"
        } else {
            "mvn"
        }),
        "gradle" => Some("gradle"),
        "git" => Some("git"),
        "systeminfo" if cfg!(target_os = "windows") => Some("systeminfo"),
        "wmic" if cfg!(target_os = "windows") => Some("wmic"),
        "df" if !cfg!(target_os = "windows") => Some("df"),
        "free" if cfg!(target_os = "linux") => Some("free"),
        "uname" if !cfg!(target_os = "windows") => Some("uname"),
        "ls" if !cfg!(target_os = "windows") => Some("ls"),
        "pwd" if !cfg!(target_os = "windows") => Some("pwd"),
        "du" if !cfg!(target_os = "windows") => Some("du"),
        _ => None,
    }
}

fn validate_args(args: &[String]) -> Result<(), String> {
    if args.len() > 40
        || args.iter().any(|arg| {
            arg.len() > 500
                || arg.contains('\0')
                || ["&&", "||", ";", "`", "$(`", ">", "<"]
                    .iter()
                    .any(|token| arg.contains(token))
        })
    {
        return Err("El comando contiene operadores de shell o argumentos no seguros.".into());
    }
    let joined = args.join(" ").to_ascii_lowercase();
    let blocked = [
        "--global",
        " -g ",
        "install -g",
        "uninstall -g",
        "publish",
        "curl",
        "wget",
        "powershell",
        "cmd /c",
        "rm -rf",
        "rmdir /s",
        "format",
        "shutdown",
    ];
    if blocked.iter().any(|item| joined.contains(item)) {
        return Err("El comando intenta instalar globalmente, publicar, descargar scripts o modificar el sistema.".into());
    }
    Ok(())
}

fn shell_command(request: &AgentCommandRequest) -> Result<Option<(String, Vec<String>)>, String> {
    let Some(command) = request
        .command
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    if !matches!(request.terminal_mode.as_str(), "shell" | "admin") {
        return Err("La terminal completa no está autorizada en Configuración > Terminal.".into());
    }
    if command.trim().is_empty() || command.len() > 8_000 || command.contains('\0') {
        return Err("El comando de terminal está vacío o es demasiado largo.".into());
    }
    #[cfg(target_os = "windows")]
    {
        let selected = match request.shell.as_str() {
            "cmd" => "cmd",
            "powershell" | "automatic" | "" => "powershell",
            _ => return Err("Ese intérprete no está disponible en Windows.".into()),
        };
        return Ok(Some(if selected == "cmd" {
            (
                "cmd.exe".into(),
                vec!["/D".into(), "/S".into(), "/C".into(), command.into()],
            )
        } else {
            (
                "powershell.exe".into(),
                vec![
                    "-NoLogo".into(),
                    "-NoProfile".into(),
                    "-NonInteractive".into(),
                    "-Command".into(),
                    format!("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $OutputEncoding = [Console]::OutputEncoding; $ErrorActionPreference = 'Stop'; {command}\nif (-not $?) {{ exit 1 }}; if ($null -ne $LASTEXITCODE) {{ exit $LASTEXITCODE }}"),
                ],
            )
        }));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = match request.shell.as_str() {
            "zsh" => "/bin/zsh",
            "bash" => "/bin/bash",
            "automatic" | "" if cfg!(target_os = "macos") => "/bin/zsh",
            "automatic" | "" => "/bin/bash",
            _ => return Err("Ese intérprete no está disponible en este sistema.".into()),
        };
        if !Path::new(shell).is_file() {
            return Err(format!("No se encontró {shell} en este equipo."));
        }
        return Ok(Some((shell.into(), vec!["-lc".into(), command.into()])));
    }
}

#[tauri::command]
pub fn detect_project_commands(root: String) -> Result<Vec<DetectedCommand>, String> {
    let root = canonical_root(&root)?;
    let mut found = Vec::new();
    let mut add = |id: &str, label: &str, program: &str, args: &[&str], kind: &str| {
        found.push(DetectedCommand {
            id: id.into(),
            label: label.into(),
            program: program.into(),
            args: args.iter().map(|v| v.to_string()).collect(),
            kind: kind.into(),
        })
    };
    if root.join("package.json").is_file() {
        let value = std::fs::read_to_string(root.join("package.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
        let scripts = value
            .as_ref()
            .and_then(|v| v.get("scripts"))
            .and_then(|v| v.as_object());
        if scripts.is_some_and(|s| s.contains_key("test")) {
            add("npm-test", "Ejecutar pruebas", "npm", &["test"], "test");
        }
        if scripts.is_some_and(|s| s.contains_key("build")) {
            add(
                "npm-build",
                "Compilar proyecto",
                "npm",
                &["run", "build"],
                "build",
            );
        }
        if scripts.is_some_and(|s| s.contains_key("lint")) {
            add(
                "npm-lint",
                "Comprobar código",
                "npm",
                &["run", "lint"],
                "check",
            );
        }
    }
    if root.join("Cargo.toml").is_file() {
        add(
            "cargo-test",
            "Ejecutar pruebas Rust",
            "cargo",
            &["test"],
            "test",
        );
        add(
            "cargo-check",
            "Comprobar Rust",
            "cargo",
            &["check"],
            "check",
        );
        add("cargo-build", "Compilar Rust", "cargo", &["build"], "build");
    }
    if root.join("pyproject.toml").is_file()
        || root.join("pytest.ini").is_file()
        || root.join("tests").is_dir()
    {
        add(
            "pytest",
            "Ejecutar pruebas Python",
            "python",
            &["-m", "pytest"],
            "test",
        );
    }
    if root.join("go.mod").is_file() {
        add(
            "go-test",
            "Ejecutar pruebas Go",
            "go",
            &["test", "./..."],
            "test",
        );
        add(
            "go-build",
            "Compilar Go",
            "go",
            &["build", "./..."],
            "build",
        );
    }
    if std::fs::read_dir(&root).ok().is_some_and(|mut entries| {
        entries.any(|e| {
            e.ok()
                .is_some_and(|x| x.path().extension().is_some_and(|v| v == "sln"))
        })
    }) {
        add(
            "dotnet-test",
            "Ejecutar pruebas .NET",
            "dotnet",
            &["test"],
            "test",
        );
        add(
            "dotnet-build",
            "Compilar .NET",
            "dotnet",
            &["build"],
            "build",
        );
    }
    Ok(found)
}

#[tauri::command]
pub async fn run_agent_command(
    request: AgentCommandRequest,
    on_event: Channel<AgentCommandEvent>,
    runtime: State<'_, AgentRuntime>,
) -> Result<(), String> {
    run_command_inner(request, on_event, &runtime).await
}

async fn run_command_inner(
    request: AgentCommandRequest,
    on_event: Channel<AgentCommandEvent>,
    runtime: &AgentRuntime,
) -> Result<(), String> {
    if is_system_info_request(&request) {
        if request.terminal_mode == "disabled" {
            return Err("La terminal está desactivada en Configuración > Terminal.".into());
        }
        if request.request_id.trim().is_empty() {
            return Err("Falta el identificador del proceso.".into());
        }
        let started = Instant::now();
        let _ = on_event.send(AgentCommandEvent::Started {
            command: "nova-system-info".into(),
        });
        // System information is a Vareliox capability, not a shell process. It must
        // also work when the model supplies `/`, an absolute cwd, or no valid
        // project. Use the project only to select its disk when it is available.
        let storage_root = canonical_root(&request.root)
            .ok()
            .map(|path| path.to_string_lossy().to_string());
        let summary = crate::system::system_summary(storage_root).await?;
        let _ = on_event.send(AgentCommandEvent::Output {
            stream: "stdout".into(),
            text: format!("{summary}\n"),
        });
        let _ = on_event.send(AgentCommandEvent::Finished {
            exit_code: Some(0),
            duration_ms: started.elapsed().as_millis() as u64,
            truncated: false,
        });
        return Ok(());
    }
    let root = canonical_root(&request.root)?;
    let cwd = safe_cwd(&root, &request.cwd)?;
    let terminal = shell_command(&request)?;
    let (program, args) = if let Some(value) = terminal {
        value
    } else {
        if request.terminal_mode == "disabled" {
            return Err("La terminal está desactivada en Configuración > Terminal.".into());
        }
        if matches!(request.terminal_mode.as_str(), "shell" | "admin") {
            if request.program.trim().is_empty()
                || request.program.contains('\0')
                || request.args.iter().any(|arg| arg.contains('\0'))
            {
                return Err("El programa o sus argumentos no son válidos.".into());
            }
            (
                allowed_program(&request.program)
                    .unwrap_or(request.program.trim())
                    .to_string(),
                request.args.clone(),
            )
        } else {
            validate_args(&request.args)?;
            let program = allowed_program(&request.program).ok_or_else(|| {
                "El programa solicitado no está en la lista segura de Vareliox Code.".to_string()
            })?;
            (program.to_string(), request.args.clone())
        }
    };
    if request.request_id.trim().is_empty() {
        return Err("Falta el identificador del proceso.".into());
    }
    let timeout = request.timeout_secs.clamp(1, MAX_COMMAND_SECS);
    let token = CancellationToken::new();
    runtime
        .active
        .lock()
        .await
        .insert(request.request_id.clone(), token.clone());
    let display = request
        .command
        .clone()
        .unwrap_or_else(|| format!("{} {}", request.program, request.args.join(" ")))
        .trim()
        .to_string();
    let _ = on_event.send(AgentCommandEvent::Started { command: display });
    let started = Instant::now();
    let mut process = Command::new(program);
    process
        .args(&args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    add_known_windows_tool_paths(&mut process);
    // Vareliox captures stdout/stderr and renders it in its own task card. Avoid
    // flashing a separate CMD/PowerShell window for terminal commands.
    #[cfg(target_os = "windows")]
    process.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    #[cfg(unix)]
    process.process_group(0);
    let mut child = match process.spawn() {
        Ok(child) => child,
        Err(error) => {
            runtime.active.lock().await.remove(&request.request_id);
            return Err(format!("No se pudo iniciar el comando: {error}"));
        }
    };
    let (tx, mut rx) = mpsc::unbounded_channel::<(String, String)>();
    if let Some(pipe) = child.stdout.take() {
        tokio::spawn(read_output(pipe, tx.clone(), "stdout"));
    }
    if let Some(pipe) = child.stderr.take() {
        tokio::spawn(read_output(pipe, tx.clone(), "stderr"));
    }
    drop(tx);
    let mut output = 0usize;
    let mut truncated = false;
    let mut pipes_open = true;
    let mut process_done = false;
    let mut exit_code = None;
    let mut timed_out = false;
    let deadline = tokio::time::sleep(Duration::from_secs(timeout));
    tokio::pin!(deadline);
    let exit = loop {
        tokio::select! {
            _=token.cancelled()=>{ terminate_command(&mut child).await; let _=on_event.send(AgentCommandEvent::Cancelled); break None; }
            _=&mut deadline=>{ timed_out = true; terminate_command(&mut child).await; let _=on_event.send(AgentCommandEvent::Error{code:"COMMAND_TIMEOUT".into(),title:"El comando tardó demasiado".into(),explanation:format!("Superó el límite de {timeout} segundos."),action:"Reduce la tarea o aumenta el límite permitido.".into()}); break None; }
            item=rx.recv(), if pipes_open =>{ if let Some((stream,text))=item { if output < MAX_OUTPUT_BYTES { let remaining=MAX_OUTPUT_BYTES-output; let mut end=text.len().min(remaining); while !text.is_char_boundary(end) { end-=1; } let sent=text[..end].to_string(); truncated |= end < text.len(); output+=sent.len(); let _=on_event.send(AgentCommandEvent::Output{stream,text:sent}); } else { truncated=true; } } else { pipes_open=false; } }
            status=child.wait(), if !process_done =>{ exit_code=status.ok().and_then(|s|s.code()); process_done=true; }
        }
        if process_done && !pipes_open {
            break exit_code;
        }
    };
    runtime.active.lock().await.remove(&request.request_id);
    if !token.is_cancelled() && !timed_out {
        let _ = on_event.send(AgentCommandEvent::Finished {
            exit_code: exit,
            duration_ms: started.elapsed().as_millis() as u64,
            truncated,
        });
    }
    Ok(())
}

async fn terminate_command(child: &mut tokio::process::Child) {
    if let Some(id) = child.id() {
        #[cfg(target_os = "windows")]
        {
            let mut command = Command::new("taskkill.exe");
            command
                .args(["/PID", &id.to_string(), "/T", "/F"])
                .creation_flags(0x0800_0000)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            let _ = tokio::time::timeout(Duration::from_secs(3), command.status()).await;
        }
        #[cfg(unix)]
        {
            let _ = Command::new("/bin/kill")
                .args(["-KILL", "--", &format!("-{id}")])
                .status()
                .await;
        }
    }
    let _ = child.kill().await;
}

async fn read_output<R: AsyncRead + Unpin>(
    mut pipe: R,
    tx: mpsc::UnboundedSender<(String, String)>,
    stream: &'static str,
) {
    let mut buffer = [0u8; 4096];
    let mut pending = Vec::new();
    while let Ok(size) = pipe.read(&mut buffer).await {
        if size == 0 {
            break;
        }
        pending.extend_from_slice(&buffer[..size]);
        let end = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => pending.len(),
        };
        if end > 0 {
            if tx
                .send((
                    stream.into(),
                    String::from_utf8_lossy(&pending[..end]).into_owned(),
                ))
                .is_err()
            {
                return;
            }
            pending.drain(..end);
        }
    }
    if !pending.is_empty() {
        let _ = tx.send((
            stream.into(),
            String::from_utf8_lossy(&pending).into_owned(),
        ));
    }
}

#[tauri::command]
pub async fn cancel_agent_command(
    request_id: String,
    runtime: State<'_, AgentRuntime>,
) -> Result<bool, String> {
    if let Some(token) = runtime.active.lock().await.get(&request_id) {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capture_events() -> (
        Channel<AgentCommandEvent>,
        std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
    ) {
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = events.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                captured
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&text).unwrap());
            }
            Ok(())
        });
        (channel, events)
    }

    #[tokio::test]
    async fn detected_project_check_runs_in_a_directory_with_spaces() {
        let temporary = tempfile::Builder::new()
            .prefix("nova npm project ")
            .tempdir()
            .unwrap();
        std::fs::write(
            temporary.path().join("package.json"),
            r#"{"scripts":{"test":"node -e \"console.log('project-check-ok')\""}}"#,
        )
        .unwrap();
        let root = temporary.path().to_string_lossy().into_owned();
        let detected = detect_project_commands(root.clone()).unwrap();
        let task = detected.iter().find(|task| task.id == "npm-test").unwrap();
        let mut request = terminal_request("project", Some(""));
        request.root = root;
        request.program = task.program.clone();
        request.args = task.args.clone();
        let (channel, events) = capture_events();
        run_command_inner(request, channel, &AgentRuntime::default())
            .await
            .unwrap();
        let events = events.lock().unwrap();
        assert_eq!(events.last().unwrap()["exitCode"], 0);
        assert!(events.iter().any(|event| event["text"]
            .as_str()
            .unwrap_or("")
            .contains("project-check-ok")));
    }

    #[tokio::test]
    async fn runner_drains_stdout_stderr_and_retains_failure_code_in_spaced_cwd() {
        let temporary = tempfile::Builder::new()
            .prefix("nova project with spaces ")
            .tempdir()
            .unwrap();
        let runtime = AgentRuntime::default();
        let command = if cfg!(windows) {
            "Write-Output (Get-Location).Path; 1..300 | ForEach-Object { Write-Output $_ }; [Console]::Error.Write('failure'); exit 7"
        } else {
            "pwd; seq 1 300; printf failure >&2; exit 7"
        };
        let mut request = terminal_request("shell", Some(command));
        request.root = temporary.path().to_string_lossy().into_owned();
        let (channel, events) = capture_events();
        run_command_inner(request, channel, &runtime).await.unwrap();
        let events = events.lock().unwrap();
        let output: String = events
            .iter()
            .filter_map(|event| event["text"].as_str())
            .collect();
        assert!(output.contains("nova project with spaces"));
        assert!(output.contains("300"));
        assert!(output.contains("failure"));
        assert_eq!(events.last().unwrap()["exitCode"], 7);
        assert!(runtime.active.lock().await.is_empty());
    }

    #[tokio::test]
    async fn failed_spawn_releases_runtime_and_empty_command_uses_program() {
        let temporary = tempfile::tempdir().unwrap();
        let runtime = AgentRuntime::default();
        let mut request = terminal_request("shell", Some(""));
        request.root = temporary.path().to_string_lossy().into_owned();
        request.program = "nova-nonexistent-test-executable".into();
        let (channel, _) = capture_events();
        assert!(run_command_inner(request, channel, &runtime).await.is_err());
        assert!(runtime.active.lock().await.is_empty());
    }

    #[tokio::test]
    async fn timeout_emits_error_without_false_finished_event() {
        let temporary = tempfile::tempdir().unwrap();
        let runtime = AgentRuntime::default();
        let mut request = terminal_request(
            "shell",
            Some(if cfg!(windows) {
                "Start-Sleep 15"
            } else {
                "sleep 15"
            }),
        );
        request.root = temporary.path().to_string_lossy().into_owned();
        request.timeout_secs = 1;
        let (channel, events) = capture_events();
        run_command_inner(request, channel, &runtime).await.unwrap();
        let events = events.lock().unwrap();
        assert!(events
            .iter()
            .any(|event| event["code"] == "COMMAND_TIMEOUT"));
        assert!(!events.iter().any(|event| event["type"] == "finished"));
        assert!(runtime.active.lock().await.is_empty());
    }

    #[tokio::test]
    async fn cancellation_isolated_from_next_command() {
        let temporary = tempfile::tempdir().unwrap();
        let runtime = AgentRuntime::default();
        let mut request = terminal_request(
            "shell",
            Some(if cfg!(windows) {
                "Start-Sleep 15"
            } else {
                "sleep 15"
            }),
        );
        request.root = temporary.path().to_string_lossy().into_owned();
        let (channel, events) = capture_events();
        let cancel = async {
            for _ in 0..200 {
                if let Some(token) = runtime.active.lock().await.values().next() {
                    token.cancel();
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("command did not start");
        };
        let (result, _) = tokio::join!(run_command_inner(request, channel, &runtime), cancel);
        result.unwrap();
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["type"] == "cancelled"));
        assert!(runtime.active.lock().await.is_empty());
        let mut next = terminal_request("shell", Some("echo ready"));
        next.root = temporary.path().to_string_lossy().into_owned();
        let (channel, events) = capture_events();
        run_command_inner(next, channel, &runtime).await.unwrap();
        assert_eq!(events.lock().unwrap().last().unwrap()["exitCode"], 0);
    }

    fn terminal_request(mode: &str, command: Option<&str>) -> AgentCommandRequest {
        AgentCommandRequest {
            request_id: "test".into(),
            root: ".".into(),
            cwd: "".into(),
            program: "cargo".into(),
            args: vec!["check".into()],
            timeout_secs: 30,
            terminal_mode: mode.into(),
            shell: "automatic".into(),
            command: command.map(str::to_string),
        }
    }
    #[test]
    fn blocks_shell_and_system_commands() {
        assert!(allowed_program("powershell").is_none());
        assert!(validate_args(&["test".into(), "&&".into(), "format".into()]).is_err());
        assert!(validate_args(&["test".into()]).is_ok());
    }
    #[test]
    fn resolves_package_managers_for_the_current_platform() {
        let expected_npm = if cfg!(target_os = "windows") {
            "npm.cmd"
        } else {
            "npm"
        };
        let expected_python = if cfg!(target_os = "windows") {
            "python"
        } else {
            "python3"
        };
        assert_eq!(allowed_program("npm"), Some(expected_npm));
        assert_eq!(allowed_program("python"), Some(expected_python));
    }
    #[test]
    fn full_shell_requires_an_explicit_terminal_level() {
        assert!(shell_command(&terminal_request("project", Some("echo test"))).is_err());
        assert!(shell_command(&terminal_request("disabled", Some("echo test"))).is_err());
        assert!(shell_command(&terminal_request("shell", Some("echo test")))
            .unwrap()
            .is_some());
    }
    #[test]
    fn system_info_accepts_an_empty_shell_field() {
        let mut request = terminal_request("project", Some("   "));
        request.program = " nova-system-info ".into();
        request.cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(is_system_info_request(&request));
    }
    #[test]
    fn absolute_working_directories_follow_the_authorized_root() {
        let authorized = tempfile::tempdir().unwrap();
        let authorized_root = authorized.path().canonicalize().unwrap();
        let inside = authorized.path().join("inside");
        std::fs::create_dir(&inside).unwrap();
        assert_eq!(
            safe_cwd(&authorized_root, &inside.to_string_lossy()).unwrap(),
            inside.canonicalize().unwrap()
        );

        let outside = tempfile::tempdir().unwrap();
        assert!(safe_cwd(&authorized_root, &outside.path().to_string_lossy()).is_err());
    }
    #[test]
    fn detects_project_commands_without_guessing() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("package.json"),
            r#"{"scripts":{"test":"vitest","build":"vite build"}}"#,
        )
        .unwrap();
        let commands = detect_project_commands(temp.path().to_string_lossy().to_string()).unwrap();
        assert!(commands.iter().any(|c| c.id == "npm-test"));
        assert!(commands.iter().any(|c| c.id == "npm-build"));
    }
}
