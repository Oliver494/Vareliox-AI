use serde::Serialize;
use std::{collections::BTreeSet, path::Path, process::Stdio, time::Duration};
use tauri::AppHandle;
use tokio::{process::Command, time::timeout};

const MAX_GIT_OUTPUT: usize = 512 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatus {
    installed: bool,
    repository: bool,
    branch: Option<String>,
    changes: Vec<String>,
    diagnostic: Option<String>,
}

async fn run_git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = Command::new("git");
    command
        .kill_on_drop(true)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .args(["-c", "color.ui=false", "-c", "core.pager=cat"])
        .args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    timeout(Duration::from_secs(6), command.output())
        .await
        .map_err(|_| "Git tardó demasiado y la operación fue cancelada.".to_string())?
        .map_err(|error| format!("No se pudo iniciar Git: {error}"))
}

fn nul_paths(bytes: &[u8]) -> Result<Vec<String>, String> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| {
            std::str::from_utf8(path)
                .map(|path| path.replace('\\', "/"))
                .map_err(|_| "Git devolvió una ruta que Vareliox no puede representar.".to_string())
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn git_status(root: String) -> Result<GitStatus, String> {
    let root = crate::clean_root(&root)?;
    let output = match run_git(
        &root,
        &[
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=normal",
        ],
    )
    .await
    {
        Ok(output) => output,
        Err(error) if error.to_ascii_lowercase().contains("no se pudo iniciar") => {
            return Ok(GitStatus {
                installed: false,
                repository: false,
                branch: None,
                changes: vec![],
                diagnostic: Some("Git no está instalado o no está disponible en PATH.".into()),
            })
        }
        Err(error) => return Err(error),
    };
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(GitStatus {
            installed: true,
            repository: false,
            branch: None,
            changes: vec![],
            diagnostic: Some(if detail.is_empty() {
                "La carpeta no es un repositorio Git.".into()
            } else {
                detail
            }),
        });
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    let branch = lines
        .next()
        .and_then(|line| line.strip_prefix("## "))
        .map(str::to_string);
    Ok(GitStatus {
        installed: true,
        repository: true,
        branch,
        changes: lines.take(500).map(str::to_string).collect(),
        diagnostic: None,
    })
}

#[tauri::command]
pub(crate) async fn git_diff(root: String) -> Result<String, String> {
    let root = crate::clean_root(&root)?;
    let mut text = String::new();
    for args in [
        vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=3",
            "--",
            ".",
        ],
        vec![
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=3",
            "--",
            ".",
        ],
    ] {
        let output = run_git(&root, &args).await?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        text.push_str(&String::from_utf8_lossy(&output.stdout));
    }
    if text.len() <= MAX_GIT_OUTPUT {
        return Ok(text);
    }
    let mut truncated = text.chars().take(MAX_GIT_OUTPUT).collect::<String>();
    truncated.push_str("\n[Diff truncado por Vareliox Code]\n");
    Ok(truncated)
}

