//! Disk model management. No caller-supplied absolute filesystem paths or shell.
use super::*;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    pub id: String,
    pub name: String,
    pub runtime: String,
}

fn failure(detail: impl Into<String>) -> Diagnostic {
    Diagnostic::new(
        "MODEL_MANAGEMENT_ERROR",
        "No se pudo gestionar el modelo",
        detail,
        "El modelo o su ubicación no están disponibles.",
        "Actualiza la lista; descarga el modelo si lo necesitas de nuevo.",
        true,
    )
}

fn local_endpoint(config: &ProviderConfig) -> Result<(), Diagnostic> {
    let url = url::Url::parse(&config.endpoint).map_err(|_| failure("Endpoint no válido"))?;
    if !config.provider.is_local()
        || url.scheme() != "http"
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(failure(
            "Solo se pueden eliminar modelos de este equipo, no de un servidor remoto.",
        ));
    }
    Ok(())
}

async fn lm_values(subcommand: &str) -> Result<Vec<Value>, Diagnostic> {
    let cli = super::find_lms_cli()
        .ok_or_else(|| failure("No se encontró la herramienta lms de LM Studio."))?;
    let mut command = tokio::process::Command::new(cli);
    command.args([subcommand, "--json"]).kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(20), command.output())
        .await
        .map_err(|_| failure("LM Studio tardó demasiado al listar modelos."))?
        .map_err(|error| failure(error.to_string()))?;
    if !output.status.success() {
        return Err(failure("LM Studio no pudo listar sus modelos en disco."));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| failure("LM Studio devolvió una lista de modelos no válida."))
}

async fn lm_models() -> Result<Vec<Value>, Diagnostic> {
    lm_values("ls").await
}

fn lm_root() -> Result<PathBuf, Diagnostic> {
    let home = std::env::var_os(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    })
    .ok_or_else(|| failure("No se encontró la carpeta del usuario."))?;
    let base = PathBuf::from(home).join(".lmstudio");
    let settings: Value = fs::read(base.join("settings.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null);
    Ok(settings
        .get("downloadsFolder")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join("models")))
}

fn checked_model_file(root: &Path, relative: &str) -> Result<PathBuf, Diagnostic> {
    let path = Path::new(relative);
    if path.components().count() < 2
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(failure(
            "La ruta del modelo no es una ruta relativa segura.",
        ));
    }
    let root = root
        .canonicalize()
        .map_err(|error| failure(error.to_string()))?;
    let mut target = root.clone();
    for part in path.components() {
        target.push(part);
        let metadata = fs::symlink_metadata(&target).map_err(|error| failure(error.to_string()))?;
        if metadata.file_type().is_symlink() {
            return Err(failure(
                "No se eliminan modelos a través de enlaces simbólicos.",
            ));
        }
    }
    if !target.is_file()
        || !target
            .canonicalize()
            .map_err(|error| failure(error.to_string()))?
            .starts_with(&root)
    {
        return Err(failure(
            "Este formato contiene varios archivos; elimínalo desde LM Studio.",
        ));
    }
    Ok(target)
}

#[tauri::command]
pub async fn list_installed_local_models(
    app: AppHandle,
    config: ProviderConfig,
    state: State<'_, AiState>,
) -> Result<Vec<InstalledModel>, Diagnostic> {
    local_endpoint(&config)?;
    let mut models: Vec<_> = local_media::list_local_media_models(app)?
        .into_iter()
        .map(|model| InstalledModel {
            id: model.id,
            name: model.name,
            runtime: "vareliox".into(),
        })
        .collect();
    if config.provider == ProviderId::LmStudio {
        models.extend(lm_models().await?.into_iter().filter_map(|model| {
            Some(InstalledModel {
                id: model.get("path")?.as_str()?.into(),
                name: model
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or("Modelo LM Studio")
                    .into(),
                runtime: "lm_studio".into(),
            })
        }));
    } else {
        let chat_models = match models_for(config, None, &state).await {
            Ok(items) => items,
            Err(_) if !models.is_empty() => vec![],
            Err(error) => return Err(error),
        };
        models.extend(chat_models.into_iter().map(|model| InstalledModel {
            id: model.id,
            name: model.name,
            runtime: "ollama".into(),
        }));
    }
    Ok(models)
}

