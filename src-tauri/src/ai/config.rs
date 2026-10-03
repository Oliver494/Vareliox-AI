use super::types::{AiSettings, ProviderConfig, ProviderId};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

fn scope_id(project_path: Option<&str>) -> Result<String, String> {
    match project_path {
        Some(path) => {
            let canonical = Path::new(path)
                .canonicalize()
                .map_err(|_| "El proyecto ya no existe o no es accesible.".to_string())?;
            if !canonical.is_dir() {
                return Err("La ruta del proyecto no es una carpeta.".into());
            }
            Ok(hex::encode(Sha256::digest(
                canonical.to_string_lossy().as_bytes(),
            )))
        }
        None => Ok("global".into()),
    }
}

fn settings_path(app: &AppHandle, project_path: Option<&str>) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("No se pudo abrir la configuración: {error}"))?
        .join("providers");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo preparar la configuración: {error}"))?;
    Ok(directory.join(format!("{}.json", scope_id(project_path)?)))
}

pub fn secret_user(provider: ProviderId, config_id: &str) -> String {
    if provider == ProviderId::Custom {
        let safe_id: String = config_id
            .chars()
            .filter(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':')
            })
            .take(96)
            .collect();
        format!(
            "global:custom:{}",
            if safe_id.is_empty() {
                "default"
            } else {
                &safe_id
            }
        )
    } else {
        format!("global:{}", provider.as_str())
    }
}

pub fn legacy_secret_user(
    provider: ProviderId,
    project_path: Option<&str>,
) -> Result<String, String> {
    Ok(format!("{}:{}", scope_id(project_path)?, provider.as_str()))
}

pub fn load(app: &AppHandle, project_path: Option<&str>) -> Result<AiSettings, String> {
    let path = settings_path(app, project_path)?;
    if !path.exists() {
        return Ok(AiSettings::default());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("No se pudo leer la configuración: {error}"))?;
    let mut settings: AiSettings = serde_json::from_slice(&bytes)
        .map_err(|_| "La configuración de proveedores está dañada.".to_string())?;
    merge_defaults(&mut settings);
    Ok(settings)
}

fn merge_defaults(settings: &mut AiSettings) {
    for provider in [
        ProviderId::Ollama,
        ProviderId::LmStudio,
        ProviderId::OpenAi,
        ProviderId::Anthropic,
        ProviderId::Gemini,
        ProviderId::Nvidia,
        ProviderId::Zai,
        ProviderId::Kimi,
    ] {
        if let Some(item) = settings
            .providers
            .iter_mut()
            .find(|item| item.provider == provider)
        {
            if item.models.chat.trim().is_empty() && !item.model.trim().is_empty() {
                item.models.chat = item.model.clone();
            }
            if item.model.trim().is_empty() && !item.models.chat.trim().is_empty() {
                item.model = item.models.chat.clone();
            }
            if !item.capabilities.iter().any(|value| value == "chat") {
                item.capabilities.push("chat".into());
            }
            if item.provider == ProviderId::Nvidia {
                if !item.capabilities.iter().any(|value| value == "image") {
                    item.capabilities.push("image".into());
                }
                if !item.capabilities.iter().any(|value| value == "video") {
                    item.capabilities.push("video".into());
                }
                if item.models.image.is_empty() {
                    item.models.image = "black-forest-labs/flux.1-schnell".into();
                }
                if item.models.video.is_empty() {
                    item.models.video = "stabilityai/stable-video-diffusion".into();
                }
            }
            if matches!(item.provider, ProviderId::OpenAi | ProviderId::Gemini) {
                if !item.capabilities.iter().any(|value| value == "image") {
                    item.capabilities.push("image".into());
                }
                if item.models.image.is_empty() {
                    item.models.image = ProviderConfig::defaults(provider).models.image;
                }
            }
            if item.config_id.trim().is_empty() {
                item.config_id = provider.as_str().to_string();
            }
            if item.display_name.trim().is_empty() {
                item.display_name = provider.display_name().to_string();
            }
            // Migra solamente los valores que eran los valores predeterminados antiguos.
            // Un valor distinto se considera una elección explícita del usuario.
            let legacy_timeout = if provider.is_local() { 90 } else { 30 };
            if item.first_response_timeout_secs == legacy_timeout {
                item.first_response_timeout_secs =
                    ProviderConfig::defaults(provider).first_response_timeout_secs;
            }
        } else {
            settings.providers.push(ProviderConfig::defaults(provider));
        }
    }

    let mut custom_index = 0usize;
    for item in settings
        .providers
        .iter_mut()
        .filter(|item| item.provider == ProviderId::Custom)
    {
        if item.models.chat.trim().is_empty() && !item.model.trim().is_empty() {
            item.models.chat = item.model.clone();
        }
        if item.model.trim().is_empty() && !item.models.chat.trim().is_empty() {
            item.model = item.models.chat.clone();
        }
        if item.config_id.trim().is_empty() || item.config_id == "custom" {
            item.config_id = if custom_index == 0 {
                "custom:default".to_string()
            } else {
                format!("custom:migrated-{custom_index}")
            };
        }
        if item.display_name.trim().is_empty() || item.display_name == "Proveedor personalizado" {
            item.display_name = "Mi proveedor".to_string();
        }
        custom_index += 1;
    }

    if settings.active_config_id.is_none() {
        settings.active_config_id = settings.active_provider.and_then(|provider| {
            settings
                .providers
                .iter()
                .find(|item| item.provider == provider)
                .map(|item| item.config_id.clone())
        });
    }
}