#[tauri::command]
pub(crate) async fn git_commit(root: String, message: String) -> Result<String, String> {
    let root = crate::clean_root(&root)?;
    let message = message.trim();
    if message.is_empty() || message.chars().count() > 120 || message.contains(['\r', '\n']) {
        return Err("El mensaje debe tener entre 1 y 120 caracteres y una sola línea.".into());
    }
    for key in ["user.name", "user.email"] {
        let configured = run_git(&root, &["config", "--get", key]).await?;
        if !configured.status.success() || configured.stdout.is_empty() {
            return Err(format!(
                "Git necesita configurar {key} antes de crear un commit."
            ));
        }
    }
    let add = run_git(&root, &["add", "-A", "--", "."]).await?;
    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).trim().to_string());
    }
    let commit = run_git(
        &root,
        &["commit", "--no-verify", "--no-gpg-sign", "-m", message],
    )
    .await?;
    if !commit.status.success() {
        return Err(format!(
            "Git no pudo crear el commit. Los cambios quedaron preparados en el índice: {}",
            String::from_utf8_lossy(&commit.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&commit.stdout).trim().to_string())
}

#[tauri::command]
pub(crate) async fn git_discard_changes(
    app: AppHandle,
    root: String,
) -> Result<Vec<String>, String> {
    let root = crate::clean_root(&root)?;
    let recovery_dir = crate::recovery_project_dir(&app, &root)?;
    git_discard_changes_inner(root, recovery_dir).await
}

async fn git_discard_changes_inner(
    root: std::path::PathBuf,
    recovery_dir: std::path::PathBuf,
) -> Result<Vec<String>, String> {
    let head = run_git(&root, &["rev-parse", "--verify", "HEAD"]).await?;
    if !head.status.success() {
        return Err(
            "Git necesita al menos un commit antes de poder descartar cambios de forma segura."
                .into(),
        );
    }

    let queries: [&[&str]; 3] = [
        &[
            "diff",
            "--name-only",
            "-z",
            "--no-renames",
            "--diff-filter=ACDMRTUXB",
            "--",
            ".",
        ],
        &[
            "diff",
            "--cached",
            "--name-only",
            "-z",
            "--no-renames",
            "--diff-filter=ACDMRTUXB",
            "--",
            ".",
        ],
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ".",
        ],
    ];
    let mut changed = BTreeSet::new();
    for query in queries {
        let output = run_git(&root, query).await?;
        if !output.status.success() {
            return Err(format!(
                "Git no pudo preparar el descarte: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        changed.extend(nul_paths(&output.stdout)?);
    }
    if changed.is_empty() {
        return Ok(Vec::new());
    }
    if changed.len() > 1_000 {
        return Err(
            "Hay más de 1.000 rutas modificadas. Vareliox canceló el descarte para proteger el proyecto."
                .into(),
        );
    }

    let paths = changed.into_iter().collect::<Vec<_>>();
    for path in &paths {
        crate::validate_planned_project_path(&root, path)?;
    }
    let actions = paths
        .iter()
        .map(|path| crate::AiProjectAction {
            action_type: "write".into(),
            path: path.clone(),
            content: None,
            new_path: None,
        })
        .collect::<Vec<_>>();
    let (manifest, snapshot_dir) = crate::create_recovery_snapshot(&recovery_dir, &root, &actions)?;

    let discard_result = async {
        let restore = run_git(
            &root,
            &[
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                ".",
            ],
        )
        .await?;
        if !restore.status.success() {
            return Err(format!(
                "Git no pudo restaurar los archivos: {}",
                String::from_utf8_lossy(&restore.stderr).trim()
            ));
        }
        for path in &paths {
            let untracked = run_git(
                &root,
                &["ls-files", "--others", "--exclude-standard", "--", path],
            )
            .await?;
            if !untracked.status.success() {
                return Err(
                    "Git no pudo comprobar los archivos nuevos durante el descarte.".into(),
                );
            }
            if !untracked.stdout.is_empty() {
                let candidate = crate::existing_project_path(&root, path)?;
                crate::remove_any(&candidate)?;
            }
        }
        Ok::<(), String>(())
    }
    .await;

    match discard_result {
        Ok(()) => {
            crate::append_action_log(&recovery_dir, &manifest, "git_discarded");
            Ok(paths)
        }
        Err(error) => {
            let rollback = crate::restore_recovery_snapshot(&root, &snapshot_dir, &manifest);
            crate::append_action_log(&recovery_dir, &manifest, "git_discard_failed");
            match rollback {
                Ok(_) => Err(format!(
                    "{error} Vareliox restauró la copia de recuperación."
                )),
                Err(rollback_error) => Err(format!(
                    "{error} La recuperación automática también falló: {rollback_error}"
                )),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn status_outside_a_repository_is_safe() {
        let root = tempfile::tempdir().unwrap();
        let result = git_status(root.path().to_string_lossy().to_string())
            .await
            .unwrap();
        assert!(result.installed || result.diagnostic.is_some());
        assert!(!result.repository);
    }

    #[tokio::test]
    async fn commit_rejects_multiline_and_empty_messages() {
        let root = tempfile::tempdir().unwrap();
        assert!(
            git_commit(root.path().to_string_lossy().to_string(), "".into())
                .await
                .is_err()
        );
        assert!(
            git_commit(root.path().to_string_lossy().to_string(), "one\ntwo".into())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn creates_a_local_commit_without_running_hooks() {
        let root = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .current_dir(root.path())
                .args(args)
                .output()
        };
        if run(&["init"]).is_err() {
            return;
        }
        assert!(run(&["config", "user.name", "Vareliox Test"])
            .unwrap()
            .status
            .success());
        assert!(run(&["config", "user.email", "nova@example.invalid"])
            .unwrap()
            .status
            .success());
        std::fs::write(root.path().join("file.txt"), "hello").unwrap();
        let result = git_commit(
            root.path().to_string_lossy().to_string(),
            "test commit".into(),
        )
        .await
        .unwrap();
        assert!(result.contains("test commit"));
        assert!(run(&["status", "--porcelain"]).unwrap().stdout.is_empty());
    }

    #[tokio::test]
    async fn discards_tracked_and_untracked_changes_with_a_recovery_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .current_dir(root.path())
                .args(args)
                .output()
                .unwrap()
        };
        if !run(&["init"]).status.success() {
            return;
        }
        assert!(run(&["config", "user.name", "Vareliox Test"])
            .status
            .success());
        assert!(run(&["config", "user.email", "nova@example.invalid"])
            .status
            .success());
        std::fs::write(root.path().join("tracked.txt"), "baseline").unwrap();
        assert!(run(&["add", "tracked.txt"]).status.success());
        assert!(run(&["commit", "--no-gpg-sign", "-m", "baseline"])
            .status
            .success());
        std::fs::write(root.path().join("tracked.txt"), "changed").unwrap();
        std::fs::write(root.path().join("new file.txt"), "untracked").unwrap();

        let discarded = git_discard_changes_inner(
            crate::clean_root(&root.path().to_string_lossy()).unwrap(),
            recovery.path().to_path_buf(),
        )
        .await
        .unwrap();
        assert_eq!(
            discarded,
            vec!["new file.txt".to_string(), "tracked.txt".to_string()]
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("tracked.txt")).unwrap(),
            "baseline"
        );
        assert!(!root.path().join("new file.txt").exists());

        let snapshot_dir = std::fs::read_dir(recovery.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| path.join("manifest.json").is_file())
            .unwrap();
        let manifest: crate::RecoveryManifest =
            serde_json::from_slice(&std::fs::read(snapshot_dir.join("manifest.json")).unwrap())
                .unwrap();
        crate::restore_recovery_snapshot(
            &crate::clean_root(&root.path().to_string_lossy()).unwrap(),
            &snapshot_dir,
            &manifest,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("tracked.txt")).unwrap(),
            "changed"
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("new file.txt")).unwrap(),
            "untracked"
        );
    }

    #[test]
    fn parses_nul_separated_git_paths() {
        assert_eq!(
            nul_paths(b"src/main.rs\0folder/file name.txt\0").unwrap(),
            vec!["src/main.rs", "folder/file name.txt"]
        );
        assert!(nul_paths(&[0xff, 0]).is_err());
    }
}