#[tauri::command]
pub async fn remove_installed_local_model(
    app: AppHandle,
    config: ProviderConfig,
    model_id: String,
    runtime: String,
    state: State<'_, AiState>,
) -> Result<Vec<String>, Diagnostic> {
    local_endpoint(&config)?;
    let _worker = state.media_worker.try_lock().map_err(|_| {
        failure("Espera a que termine la generación o descarga antes de eliminar un modelo.")
    })?;
    if !state.active.lock().await.is_empty() {
        return Err(failure(
            "Hay una operación activa. Deténla antes de eliminar modelos.",
        ));
    }
    if runtime == "vareliox" {
        local_media::remove_model(&app, &model_id)?;
        return Ok(vec![model_id]);
    }
    if runtime == "ollama" && config.provider == ProviderId::Ollama {
        if !models_for(config.clone(), None, &state)
            .await?
            .iter()
            .any(|model| model.id == model_id)
        {
            return Err(failure("El modelo ya no está instalado."));
        }
        let response = client_for(&config, &state)
            .await?
            .delete(providers::endpoint(&config, "/api/delete")?)
            .json(&json!({ "model": model_id }))
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|error| failure(error.to_string()))?;
        if !response.status().is_success() {
            return Err(failure(format!(
                "Ollama rechazó la eliminación: HTTP {}",
                response.status()
            )));
        }
        return Ok(vec![model_id]);
    }
    if runtime == "lm_studio" && config.provider == ProviderId::LmStudio {
        let models = lm_models().await?;
        let model = models
            .iter()
            .find(|model| model.get("path").and_then(Value::as_str) == Some(model_id.as_str()))
            .ok_or_else(|| failure("El modelo ya no está instalado."))?;
        let loaded_models = lm_values("ps").await?;
        let key = model
            .get("modelKey")
            .and_then(Value::as_str)
            .unwrap_or(&model_id)
            .to_string();
        if loaded_models.iter().any(|item| {
            ["modelKey", "path", "identifier"].iter().any(|field| {
                item.get(field)
                    .and_then(Value::as_str)
                    .is_some_and(|id| id == key || id == model_id)
            })
        }) {
            return Err(failure(
                "Descarga el modelo de la memoria en LM Studio antes de eliminarlo del disco.",
            ));
        }
        let target = checked_model_file(&lm_root()?, &model_id)?;
        fs::remove_file(target).map_err(|error| failure(error.to_string()))?;
        return Ok(vec![model_id, key]);
    }
    Err(failure(
        "El motor no coincide con el proveedor seleccionado.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_deletion_rejects_traversal_and_preserves_unrelated_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("publisher")).unwrap();
        let model = dir.path().join("publisher/model.gguf");
        fs::write(&model, "test").unwrap();
        for path in [
            "../publisher/model.gguf",
            "/publisher/model.gguf",
            "publisher/../publisher/model.gguf",
            "publisher",
        ] {
            assert!(checked_model_file(dir.path(), path).is_err());
        }
        assert_eq!(
            checked_model_file(dir.path(), "publisher/model.gguf").unwrap(),
            model
        );
        assert!(model.exists());
    }
    #[cfg(unix)]
    #[test]
    fn model_deletion_rejects_symlink_ancestors() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        fs::write(other.path().join("model.gguf"), "keep").unwrap();
        std::os::unix::fs::symlink(other.path(), dir.path().join("publisher")).unwrap();
        assert!(checked_model_file(dir.path(), "publisher/model.gguf").is_err());
        assert!(other.path().join("model.gguf").exists());
    }
}