pub fn save(
    app: &AppHandle,
    project_path: Option<&str>,
    settings: &AiSettings,
) -> Result<(), String> {
    let path = settings_path(app, project_path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta de configuración.".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("No se pudo preparar el guardado: {error}"))?;
    serde_json::to_writer_pretty(&mut temporary, settings)
        .map_err(|error| format!("No se pudo serializar la configuración: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("No se pudo guardar la configuración: {}", error.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::MediaVerification;

    #[test]
    fn provider_keys_use_a_stable_global_credential() {
        assert_eq!(secret_user(ProviderId::Nvidia, "nvidia"), "global:nvidia");
        assert_eq!(
            secret_user(ProviderId::Nvidia, "anything"),
            secret_user(ProviderId::Nvidia, "nvidia")
        );
        assert_ne!(
            secret_user(ProviderId::Custom, "custom:one"),
            secret_user(ProviderId::Custom, "custom:two")
        );
    }

    #[test]
    fn migrates_only_the_old_default_start_timeout() {
        let mut settings = AiSettings {
            active_provider: None,
            active_config_id: None,
            providers: vec![ProviderConfig::defaults(ProviderId::Nvidia)],
        };
        settings.providers[0].first_response_timeout_secs = 30;
        merge_defaults(&mut settings);
        assert_eq!(
            settings
                .providers
                .iter()
                .find(|item| item.provider == ProviderId::Nvidia)
                .unwrap()
                .first_response_timeout_secs,
            90
        );

        let mut custom = AiSettings {
            active_provider: None,
            active_config_id: None,
            providers: vec![ProviderConfig::defaults(ProviderId::Nvidia)],
        };
        custom.providers[0].first_response_timeout_secs = 45;
        merge_defaults(&mut custom);
        assert_eq!(
            custom
                .providers
                .iter()
                .find(|item| item.provider == ProviderId::Nvidia)
                .unwrap()
                .first_response_timeout_secs,
            45
        );
    }

    #[test]
    fn migrates_multiple_legacy_custom_providers_without_merging_them() {
        let mut first = ProviderConfig::defaults(ProviderId::Custom);
        first.display_name = "DeepSeek".into();
        let mut second = ProviderConfig::defaults(ProviderId::Custom);
        second.display_name = "OpenRouter".into();
        let mut settings = AiSettings {
            active_provider: Some(ProviderId::Custom),
            active_config_id: None,
            providers: vec![first, second],
        };

        merge_defaults(&mut settings);

        let custom: Vec<_> = settings
            .providers
            .iter()
            .filter(|item| item.provider == ProviderId::Custom)
            .collect();
        assert_eq!(custom.len(), 2);
        assert_ne!(custom[0].config_id, custom[1].config_id);
        assert_eq!(custom[0].display_name, "DeepSeek");
        assert_eq!(custom[1].display_name, "OpenRouter");
        assert_eq!(settings.active_config_id.as_deref(), Some("custom:default"));
    }

    #[test]
    fn custom_media_verification_survives_settings_migration_and_json_roundtrip() {
        let mut custom = ProviderConfig::defaults(ProviderId::Custom);
        custom.models.image = "my-image-model".into();
        custom.media_verification = Some(MediaVerification {
            endpoint: custom.endpoint.clone(),
            image_model: custom.models.image.clone(),
        });
        let mut settings = AiSettings {
            active_provider: Some(ProviderId::Custom),
            active_config_id: None,
            providers: vec![custom],
        };
        merge_defaults(&mut settings);
        let restored: AiSettings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        let verification = restored.providers[0].media_verification.as_ref().unwrap();
        assert_eq!(verification.image_model, "my-image-model");
        assert_eq!(verification.endpoint, "http://127.0.0.1:8000/v1");
    }
}
